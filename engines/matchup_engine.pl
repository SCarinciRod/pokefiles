:- encoding(utf8).

parse_best_switch_query(Text, TargetName) :-
    tokenize_for_match(Text, Tokens),
    ( best_switch_intent_phrase(Phrase), starts_with_tokens(Tokens, Phrase)
    ; best_switch_intent_phrase(Phrase), contiguous_sublist(Phrase, Tokens)
    ),
    append(_, ["contra" | Tail], Tokens),
    extract_name_from_tokens(Tail, TargetName).

parse_team_compare_query(Text, NameA, NameB) :-
    tokenize_for_match(Text, Tokens),
    ( token_member_pred(Tokens, team_intent_token)
    ; member("equipe", Tokens)
    ; member("comp", Tokens)
    ),
    token_member_pred(Tokens, team_compare_signal_token),
    split_compare_tokens(Tokens, LeftTokens, RightTokens),
    extract_name_from_tokens(LeftTokens, NameA),
    extract_name_from_tokens(RightTokens, NameB),
    NameA \= NameB.

parse_context_filter_query(Text, Filters) :-
    tokenize_for_match(Text, Tokens),
    token_member_pred(Tokens, context_reference_token),
    findall(Filter,
        ( context_filter_token(Filter, FilterTokens),
          contiguous_sublist(FilterTokens, Tokens)
        ),
        FiltersRaw),
    sort(FiltersRaw, Filters),
    Filters \= [].

parse_compare_query(Text, NameA, NameB) :-
    tokenize_for_match(Text, Tokens),
        ( append(_, [IntentToken | Tail], Tokens),
            compare_intent_token(IntentToken)
        ; append(_, [IntentToken, "entre" | Tail], Tokens),
            compare_intent_token(IntentToken)
        ; append(_, ["entre" | Tail], Tokens),
            token_member_pred(Tokens, compare_intent_token)
    ),
    split_compare_tokens(Tail, LeftTokens, RightTokens),
    extract_name_from_tokens(LeftTokens, NameA),
    extract_name_from_tokens(RightTokens, NameB).

parse_battle_sim_query(Text, NameA, NameB) :-
    tokenize_for_match(Text, Tokens),
    battle_intent_tokens(Tokens),
    parse_battle_pair_from_tokens(Tokens, NameA, NameB),
    NameA \= NameB.

parse_ambiguous_two_pokemon_query(Text, NameA, NameB) :-
    tokenize_for_match(Text, Tokens),
    \+ battle_intent_tokens(Tokens),
    \+ starts_with_tokens(Tokens, ["compare"]),
    \+ starts_with_tokens(Tokens, ["comparar"]),
    split_battle_tokens(Tokens, LeftTokens, RightTokens),
    extract_name_from_tokens(LeftTokens, NameA),
    extract_name_from_tokens(RightTokens, NameB),
    NameA \= NameB,
    pokemon_info(NameA, _),
    pokemon_info(NameB, _).

battle_intent_tokens(Tokens) :-
    ( member(Token, Tokens), battle_intent_token(Token)
    ; battle_intent_phrase(Phrase), starts_with_tokens(Tokens, Phrase)
    ),
    !.

parse_battle_pair_from_tokens(Tokens, NameA, NameB) :-
    split_battle_tokens(Tokens, LeftTokens, RightTokens),
    extract_name_from_tokens(LeftTokens, NameA),
    extract_name_from_tokens(RightTokens, NameB),
    NameA \= NameB.
parse_battle_pair_from_tokens(Tokens, NameA, NameB) :-
    battle_relation_phrase(RelationTokens),
    append(LeftAndRelation, RightTokens, Tokens),
    append(LeftTokens, RelationTokens, LeftAndRelation),
    LeftTokens \= [],
    RightTokens \= [],
    extract_name_from_tokens(LeftTokens, NameA),
    extract_name_from_tokens(RightTokens, NameB),
    NameA \= NameB.

split_compare_tokens(Tokens, Left, Right) :-
    append(Left, [Separator | Right], Tokens),
    compare_separator(Separator),
    Left \= [],
    Right \= [],
    !.

compare_separator(Separator) :-
    compare_separator_token(Separator).

split_battle_tokens(Tokens, Left, Right) :-
    append(_, ["entre" | Tail], Tokens),
    ( split_compare_tokens(Tail, Left, Right)
    ; append(Left, ["e" | Right], Tail), Left \= [], Right \= []
    ),
    !.
split_battle_tokens(Tokens, Left, Right) :-
    split_compare_tokens(Tokens, Left, Right),
    !.
split_battle_tokens(Tokens, Left, Right) :-
    append(Left, ["e" | Right], Tokens),
    Left \= [],
    Right \= [].

answer_level_matchup_query(Text, TargetName, TargetLevel, OwnLevel) :-
    extract_all_pokemon_mentions(Text, Mentioned),
    exclude(=(TargetName), Mentioned, RosterNames),
    RosterNames \= [],
    !,
    answer_level_matchup_from_roster(TargetName, TargetLevel, OwnLevel, RosterNames).
answer_level_matchup_query(_Text, TargetName, TargetLevel, OwnLevel) :-
    retractall(pending_level_roster(_, _, _)),
    assertz(pending_level_roster(TargetName, TargetLevel, OwnLevel)),
    display_pokemon_name(TargetName, TargetLabel),
    format('Bot: Entendi: alvo ~w no nível ~w e seu time por volta do nível ~w.~n', [TargetLabel, TargetLevel, OwnLevel]),
    writeln('Bot: Me diga quais Pokémon você tem para eu ranquear suas melhores chances (ex.: "golem, graveler, sandslash").').

answer_level_matchup_from_roster(TargetName, TargetLevel, OwnLevel, RosterNames) :-
    resolve_counter_target(TargetName, pokemon(TargetID, TargetAtom, _, _, TargetTypes, _, TargetStatsRaw), _),
    scale_stats_for_competitive_battle(TargetID, TargetStatsRaw, TargetLevel, TargetStats),
    findall(Score-Name-Winner-Turns,
        ( member(Name, RosterNames),
          once(pokemon_info(Name, pokemon(CandidateID, NameAtom, _, _, Types, _, StatsRaw))),
          scale_stats_for_competitive_battle(CandidateID, StatsRaw, OwnLevel, ScaledStats),
          battle_profile(OwnLevel, CandidateID, Types, ScaledStats, TargetID, TargetTypes, TargetStats, ProfileA),
          battle_profile(TargetLevel, TargetID, TargetTypes, TargetStats, CandidateID, Types, ScaledStats, ProfileB),
          simulate_duel(ProfileA, ProfileB, WinnerSide, Turns),
          ( WinnerSide == a -> Winner = win ; Winner = lose ),
          ( Winner == win -> Score is 100 - (Turns * 5) ; Score is 45 - (Turns * 3) ),
          NameAtom = Name
        ),
        ResultsRaw),
    ResultsRaw \= [],
    keysort(ResultsRaw, Asc),
    reverse(Asc, Ranked),
    take_first_n(Ranked, 6, Top),
    display_pokemon_name(TargetAtom, TargetLabel),
    format('Bot: Melhores chances do seu elenco contra ~w (alvo nível ~w, seu time nível ~w):~n', [TargetLabel, TargetLevel, OwnLevel]),
    print_level_matchup_results(Top),
    writeln('Bot: Observação: considera golpe-chave e habilidade catalogados, mas ainda simplifica item, clima e boosts.').
answer_level_matchup_from_roster(_, _, _, _) :-
    writeln('Bot: Não consegui avaliar esse cenário por nível com os dados informados.').

scale_stats_by_level(BaseStats, Level, ScaledStats) :-
    default_stat_training(EVs, Nature),
    scale_stats_with_training(BaseStats, Level, EVs, Nature, ScaledStats).

scale_stats_for_competitive_battle(PokemonID, BaseStats, Level, ScaledStats) :-
    competitive_training_profile(PokemonID, BaseStats, EVs, Nature),
    scale_stats_with_training(BaseStats, Level, EVs, Nature, ScaledStats).

scale_stats_with_training([], _Level, _EVs, _Nature, []).
scale_stats_with_training([Stat-BaseValue | Rest], LevelRaw, EVs, Nature, [Stat-Scaled | ScaledRest]) :-
    normalized_battle_level(LevelRaw, Level),
    iv_default_for_stat(Stat, IV),
    training_ev_for_stat(EVs, Stat, EV),
    nature_modifier_for_stat(Nature, Stat, NatureModifier),
    final_stat_from_base(Stat, BaseValue, Level, IV, EV, NatureModifier, Scaled),
    scale_stats_with_training(Rest, Level, EVs, Nature, ScaledRest).

normalized_battle_level(LevelRaw, Level) :-
    LevelRounded is round(LevelRaw),
    LevelMin is max(1, LevelRounded),
    Level is min(100, LevelMin).

battle_default_level(50).

default_stat_training(
    evs(0, 0, 0, 0, 0, 0),
    nature(neutral, neutral)
).

iv_default_for_stat(_Stat, 31).

training_ev_for_stat(evs(HP, _Atk, _Def, _SpA, _SpD, _Spe), hp, HP).
training_ev_for_stat(evs(_HP, Atk, _Def, _SpA, _SpD, _Spe), attack, Atk).
training_ev_for_stat(evs(_HP, _Atk, Def, _SpA, _SpD, _Spe), defense, Def).
training_ev_for_stat(evs(_HP, _Atk, _Def, SpA, _SpD, _Spe), special_attack, SpA).
training_ev_for_stat(evs(_HP, _Atk, _Def, _SpA, SpD, _Spe), special_defense, SpD).
training_ev_for_stat(evs(_HP, _Atk, _Def, _SpA, _SpD, Spe), speed, Spe).
training_ev_for_stat(_EVs, _Stat, 0).

nature_modifier_for_stat(nature(Stat, _Down), Stat, 1.1) :-
    Stat \= neutral,
    !.
nature_modifier_for_stat(nature(_Up, Stat), Stat, 0.9) :-
    Stat \= neutral,
    !.
nature_modifier_for_stat(_Nature, _Stat, 1.0).

final_stat_from_base(hp, BaseValue, Level, IV, EV, _NatureModifier, FinalStat) :-
    EVQuarter is floor(EV / 4),
    Interim is floor(((2 * BaseValue + IV + EVQuarter) * Level) / 100),
    FinalStat is max(1, Interim + Level + 10),
    !.
final_stat_from_base(_Stat, BaseValue, Level, IV, EV, NatureModifier, FinalStat) :-
    EVQuarter is floor(EV / 4),
    Interim is floor(((2 * BaseValue + IV + EVQuarter) * Level) / 100),
    PreNature is Interim + 5,
    FinalStat is max(1, floor(PreNature * NatureModifier)).

print_level_matchup_results([]).
print_level_matchup_results([_Score-Name-Winner-Turns | Rest]) :-
    display_pokemon_name(Name, NameLabel),
    ( Winner == win -> Verdict = 'chance boa de vitória'
    ; Verdict = 'duelo desfavorável'
    ),
    ( Turns =:= 1 -> TurnWord = 'turno' ; TurnWord = 'turnos' ),
    format('  - ~w: ~w (estimativa ~w ~w).~n', [NameLabel, Verdict, Turns, TurnWord]),
    print_level_matchup_results(Rest).

answer_best_switch_query(TargetIdentifier) :-
    resolve_counter_target(TargetIdentifier, pokemon(TargetID, TargetName, _, _, TargetTypes, _, _), UsedFallback),
    recommend_best_switches(TargetID, TargetTypes, TopPairs),
    TopPairs \= [],
    !,
    display_pokemon_name(TargetName, TargetLabel),
    switch_pairs_text(TopPairs, SwitchText),
    ( UsedFallback == true ->
        writeln('Bot: Ainda não tenho a ficha da forma especial alvo, então usei a forma base para análise.');
      true
    ),
    extract_switch_names(TopPairs, SwitchNames),
    remember_candidate_list(SwitchNames),
    format('Bot: Quem entra melhor contra ~w:~n~w~n', [TargetLabel, SwitchText]).
answer_best_switch_query(TargetIdentifier) :-
    resolve_counter_target(TargetIdentifier, pokemon(_, TargetName, _, _, _, _, _), _),
    !,
    display_pokemon_name(TargetName, TargetLabel),
    format('Bot: Não encontrei opções sólidas de entrada contra ~w com o filtro atual de geração.~n', [TargetLabel]).
answer_best_switch_query(TargetIdentifier) :-
    writeln('Bot: Não consegui identificar o alvo da análise.'),
    print_suggestion_for_identifier(best_switch, TargetIdentifier).

answer_best_switch_query_with_clarification(TargetIdentifier) :-
    retractall(pending_list_preferences(_)),
    assertz(pending_list_preferences(best_switch(TargetIdentifier))),
    display_pokemon_name(TargetIdentifier, TargetLabel),
    format('Bot: Para analisar quem entra melhor contra ~w, quer aplicar filtros antes?~n', [TargetLabel]),
    writeln('Bot: Você pode responder: "padrão", "sem lendários", "sem mega" ou combinar filtros.').

answer_best_switch_query_with_filters(TargetIdentifier, ContextFilters) :-
    resolve_counter_target(TargetIdentifier, pokemon(TargetID, TargetName, _, _, TargetTypes, _, _), UsedFallback),
    recommend_best_switches_all(TargetID, TargetTypes, Pairs),
    include(switch_pair_passes_filters(ContextFilters), Pairs, FilteredPairs),
    FilteredPairs \= [],
    !,
    take_first_n(FilteredPairs, 6, TopPairs),
    display_pokemon_name(TargetName, TargetLabel),
    switch_pairs_text(TopPairs, SwitchText),
    ( UsedFallback == true ->
        writeln('Bot: Ainda não tenho a ficha da forma especial alvo, então usei a forma base para análise.');
      true
    ),
    extract_switch_names(TopPairs, SwitchNames),
    remember_candidate_list(SwitchNames),
    format('Bot: Com os filtros aplicados, quem entra melhor contra ~w:~n~w~n', [TargetLabel, SwitchText]).
answer_best_switch_query_with_filters(TargetIdentifier, _) :-
    answer_best_switch_query(TargetIdentifier).

answer_context_filter_query(Filters) :-
    last_list_candidates(Names),
    Names \= [],
    !,
    apply_context_filters(Names, Filters, FilteredNames),
    ( FilteredNames \= [] ->
        remember_candidate_list(FilteredNames),
        length(FilteredNames, Count),
        sample_names_text(FilteredNames, 10, SampleText),
        format('Bot: Após aplicar os filtros, restaram ~w Pokémon.~n', [Count]),
        format('  Exemplos: ~w~n', [SampleText])
    ; writeln('Bot: Com esses filtros, a lista ficou vazia.')
    ).
answer_context_filter_query(_) :-
    writeln('Bot: Ainda não tenho uma lista recente para filtrar.').

answer_team_compare_query(NameA, NameB) :-
    pokemon_info(NameA, pokemon(IDA, NameAtomA, _, _, _, _, StatsA)),
    pokemon_info(NameB, pokemon(IDB, NameAtomB, _, _, _, _, StatsB)),
    !,
    answer_compare_query(NameA, NameB),
    display_pokemon_name(NameAtomA, LabelA),
    display_pokemon_name(NameAtomB, LabelB),
    compare_role_profile(IDA, StatsA, _, BucketA),
    compare_role_profile(IDB, StatsB, _, BucketB),
    ( BucketA == BucketB ->
        format('Bot: Para time, ~w e ~w disputam a mesma função principal. Escolha pelo matchup do meta do seu grupo.~n', [LabelA, LabelB])
    ; format('Bot: Para time, ~w e ~w tendem a cumprir funções diferentes e podem até se complementar.~n', [LabelA, LabelB])
    ).
answer_team_compare_query(NameA, NameB) :-
    writeln('Bot: Não consegui montar comparação de função para time.'),
    print_suggestion_for_pair(compare, NameA, NameB).

% ============================================================
% RESPOSTAS: TIPOLOGIA, COMPARA�?�fO E BATALHA
% ============================================================

answer_weak_against_type_query(TypeFilters) :-
    findall(Name,
        ( pokemon_in_scope(_, Name, _, _, Types, _, _),
          pokemon_weak_to_any(TypeFilters, Types)
        ),
        NamesRaw),
    sort(NamesRaw, Names),
    length(Names, Count),
    type_filters_text(TypeFilters, FiltersText),
    format('Bot: Encontrei ~w Pokémon fracos contra ~w.~n', [Count, FiltersText]),
    ( Count > 0 ->
        sample_names_text(Names, 12, SampleText),
        format('  Exemplos: ~w~n', [SampleText])
    ; true
    ).

answer_weak_against_type_query_with_clarification(TypeFilters) :-
    retractall(pending_list_preferences(_)),
    assertz(pending_list_preferences(weak_against(TypeFilters))),
    type_filters_text(TypeFilters, FiltersText),
    format('Bot: Para a lista de fraqueza contra ~w, quer aplicar filtros antes?~n', [FiltersText]),
    writeln('Bot: Você pode responder: "padrão", "sem lendários", "sem mega" ou combinar filtros.').

answer_weak_against_type_query_with_filters(TypeFilters, ContextFilters) :-
    findall(Name,
        ( pokemon_in_scope(_, Name, _, _, Types, _, _),
          pokemon_weak_to_any(TypeFilters, Types)
        ),
        NamesRaw),
    sort(NamesRaw, Names),
    apply_context_filters(Names, ContextFilters, FilteredNames),
    length(FilteredNames, Count),
    type_filters_text(TypeFilters, FiltersText),
    format('Bot: Com os filtros aplicados, encontrei ~w Pokémon fracos contra ~w.~n', [Count, FiltersText]),
    ( Count > 0 ->
        sample_names_text(FilteredNames, 12, SampleText),
        format('  Exemplos: ~w~n', [SampleText])
    ; true
    ).

pokemon_weak_to_any([], _) :- fail.
pokemon_weak_to_any([AttackType | _], DefenseTypes) :-
    combined_multiplier(AttackType, DefenseTypes, Mult),
    Mult > 1.0,
    !.
pokemon_weak_to_any([_ | Rest], DefenseTypes) :-
    pokemon_weak_to_any(Rest, DefenseTypes).

answer_immunity_type_query(TypeFilters) :-
    findall(Name,
        ( pokemon_in_scope(_, Name, _, _, Types, _, _),
          pokemon_immune_to_any(TypeFilters, Types)
        ),
        NamesRaw),
    sort(NamesRaw, Names),
    length(Names, Count),
    type_filters_text(TypeFilters, FiltersText),
    format('Bot: Encontrei ~w Pokémon com imunidade a ~w.~n', [Count, FiltersText]),
    ( Count > 0 ->
        sample_names_text(Names, 12, SampleText),
        format('  Exemplos: ~w~n', [SampleText])
    ; true
    ).

answer_immunity_type_query_with_clarification(TypeFilters) :-
    retractall(pending_list_preferences(_)),
    assertz(pending_list_preferences(immunity(TypeFilters))),
    type_filters_text(TypeFilters, FiltersText),
    format('Bot: Para a lista de imunidade a ~w, quer aplicar filtros antes?~n', [FiltersText]),
    writeln('Bot: Você pode responder: "padrão", "sem lendários", "sem mega" ou combinar filtros.').

answer_immunity_type_query_with_filters(TypeFilters, ContextFilters) :-
    findall(Name,
        ( pokemon_in_scope(_, Name, _, _, Types, _, _),
          pokemon_immune_to_any(TypeFilters, Types)
        ),
        NamesRaw),
    sort(NamesRaw, Names),
    apply_context_filters(Names, ContextFilters, FilteredNames),
    length(FilteredNames, Count),
    type_filters_text(TypeFilters, FiltersText),
    format('Bot: Com os filtros aplicados, encontrei ~w Pokémon com imunidade a ~w.~n', [Count, FiltersText]),
    ( Count > 0 ->
        sample_names_text(FilteredNames, 12, SampleText),
        format('  Exemplos: ~w~n', [SampleText])
    ; true
    ).

pokemon_immune_to_any([], _) :- fail.
pokemon_immune_to_any([AttackType | _], DefenseTypes) :-
    combined_multiplier(AttackType, DefenseTypes, 0.0),
    !.
pokemon_immune_to_any([_ | Rest], DefenseTypes) :-
    pokemon_immune_to_any(Rest, DefenseTypes).

answer_role_type_query(RoleKey, TypeFilters) :-
    findall(Score-Name,
        ( pokemon_in_scope(_, Name, _, _, Types, _, Stats),
          pokemon_matches_optional_type_filters(TypeFilters, Types),
          role_score(RoleKey, Stats, Score)
        ),
        PairsRaw),
    PairsRaw \= [],
    keysort(PairsRaw, PairsAsc),
    reverse(PairsAsc, PairsDesc),
    take_first_n(PairsDesc, 10, TopPairs),
    top_pairs_names_text(TopPairs, TopText),
    role_label_short(RoleKey, RoleText),
    ( TypeFilters == [] ->
        format('Bot: Top perfis ~w no recorte atual: ~w.~n', [RoleText, TopText])
    ; type_filters_text(TypeFilters, FiltersText),
      format('Bot: Top perfis ~w entre os tipos ~w: ~w.~n', [RoleText, FiltersText, TopText])
    ).

pokemon_matches_optional_type_filters([], _).
pokemon_matches_optional_type_filters(TypeFilters, PokemonTypes) :-
    pokemon_matches_type_filters(TypeFilters, PokemonTypes).

pokemon_matches_optional_type_filters_by_name([], _Name).
pokemon_matches_optional_type_filters_by_name(TypeFilters, Name) :-
    pokemon_info(Name, pokemon(_, _, _, _, PokemonTypes, _, _)),
    pokemon_matches_type_filters(TypeFilters, PokemonTypes).

role_score(tank, Stats, Score) :-
    stat_value(Stats, hp, HP),
    stat_value(Stats, defense, Def),
    stat_value(Stats, special_defense, SpDef),
    Score is (HP * 1.3) + Def + SpDef.
role_score(sweeper, Stats, Score) :-
    stat_value(Stats, attack, Atk),
    stat_value(Stats, special_attack, SpAtk),
    stat_value(Stats, speed, Spe),
    Score is (max(Atk, SpAtk) * 1.5) + Spe.

role_label_short(tank, 'tank').
role_label_short(sweeper, 'sweeper').

answer_compare_query(NameA, NameB) :-
    pokemon_info(NameA, pokemon(IDA, NameAtomA, _, _, TypesA, _, StatsA)),
    pokemon_info(NameB, pokemon(IDB, NameAtomB, _, _, TypesB, _, StatsB)),
    !,
    display_pokemon_name(NameAtomA, LabelA),
    display_pokemon_name(NameAtomB, LabelB),
    best_attack_between_types(TypesA, TypesB, AttackAB),
    best_attack_between_types(TypesB, TypesA, AttackBA),
    defensive_pressure_between_types(TypesA, TypesB, DefenseAB),
    defensive_pressure_between_types(TypesB, TypesA, DefenseBA),
    total_stats_value(StatsA, TotalA),
    total_stats_value(StatsB, TotalB),
    compare_role_profile(IDA, StatsA, RoleA, BucketA),
    compare_role_profile(IDB, StatsB, RoleB, BucketB),
    type_effectiveness_summary(TypesA, WeakA, ResistA, ImmuneA),
    type_effectiveness_summary(TypesB, WeakB, ResistB, ImmuneB),
    top_weakness_text(WeakA, WeakAText),
    top_weakness_text(WeakB, WeakBText),
    top_resistance_text(ResistA, ResistAText),
    top_resistance_text(ResistB, ResistBText),
    type_list_text(ImmuneA, ImmunityAText),
    type_list_text(ImmuneB, ImmunityBText),
    multiplier_text(AttackAB, AttackABText),
    multiplier_text(AttackBA, AttackBAText),
    multiplier_text(DefenseAB, DefenseABText),
    multiplier_text(DefenseBA, DefenseBAText),
    format('Bot: Comparação entre ~w e ~w:~n', [LabelA, LabelB]),
    format('  - Ofensivamente, ~w bate em ~w com até ~w.~n', [LabelA, LabelB, AttackABText]),
    format('  - Ofensivamente, ~w bate em ~w com até ~w.~n', [LabelB, LabelA, AttackBAText]),
    format('  - Defensivamente, ~w pode receber até ~w de ~w.~n', [LabelA, DefenseABText, LabelB]),
    format('  - Defensivamente, ~w pode receber até ~w de ~w.~n', [LabelB, DefenseBAText, LabelA]),
    format('  - Base total de status: ~w (~w) vs ~w (~w).~n', [LabelA, TotalA, LabelB, TotalB]),
    print_top_stat_differences(StatsA, StatsB, LabelA, LabelB),
    format('  - Perfil de ~w: ~w.~n', [LabelA, RoleA]),
    format('  - Perfil de ~w: ~w.~n', [LabelB, RoleB]),
    format('  - Fraquezas principais de ~w: ~w.~n', [LabelA, WeakAText]),
    format('  - Fraquezas principais de ~w: ~w.~n', [LabelB, WeakBText]),
    format('  - Resistências principais de ~w: ~w.~n', [LabelA, ResistAText]),
    format('  - Resistências principais de ~w: ~w.~n', [LabelB, ResistBText]),
    format('  - Imunidades de ~w: ~w.~n', [LabelA, ImmunityAText]),
    format('  - Imunidades de ~w: ~w.~n', [LabelB, ImmunityBText]),
    print_compare_duel_deep_summary(IDA, LabelA, TypesA, StatsA, IDB, LabelB, TypesB, StatsB),
    print_role_comparison_note(BucketA, BucketB, LabelA, LabelB).
answer_compare_query(NameA, NameB) :-
    writeln('Bot: Não consegui comparar esses dois Pokémon. Tente: "compare charizard vs blastoise".'),
    print_suggestion_for_pair(compare, NameA, NameB).

print_top_stat_differences(StatsA, StatsB, LabelA, LabelB) :-
    findall(Diff-Stat-Winner-ValueA-ValueB,
        ( comparable_stat(Stat),
          stat_value(StatsA, Stat, ValueA),
          stat_value(StatsB, Stat, ValueB),
          Diff is abs(ValueA - ValueB),
          Diff > 0,
          ( ValueA >= ValueB -> Winner = a ; Winner = b )
        ),
        DiffPairs),
    DiffPairs \= [],
    !,
    keysort(DiffPairs, SortedAsc),
    reverse(SortedAsc, SortedDesc),
    take_first_n(SortedDesc, 3, TopDiffs),
    print_stat_diff_lines(TopDiffs, LabelA, LabelB).
print_top_stat_differences(_, _, _, _).

comparable_stat(hp).
comparable_stat(attack).
comparable_stat(defense).
comparable_stat(special_attack).
comparable_stat(special_defense).
comparable_stat(speed).

print_stat_diff_lines([], _, _).
print_stat_diff_lines([_Diff-Stat-Winner-ValueA-ValueB | Rest], LabelA, LabelB) :-
    display_stat_label(Stat, StatLabel),
    ( Winner == a ->
        format('  - Em ~w, ~w leva vantagem (~w: ~w vs ~w: ~w).~n', [StatLabel, LabelA, LabelA, ValueA, LabelB, ValueB])
    ; format('  - Em ~w, ~w leva vantagem (~w: ~w vs ~w: ~w).~n', [StatLabel, LabelB, LabelB, ValueB, LabelA, ValueA])
    ),
    print_stat_diff_lines(Rest, LabelA, LabelB).

top_weakness_text(Weaknesses, Text) :-
    sort_effects_desc(Weaknesses, Ordered),
    take_first_n(Ordered, 4, Top),
    effect_list_text(Top, Text).

top_resistance_text(Resistances, Text) :-
    sort_effects_asc(Resistances, Ordered),
    take_first_n(Ordered, 4, Top),
    effect_list_text(Top, Text).

sort_effects_desc(Effects, Sorted) :-
    findall(Key-Type-M,
        ( member(Type-M, Effects),
          Key is -M
        ),
        Keyed),
    keysort(Keyed, KeyedSorted),
    findall(Type-M,
        member(_-Type-M, KeyedSorted),
        Sorted).

sort_effects_asc(Effects, Sorted) :-
    findall(M-Type-M,
        member(Type-M, Effects),
        Keyed),
    keysort(Keyed, KeyedSorted),
    findall(Type-M,
        member(_-Type-M, KeyedSorted),
        Sorted).

print_compare_duel_deep_summary(IDA, LabelA, TypesA, StatsA, IDB, LabelB, TypesB, StatsB) :-
    battle_default_level(Level),
    scale_stats_for_competitive_battle(IDA, StatsA, Level, StatsAUsed),
    scale_stats_for_competitive_battle(IDB, StatsB, Level, StatsBUsed),
    battle_profile(Level, IDA, TypesA, StatsAUsed, IDB, TypesB, StatsBUsed, ProfileA),
    battle_profile(Level, IDB, TypesB, StatsBUsed, IDA, TypesA, StatsAUsed, ProfileB),
    simulate_duel(ProfileA, ProfileB, WinnerSide, Turns),
    format('  - Simulação aprofundada 1x1 (nível ~w, golpes + habilidades):~n', [Level]),
    print_duel_deep_block(LabelA, ProfileA, LabelB, ProfileB, WinnerSide, Turns).

print_duel_deep_block(LabelA, ProfileA, LabelB, ProfileB, WinnerSide, Turns) :-
    battle_move_summary_text(ProfileA, MoveAText),
    battle_move_summary_text(ProfileB, MoveBText),
    profile_mode_text(ProfileA.mode, ModeAText),
    profile_mode_text(ProfileB.mode, ModeBText),
    multiplier_text(ProfileA.multiplier, MultAText),
    multiplier_text(ProfileB.multiplier, MultBText),
    multiplier_text(ProfileA.stab, StabAText),
    multiplier_text(ProfileB.stab, StabBText),
    multiplier_text(ProfileA.weather_mod, WeatherAText),
    multiplier_text(ProfileB.weather_mod, WeatherBText),
    multiplier_text(ProfileA.terrain_mod, TerrainAText),
    multiplier_text(ProfileB.terrain_mod, TerrainBText),
    battle_priority_text(ProfileA.priority, PriorityAText),
    battle_priority_text(ProfileB.priority, PriorityBText),
    duel_action_order(ProfileA, ProfileB, ActionOrderA),
    opposite_action_order(ActionOrderA, ActionOrderB),
    counter_action_order_text(ActionOrderA, ActionTextA),
    counter_action_order_text(ActionOrderB, ActionTextB),
    winner_label_by_side(WinnerSide, LabelA, LabelB, WinnerLabel),
    turn_word(Turns, TurnWord),
    battle_field_context_text(ProfileA.weather, ProfileA.terrain, FieldText),
    format('  - Campo assumido: ~w.~n', [FieldText]),
    format('  - ~w ataca pelo lado ~w com ~w (~w, ~w, STAB ~w, clima ~w, terreno ~w, dano ~1f/turno; faixa ~w-~w).~n', [LabelA, ModeAText, MoveAText, MultAText, PriorityAText, StabAText, WeatherAText, TerrainAText, ProfileA.damage, ProfileA.min_damage, ProfileA.max_damage]),
    format('  - ~w ataca pelo lado ~w com ~w (~w, ~w, STAB ~w, clima ~w, terreno ~w, dano ~1f/turno; faixa ~w-~w).~n', [LabelB, ModeBText, MoveBText, MultBText, PriorityBText, StabBText, WeatherBText, TerrainBText, ProfileB.damage, ProfileB.min_damage, ProfileB.max_damage]),
    format('  - Ritmo: ~w ~w e ~w ~w.~n', [LabelA, ActionTextA, LabelB, ActionTextB]),
    format('  - Vencedor provável: ~w (em cerca de ~w ~w).~n', [WinnerLabel, Turns, TurnWord]),
    print_battle_ability_note_if_any(LabelA, ProfileA.ability_note),
    print_battle_ability_note_if_any(LabelB, ProfileB.ability_note).

winner_label_by_side(a, LabelA, _LabelB, LabelA).
winner_label_by_side(b, _LabelA, LabelB, LabelB).

battle_move_summary_text(Profile, Text) :-
    MoveNote = Profile.move_note,
    ( MoveNote \= '' ->
        Text = MoveNote
    ; battle_key_move_text(Profile, Text)
    ).

battle_key_move_text(Profile, Text) :-
    Move = Profile.key_move,
    Move \= none,
    !,
    display_label(Move, Text).
battle_key_move_text(_, 'golpe ofensivo padrão').

battle_priority_text(Priority, Text) :-
    Priority > 0,
    !,
    format(atom(Text), 'prioridade +~w', [Priority]).
battle_priority_text(_, 'sem prioridade').

print_battle_ability_note_if_any(_Label, Note) :-
    Note == '',
    !.
print_battle_ability_note_if_any(Label, Note) :-
    format('  - Habilidade relevante de ~w: ~w.~n', [Label, Note]).

opposite_action_order(first, second).
opposite_action_order(second, first).

battle_field_context_text(none, none, 'sem clima e sem terreno (neutro)') :- !.
battle_field_context_text(Weather, none, Text) :-
    battle_weather_label(Weather, WeatherLabel),
    format(atom(Text), 'clima: ~w; sem terreno', [WeatherLabel]),
    !.
battle_field_context_text(none, Terrain, Text) :-
    battle_terrain_label(Terrain, TerrainLabel),
    format(atom(Text), 'sem clima; terreno: ~w', [TerrainLabel]),
    !.
battle_field_context_text(Weather, Terrain, Text) :-
    battle_weather_label(Weather, WeatherLabel),
    battle_terrain_label(Terrain, TerrainLabel),
    format(atom(Text), 'clima: ~w; terreno: ~w', [WeatherLabel, TerrainLabel]).

battle_weather_label(sun, 'sol intenso').
battle_weather_label(rain, 'chuva').
battle_weather_label(sandstorm, 'tempestade de areia').
battle_weather_label(snow, 'neve').
battle_weather_label(none, 'nenhum clima').

battle_terrain_label(electric, 'elétrico').
battle_terrain_label(grassy, 'gramado').
battle_terrain_label(psychic, 'psíquico').
battle_terrain_label(misty, 'nebuloso').
battle_terrain_label(none, 'nenhum terreno').

answer_battle_sim_query(NameA, NameB) :-
    pokemon_info(NameA, pokemon(IDA, NameAtomA, _, _, TypesA, _, StatsA)),
    pokemon_info(NameB, pokemon(IDB, NameAtomB, _, _, TypesB, _, StatsB)),
    !,
    display_pokemon_name(NameAtomA, LabelA),
    display_pokemon_name(NameAtomB, LabelB),
    battle_default_level(Level),
    scale_stats_for_competitive_battle(IDA, StatsA, Level, StatsAUsed),
    scale_stats_for_competitive_battle(IDB, StatsB, Level, StatsBUsed),
    battle_profile(Level, IDA, TypesA, StatsAUsed, IDB, TypesB, StatsBUsed, ProfileA),
    battle_profile(Level, IDB, TypesB, StatsBUsed, IDA, TypesA, StatsAUsed, ProfileB),
    simulate_duel(ProfileA, ProfileB, WinnerSide, Turns),
    remember_candidate_list([NameAtomA, NameAtomB]),
    format('Bot: Simulação teórica 1x1 entre ~w e ~w (nível padrão ~w):~n', [LabelA, LabelB, Level]),
    print_duel_deep_block(LabelA, ProfileA, LabelB, ProfileB, WinnerSide, Turns),
    writeln('Bot: Observação: considera golpe-chave e habilidade catalogados, mas ainda simplifica item, clima e boosts.').
answer_battle_sim_query(NameA, NameB) :-
    writeln('Bot: Não consegui simular esse embate. Exemplo: "simule embate entre charizard e blastoise".'),
    print_suggestion_for_pair(battle, NameA, NameB).

print_suggestion_for_pair(ActionKey, NameA, NameB) :-
    infer_identifier(NameA, ResolvedA, StatusA),
    infer_identifier(NameB, ResolvedB, StatusB),
    ( StatusA \= exact ; StatusB \= exact ),
    pokemon_info(ResolvedA, _),
    pokemon_info(ResolvedB, _),
    !,
    handle_pair_inference(ActionKey, NameA, ResolvedA, StatusA, NameB, ResolvedB, StatusB).
print_suggestion_for_pair(_, _, _).

print_suggestion_pairs([]).
print_suggestion_pairs([Input-Suggested | Rest]) :-
    display_pokemon_name(Input, InputLabel),
    display_pokemon_name(Suggested, SuggestedLabel),
    format('  - ~w -> ~w~n', [InputLabel, SuggestedLabel]),
    print_suggestion_pairs(Rest).

print_suggestion_for_identifier(ActionKey, Identifier) :-
    infer_identifier(Identifier, Resolved, Status),
    Status \= exact,
    pokemon_info(Resolved, _),
    !,
    handle_identifier_inference(ActionKey, Identifier, Resolved, Status).
print_suggestion_for_identifier(_, _).

infer_identifier(Input, Resolved, auto(Score)) :-
    suggest_pokemon_name(Input, Suggested, Score),
    normalize_identifier_for_match(Input, InputNorm),
    normalize_identifier_for_match(Suggested, SuggestedNorm),
    InputNorm \= SuggestedNorm,
    auto_correction_threshold(Threshold),
    Score >= Threshold,
    !,
    Resolved = Suggested.
infer_identifier(Input, Resolved, confirm(Score)) :-
    suggest_pokemon_name(Input, Suggested, Score),
    normalize_identifier_for_match(Input, InputNorm),
    normalize_identifier_for_match(Suggested, SuggestedNorm),
    InputNorm \= SuggestedNorm,
    !,
    Resolved = Suggested.
infer_identifier(Input, Input, exact).

auto_correction_threshold(0.90).

handle_pair_inference(ActionKey, InputA, ResolvedA, StatusA, InputB, ResolvedB, StatusB) :-
    ( status_requires_confirmation(StatusA)
    ; status_requires_confirmation(StatusB)
    ),
    !,
    queue_pair_confirmation(ActionKey, InputA, ResolvedA, InputB, ResolvedB).
handle_pair_inference(ActionKey, InputA, ResolvedA, _StatusA, InputB, ResolvedB, _StatusB) :-
    pair_action_term(ActionKey, ResolvedA, ResolvedB, ActionTerm),
    writeln('Bot: Corrigi automaticamente os nomes com alta confiança e vou continuar.'),
    print_correction_line(InputA, ResolvedA),
    print_correction_line(InputB, ResolvedB),
    execute_pending_confirmation(ActionTerm).

handle_identifier_inference(ActionKey, Input, Resolved, Status) :-
    status_requires_confirmation(Status),
    !,
    queue_identifier_confirmation(ActionKey, Input, Resolved).
handle_identifier_inference(ActionKey, Input, Resolved, _Status) :-
    identifier_action_term(ActionKey, Resolved, ActionTerm),
    writeln('Bot: Corrigi automaticamente o nome com alta confiança e vou continuar.'),
    print_correction_line(Input, Resolved),
    execute_pending_confirmation(ActionTerm).

status_requires_confirmation(confirm(_)).

queue_pair_confirmation(ActionKey, InputA, ResolvedA, InputB, ResolvedB) :-
    retractall(pending_confirmation(_)),
    pair_action_term(ActionKey, ResolvedA, ResolvedB, ActionTerm),
    assertz(pending_confirmation(ActionTerm)),
    display_pokemon_name(ResolvedA, LabelA),
    display_pokemon_name(ResolvedB, LabelB),
    writeln('Bot: Fiz uma inferência de nomes por similaridade.'),
    print_correction_line(InputA, ResolvedA),
    print_correction_line(InputB, ResolvedB),
    format('Bot: Você quer que eu continue com ~w e ~w? (sim/não)~n', [LabelA, LabelB]).

pair_action_term(compare, NameA, NameB, compare(NameA, NameB)).
pair_action_term(battle, NameA, NameB, battle(NameA, NameB)).

queue_identifier_confirmation(ActionKey, Input, Resolved) :-
    retractall(pending_confirmation(_)),
    identifier_action_term(ActionKey, Resolved, ActionTerm),
    assertz(pending_confirmation(ActionTerm)),
    display_pokemon_name(Resolved, Label),
    writeln('Bot: Fiz uma inferência de nome por similaridade.'),
    print_correction_line(Input, Resolved),
    format('Bot: Quer que eu continue usando ~w? (sim/não)~n', [Label]).

identifier_action_term(info, Name, info(Name)).
identifier_action_term(counter, Name, counter(Name)).
identifier_action_term(best_switch, Name, best_switch(Name)).
identifier_action_term(filtered_counter(TypeFilters), Name, filtered_counter(TypeFilters, Name)).

print_correction_line(Input, Resolved) :-
    normalize_identifier_for_match(Input, InputNorm),
    normalize_identifier_for_match(Resolved, ResolvedNorm),
    ( InputNorm \= ResolvedNorm ->
        display_pokemon_name(Input, InputLabel),
        display_pokemon_name(Resolved, ResolvedLabel),
        format('  - ~w -> ~w~n', [InputLabel, ResolvedLabel])
    ; true
    ).

suggest_pokemon_name(Identifier, SuggestedName) :-
    suggest_pokemon_name(Identifier, SuggestedName, _).

suggest_pokemon_name(Identifier, SuggestedName, SuggestedScore) :-
    nonvar(Identifier),
    \+ number(Identifier),
    \+ identifier_looks_like_type(Identifier),
    normalize_identifier_for_match(Identifier, InputNorm),
    atom_length(InputNorm, InputLen),
    InputLen >= 3,
    min_similarity_for_length(InputLen, MinScore),
    findall(Score-Name,
        ( pokemon(_, Name, _, _, _, _, _),
          normalize_identifier_for_match(Name, NameNorm),
          isub(InputNorm, NameNorm, RawScore, [zero_to_one(true), substring_threshold(0)]),
          Score is max(0.0, RawScore),
          Score >= MinScore
        ),
        ScoredRaw),
    ScoredRaw \= [],
    keysort(ScoredRaw, ScoredAsc),
    reverse(ScoredAsc, [SuggestedScore-SuggestedName | _]).

identifier_looks_like_type(Identifier) :-
    input_to_string(Identifier, Text),
    tokenize_for_match(Text, [SingleToken]),
    normalize_type(SingleToken, Type),
    valid_type(Type).

min_similarity_for_length(Len, 0.84) :- Len =< 4, !.
min_similarity_for_length(Len, 0.76) :- Len =< 6, !.
min_similarity_for_length(Len, 0.70) :- Len =< 10, !.
min_similarity_for_length(_, 0.66).

normalize_identifier_for_match(Input, NormalizedAtom) :-
    input_to_string(Input, Text),
    string_lower(Text, Lower),
    split_string(Lower, " ,.;:!?()[]{}\"'/-_", "", RawTokens),
    include(non_empty_string, RawTokens, Tokens),
    atomic_list_concat(Tokens, '_', Joined),
    string_chars(Joined, Chars),
    maplist(fold_accent_char, Chars, FoldedChars),
    string_chars(FoldedString, FoldedChars),
    atom_string(NormalizedAtom, FoldedString).

input_to_string(Input, Text) :-
    string(Input),
    !,
    Text = Input.
input_to_string(Input, Text) :-
    atom(Input),
    !,
    atom_string(Input, Text).
input_to_string(Input, Text) :-
    term_string(Input, Text).

fold_accent_char('á', 'a').
fold_accent_char('à', 'a').
fold_accent_char('â', 'a').
fold_accent_char('ã', 'a').
fold_accent_char('ä', 'a').
fold_accent_char('é', 'e').
fold_accent_char('è', 'e').
fold_accent_char('ê', 'e').
fold_accent_char('ë', 'e').
fold_accent_char('í', 'i').
fold_accent_char('ì', 'i').
fold_accent_char('î', 'i').
fold_accent_char('ï', 'i').
fold_accent_char('ó', 'o').
fold_accent_char('ò', 'o').
fold_accent_char('ô', 'o').
fold_accent_char('õ', 'o').
fold_accent_char('ö', 'o').
fold_accent_char('ú', 'u').
fold_accent_char('ù', 'u').
fold_accent_char('û', 'u').
fold_accent_char('ü', 'u').
fold_accent_char('ç', 'c').
fold_accent_char(Char, Char).

answer_ambiguous_two_pokemon_query(NameA, NameB) :-
    display_pokemon_name(NameA, LabelA),
    display_pokemon_name(NameB, LabelB),
    format('Bot: Entendi os dois Pokémon (~w e ~w), mas faltou a intenção.~n', [LabelA, LabelB]),
    writeln('Bot: Você quer comparação geral ou simulação de quem ganha?'),
    format('  - Comparação: "compare ~w vs ~w"~n', [NameA, NameB]),
    format('  - Simulação: "quem ganha entre ~w e ~w"~n', [NameA, NameB]).

battle_profile(AttackerID, AttackerTypes, AttackerStats, DefenderID, DefenderTypes, DefenderStats, Profile) :-
    battle_default_level(Level),
    battle_profile(Level, AttackerID, AttackerTypes, AttackerStats, DefenderID, DefenderTypes, DefenderStats, Profile).

battle_profile(LevelRaw, AttackerID, AttackerTypes, AttackerStats, DefenderID, DefenderTypes, DefenderStats,
    profile{mode:Mode, multiplier:Multiplier, damage:Damage, min_damage:MinDamage, max_damage:MaxDamage, hp:HP, speed:Speed, priority:Priority, key_move:KeyMove, move_note:MoveNote, ability_note:AbilityNote, stab:STABMult, weather_mod:WeatherMod, terrain_mod:TerrainMod, weather:Weather, terrain:Terrain}) :-
    normalized_battle_level(LevelRaw, Level),
    stat_value(AttackerStats, hp, HP),
    stat_value(AttackerStats, speed, Speed),
    battle_field_context(AttackerID, AttackerTypes, AttackerStats, DefenderID, DefenderTypes, DefenderStats, FieldContext),
    battle_best_move_choice(AttackerID, AttackerTypes, DefenderID, DefenderTypes, FieldContext, Choice),
    !,
    choose_offense_stats(Choice.category, AttackerStats, DefenderStats, Mode, AttackStat, DefenseStat),
    attack_stat_multiplier_from_abilities(AttackerID, Choice.category, AttackStatMult),
    AttackEffective is max(1, round(AttackStat * AttackStatMult)),
    attack_type_boost_multiplier_from_abilities(AttackerID, Choice.type, TypeBoostMult),
    defender_damage_multiplier_from_abilities(DefenderID, Choice.type, DefenderMitigationMult),
    Other is TypeBoostMult * DefenderMitigationMult * Choice.tempo_factor * Choice.terrain_mod,
    battle_damage_modifiers(Choice.stab, Choice.multiplier, Choice.weather_mod, Other, Modifiers),
    battle_damage_profile_gen5_plus(Level, Choice.base_power, AttackEffective, DefenseStat, Modifiers, DamageProfile),
    Damage = DamageProfile.avg,
    MinDamage = DamageProfile.min,
    MaxDamage = DamageProfile.max,
    Priority = Choice.priority,
    Multiplier = Choice.multiplier,
    KeyMove = Choice.move,
    MoveNote = Choice.move_note,
    STABMult = Choice.stab,
    WeatherMod = Choice.weather_mod,
    TerrainMod = Choice.terrain_mod,
    Weather = FieldContext.weather,
    Terrain = FieldContext.terrain,
    ( ability_counter_insight(AttackerID, DefenderTypes, AbilityNoteResolved) ->
        AbilityNote = AbilityNoteResolved
    ; AbilityNote = ''
    ).
battle_profile(LevelRaw, AttackerID, AttackerTypes, AttackerStats, _DefenderID, DefenderTypes, DefenderStats,
    profile{mode:Mode, multiplier:Multiplier, damage:Damage, min_damage:MinDamage, max_damage:MaxDamage, hp:HP, speed:Speed, priority:0, key_move:none, move_note:'', ability_note:AbilityNote, stab:1.0, weather_mod:1.0, terrain_mod:1.0, weather:none, terrain:none}) :-
    normalized_battle_level(LevelRaw, _Level),
    stat_value(AttackerStats, hp, HP),
    stat_value(AttackerStats, speed, Speed),
    best_attack_between_types(AttackerTypes, DefenderTypes, Multiplier),
    stat_value(AttackerStats, attack, Atk),
    stat_value(AttackerStats, special_attack, SpAtk),
    stat_value(DefenderStats, defense, Def),
    stat_value(DefenderStats, special_defense, SpDef),
    stab_bonus(AttackerTypes, STAB),
    PhysicalDamage is max(1.0, (Atk * STAB * Multiplier * 18.0) / max(1.0, Def)),
    SpecialDamage is max(1.0, (SpAtk * STAB * Multiplier * 18.0) / max(1.0, SpDef)),
    ( PhysicalDamage >= SpecialDamage ->
        Mode = physical,
        Damage = PhysicalDamage
    ; Mode = special,
      Damage = SpecialDamage
    ),
    MinDamage is max(1, floor(Damage * 0.85)),
    MaxDamage is max(1, floor(Damage)),
    ( ability_counter_insight(AttackerID, DefenderTypes, AbilityNoteResolved) ->
        AbilityNote = AbilityNoteResolved
    ; AbilityNote = ''
    ).

battle_best_move_choice(AttackerID, AttackerTypes, DefenderID, DefenderTypes, FieldContext, Choice) :-
    findall(Score-ChoiceItem,
        battle_offensive_move_option(AttackerID, AttackerTypes, DefenderID, DefenderTypes, FieldContext, Score, ChoiceItem),
        RawChoices),
    RawChoices \= [],
    keysort(RawChoices, ChoicesAsc),
    reverse(ChoicesAsc, [_BestScore-Choice | _]).

battle_offensive_move_option(AttackerID, AttackerTypes, DefenderID, DefenderTypes, FieldContext, Score,
    choice{move:Move, type:MoveType, category:Category, multiplier:Mult, priority:Priority, base_power:BasePowerEstimate, stab:STAB, move_note:MoveInsight, tempo_factor:TempoFactor, weather_mod:WeatherMod, terrain_mod:TerrainMod}) :-
    pokemon_info(AttackerID, pokemon(_, Name, _, _, _, _, _)),
    pokemon_move_list_for_id(AttackerID, Name, Moves, _Source),
    sort(Moves, UniqueMoves),
    member(Move, UniqueMoves),
    move_data(Move, MoveType, Category, BasePower, _Accuracy, _PP, Tags, EffectChance, Ailment, EffectCategory, Description),
    offensive_move_category(Category),
    combined_multiplier(MoveType, DefenderTypes, BaseMult),
    ( defender_ability_immune_to_type(DefenderID, MoveType) ->
        Mult = 0.0
    ; Mult = BaseMult
    ),
    move_base_power_estimate(BasePower, Description, BasePowerEstimate),
    battle_stab_multiplier(AttackerID, AttackerTypes, MoveType, STAB),
    offensive_move_priority(Tags, Priority),
    battle_weather_modifier(FieldContext.weather, Move, MoveType, WeatherMod),
    battle_terrain_modifier(FieldContext.terrain, MoveType, Priority, FieldContext.attacker_grounded, FieldContext.defender_grounded, TerrainMod),
    offensive_move_score(MoveType, AttackerTypes, Mult, BasePower, Priority, Tags, EffectChance, Ailment, EffectCategory, Description, CoreScore),
    battle_move_tempo_factor(AttackerID, Move, Description, TempoFactor, TempoNote),
    DamagePotential is BasePowerEstimate * STAB * Mult * TempoFactor * WeatherMod * TerrainMod,
    ScoreRaw is CoreScore + (DamagePotential / 8.0) + (Priority * 6.0),
    Score is ScoreRaw * TempoFactor * WeatherMod * TerrainMod,
    counter_move_insight_text(Move, Mult, Priority, Tags, EffectChance, Ailment, EffectCategory, BasePower, Description, BaseInsight),
    battle_move_insight_with_tempo(BaseInsight, TempoNote, MoveInsight).

battle_field_context(AttackerID, AttackerTypes, AttackerStats, DefenderID, DefenderTypes, DefenderStats,
    field_context{weather:Weather, terrain:Terrain, attacker_grounded:AttackerGrounded, defender_grounded:DefenderGrounded}) :-
    pokemon_grounded_in_sim(AttackerTypes, AttackerID, AttackerGrounded),
    pokemon_grounded_in_sim(DefenderTypes, DefenderID, DefenderGrounded),
    field_weather_from_active_pair(AttackerID, AttackerStats, DefenderID, DefenderStats, Weather),
    field_terrain_from_active_pair(AttackerID, AttackerStats, DefenderID, DefenderStats, Terrain).

pokemon_grounded_in_sim(Types, _PokemonID, false) :-
    memberchk(flying, Types),
    !.
pokemon_grounded_in_sim(_Types, PokemonID, false) :-
    pokemon_has_ability(PokemonID, levitate),
    !.
pokemon_grounded_in_sim(_Types, _PokemonID, true).

pokemon_has_ability(PokemonID, Ability) :-
    pokemon_info(PokemonID, pokemon(_, _, _, _, _, Abilities, _)),
    member(Ability, Abilities).

field_weather_from_active_pair(AttackerID, _AttackerStats, DefenderID, _DefenderStats, none) :-
    ( pokemon_has_ability(AttackerID, cloud_nine)
    ; pokemon_has_ability(AttackerID, air_lock)
    ; pokemon_has_ability(DefenderID, cloud_nine)
    ; pokemon_has_ability(DefenderID, air_lock)
    ),
    !.
field_weather_from_active_pair(AttackerID, AttackerStats, DefenderID, DefenderStats, Weather) :-
    findall(Option,
        battle_field_effect_option(weather, [AttackerID-AttackerStats, DefenderID-DefenderStats], Option),
        Options),
    pick_field_effect_from_options(Options, none, Weather).

field_terrain_from_active_pair(AttackerID, AttackerStats, DefenderID, DefenderStats, Terrain) :-
    findall(Option,
        battle_field_effect_option(terrain, [AttackerID-AttackerStats, DefenderID-DefenderStats], Option),
        Options),
    pick_field_effect_from_options(Options, none, Terrain).

battle_field_effect_option(Kind, PokemonPairs, Effect-Speed) :-
    member(PokemonID-Stats, PokemonPairs),
    pokemon_info(PokemonID, pokemon(_, _, _, _, _, Abilities, _)),
    member(Ability, Abilities),
    ability_sets_field_effect(Kind, Ability, Effect),
    stat_value(Stats, speed, Speed).

ability_sets_field_effect(weather, Ability, Weather) :-
    ability_weather(Ability, Weather).
ability_sets_field_effect(terrain, Ability, Terrain) :-
    ability_terrain(Ability, Terrain).

pick_field_effect_from_options([], Default, Default) :- !.
pick_field_effect_from_options(Options, _Default, Effect) :-
    findall(Speed, member(_-Speed, Options), Speeds),
    max_list(Speeds, MaxSpeed),
    findall(Name,
        member(Name-MaxSpeed, Options),
        TopRaw),
    sort(TopRaw, TopSorted),
    TopSorted = [Effect | _].

ability_weather(drought, sun).
ability_weather(desolate_land, sun).
ability_weather(orichalcum_pulse, sun).
ability_weather(drizzle, rain).
ability_weather(primordial_sea, rain).
ability_weather(sand_stream, sandstorm).
ability_weather(snow_warning, snow).

ability_terrain(electric_surge, electric).
ability_terrain(grassy_surge, grassy).
ability_terrain(psychic_surge, psychic).
ability_terrain(misty_surge, misty).

battle_weather_modifier(sun, hydro_steam, water, 1.5) :- !.
battle_weather_modifier(sun, _Move, fire, 1.5) :- !.
battle_weather_modifier(sun, Move, water, 0.5) :-
    Move \= hydro_steam,
    !.
battle_weather_modifier(rain, _Move, water, 1.5) :- !.
battle_weather_modifier(rain, _Move, fire, 0.5) :- !.
battle_weather_modifier(_, _, _, 1.0).

battle_terrain_modifier(psychic, _MoveType, Priority, _AttackerGrounded, DefenderGrounded, 0.0) :-
    Priority > 0,
    DefenderGrounded == true,
    !.
battle_terrain_modifier(electric, electric, _Priority, AttackerGrounded, _DefenderGrounded, 1.5) :-
    AttackerGrounded == true,
    !.
battle_terrain_modifier(grassy, grass, _Priority, AttackerGrounded, _DefenderGrounded, 1.5) :-
    AttackerGrounded == true,
    !.
battle_terrain_modifier(psychic, psychic, _Priority, AttackerGrounded, _DefenderGrounded, 1.5) :-
    AttackerGrounded == true,
    !.
battle_terrain_modifier(misty, dragon, _Priority, _AttackerGrounded, DefenderGrounded, 0.5) :-
    DefenderGrounded == true,
    !.
battle_terrain_modifier(_, _, _, _, _, 1.0).

battle_move_tempo_factor(AttackerID, Move, _Description, 1.0, 'aproveita clima de sol e bate no mesmo turno') :-
    member(Move, [solar_beam, solar_blade]),
    pokemon_sets_harsh_sun(AttackerID),
    !.
battle_move_tempo_factor(_AttackerID, Move, Description, 0.55, 'requer preparo (2 turnos)') :-
    move_requires_charge_turn(Move, Description),
    !.
battle_move_tempo_factor(_AttackerID, _Move, Description, 0.50, 'exige recarga no turno seguinte') :-
    move_requires_recharge_turn(Description),
    !.
battle_move_tempo_factor(_AttackerID, _Move, _Description, 1.0, '').

pokemon_sets_harsh_sun(PokemonID) :-
    pokemon_info(PokemonID, pokemon(_, _, _, _, _, Abilities, _)),
    member(Ability, Abilities),
    memberchk(Ability, [drought, desolate_land, orichalcum_pulse]),
    !.

move_requires_charge_turn(Move, _Description) :-
    memberchk(Move, [solar_beam, solar_blade, skull_bash, sky_attack, razor_wind]),
    !.
move_requires_charge_turn(_Move, Description) :-
    sub_atom(Description, _, _, _, 'Requires a turn to charge before attacking.'),
    !.
move_requires_charge_turn(_Move, Description) :-
    sub_atom(Description, _, _, _, 'hits next turn'),
    !.
move_requires_charge_turn(_Move, Description) :-
    sub_atom(Description, _, _, _, 'Hits next turn'),
    !.

move_requires_recharge_turn(Description) :-
    sub_atom(Description, _, _, _, 'foregoes its next turn to recharge'),
    !.
move_requires_recharge_turn(Description) :-
    sub_atom(Description, _, _, _, 'must recharge'),
    !.

battle_move_insight_with_tempo(BaseInsight, '', BaseInsight) :- !.
battle_move_insight_with_tempo(BaseInsight, TempoNote, Insight) :-
    format(atom(Insight), '~w; ~w', [BaseInsight, TempoNote]).

battle_stab_multiplier(_AttackerID, AttackerTypes, MoveType, 1.0) :-
    \+ member(MoveType, AttackerTypes),
    !.
battle_stab_multiplier(AttackerID, AttackerTypes, MoveType, 2.0) :-
    member(MoveType, AttackerTypes),
    pokemon_info(AttackerID, pokemon(_, _, _, _, _, Abilities, _)),
    member(adaptability, Abilities),
    !.
battle_stab_multiplier(_AttackerID, AttackerTypes, MoveType, 1.5) :-
    member(MoveType, AttackerTypes),
    !.
battle_stab_multiplier(_, _, _, 1.0).

battle_damage_modifiers(STAB, TypeMult, Weather, Other, modifiers{
    targets:1.0,
    parental_bond:1.0,
    weather:Weather,
    glaive_rush:1.0,
    critical:1.0,
    stab:STAB,
    type:TypeMult,
    burn:1.0,
    other:Other,
    zmove:1.0,
    tera_shield:1.0
}).

battle_damage_profile_gen5_plus(Level, PowerInput, AttackEff, DefenseEff, Modifiers, damage_profile{min:MinDamage, avg:AvgDamage, max:MaxDamage}) :-
    DamageMinRandom = 0.85,
    DamageAvgRandom = 0.925,
    DamageMaxRandom = 1.0,
    battle_damage_single_gen5_plus(Level, PowerInput, AttackEff, DefenseEff, Modifiers, DamageMinRandom, MinDamage),
    battle_damage_single_gen5_plus(Level, PowerInput, AttackEff, DefenseEff, Modifiers, DamageAvgRandom, AvgDamage),
    battle_damage_single_gen5_plus(Level, PowerInput, AttackEff, DefenseEff, Modifiers, DamageMaxRandom, MaxDamage).

battle_damage_single_gen5_plus(_Level, _PowerInput, _AttackEff, _DefenseEff, Modifiers, _Random, 0) :-
    TypeMult is Modifiers.type,
    TypeMult =< 0.0,
    !.
battle_damage_single_gen5_plus(Level, PowerInput, AttackEffRaw, DefenseEffRaw, Modifiers, RandomFactor, Damage) :-
    Power is max(1, round(PowerInput)),
    AttackEff is max(1, round(AttackEffRaw)),
    DefenseEff is max(1, round(DefenseEffRaw)),
    battle_base_damage(Level, Power, AttackEff, DefenseEff, BaseDamage),
    damage_modifier_ordered_list(Modifiers, RandomFactor, OrderedModifiers),
    apply_damage_modifiers_gen5_plus(BaseDamage, OrderedModifiers, ModifiedDamage),
    ( ModifiedDamage =< 0 ->
        Damage = 1
    ; Damage = ModifiedDamage
    ).

battle_base_damage(Level, Power, AttackEff, DefenseEff, BaseDamage) :-
    LevelTerm is floor((2 * Level) / 5) + 2,
    Numerator is LevelTerm * Power * AttackEff,
    Raw is floor(Numerator / DefenseEff),
    BaseDamage is floor(Raw / 50) + 2.

damage_modifier_ordered_list(Modifiers, RandomFactor, [
    Modifiers.targets,
    Modifiers.parental_bond,
    Modifiers.weather,
    Modifiers.glaive_rush,
    Modifiers.critical,
    RandomFactor,
    Modifiers.stab,
    Modifiers.type,
    Modifiers.burn,
    Modifiers.other,
    Modifiers.zmove,
    Modifiers.tera_shield
]).

apply_damage_modifiers_gen5_plus(Damage, [], Damage).
apply_damage_modifiers_gen5_plus(CurrentDamage, [Modifier | Rest], ResultDamage) :-
    DamageFloat is CurrentDamage * Modifier,
    round_half_down_positive(DamageFloat, RoundedDamage),
    apply_damage_modifiers_gen5_plus(RoundedDamage, Rest, ResultDamage).

round_half_down_positive(Value, Rounded) :-
    FloorValue is floor(Value),
    Fraction is Value - FloorValue,
    ( Fraction > 0.5 ->
        Rounded is FloorValue + 1
    ; Rounded = FloorValue
    ).

choose_offense_stats(physical, AttackerStats, DefenderStats, physical, AttackStat, DefenseStat) :-
    stat_value(AttackerStats, attack, AttackStat),
    stat_value(DefenderStats, defense, DefenseStat).
choose_offense_stats(special, AttackerStats, DefenderStats, special, AttackStat, DefenseStat) :-
    stat_value(AttackerStats, special_attack, AttackStat),
    stat_value(DefenderStats, special_defense, DefenseStat).

attack_stat_multiplier_from_abilities(PokemonID, Category, Multiplier) :-
    findall(Mult,
        attack_stat_multiplier_option(PokemonID, Category, Mult),
        Multipliers),
    max_numeric_or_default(Multipliers, 1.0, Multiplier).

attack_stat_multiplier_option(PokemonID, physical, Multiplier) :-
    pokemon_info(PokemonID, pokemon(_, _, _, _, _, Abilities, _)),
    member(Ability, Abilities),
    ability_effect(Ability, _Category, _Trigger, CombatModel, _Description),
    member(attack_multiplier-Multiplier, CombatModel),
    number(Multiplier),
    Multiplier > 0.
attack_stat_multiplier_option(PokemonID, special, Multiplier) :-
    pokemon_info(PokemonID, pokemon(_, _, _, _, _, Abilities, _)),
    member(Ability, Abilities),
    ability_effect(Ability, _Category, _Trigger, CombatModel, _Description),
    member(special_attack_multiplier-Multiplier, CombatModel),
    number(Multiplier),
    Multiplier > 0.

attack_type_boost_multiplier_from_abilities(PokemonID, MoveType, Multiplier) :-
    findall(Mult,
        attack_type_boost_multiplier_option(PokemonID, MoveType, Mult),
        Multipliers),
    max_numeric_or_default(Multipliers, 1.0, Multiplier).

attack_type_boost_multiplier_option(PokemonID, MoveType, 1.2) :-
    pokemon_info(PokemonID, pokemon(_, _, _, _, _, Abilities, _)),
    member(Ability, Abilities),
    ability_effect(Ability, _Category, _Trigger, CombatModel, _Description),
    member(type_boost-BoostedTypes, CombatModel),
    model_boosted_type(BoostedTypes, MoveType).

defender_damage_multiplier_from_abilities(PokemonID, MoveType, Multiplier) :-
    findall(Factor,
        defender_damage_multiplier_option(PokemonID, MoveType, Factor),
        Factors),
    min_numeric_or_default(Factors, 1.0, Multiplier).

defender_damage_multiplier_option(PokemonID, MoveType, Factor) :-
    pokemon_info(PokemonID, pokemon(_, _, _, _, _, Abilities, _)),
    member(Ability, Abilities),
    ability_effect(Ability, _Category, _Trigger, CombatModel, _Description),
    member(damage_multiplier-MoveType-Factor, CombatModel),
    number(Factor),
    Factor > 0.

max_numeric_or_default([], Default, Default).
max_numeric_or_default(Values, _Default, MaxValue) :-
    max_list(Values, MaxValue).

min_numeric_or_default([], Default, Default).
min_numeric_or_default(Values, _Default, MinValue) :-
    min_list(Values, MinValue).

stab_bonus([], 1.0).
stab_bonus(_, 1.5).

duel_action_order(ProfileA, ProfileB, first) :-
    ProfileA.priority > ProfileB.priority,
    !.
duel_action_order(ProfileA, ProfileB, second) :-
    ProfileA.priority < ProfileB.priority,
    !.
duel_action_order(ProfileA, ProfileB, first) :-
    ProfileA.speed > ProfileB.speed,
    !.
duel_action_order(ProfileA, ProfileB, second) :-
    ProfileA.speed < ProfileB.speed,
    !.
duel_action_order(ProfileA, ProfileB, first) :-
    ProfileA.damage >= ProfileB.damage,
    !.
duel_action_order(_, _, second).

simulate_duel(ProfileA, ProfileB, WinnerSide, Turns) :-
    HitsAToB is ceiling(ProfileB.hp / max(0.1, ProfileA.damage)),
    HitsBToA is ceiling(ProfileA.hp / max(0.1, ProfileB.damage)),
    duel_action_order(ProfileA, ProfileB, ActionOrderA),
    ( ActionOrderA == first ->
        decide_winner_with_order(HitsAToB, HitsBToA, a, Winner, Turns)
    ; decide_winner_with_order(HitsAToB, HitsBToA, b, Winner, Turns)
    ),
    WinnerSide = Winner.

decide_winner_with_order(HitsAToB, HitsBToA, a, Winner, Turns) :-
    ( HitsAToB =< HitsBToA ->
        Winner = a,
        Turns = HitsAToB
    ; Winner = b,
      Turns = HitsBToA
    ).
decide_winner_with_order(HitsAToB, HitsBToA, b, Winner, Turns) :-
    ( HitsBToA =< HitsAToB ->
        Winner = b,
        Turns = HitsBToA
    ; Winner = a,
      Turns = HitsAToB
    ).

profile_mode_text(physical, 'físico').
profile_mode_text(special, 'especial').

stat_value(Stats, Key, Value) :-
    member(Key-Value, Stats),
    !.
stat_value(_, _, 1).


recommend_best_switches(TargetID, TargetTypes, TopPairs) :-
    recommend_best_switches_all(TargetID, TargetTypes, PairsAsc),
    take_first_n(PairsAsc, 6, TopPairs).

recommend_best_switches_all(TargetID, TargetTypes, PairsAsc) :-
    findall(Score-Name-DefenseMult-Bulk,
        ( pokemon_in_scope(CandidateID, Name, _, _, CandidateTypes, _, Stats),
          CandidateID =\= TargetID,
          defensive_pressure_from_target(TargetTypes, CandidateTypes, DefenseMult),
          bulk_value(Stats, Bulk),
          Score is (DefenseMult * 1000.0) - Bulk
        ),
        PairsRaw),
    keysort(PairsRaw, SortedAsc),
    dedupe_switch_pairs_by_name(SortedAsc, PairsAsc).

dedupe_switch_pairs_by_name(PairsAsc, UniqueAsc) :-
    dedupe_switch_pairs_by_name(PairsAsc, [], UniqueAsc).

dedupe_switch_pairs_by_name([], _Seen, []).
dedupe_switch_pairs_by_name([Score-Name-DefenseMult-Bulk | Rest], Seen, Unique) :-
    ( memberchk(Name, Seen) ->
        dedupe_switch_pairs_by_name(Rest, Seen, Unique)
    ; Unique = [Score-Name-DefenseMult-Bulk | Tail],
      dedupe_switch_pairs_by_name(Rest, [Name | Seen], Tail)
    ).

defensive_pressure_from_target(TargetTypes, CandidateTypes, MaxDefenseMult) :-
    findall(Defense,
        ( member(TargetType, TargetTypes),
          combined_multiplier(TargetType, CandidateTypes, Defense)
        ),
        DefenseValues),
    max_list(DefenseValues, MaxDefenseMult).

bulk_value(Stats, Bulk) :-
    member(hp-HP, Stats),
    member(defense-Defense, Stats),
    member(special_defense-SpecialDefense, Stats),
    Bulk is HP + Defense + SpecialDefense.

switch_pairs_text(Pairs, Text) :-
    maplist(switch_pair_text, Pairs, Items),
    bullet_block_text('  - ', Items, Text).

switch_pair_text(_Score-Name-DefenseMult-_Bulk, Text) :-
    display_pokemon_name(Name, NameLabel),
    multiplier_text(DefenseMult, DefenseText),
    format(atom(Text), '~w (recebe até ~w)', [NameLabel, DefenseText]).

switch_pair_passes_filters(Filters, _Score-Name-_DefenseMult-_Bulk) :-
    name_passes_filters(Filters, Name).

extract_switch_names(Pairs, Names) :-
    findall(Name,
        member(_Score-Name-_DefenseMult-_Bulk, Pairs),
        NamesRaw),
    sort(NamesRaw, Names).

best_attack_between_types(AttackTypes, DefenseTypes, BestMultiplier) :-
    findall(M,
        ( member(AttackType, AttackTypes),
          combined_multiplier(AttackType, DefenseTypes, M)
        ),
        Multipliers),
    max_list(Multipliers, BestMultiplier).

defensive_pressure_between_types(OwnTypes, OpponentTypes, WorstMultiplier) :-
    findall(M,
        ( member(OpponentType, OpponentTypes),
          combined_multiplier(OpponentType, OwnTypes, M)
        ),
        Multipliers),
    max_list(Multipliers, WorstMultiplier).
