:- encoding(utf8).

parse_evolution_level_query(Text, Name) :-
    tokenize_for_match(Text, Tokens),
    ( member(Token, Tokens), evolution_intent_token(Token) ),
    evolution_details_focus_tokens(Tokens),
    ( parse_natural_pokemon_query(Text, Name)
    ; pokemon_identifier_after_preposition(Tokens, Name)
    ).

parse_evolution_should_have_query(Text, Name, CurrentLevel) :-
    tokenize_for_match(Text, Tokens),
    ( member(Token, Tokens), evolution_intent_token(Token) ),
    evolution_should_have_tokens(Tokens),
    level_word_tokens(Tokens),
    ( parse_natural_pokemon_query(Text, Name)
    ; pokemon_identifier_after_preposition(Tokens, Name)
    ),
    extract_levels_from_tokens(Tokens, Levels),
    Levels = [CurrentLevel | _].

evolution_should_have_tokens(Tokens) :-
    member("deveria", Tokens),
    !.
evolution_should_have_tokens(Tokens) :-
    contiguous_sublist(["ja", "deveria"], Tokens),
    !.
evolution_should_have_tokens(Tokens) :-
    contiguous_sublist(["ja", "evoluiu"], Tokens),
    !.
evolution_should_have_tokens(Tokens) :-
    contiguous_sublist(["ja", "deveria", "ter", "evoluido"], Tokens),
    !.

evolution_details_focus_tokens(Tokens) :-
    level_word_tokens(Tokens),
    !.
evolution_details_focus_tokens(Tokens) :-
    evolution_method_tokens(Tokens, _),
    !.
evolution_details_focus_tokens(Tokens) :-
    member(Token, Tokens),
    evolution_detail_token(Token),
    !.

answer_evolution_should_have_query(NameIdentifier, CurrentLevel) :-
    pokemon_info(NameIdentifier, pokemon(ID, NameAtom, _, _, _, _, _)),
    !,
    display_pokemon_name(NameAtom, NameLabel),
    findall(ToID-Trigger-MinLevel-Condition,
        pokemon_evolution(ID, ToID, Trigger, MinLevel, Condition),
        EvolutionsRaw),
    sort(EvolutionsRaw, Evolutions),
    ( Evolutions == [] ->
        format('Bot: ~w não possui evolução registrada na base atual.~n', [NameLabel])
    ; evolution_level_guaranteed_threshold(Evolutions, MinGuaranteed) ->
        answer_evolution_should_have_guaranteed(NameLabel, Evolutions, CurrentLevel, MinGuaranteed)
    ; evolution_level_conditional_threshold(Evolutions, MinConditional) ->
        answer_evolution_should_have_conditional(NameLabel, Evolutions, CurrentLevel, MinConditional)
        ; summarize_evolution_options(Evolutions, Summary),
            format('Bot: ~w não evolui apenas por nível. Possíveis evoluções:~n~w~n', [NameLabel, Summary])
    ).
answer_evolution_should_have_query(NameIdentifier, CurrentLevel) :-
    writeln('Bot: Não consegui identificar o Pokémon para verificar se já deveria ter evoluído.'),
    print_suggestion_for_identifier(evolution_should_have(CurrentLevel), NameIdentifier).

answer_evolution_should_have_guaranteed(NameLabel, Evolutions, CurrentLevel, MinGuaranteed) :-
    ( CurrentLevel >= MinGuaranteed ->
        format('Bot: Sim. No nível ~w, ~w já deveria ter evoluído por level up.~n', [CurrentLevel, NameLabel]),
        evolution_level_eligible_targets(Evolutions, CurrentLevel, Targets),
        ( Targets \= [] ->
            evolution_names_text(Targets, TargetsText),
            format('Bot: Evolução esperada nesse nível: ~w.~n', [TargetsText])
        ; true
        )
    ; Missing is MinGuaranteed - CurrentLevel,
      format('Bot: Ainda não. ~w evolui por nível a partir do ~w (faltam ~w níveis).~n', [NameLabel, MinGuaranteed, Missing])
    ).

answer_evolution_should_have_conditional(NameLabel, Evolutions, CurrentLevel, MinConditional) :-
    summarize_evolution_options(Evolutions, Summary),
    ( CurrentLevel >= MinConditional ->
        format('Bot: Não necessariamente. No nível ~w, ~w pode evoluir, mas depende de requisito extra.~n', [CurrentLevel, NameLabel]),
                format('Bot: Possíveis evoluções:~n~w~n', [Summary])
    ; Missing is MinConditional - CurrentLevel,
      format('Bot: Ainda não por nível. O primeiro gatilho por nível com condição extra aparece em ~w (faltam ~w níveis).~n', [MinConditional, Missing]),
            format('Bot: Possíveis evoluções:~n~w~n', [Summary])
    ).

evolution_level_guaranteed_threshold(Evolutions, MinLevel) :-
    findall(Level,
        ( member(_ToID-level_up-Level-none, Evolutions),
          number(Level)
        ),
        Levels),
    Levels \= [],
    min_list(Levels, MinLevel).

evolution_level_conditional_threshold(Evolutions, MinLevel) :-
    findall(Level,
        ( member(_ToID-level_up-Level-Condition, Evolutions),
          number(Level),
          Condition \= none
        ),
        Levels),
    Levels \= [],
    min_list(Levels, MinLevel).

evolution_level_eligible_targets(Evolutions, CurrentLevel, Targets) :-
    findall(TargetName,
        ( member(ToID-level_up-MinLevel-none, Evolutions),
          number(MinLevel),
          CurrentLevel >= MinLevel,
          evolution_target_label(ToID, TargetName)
        ),
        TargetsRaw),
    sort(TargetsRaw, Targets).

summarize_evolution_options(Evolutions, Summary) :-
    findall(ToLabel,
        ( member(ToID-_-_-_, Evolutions),
          evolution_target_label(ToID, ToLabel)
        ),
        NamesRaw),
    sort(NamesRaw, Names),
    ( Names == [] ->
        Summary = '  - (nenhuma evolução registrada)'
    ; bullet_block_text('  - ', Names, Summary)
    ).

condensed_evolution_summary_text([], 'nenhum caminho conhecido').
condensed_evolution_summary_text(Entries, Summary) :-
    maplist(condensed_evolution_entry_text, Entries, Labels),
    atomic_list_concat(Labels, '; ', Summary).

condensed_evolution_entry_text(detailed(ToID, Trigger, MinLevel, Condition), Text) :-
    evolution_target_label(ToID, ToLabel),
    evolution_condition_text(Trigger, MinLevel, Condition, CondTextRaw),
    strip_trailing_period(CondTextRaw, CondText),
    format(atom(Text), '~w: ~w', [ToLabel, CondText]).
condensed_evolution_entry_text(ambiguous(ToID, Count), Text) :-
    evolution_target_label(ToID, ToLabel),
    format(atom(Text), '~w: ~w caminhos alternativos', [ToLabel, Count]).

strip_trailing_period(TextIn, TextOut) :-
    atom_concat(Stem, '.', TextIn),
    !,
    TextOut = Stem.
strip_trailing_period(Text, Text).

evolution_names_text(Names, Text) :-
    atomic_list_concat(Names, ', ', Text).

answer_evolution_level_query(NameIdentifier) :-
    pokemon_info(NameIdentifier, pokemon(ID, NameAtom, _, _, _, _, _)),
    !,
    display_pokemon_name(NameAtom, NameLabel),
    findall(ToID-Trigger-MinLevel-Condition,
        pokemon_evolution(ID, ToID, Trigger, MinLevel, Condition),
        EvolutionsRaw),
    sort(EvolutionsRaw, Evolutions),
    ( Evolutions \= [] ->
        condense_evolution_options(Evolutions, CondensedEvolutions),
        format('Bot: Evoluções de ~w:~n', [NameLabel]),
        print_evolution_options(CondensedEvolutions)
    ; findall(FromID-Trigger-MinLevel-Condition,
          pokemon_evolution(FromID, ID, Trigger, MinLevel, Condition),
          PreviousRaw),
      sort(PreviousRaw, PreviousEvolutions),
      ( PreviousEvolutions \= [] ->
          format('Bot: ~w não tem evolução posterior registrada.~n', [NameLabel]),
          writeln('Bot: Cadeia anterior conhecida:'),
          print_previous_evolution_options(PreviousEvolutions)
    ; format('Bot: Não encontrei dados de evolução para ~w no momento.~n', [NameLabel])
      )
    ).
answer_evolution_level_query(NameIdentifier) :-
    writeln('Bot: Não consegui identificar o Pokémon para consultar nível de evolução.'),
    print_suggestion_for_identifier(evolution_level, NameIdentifier).

print_evolution_options([]).
print_evolution_options([detailed(ToID, Trigger, MinLevel, Condition) | Rest]) :-
    evolution_target_label(ToID, ToLabel),
    evolution_condition_text(Trigger, MinLevel, Condition, ConditionText),
    format('  - ~w~n', [ConditionText]),
    format('    -> evolui para: ~w~n', [ToLabel]),
    print_evolution_options(Rest).
print_evolution_options([ambiguous(ToID, Count) | Rest]) :-
    evolution_target_label(ToID, ToLabel),
    format('  - Existem ~w caminhos alternativos para evoluir para ~w.~n', [Count, ToLabel]),
    writeln('    -> se quiser, posso detalhar os caminhos específicos desta evolução.'),
    print_evolution_options(Rest).

condense_evolution_options(Evolutions, Condensed) :-
    findall(ToID,
        member(ToID-_-_-_, Evolutions),
        ToIDsRaw),
    sort(ToIDsRaw, ToIDs),
    findall(Entry,
        ( member(ToID, ToIDs),
          condensed_option_entry(ToID, Evolutions, Entry)
        ),
        Condensed).

condensed_option_entry(ToID, Evolutions, detailed(ToID, Trigger, MinLevel, Condition)) :-
    evolution_target_options(ToID, Evolutions, Options),
    option_preferred_item(Options, Trigger-MinLevel-Condition),
    !.
condensed_option_entry(ToID, Evolutions, detailed(ToID, Trigger, MinLevel, Condition)) :-
    evolution_target_options(ToID, Evolutions, [Trigger-MinLevel-Condition]),
    !.
condensed_option_entry(ToID, Evolutions, ambiguous(ToID, Count)) :-
    evolution_target_options(ToID, Evolutions, Options),
    \+ options_have_item_path(Options),
    length(Options, Count),
    Count > 1.

evolution_target_options(ToID, Evolutions, Options) :-
    findall(Trigger-MinLevel-Condition,
        member(ToID-Trigger-MinLevel-Condition, Evolutions),
        Options).

option_preferred_item(Options, Trigger-MinLevel-Condition) :-
    member(Trigger-MinLevel-Condition, Options),
    Trigger == use_item,
    !.

options_have_item_path(Options) :-
    member(Trigger-_-_, Options),
    Trigger == use_item,
    !.

print_previous_evolution_options([]).
print_previous_evolution_options([FromID-Trigger-MinLevel-Condition | Rest]) :-
    evolution_target_label(FromID, FromLabel),
    evolution_condition_text(Trigger, MinLevel, Condition, ConditionText),
    format('  - vem de ~w (~w).~n', [FromLabel, ConditionText]),
    print_previous_evolution_options(Rest).

evolution_target_label(ID, Label) :-
    pokemon_info(ID, pokemon(_, NameAtom, _, _, _, _, _)),
    !,
    display_pokemon_name(NameAtom, Label).
evolution_target_label(ID, Label) :-
    format(atom(Label), '#~w', [ID]).

evolution_condition_text(Trigger, MinLevel, Condition, Text) :-
    evolution_trigger_label(Trigger, TriggerText),
    evolution_level_text(MinLevel, LevelText),
    evolution_extra_condition_text(Condition, ExtraText),
    build_evolution_condition_text(TriggerText, LevelText, ExtraText, Text).

evolution_trigger_label(level_up, 'Evolui por nível').
evolution_trigger_label(trade, 'Evolui por troca').
evolution_trigger_label(use_item, 'Evolui com item').
evolution_trigger_label(use_move, 'Evolui ao aprender/usar golpe específico').
evolution_trigger_label(three_critical_hits, 'Evolui após 3 acertos críticos').
evolution_trigger_label(other, 'Evolui por condição especial').
evolution_trigger_label(Trigger, Text) :-
    display_label(Trigger, TriggerLabel),
    format(atom(Text), 'Evolui por ~w', [TriggerLabel]).

evolution_level_text(none, '').
evolution_level_text(Level, Text) :-
    number(Level),
    format(atom(Text), ' no nível ~w', [Level]).

evolution_extra_condition_text(none, '').
evolution_extra_condition_text(Condition, Text) :-
    evolution_condition_components(Condition, Components),
    Components \= [],
    !,
    maplist(evolution_condition_component_text, Components, Labels),
    atomic_list_concat(Labels, ' + ', DetailsLabel),
    format(atom(Text), ' (requisito: ~w)', [DetailsLabel]).
evolution_extra_condition_text(Condition, Text) :-
    display_label(Condition, CondLabel),
    format(atom(Text), ' (condição: ~w)', [CondLabel]).

evolution_condition_components(Condition, Components) :-
    atom(Condition),
    atom_string(Condition, ConditionText),
    split_string(ConditionText, "_", "", RawTokens),
    include(non_empty_string, RawTokens, Tokens),
    Tokens \= [],
    split_tokens_on_and(Tokens, Groups),
    Groups \= [],
    findall(Component,
        ( member(Group, Groups),
          evolution_condition_group_component(Group, Component)
        ),
        Components),
    Components \= [].

split_tokens_on_and([], []).
split_tokens_on_and(Tokens, Groups) :-
    append(Head, ["and" | Tail], Tokens),
    !,
    ( Head == [] ->
        split_tokens_on_and(Tail, Groups)
    ; split_tokens_on_and(Tail, TailGroups),
      Groups = [Head | TailGroups]
    ).
split_tokens_on_and(Tokens, [Tokens]).

evolution_condition_group_component(["item" | ItemTokens], item(ItemID)) :-
    ItemTokens \= [],
    !,
    atomic_list_concat(ItemTokens, '_', ItemID).
evolution_condition_group_component(["held" | ItemTokens], held_item(ItemID)) :-
    ItemTokens \= [],
    !,
    atomic_list_concat(ItemTokens, '_', ItemID).
evolution_condition_group_component(["happiness", ValueToken], happiness(Value)) :-
    string_number(ValueToken, Value),
    integer(Value),
    !.
evolution_condition_group_component(["affection", ValueToken], affection(Value)) :-
    string_number(ValueToken, Value),
    integer(Value),
    !.
evolution_condition_group_component(["time", TimeToken], time(TimeID)) :-
    !,
    atom_string(TimeID, TimeToken).
evolution_condition_group_component(["location" | LocationTokens], location(LocationID)) :-
    LocationTokens \= [],
    !,
    atomic_list_concat(LocationTokens, '_', LocationID).
evolution_condition_group_component(["move", "type" | TypeTokens], move_type(TypeID)) :-
    TypeTokens \= [],
    !,
    atomic_list_concat(TypeTokens, '_', TypeID).
evolution_condition_group_component(["move" | MoveTokens], move(MoveID)) :-
    MoveTokens \= [],
    !,
    atomic_list_concat(MoveTokens, '_', MoveID).
evolution_condition_group_component(Tokens, raw(RawID)) :-
    atomic_list_concat(Tokens, '_', RawID).

evolution_condition_component_text(item(ItemID), Text) :-
    evolution_item_component_text(ItemID, use_item, Text).
evolution_condition_component_text(held_item(ItemID), Text) :-
    evolution_item_component_text(ItemID, held_item, Text).
evolution_condition_component_text(happiness(Value), Text) :-
    format(atom(Text), 'felicidade ~w+', [Value]).
evolution_condition_component_text(affection(Value), Text) :-
    format(atom(Text), 'afeto ~w+', [Value]).
evolution_condition_component_text(time(TimeID), Text) :-
    evolution_time_component_text(TimeID, Text).
evolution_condition_component_text(location(LocationID), Text) :-
    display_label(LocationID, LocationLabel),
    format(atom(Text), 'local: ~w', [LocationLabel]).
evolution_condition_component_text(move_type(TypeID), Text) :-
    display_type_label(TypeID, TypeLabel),
    format(atom(Text), 'golpe do tipo ~w', [TypeLabel]).
evolution_condition_component_text(move(MoveID), Text) :-
    display_label(MoveID, MoveLabel),
    format(atom(Text), 'conhecer/usar ~w', [MoveLabel]).
evolution_condition_component_text(raw(RawID), Text) :-
    display_label(RawID, Text).

evolution_item_component_text(ItemID, ItemMode, Text) :-
    evolution_item_catalog_lookup(ItemID, ItemLabel),
    ( ItemMode == held_item ->
        format(atom(Prefix), 'segurando ~w', [ItemLabel])
    ; format(atom(Prefix), 'usar item ~w', [ItemLabel])
    ),
    Text = Prefix.

evolution_item_catalog_lookup(ItemID, ItemLabel) :-
    current_predicate(item_entry/6),
    item_entry(ItemID, _Category, _Cost, _FlingPower, _FlingEffect, _Description),
    display_label(ItemID, ItemLabel),
    !.
evolution_item_catalog_lookup(ItemID, ItemLabel) :-
    display_label(ItemID, ItemLabel).

evolution_time_component_text(day, 'durante o dia') :- !.
evolution_time_component_text(night, 'durante a noite') :- !.
evolution_time_component_text(TimeID, Text) :-
    display_label(TimeID, TimeLabel),
    format(atom(Text), 'tempo: ~w', [TimeLabel]).

build_evolution_condition_text(TriggerText, LevelText, '', Text) :-
    format(atom(Text), '~w~w.', [TriggerText, LevelText]).
build_evolution_condition_text(TriggerText, LevelText, ExtraText, Text) :-
    ExtraText \= '',
    format(atom(Text), '~w~w~w.', [TriggerText, LevelText, ExtraText]).

parse_evolution_count_query(Text, Method) :-
    tokenize_for_match(Text, Tokens),
    quantity_intent_tokens(Tokens),
    has_evolution_intent_tokens(Tokens),
    evolution_method_tokens(Tokens, Method).

parse_evolution_structure_query(Text, Kind, Generation) :-
    tokenize_for_match(Text, Tokens),
    has_evolution_intent_tokens(Tokens),
    extract_all_pokemon_mentions(Text, Mentions),
    Mentions == [],
    evolution_structure_kind_from_tokens(Tokens, Kind),
    ( parse_generation_from_tokens(Tokens, ParsedGeneration) -> Generation = ParsedGeneration ; Generation = all ).

parse_evolution_chain_query(Text, Name) :-
    tokenize_for_match(Text, Tokens),
    ( has_evolution_intent_tokens(Tokens)
    ; member(Token, Tokens), evolution_chain_token(Token)
    ),
    ( member(Token, Tokens), evolution_chain_token(Token) ),
    ( parse_natural_pokemon_query(Text, Name)
    ; pokemon_identifier_after_preposition(Tokens, Name)
    ).

has_evolution_intent_tokens(Tokens) :-
    member(Token, Tokens),
    evolution_intent_token(Token),
    !.

evolution_method_tokens(Tokens, level_up) :-
    member("level", Tokens)
    ; member("lv", Tokens)
    ; member("nivel", Tokens)
    ; member("nível", Tokens)
    ; contiguous_sublist(["level", "up"], Tokens).
evolution_method_tokens(Tokens, stone) :-
    member("pedra", Tokens)
    ; member("stone", Tokens)
    ; contiguous_sublist(["uso", "de", "pedra"], Tokens).
evolution_method_tokens(Tokens, happiness) :-
    member("happiness", Tokens)
    ; member("felicidade", Tokens)
    ; member("amizade", Tokens).

evolution_structure_kind_from_tokens(Tokens, three_stage) :-
    ( contiguous_sublist(["3", "estagios"], Tokens)
    ; contiguous_sublist(["3", "estágios"], Tokens)
    ; contiguous_sublist(["tres", "estagios"], Tokens)
    ; contiguous_sublist(["três", "estágios"], Tokens)
    ).
evolution_structure_kind_from_tokens(Tokens, by_method(Method)) :-
    evolution_method_tokens(Tokens, Method),
    ( member("por", Tokens)
    ; member("via", Tokens)
    ; member("com", Tokens)
    ).
evolution_structure_kind_from_tokens(Tokens, non_evolving) :-
    ( contiguous_sublist(["nao", "evoluem"], Tokens)
    ; contiguous_sublist(["não", "evoluem"], Tokens)
    ; contiguous_sublist(["nao", "evolui"], Tokens)
    ; contiguous_sublist(["não", "evolui"], Tokens)
    ).
evolution_structure_kind_from_tokens(Tokens, final_stage) :-
    contiguous_sublist(["estagio", "final"], Tokens)
    ; contiguous_sublist(["estágio", "final"], Tokens)
    ; contiguous_sublist(["forma", "final"], Tokens).

answer_evolution_count_query(Method) :-
    findall(FromID,
        ( pokemon_evolution(FromID, _ToID, Trigger, _MinLevel, Condition),
          evolution_matches_method(Trigger, Condition, Method)
        ),
        FromRaw),
    sort(FromRaw, UniqueFrom),
    length(UniqueFrom, Count),
    evolution_method_label(Method, MethodLabel),
    format('Bot: Existem ~w Pokémon que evoluem por ~w.~n', [Count, MethodLabel]).

evolution_matches_method(Trigger, Condition, level_up) :-
    Trigger == level_up,
    \+ sub_atom(Condition, _, _, _, 'happiness_').
evolution_matches_method(Trigger, Condition, stone) :-
    Trigger == use_item,
    sub_atom(Condition, _, _, _, 'item_'),
    sub_atom(Condition, _, _, _, 'stone').
evolution_matches_method(_Trigger, Condition, happiness) :-
    sub_atom(Condition, _, _, _, 'happiness_').

evolution_method_label(level_up, 'level up').
evolution_method_label(stone, 'uso de pedra').
evolution_method_label(happiness, 'felicidade (happiness)').

answer_evolution_structure_query(Kind, Generation) :-
    evolution_structure_names(Kind, Generation, Names),
    Names \= [],
    !,
    remember_candidate_list(Names),
    length(Names, Count),
    sample_names_text(Names, 12, SampleText),
    evolution_structure_label(Kind, KindLabel),
    generation_scope_text(Generation, ScopeText),
    format('Bot: Encontrei ~w Pokémon para "~w" (~w).~n', [Count, KindLabel, ScopeText]),
    format('  Exemplos: ~w~n', [SampleText]).
answer_evolution_structure_query(Kind, Generation) :-
    evolution_structure_label(Kind, KindLabel),
    generation_scope_text(Generation, ScopeText),
    format('Bot: Não encontrei resultados para "~w" no recorte ~w.~n', [KindLabel, ScopeText]).

answer_evolution_chain_query(NameIdentifier) :-
    pokemon_info(NameIdentifier, pokemon(ID, NameAtom, _, _, _, _, _)),
    !,
    level_gate_species_id(ID, SpeciesID),
    species_family_members(SpeciesID, FamilyIDs),
    sort(FamilyIDs, UniqueFamily),
    findall(Stage-Name,
        ( member(MemberID, UniqueFamily),
          species_stage_index(MemberID, Stage),
          evolution_target_label(MemberID, Name)
        ),
        StagePairs),
    StagePairs \= [],
    family_evolution_transitions(UniqueFamily, FamilyTransitions),
    display_pokemon_name(NameAtom, NameLabel),
    writeln('Bot: Cadeia evolutiva completa:'),
    format('  Referência: ~w~n', [NameLabel]),
    print_chain_by_stage(StagePairs),
    ( FamilyTransitions \= [] ->
        writeln('Bot: Transições e requisitos conhecidos:'),
        print_evolution_tree_edges(FamilyTransitions)
    ; writeln('Bot: Não há transições registradas para essa família na base atual.')
    ).
answer_evolution_chain_query(NameIdentifier) :-
    writeln('Bot: Não consegui identificar o Pokémon para montar a cadeia evolutiva.'),
    print_suggestion_for_identifier(evolution_chain, NameIdentifier).

evolution_structure_names(three_stage, Generation, Names) :-
    scoped_species_ids(Generation, SpeciesIDs),
    findall(Name,
        ( member(SpeciesID, SpeciesIDs),
          species_stage_index(SpeciesID, 1),
          species_max_stage(SpeciesID, 3),
          evolution_target_label(SpeciesID, Name)
        ),
        NamesRaw),
    sort(NamesRaw, Names).
evolution_structure_names(by_method(Method), Generation, Names) :-
    scoped_species_ids(Generation, SpeciesIDs),
    findall(Name,
        ( member(SpeciesID, SpeciesIDs),
          pokemon_evolution(SpeciesID, _ToID, Trigger, _MinLevel, Condition),
          evolution_matches_method(Trigger, Condition, Method),
          evolution_target_label(SpeciesID, Name)
        ),
        NamesRaw),
    sort(NamesRaw, Names).
evolution_structure_names(non_evolving, Generation, Names) :-
    scoped_species_ids(Generation, SpeciesIDs),
    findall(Name,
        ( member(SpeciesID, SpeciesIDs),
          \+ pokemon_evolution(SpeciesID, _ToID, _Trigger, _MinLevel, _Condition),
          evolution_target_label(SpeciesID, Name)
        ),
        NamesRaw),
    sort(NamesRaw, Names).
evolution_structure_names(final_stage, Generation, Names) :-
    scoped_species_ids(Generation, SpeciesIDs),
    findall(Name,
        ( member(SpeciesID, SpeciesIDs),
          species_is_final_stage(SpeciesID),
          evolution_target_label(SpeciesID, Name)
        ),
        NamesRaw),
    sort(NamesRaw, Names).

evolution_structure_label(three_stage, 'cadeias de 3 estágios').
evolution_structure_label(by_method(level_up), 'evolução por level up').
evolution_structure_label(by_method(stone), 'evolução por pedra').
evolution_structure_label(by_method(happiness), 'evolução por felicidade').
evolution_structure_label(non_evolving, 'não evoluem').
evolution_structure_label(final_stage, 'estágio final').

scoped_species_ids(Generation, SpeciesIDs) :-
    findall(SpeciesID,
        ( pokemon_in_scope(ID, _Name, _Height, _Weight, _Types, _Abilities, _Stats),
          generation_filter_matches(Generation, ID),
          level_gate_species_id(ID, SpeciesID)
        ),
        SpeciesRaw),
    sort(SpeciesRaw, SpeciesIDs).

species_is_final_stage(SpeciesID) :-
    \+ pokemon_evolution(SpeciesID, _ToID, _Trigger, _MinLevel, _Condition).

species_stage_index(SpeciesID, Stage) :-
    species_stage_index(SpeciesID, [], Stage).

species_stage_index(SpeciesID, _Visited, 1) :-
    \+ pokemon_evolution(_PrevID, SpeciesID, _Trigger, _MinLevel, _Condition),
    !.
species_stage_index(SpeciesID, Visited, Stage) :-
    findall(PrevStage,
        ( pokemon_evolution(PrevID, SpeciesID, _Trigger, _MinLevel, _Condition),
          \+ member(PrevID, Visited),
          species_stage_index(PrevID, [SpeciesID | Visited], PrevStage)
        ),
        PrevStages),
    PrevStages \= [],
    max_list(PrevStages, MaxPrev),
    Stage is MaxPrev + 1,
    !.
species_stage_index(_SpeciesID, _Visited, 1).

species_max_stage(SpeciesID, MaxStage) :-
    species_family_members(SpeciesID, FamilyIDs),
    findall(Stage,
        ( member(MemberID, FamilyIDs),
          species_stage_index(MemberID, Stage)
        ),
        Stages),
    max_list(Stages, MaxStage).

species_family_members(SpeciesID, FamilyIDs) :-
    species_family_members([SpeciesID], [], FamilyIDs).

species_family_members([], Visited, Visited).
species_family_members([Current | Queue], Visited, FamilyIDs) :-
    ( member(Current, Visited) ->
        species_family_members(Queue, Visited, FamilyIDs)
    ; findall(Next,
          ( pokemon_evolution(Current, Next, _T1, _L1, _C1)
          ; pokemon_evolution(Next, Current, _T2, _L2, _C2)
          ),
          Neighbors),
      append(Queue, Neighbors, NextQueue),
      species_family_members(NextQueue, [Current | Visited], FamilyIDs)
    ).

family_evolution_transitions(FamilyIDs, OrderedTransitions) :-
    findall(StageKey-(FromID-ToID-Trigger-MinLevel-Condition),
        ( member(FromID, FamilyIDs),
          pokemon_evolution(FromID, ToID, Trigger, MinLevel, Condition),
          member(ToID, FamilyIDs),
          species_stage_index(FromID, FromStage),
          species_stage_index(ToID, ToStage),
          StageKey = FromStage-ToStage-FromID-ToID
        ),
        KeyedRaw),
    sort(KeyedRaw, KeyedSorted),
    findall(Transition,
        member(_-Transition, KeyedSorted),
        RawTransitions),
    condense_family_evolution_transitions(RawTransitions, OrderedTransitions).

condense_family_evolution_transitions(RawTransitions, CondensedTransitions) :-
    findall(FromID-ToID,
        member(FromID-ToID-_-_-_, RawTransitions),
        PairKeysRaw),
    sort(PairKeysRaw, PairKeys),
    findall(Edge,
        ( member(FromID-ToID, PairKeys),
          condensed_transition_edge(FromID, ToID, RawTransitions, Edge)
        ),
        CondensedTransitions).

condensed_transition_edge(FromID, ToID, RawTransitions, detailed_edge(FromID, ToID, Trigger, MinLevel, Condition)) :-
    transition_pair_options(FromID, ToID, RawTransitions, Options),
    option_preferred_item(Options, Trigger-MinLevel-Condition),
    !.
condensed_transition_edge(FromID, ToID, RawTransitions, detailed_edge(FromID, ToID, Trigger, MinLevel, Condition)) :-
    transition_pair_options(FromID, ToID, RawTransitions, [Trigger-MinLevel-Condition]),
    !.
condensed_transition_edge(FromID, ToID, RawTransitions, ambiguous_edge(FromID, ToID, Count)) :-
    transition_pair_options(FromID, ToID, RawTransitions, Options),
    \+ options_have_item_path(Options),
    length(Options, Count),
    Count > 1.

transition_pair_options(FromID, ToID, RawTransitions, Options) :-
    findall(Trigger-MinLevel-Condition,
        member(FromID-ToID-Trigger-MinLevel-Condition, RawTransitions),
        Options).

print_evolution_tree_edges([]).
print_evolution_tree_edges([detailed_edge(FromID, ToID, Trigger, MinLevel, Condition) | Rest]) :-
    evolution_target_label(FromID, FromLabel),
    evolution_target_label(ToID, ToLabel),
    evolution_condition_text(Trigger, MinLevel, Condition, ConditionText),
    format('  - ~w -> ~w: ~w~n', [FromLabel, ToLabel, ConditionText]),
    print_evolution_tree_edges(Rest).
print_evolution_tree_edges([ambiguous_edge(FromID, ToID, Count) | Rest]) :-
    evolution_target_label(FromID, FromLabel),
    evolution_target_label(ToID, ToLabel),
    format('  - ~w -> ~w: existem ~w caminhos alternativos.~n', [FromLabel, ToLabel, Count]),
    writeln('    -> se quiser, posso detalhar os caminhos específicos desta evolução.'),
    print_evolution_tree_edges(Rest).

print_chain_by_stage(StagePairs) :-
    findall(Stage, member(Stage-_, StagePairs), StagesRaw),
    max_list(StagesRaw, MaxStage),
    print_chain_stage_lines(1, MaxStage, StagePairs).

print_chain_stage_lines(Stage, MaxStage, _Pairs) :-
    Stage > MaxStage,
    !.
print_chain_stage_lines(Stage, MaxStage, Pairs) :-
    findall(Name, member(Stage-Name, Pairs), NamesRaw),
    sort(NamesRaw, Names),
    ( Names \= [] ->
        atomic_list_concat(Names, ', ', Text),
        format('  - Estágio ~w: ~w~n', [Stage, Text])
    ; true
    ),
    Next is Stage + 1,
    print_chain_stage_lines(Next, MaxStage, Pairs).
