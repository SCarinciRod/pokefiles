:- encoding(utf8).
:- use_module(library(readutil)).
:- use_module(library(lists)).
:- use_module(library(isub)).
:- initialization(configure_text_encoding).

:- dynamic active_generation/1.
:- dynamic last_list_candidates/1.
:- dynamic pending_confirmation/1.
:- dynamic pending_level_roster/3.
:- dynamic pending_counter_preferences/1.
:- dynamic pending_counter_level_preferences/2.
:- dynamic pending_type_preferences/1.
:- dynamic pending_list_preferences/1.
:- dynamic pending_rank_focus/3.
:- dynamic pending_held_item_options/2.
:- dynamic pending_partner_preferences/2.
:- dynamic pending_partner_options/2.
:- dynamic pending_synergy_details/2.
:- dynamic cache_type_count/3.
:- dynamic cache_type_list/3.
:- dynamic cache_ability_list/3.
:- dynamic cache_move_catalog/1.
:- dynamic cache_scoped_filtered_names/4.
:- dynamic cache_generation_filtered_names/4.
:- dynamic cache_tokenized_input/2.
:- dynamic cache_counter_type_matchup/4.
:- dynamic cache_pokemon_offensive_types/2.
:- dynamic cache_pokemon_ability_immunity_types/2.
:- dynamic cache_move_coverage_multiplier/4.
:- dynamic cache_pokemon_max_offensive_priority/2.
:- dynamic cache_counter_move_factor/4.
:- dynamic cache_pokemon_move_list/3.
:- dynamic cache_held_item_recommendation/6.
:- dynamic cache_battle_best_move_choice/7.
:- dynamic pokemon_name_index_tokens/2.
:- dynamic pokemon_name_index_token/2.
:- multifile pokemon/7.
:- multifile pokemon_lore/2.
:- multifile pokemon_mega_base/2.
:- multifile pokemon_form_base/2.
:- multifile pokemon_evolution/5.
:- ensure_loaded('intent_router.pl').
:- ensure_loaded('engines/role_engine.pl').
:- ensure_loaded('engines/held_item_engine.pl').
:- ensure_loaded('engines/evolution_engine.pl').
:- ensure_loaded('engines/generation_engine.pl').
:- ensure_loaded('engines/ranking_engine.pl').
:- ensure_loaded('engines/counter_engine.pl').
:- ensure_loaded('engines/matchup_engine.pl').
:- ensure_loaded('engines/tournament_rules_engine.pl').
:- ensure_loaded('engines/doubles_strategy_engine.pl').

% ============================================================
% BOOTSTRAP E CICLO PRINCIPAL
% ============================================================

start :-
    load_database,
    set_default_generation,
    say_response(start_banner_title),
    say_response(start_banner_hint),
    say_response(start_banner_ex_1),
    say_response(start_banner_ex_2),
    say_response(start_banner_ex_3),
    say_response(start_banner_ex_4),
    say_response(start_banner_ex_5),
    chat_loop.

configure_text_encoding :-
    catch(set_stream(user_input, encoding(utf8)), _, true),
    catch(set_stream(user_output, encoding(utf8)), _, true),
    catch(set_stream(user_error, encoding(utf8)), _, true).

load_database :-
    expand_file_name('db/generation_*.pl', GenerationFiles),
    expand_file_name('db/lore_generation_*.pl', LoreFiles),
    expand_file_name('db/evolution_generation_*.pl', EvolutionFiles),
    expand_file_name('db/mega_forms.pl', MegaFiles),
    expand_file_name('db/lore_mega_forms.pl', MegaLoreFiles),
    expand_file_name('db/special_forms.pl', SpecialFiles),
    expand_file_name('db/lore_special_forms.pl', SpecialLoreFiles),
    expand_file_name('db/language_references*.pl', LanguageRefFiles),
    expand_file_name('db/bot_static_lexicon*.pl', BotStaticLexiconFiles),
    expand_file_name('db/bot_type_data.pl', BotTypeDataFiles),
    expand_file_name('db/bot_ui_texts.pl', BotUITextFiles),
    expand_file_name('db/bot_response_texts.pl', BotResponseTextFiles),
    expand_file_name('db/ability_data.pl', AbilityDataFiles),
    expand_file_name('db/abilities_catalog.pl', AbilitiesCatalogFiles),
    expand_file_name('db/items_catalog.pl', ItemsCatalogFiles),
    expand_file_name('db/moves_catalog.pl', MovesCatalogFiles),
    expand_file_name('db/move_tactical_catalog.pl', MoveTacticalCatalogFiles),
    expand_file_name('db/pokemon_movelists.pl', PokemonMovelistFiles),
    expand_file_name('db/move_data.pl', MoveDataFallbackFiles),
    ( GenerationFiles \= [] ->
        maplist(consult, GenerationFiles)
    ; consult('pokemon_db.pl')
    ),
    ( LoreFiles \= [] ->
        maplist(consult, LoreFiles)
    ; true
    ),
    ( EvolutionFiles \= [] ->
        maplist(consult, EvolutionFiles)
    ; true
    ),
    ( SpecialFiles \= [] ->
        maplist(consult, SpecialFiles)
    ; MegaFiles \= [] ->
        maplist(consult, MegaFiles)
    ; true
    ),
    ( SpecialLoreFiles \= [] ->
        maplist(consult, SpecialLoreFiles)
    ; MegaLoreFiles \= [] ->
        maplist(consult, MegaLoreFiles)
    ; true
    ),
    ( LanguageRefFiles \= [] ->
        maplist(consult, LanguageRefFiles)
    ; true
    ),
    ( BotStaticLexiconFiles \= [] ->
        maplist(consult, BotStaticLexiconFiles)
    ; true
    ),
    ( BotTypeDataFiles \= [] ->
        maplist(consult, BotTypeDataFiles)
    ; true
    ),
    ( BotUITextFiles \= [] ->
        maplist(consult, BotUITextFiles)
    ; true
    ),
    ( BotResponseTextFiles \= [] ->
        maplist(consult, BotResponseTextFiles)
    ; true
    ),
    ( AbilityDataFiles \= [] ->
        maplist(consult, AbilityDataFiles)
    ; true
    ),
    ( AbilitiesCatalogFiles \= [] ->
        maplist(consult, AbilitiesCatalogFiles)
    ; true
    ),
    ( ItemsCatalogFiles \= [] ->
        maplist(consult, ItemsCatalogFiles)
    ; true
    ),
    ( MovesCatalogFiles \= [] ->
        maplist(consult, MovesCatalogFiles)
    ; true
    ),
    ( MoveTacticalCatalogFiles \= [] ->
        maplist(consult, MoveTacticalCatalogFiles)
    ; true
    ),
    ( PokemonMovelistFiles \= [] ->
        maplist(consult, PokemonMovelistFiles)
    ; true
    ),
    ( MovesCatalogFiles == [], PokemonMovelistFiles == [], MoveDataFallbackFiles \= [] ->
        maplist(consult, MoveDataFallbackFiles)
    ; true
    ),
    rebuild_pokemon_name_index.

rebuild_pokemon_name_index :-
    retractall(pokemon_name_index_tokens(_, _)),
    retractall(pokemon_name_index_token(_, _)),
    findall(Name, pokemon(_, Name, _, _, _, _, _), NamesRaw),
    sort(NamesRaw, Names),
    forall(member(Name, Names), index_pokemon_name_tokens(Name)).

index_pokemon_name_tokens(Name) :-
    atom_string(Name, NameText),
    split_string(NameText, "_", "", NameTokensRaw),
    include(non_empty_string, NameTokensRaw, NameTokensNonEmpty),
    sort(NameTokensNonEmpty, NameTokens),
    NameTokens \= [],
    assertz(pokemon_name_index_tokens(Name, NameTokens)),
    forall(member(Token, NameTokens), assertz(pokemon_name_index_token(Token, Name))),
    !.
index_pokemon_name_tokens(_).

set_default_generation :-
    retractall(active_generation(_)),
    assertz(active_generation(all)),
    clear_query_caches,
    retractall(last_list_candidates(_)),
    retractall(pending_confirmation(_)),
    retractall(pending_level_roster(_, _, _)),
    retractall(pending_counter_preferences(_)),
    retractall(pending_counter_level_preferences(_, _)),
    retractall(pending_type_preferences(_)),
    retractall(pending_list_preferences(_)),
    retractall(pending_rank_focus(_, _, _)),
    retractall(pending_held_item_options(_, _)),
    retractall(pending_partner_preferences(_, _)),
    retractall(pending_partner_options(_, _)),
    retractall(pending_synergy_details(_, _)).

chat_loop :-
    write('Voce: '),
    flush_output(current_output),
    read_line_to_string(user_input, InputRaw),
    ( InputRaw == end_of_file ->
        nl, say_response(goodbye_eof)
    ; normalize_space(string(Input), InputRaw),
      downcase_atom(Input, Text),
      handle(Text),
      ( should_stop(Text) -> true ; chat_loop )
    ).

should_stop(Text) :-
    member(Text, ['sair', 'tchau', 'exit', 'quit']).

handle(Text) :-
    retractall(cache_tokenized_input(_, _)),
    catch(
        ( parse_generation_command(Text, Generation) ->
            set_active_generation(Generation)
        ; member(Text, ['ajuda', 'help']) ->
            show_help
        ; should_stop(Text) ->
            say_response(goodbye)
        ; answer_query(Text)
        ),
        Error,
        ( print_message(error, Error),
          writeln('Bot: Ocorreu um erro ao processar sua frase. Tente novamente com outra variação.')
        )
    ).

parse_generation_command(Text, all) :-
    member(Text, ['geracao todas', 'geração todas', 'geracao all', 'geração all']).
parse_generation_command(Text, Generation) :-
    split_string(Text, " ", "", [Cmd, Value]),
    member(Cmd, ["geracao", "geração"]),
    ( string_number(Value, Generation), integer(Generation)
    ; safe_generation_number_word(Value, Generation)
    ),
    between(1, 9, Generation).

set_active_generation(all) :-
    retractall(active_generation(_)),
    assertz(active_generation(all)),
    clear_query_caches,
    writeln('Bot: Agora estou consultando todas as geracoes carregadas.').
set_active_generation(Generation) :-
    retractall(active_generation(_)),
    assertz(active_generation(Generation)),
    clear_query_caches,
    format('Bot: Agora estou consultando apenas a geracao ~w.~n', [Generation]).

clear_query_caches :-
    retractall(cache_type_count(_, _, _)),
    retractall(cache_type_list(_, _, _)),
    retractall(cache_ability_list(_, _, _)),
    retractall(cache_move_catalog(_)),
    retractall(cache_pokemon_offensive_types(_, _)),
    retractall(cache_pokemon_ability_immunity_types(_, _)),
    retractall(cache_move_coverage_multiplier(_, _, _, _)),
    retractall(cache_pokemon_max_offensive_priority(_, _)),
    retractall(cache_counter_move_factor(_, _, _, _)),
    retractall(cache_pokemon_move_list(_, _, _)),
    retractall(cache_held_item_recommendation(_, _, _, _, _, _)),
    retractall(cache_battle_best_move_choice(_, _, _, _, _, _, _)),
    retractall(cache_pair_strategy_profile(_, _, _)),
    retractall(cache_pair_synergy_breakdown(_, _, _, _, _)),
    retractall(cache_scoped_filtered_names(_, _, _, _)),
    retractall(cache_generation_filtered_names(_, _, _, _)).

current_generation_key(Key) :-
    active_generation(Active),
    !,
    Key = Active.
current_generation_key(all).

% ============================================================
% ORQUESTRADOR DE INTENTS
% Ordem importa: regras mais específicas antes das genéricas.
% ============================================================

answer_query(Text) :-
    tokenize_for_match(Text, Tokens),
    ( resolve_intent(guarded, Text, Tokens, Goal) ->
        call(Goal),
        print_follow_up_prompt
    ; should_run_intent_fallback(Tokens),
      resolve_intent(unguarded, Text, Tokens, Goal) ->
        call(Goal),
        print_follow_up_prompt
    ; say_response(not_understood),
      print_follow_up_prompt
    ).

% ============================================================
% NÍVEL 1/NÍVEL 2 (INTENT BASE + MODIFICADORES)
% ============================================================

parse_level1_with_modifiers_query(Text, Intent, modifiers(Generation, LevelConstraint, TypeFilters, ContextFilters)) :-
    tokenize_for_match(Text, Tokens),
    parse_level2_modifiers(Tokens, Generation, LevelConstraint, TypeFilters, ContextFilters),
    has_any_level2_modifier(Generation, LevelConstraint, TypeFilters, ContextFilters),
    parse_level1_primary_intent(Text, Tokens, Intent).

parse_level1_primary_intent(Text, Tokens, counter(TargetName)) :-
    ( parse_counter_query(Text, TargetName)
    ; counter_intent_tokens(Tokens),
      parse_natural_pokemon_query(Text, TargetName)
    ),
    !.
parse_level1_primary_intent(Text, _Tokens, battle(NameA, NameB)) :-
    ( parse_battle_sim_query(Text, NameA, NameB)
    ; parse_ambiguous_two_pokemon_query(Text, NameA, NameB)
    ),
    !.
parse_level1_primary_intent(Text, _Tokens, info(Name)) :-
    parse_info_by_name(Text, Name).

parse_level2_modifiers(Tokens, Generation, LevelConstraint, TypeFilters, ContextFilters) :-
    ( parse_generation_from_tokens(Tokens, Generation) -> true ; Generation = none ),
    ( extract_modifier_level_constraint(Tokens, LevelConstraint) -> true ; LevelConstraint = none ),
    ( extract_type_filters(Tokens, TypeFilters) -> true ; TypeFilters = [] ),
    extract_context_filters(Tokens, ContextFilters).

parse_level2_only_composed_query(Text, Mode, modifiers(Generation, LevelConstraint, TypeFilters, ContextFilters)) :-
    tokenize_for_match(Text, Tokens),
    \+ has_ranking_signal(Tokens),
    \+ ranked_metric_from_tokens(Tokens, _),
    parse_level2_modifiers(Tokens, Generation, LevelConstraint, TypeFilters, ContextFilters),
    has_any_level2_modifier(Generation, LevelConstraint, TypeFilters, ContextFilters),
    \+ parse_level1_primary_intent(Text, Tokens, _),
    ( quantity_intent_tokens(Tokens) -> Mode = count ; Mode = list ).

extract_modifier_level_constraint(Tokens, LevelConstraint) :-
    ( level_cap_indicator_tokens(Tokens)
    ; level_upper_bound_tokens(Tokens)
    ; level_lower_bound_tokens(Tokens)
    ; has_token_with_prefix(Tokens, "lv")
    ; has_token_with_prefix(Tokens, "nivel")
    ; has_token_with_prefix(Tokens, "nível")
    ),
    extract_levels_from_tokens(Tokens, Levels),
    Levels \= [],
    levels_to_constraint(Tokens, Levels, LevelConstraint).

levels_to_constraint(Tokens, Levels, between(MinLevel, MaxLevel)) :-
    level_upper_bound_tokens(Tokens),
    level_lower_bound_tokens(Tokens),
    length(Levels, Count),
    Count >= 2,
    min_level_from_levels(Levels, MinLevel),
    max_level_from_levels(Levels, MaxLevel),
    MinLevel =< MaxLevel,
    !.
levels_to_constraint(Tokens, Levels, at_least(MinLevel)) :-
    level_lower_bound_tokens(Tokens),
    \+ level_upper_bound_tokens(Tokens),
    min_level_from_levels(Levels, MinLevel),
    !.
levels_to_constraint(Tokens, Levels, at_most(MaxLevel)) :-
    level_upper_bound_tokens(Tokens),
    max_level_from_levels(Levels, MaxLevel),
    !.
levels_to_constraint(_Tokens, Levels, at_most(MaxLevel)) :-
    max_level_from_levels(Levels, MaxLevel).

max_level_from_levels([MaxLevel | _], MaxLevel).

min_level_from_levels(Levels, MinLevel) :-
    reverse(Levels, [MinLevel | _]).

has_any_level2_modifier(Generation, LevelConstraint, TypeFilters, ContextFilters) :-
    Generation \= none
    ; LevelConstraint \= none
    ; TypeFilters \= []
    ; ContextFilters \= [].

quantity_intent_tokens(Tokens) :-
    member(Token, Tokens),
    quantity_intent_token(Token),
    !.

list_intent_tokens(Tokens) :-
    member(Token, Tokens),
    list_intent_token(Token),
    !.

level_cap_indicator_tokens(Tokens) :-
    member(Token, Tokens),
    level_cap_indicator_token(Token),
    !.

level_word_tokens(Tokens) :-
    member(Token, Tokens),
    level_word_token(Token),
    !.

pokemon_noun_tokens(Tokens) :-
    member(Token, Tokens),
    pokemon_noun_token(Token),
    !.

mega_tokens(Tokens) :-
    member(Token, Tokens),
    mega_token(Token),
    !.

level_upper_bound_tokens(Tokens) :-
    ( member(Token, Tokens), level_upper_bound_token(Token)
    ; level_upper_bound_phrase(Phrase), contiguous_sublist(Phrase, Tokens)
    ),
    !.

level_lower_bound_tokens(Tokens) :-
    ( member(Token, Tokens), level_lower_bound_token(Token)
    ; level_lower_bound_phrase(Phrase), contiguous_sublist(Phrase, Tokens)
    ),
    !.

answer_level1_with_modifiers(info(Name), _Modifiers) :-
    answer_pokemon(Name).
answer_level1_with_modifiers(counter(TargetIdentifier), modifiers(Generation, LevelConstraint, TypeFilters, ContextFilters)) :-
    answer_counter_with_level2_modifiers(TargetIdentifier, Generation, LevelConstraint, TypeFilters, ContextFilters).
answer_level1_with_modifiers(battle(NameA, NameB), modifiers(Generation, LevelConstraint, TypeFilters, ContextFilters)) :-
    answer_battle_with_level2_modifiers(NameA, NameB, Generation, LevelConstraint, TypeFilters, ContextFilters).

answer_level2_only_composed_query(Mode, modifiers(Generation, LevelConstraint, TypeFilters, ContextFilters)) :-
    findall(Name,
        ( pokemon(ID, Name, _Height, _Weight, Types, _Abilities, _Stats),
          ( Generation == none ; generation_matches_id(Generation, ID) ),
          pokemon_matches_optional_type_filters(TypeFilters, Types),
          name_passes_filters(ContextFilters, Name),
                    ( LevelConstraint == none ->
                                true
                        ; pokemon_reachable_by_level(ID, LevelConstraint)
                    )
        ),
        NamesRaw),
    sort(NamesRaw, Names),
    answer_level2_only_candidates(Mode, Generation, LevelConstraint, TypeFilters, ContextFilters, Names).

answer_level2_only_candidates(count, Generation, LevelConstraint, TypeFilters, _ContextFilters, Names) :-
    !,
    length(Names, Count),
    level2_modifiers_text(Generation, LevelConstraint, TypeFilters, ModText),
    format('Bot: Encontrei ~w Pokémon ~w.~n', [Count, ModText]).
answer_level2_only_candidates(_, Generation, LevelConstraint, TypeFilters, _ContextFilters, Names) :-
    Names \= [],
    !,
    remember_candidate_list(Names),
    length(Names, Count),
    sample_names_text(Names, 12, SampleText),
    level2_modifiers_text(Generation, LevelConstraint, TypeFilters, ModText),
    format('Bot: Encontrei ~w Pokémon ~w.~n', [Count, ModText]),
    format('  Exemplos: ~w~n', [SampleText]).
answer_level2_only_candidates(_, Generation, LevelConstraint, TypeFilters, _ContextFilters, _) :-
    level2_modifiers_text(Generation, LevelConstraint, TypeFilters, ModText),
    format('Bot: Não encontrei Pokémon ~w.~n', [ModText]).

level2_modifiers_text(Generation, LevelConstraint, TypeFilters, Text) :-
    generation_text_optional(Generation, GText),
    level_text_optional(LevelConstraint, LText),
    type_text_optional(TypeFilters, TText),
    atomic_list_concat([GText, LText, TText], ' ', RawText),
    normalize_space(atom(Text), RawText).

generation_text_optional(none, '').
generation_text_optional(Generation, Text) :-
    format(atom(Text), 'na geração ~w', [Generation]).

level_text_optional(none, '').
level_text_optional(LevelConstraint, Text) :-
    level_constraint_text(LevelConstraint, Text).

level_constraint_text(none, '').
level_constraint_text(at_most(MaxLevel), Text) :-
    format(atom(Text), 'até nível ~w', [MaxLevel]).
level_constraint_text(at_least(MinLevel), Text) :-
    format(atom(Text), 'a partir do nível ~w', [MinLevel]).
level_constraint_text(between(MinLevel, MaxLevel), Text) :-
    format(atom(Text), 'entre níveis ~w e ~w', [MinLevel, MaxLevel]).
level_constraint_text(LevelValue, Text) :-
    integer(LevelValue),
    format(atom(Text), 'até nível ~w', [LevelValue]).

type_text_optional([], '').
type_text_optional(TypeFilters, Text) :-
    type_filters_text(TypeFilters, FiltersText),
    format(atom(Text), 'do tipo ~w', [FiltersText]).

answer_battle_with_level2_modifiers(NameA, NameB, Generation, LevelConstraint, TypeFilters, ContextFilters) :-
    pokemon_info(NameA, pokemon(IDA, NameAtomA, _, _, TypesA, _, StatsA)),
    pokemon_info(NameB, pokemon(IDB, NameAtomB, _, _, TypesB, _, StatsB)),
    battle_pair_passes_modifiers(IDA, NameAtomA, TypesA, Generation, TypeFilters, ContextFilters),
    battle_pair_passes_modifiers(IDB, NameAtomB, TypesB, Generation, TypeFilters, ContextFilters),
    !,
        ( LevelConstraint == none ->
        battle_default_level(RefLevel),
        scale_stats_for_competitive_battle(IDA, StatsA, RefLevel, StatsAUsed),
        scale_stats_for_competitive_battle(IDB, StatsB, RefLevel, StatsBUsed),
        format(atom(MaxLabel), ' (nível padrão ~w)', [RefLevel])
        ; level_constraint_reference_level(LevelConstraint, RefLevel),
            scale_stats_for_competitive_battle(IDA, StatsA, RefLevel, StatsAUsed),
            scale_stats_for_competitive_battle(IDB, StatsB, RefLevel, StatsBUsed),
            level_constraint_text(LevelConstraint, ConstraintText),
            format(atom(MaxLabel), ' (~w)', [ConstraintText])
    ),
    display_pokemon_name(NameAtomA, LabelA),
    display_pokemon_name(NameAtomB, LabelB),
    battle_profile(RefLevel, IDA, TypesA, StatsAUsed, IDB, TypesB, StatsBUsed, ProfileA),
    battle_profile(RefLevel, IDB, TypesB, StatsBUsed, IDA, TypesA, StatsAUsed, ProfileB),
    simulate_duel(ProfileA, ProfileB, WinnerSide, Turns),
    remember_candidate_list([NameAtomA, NameAtomB]),
    format('Bot: Simulação teórica 1x1 entre ~w e ~w~w:~n', [LabelA, LabelB, MaxLabel]),
    print_duel_deep_block(LabelA, ProfileA, LabelB, ProfileB, WinnerSide, Turns),
    writeln('Bot: Observação: considera golpe-chave e habilidade catalogados, mas ainda simplifica item, clima e boosts.').
answer_battle_with_level2_modifiers(NameA, NameB, _Generation, _LevelConstraint, _TypeFilters, _ContextFilters) :-
    format('Bot: Não consegui aplicar esses modificadores ao embate entre ~w e ~w.~n', [NameA, NameB]).

battle_pair_passes_modifiers(ID, Name, Types, Generation, TypeFilters, ContextFilters) :-
    ( Generation == none ; generation_matches_id(Generation, ID) ),
    pokemon_matches_optional_type_filters(TypeFilters, Types),
    name_passes_filters(ContextFilters, Name).

% ============================================================
% ESTADO DE CONVERSA (PEND�SNCIAS / CONFIRMA�?�.ES)
% ============================================================

handle_pending_type_preferences(Text) :-
    pending_type_preferences(TypeFilters),
    !,
    tokenize_for_match(Text, Tokens),
    ( has_cancel_token(Tokens) ->
        retractall(pending_type_preferences(_)),
        say_response(pending_type_cancel)
    ; type_preferences_from_text(Text, ContextFilters) ->
        retractall(pending_type_preferences(_)),
        answer_type_query_with_context_filters(TypeFilters, ContextFilters)
    ; counter_preferences_default_text(Tokens) ->
        retractall(pending_type_preferences(_)),
        answer_type_query(TypeFilters)
    ; say_response(pending_type_help)
    ).

handle_pending_list_preferences(Text) :-
    pending_list_preferences(PendingAction),
    !,
    tokenize_for_match(Text, Tokens),
    ( has_cancel_token(Tokens) ->
        retractall(pending_list_preferences(_)),
        say_response(pending_list_cancel)
    ; type_preferences_from_text(Text, ContextFilters) ->
        retractall(pending_list_preferences(_)),
        execute_pending_list_preferences(PendingAction, ContextFilters)
    ; counter_preferences_default_text(Tokens) ->
        retractall(pending_list_preferences(_)),
        execute_pending_list_preferences(PendingAction, [])
    ; say_response(pending_type_help)
    ).

execute_pending_list_preferences(best_switch(TargetIdentifier), ContextFilters) :-
    answer_best_switch_query_with_filters(TargetIdentifier, ContextFilters).
execute_pending_list_preferences(weak_against(TypeFilters), ContextFilters) :-
    answer_weak_against_type_query_with_filters(TypeFilters, ContextFilters).
execute_pending_list_preferences(immunity(TypeFilters), ContextFilters) :-
    answer_immunity_type_query_with_filters(TypeFilters, ContextFilters).

type_preferences_from_text(Text, ContextFilters) :-
    tokenize_for_match(Text, Tokens),
    findall(Filter,
        ( context_filter_token(Filter, FilterTokens),
          contiguous_sublist(FilterTokens, Tokens)
        ),
        ContextRaw),
    sort(ContextRaw, ContextFilters),
    ContextFilters \= [].

counter_preferences_default_text(Tokens) :-
    ( member(Token, Tokens), default_choice_token(Token) )
    ; is_yes_response_tokens(Tokens)
    ; is_no_response_tokens(Tokens).

handle_pending_confirmation(Text) :-
    pending_confirmation(Action),
    !,
    ( is_yes_response(Text) ->
        retractall(pending_confirmation(_)),
        execute_pending_confirmation(Action)
    ; is_no_response(Text) ->
        retractall(pending_confirmation(_)),
        writeln('Bot: Beleza, sem problemas. Pode mandar de novo com os nomes que você quiser.')
    ; writeln('Bot: Para confirmar a correção, responda apenas "sim" ou "não".')
    ).

is_yes_response(Text) :-
    tokenize_for_match(Text, Tokens),
    is_yes_response_tokens(Tokens).

is_no_response(Text) :-
    tokenize_for_match(Text, Tokens),
    is_no_response_tokens(Tokens).

is_yes_response_tokens(Tokens) :-
    member(Token, Tokens),
    yes_response_token(Token),
    !.

is_no_response_tokens(Tokens) :-
    member(Token, Tokens),
    no_response_token(Token),
    !.

has_cancel_token(Tokens) :-
    member(Token, Tokens),
    cancel_token(Token),
    !.

execute_pending_confirmation(info(Name)) :-
    answer_pokemon(Name).
execute_pending_confirmation(counter(Name)) :-
    answer_counter_query(Name).
execute_pending_confirmation(filtered_counter(TypeFilters, Name)) :-
    answer_filtered_counter_query(TypeFilters, Name).
execute_pending_confirmation(best_switch(Name)) :-
    answer_best_switch_query(Name).
execute_pending_confirmation(compare(NameA, NameB)) :-
    answer_compare_query(NameA, NameB).
execute_pending_confirmation(battle(NameA, NameB)) :-
    answer_battle_sim_query(NameA, NameB).

handle_pending_level_roster(Text) :-
    pending_level_roster(TargetName, TargetLevel, OwnLevel),
    !,
    tokenize_for_match(Text, Tokens),
    ( member("cancelar", Tokens) ->
        retractall(pending_level_roster(_, _, _)),
        writeln('Bot: Certo, cancelei a análise por nível.')
    ; extract_all_pokemon_mentions(Text, Mentioned),
      exclude(=(TargetName), Mentioned, RosterNames),
      RosterNames \= [] ->
        retractall(pending_level_roster(_, _, _)),
        answer_level_matchup_from_roster(TargetName, TargetLevel, OwnLevel, RosterNames)
    ; writeln('Bot: Ainda não identifiquei sua lista. Envie os nomes separados por vírgula (ex.: "golem, graveler, sandslash") ou digite "cancelar".')
    ).

% ============================================================
% PARSERS DE LINGUAGEM NATURAL
% ============================================================

parse_level_matchup_query(Text, TargetName, TargetLevel, OwnLevel) :-
    tokenize_for_match(Text, Tokens),
    ( level_word_tokens(Tokens)
    ; has_token_with_prefix(Tokens, "lv")
    ; has_token_with_prefix(Tokens, "nivel")
    ; has_token_with_prefix(Tokens, "nível")
    ),
    ( member("vencer", Tokens)
    ; member("ganhar", Tokens)
    ; member("chances", Tokens)
    ; member("contra", Tokens)
    ),
    parse_natural_pokemon_query(Text, TargetName),
    extract_levels_from_tokens(Tokens, Levels),
    Levels \= [],
    infer_target_and_own_levels(Levels, TargetLevel, OwnLevel).

parse_generation_from_tokens(Tokens, Generation) :-
    ( append(_, [Key, Value | _], Tokens),
      generation_keyword_token(Key),
      token_to_generation(Value, Generation)
        ; append(_, [Value, Key | _], Tokens),
            generation_keyword_token(Key),
            token_to_generation(Value, Generation)
        ; append(_, [Prefix, Value | _], Tokens),
            generation_prefix(Prefix),
            token_to_generation(Value, Generation)
    ; member(Token, Tokens),
      token_with_generation_prefix(Token, Generation)
    ),
    between(1, 9, Generation).

token_to_generation(Token, Generation) :-
    string_number(Token, Generation),
    integer(Generation),
    between(1, 9, Generation).
token_to_generation(Token, Generation) :-
    safe_generation_number_word(Token, Generation),
    between(1, 9, Generation).

token_with_generation_prefix(Token, Generation) :-
    generation_prefix(Prefix),
    sub_string(Token, 0, PrefixLen, _, Prefix),
    sub_string(Token, PrefixLen, _, 0, Digits),
    Digits \= "",
    string_number(Digits, Generation),
    integer(Generation),
    between(1, 9, Generation).

extract_context_filters(Tokens, Filters) :-
    findall(Filter,
        ( context_filter_token(Filter, FilterTokens),
          contiguous_sublist(FilterTokens, Tokens)
        ),
        Raw),
    sort(Raw, Filters).

has_token_with_prefix(Tokens, Prefix) :-
    member(Token, Tokens),
    sub_string(Token, 0, _, _, Prefix).

extract_levels_from_tokens(Tokens, Levels) :-
    findall(Level,
        ( member(Token, Tokens),
          token_to_level(Token, Level)
        ),
        LevelsSingleRaw),
    findall(Level,
        token_level_compound_in_tokens(Tokens, Level),
        LevelsCompoundRaw),
    append(LevelsSingleRaw, LevelsCompoundRaw, LevelsRaw),
    LevelsRaw \= [],
    sort(LevelsRaw, LevelsSorted),
    reverse(LevelsSorted, Levels).

token_to_level(Token, Level) :-
    string_number(Token, Level),
    integer(Level),
    between(1, 100, Level).
token_to_level(Token, Level) :-
    safe_number_word_value(Token, Level),
    between(1, 100, Level).
token_to_level(Token, Level) :-
    level_prefix_digits(Token, "lv", Level).
token_to_level(Token, Level) :-
    level_prefix_digits(Token, "nivel", Level).
token_to_level(Token, Level) :-
    level_prefix_digits(Token, "nível", Level).

token_level_compound_in_tokens(Tokens, Level) :-
    append(_, [TensToken, "e", UnitToken | _], Tokens),
    safe_number_word_value(TensToken, Tens),
    safe_number_word_value(UnitToken, Units),
    member(Tens, [20, 30, 40, 50, 60, 70, 80, 90]),
    between(1, 9, Units),
    Level is Tens + Units,
    between(1, 100, Level).

level_prefix_digits(Token, Prefix, Level) :-
    sub_string(Token, 0, PrefixLen, _, Prefix),
    sub_string(Token, PrefixLen, _, 0, Digits),
    Digits \= "",
    string_number(Digits, Level),
    integer(Level),
    between(1, 100, Level).

infer_target_and_own_levels([Only], Only, Only).
infer_target_and_own_levels(Levels, TargetLevel, OwnLevel) :-
    Levels = [TargetLevel | _],
    last(Levels, OwnLevel).

extract_all_pokemon_mentions(Text, Names) :-
    tokenize_for_match(Text, Tokens),
        indexed_candidate_names_from_tokens(Tokens, IndexedCandidates),
        ( IndexedCandidates \= [] ->
                CandidateNames = IndexedCandidates
        ; findall(Name, pokemon_in_scope(_, Name, _, _, _, _, _), CandidateNamesRaw),
            sort(CandidateNamesRaw, CandidateNames)
        ),
        findall(Name,
                ( member(Name, CandidateNames),
                    pokemon_name_in_scope(Name),
                    pokemon_name_mentioned_in_tokens(Name, Tokens, _)
                ),
                NamesRaw),
    sort(NamesRaw, Names).

parse_info_by_number(Text, Number) :-
    tokenize_for_match(Text, Tokens),
    ( starts_with_tokens(Tokens, ["info", "numero"]) ;
      starts_with_tokens(Tokens, ["pokemon", "numero"]) ;
            starts_with_tokens(Tokens, ["pokemon"]) ;
      starts_with_tokens(Tokens, ["numero"]) ;
      starts_with_tokens(Tokens, ["pokedex"]) ;
            single_numeric_word(Tokens) ;
      sub_string(Text, _, _, _, "numero") ;
      sub_string(Text, _, _, _, "pokedex")
    ),
    extract_number(Tokens, Number).

parse_info_by_name(Text, Name) :-
    tokenize_for_match(Text, Tokens),
    ( starts_with_tokens(Tokens, ["info", "nome"]) ->
        drop_first_n(Tokens, 2, NameTokens),
        extract_name_from_tokens(NameTokens, Name)
    ; starts_with_tokens(Tokens, ["pokemon", "nome"]) ->
        drop_first_n(Tokens, 2, NameTokens),
        extract_name_from_tokens(NameTokens, Name)
    ; starts_with_tokens(Tokens, ["nome"]) ->
        drop_first_n(Tokens, 1, NameTokens),
        extract_name_from_tokens(NameTokens, Name)
    ; starts_with_tokens(Tokens, ["pokemon"]) ->
        drop_first_n(Tokens, 1, NameTokens),
        extract_name_from_tokens(NameTokens, Name)
    ; single_word(Tokens, Name)
    ).

parse_natural_pokemon_query(Text, Name) :-
    tokenize_for_match(Text, Tokens),
        indexed_candidate_names_from_tokens(Tokens, IndexedCandidates),
        ( IndexedCandidates \= [] ->
                CandidateNames = IndexedCandidates
        ; findall(FoundName, pokemon_in_scope(_, FoundName, _, _, _, _, _), CandidateNamesRaw),
            sort(CandidateNamesRaw, CandidateNames)
        ),
    findall(Len-FoundName,
                ( member(FoundName, CandidateNames),
                    pokemon_name_in_scope(FoundName),
          pokemon_name_mentioned_in_tokens(FoundName, Tokens, Len)
        ),
        Matches),
    Matches \= [],
    keysort(Matches, Sorted),
    reverse(Sorted, [_BestLen-Name | _]).

indexed_candidate_names_from_tokens(Tokens, CandidateNames) :-
        findall(Name,
                ( member(Token, Tokens),
                    pokemon_name_index_token(Token, Name)
                ),
                CandidateNamesRaw),
        sort(CandidateNamesRaw, CandidateNames).

pokemon_name_in_scope(Name) :-
        pokemon_in_scope(_, Name, _, _, _, _, _),
        !.

parse_type_query(Text, TypeFilters) :-
    split_string(Text, " ", "", Tokens),
    ( append(_, ["tipo" | Tail], Tokens)
    ; append(_, ["tipos" | Tail], Tokens)
    ),
    extract_type_filters(Tail, TypeFilters).

parse_natural_type_query(Text, TypeFilters) :-
    tokenize_for_match(Text, Tokens),
    ( pokemon_noun_tokens(Tokens)
    ; list_intent_tokens(Tokens)
    ; quantity_intent_tokens(Tokens)
    ; member("tipo", Tokens)
    ; member("tipos", Tokens)
    ; member("elemento", Tokens)
    ; member("elementos", Tokens)
    ),
    extract_type_filters(Tokens, TypeFilters).

parse_count_without_type_query(Text, TypeFilters) :-
    tokenize_for_match(Text, Tokens),
    quantity_intent_tokens(Tokens),
    token_member_pred(Tokens, negation_token),
    extract_type_filters(Tokens, TypeFilters),
    TypeFilters \= [].

parse_weak_against_type_query(Text, TypeFilters) :-
    tokenize_for_match(Text, Tokens),
    token_member_pred(Tokens, weak_intent_token),
    ( member("contra", Tokens)
    ; member("a", Tokens)
    ; ( member(RelToken, Tokens), counter_relation_token(RelToken) )
    ),
    extract_type_filters(Tokens, TypeFilters),
    TypeFilters \= [].

parse_immunity_type_query(Text, TypeFilters) :-
    tokenize_for_match(Text, Tokens),
    token_member_pred(Tokens, immunity_intent_token),
    extract_type_filters(Tokens, TypeFilters),
    TypeFilters \= [].

parse_role_type_query(Text, RoleKey, TypeFilters) :-
    tokenize_for_match(Text, Tokens),
    role_keyword(RoleKey, Tokens),
    ( extract_type_filters(Tokens, TypeFilters)
    ; TypeFilters = []
    ).

role_keyword(tank, Tokens) :-
    ( member("tank", Tokens)
    ; member("tanky", Tokens)
    ; member("resistente", Tokens)
    ; member("resistentes", Tokens)
    ).
role_keyword(sweeper, Tokens) :-
    ( member("sweeper", Tokens)
    ; member("sweep", Tokens)
    ; member("ofensivo", Tokens)
    ; member("ofensivos", Tokens)
    ).

parse_contextual_stat_query(Text, Stats) :-
    tokenize_for_match(Text, Tokens),
    ( member("desse", Tokens)
    ; member("desses", Tokens)
    ; member("dessa", Tokens)
    ; member("dessas", Tokens)
    ; member("destes", Tokens)
    ; member("destas", Tokens)
    ; member("deles", Tokens)
    ; member("delas", Tokens)
    ),
    extract_stats_from_tokens(Tokens, Stats),
    Stats \= [].

parse_ability_query(Text, Ability) :-
    tokenize_for_match(Text, Tokens),
    append(_, [Keyword | Tail], Tokens),
    ability_keyword(Keyword),
    \+ starts_with_tokens(Tail, ["de"]),
    \+ starts_with_tokens(Tail, ["do"]),
    \+ starts_with_tokens(Tail, ["da"]),
    extract_ability_token(Tail, Ability).
parse_ability_query(Text, Ability) :-
    tokenize_for_match(Text, Tokens),
    ability_detail_request_signal(Tokens),
    extract_best_ability_mention_from_tokens(Tokens, Ability),
    \+ parse_natural_pokemon_query(Text, _).

ability_keyword_signal(Tokens) :-
    member(Keyword, Tokens),
    ability_keyword(Keyword),
    !.
ability_keyword_signal(Tokens) :-
    current_predicate(ability_keyword_phrase/1),
    ability_keyword_phrase(Phrase),
    contiguous_sublist(Phrase, Tokens),
    !.

parse_pokemon_ability_details_query(Text, Name) :-
    tokenize_for_match(Text, Tokens),
    parse_natural_pokemon_query(Text, Name),
    ( ability_keyword_signal(Tokens)
    ; extract_best_ability_mention_from_tokens(Tokens, _)
    ),
    ( ability_detail_request_signal(Tokens)
    ; extract_best_ability_mention_from_tokens(Tokens, _)
    ),
    !.

ability_detail_request_signal(Tokens) :-
    member(Token, Tokens),
    member(Token, ["faz", "fazem", "efeito", "efeitos", "funciona", "detalhe", "detalhes", "explica", "explicacao", "descrição", "descricao", "serve", "info", "informacao", "informacoes", "informações"]),
    !.
ability_detail_request_signal(Tokens) :-
    contiguous_sublist(["o", "que"], Tokens),
    !.
ability_detail_request_signal(Tokens) :-
    contiguous_sublist(["oq"], Tokens),
    !.
ability_detail_request_signal(Tokens) :-
    contiguous_sublist(["como", "funciona"], Tokens),
    !.


parse_pokemon_movelist_query(Text, Name) :-
    tokenize_for_match(Text, Tokens),
    ( member(Token, Tokens), move_intent_token(Token) ),
    extract_all_pokemon_mentions(Text, Mentions),
    Mentions = [Name | _].

parse_move_list_query(Text) :-
    tokenize_for_match(Text, Tokens),
        ( ( member(Token, Tokens), move_intent_token(Token),
                ( member("lista", Tokens)
                ; member("listar", Tokens)
                ; member("todos", Tokens)
                ; member("presentes", Tokens)
                ; member("jogo", Tokens)
                ; member("catalogados", Tokens)
                ; member("catalogado", Tokens)
                ; member("catalogo", Tokens)
                ; member("catálogo", Tokens)
                )
            )
        ; contiguous_sublist(["lista", "de", "moves"], Tokens)
    ; contiguous_sublist(["lista", "de", "golpes"], Tokens)
    ; contiguous_sublist(["moves", "presentes"], Tokens)
    ; contiguous_sublist(["golpes", "presentes"], Tokens)
    ),
    \+ parse_pokemon_movelist_query(Text, _).

parse_specific_move_query(Text, Move) :-
    tokenize_for_match(Text, Tokens),
    move_detail_query_signal(Tokens),
    extract_best_move_mention_from_tokens(Tokens, Move).

parse_specific_item_query(Text, Item) :-
    tokenize_for_match(Text, Tokens),
    item_detail_query_signal(Tokens),
    extract_best_item_mention_from_tokens(Tokens, Item).

move_detail_query_signal(Tokens) :-
    detail_query_signal(Tokens),
    !.
move_detail_query_signal(Tokens) :-
    token_member_any(Tokens, ["move", "moves", "golpe", "golpes", "poder", "power", "accuracy", "acuracia", "precisao", "pp", "prioridade", "categoria", "tipo"]),
    !.
move_detail_query_signal(Tokens) :-
    length(Tokens, Len),
    Len =< 4,
    !.

item_detail_query_signal(Tokens) :-
    detail_query_signal(Tokens),
    !.
item_detail_query_signal(Tokens) :-
    token_member_any(Tokens, ["item", "itens", "held", "equipar", "equipado", "equipa", "serve", "funciona"]),
    !.
item_detail_query_signal(Tokens) :-
    length(Tokens, Len),
    Len =< 4,
    !.

detail_query_signal(Tokens) :-
    member(Token, Tokens),
    member(Token, ["faz", "efeito", "efeitos", "serve", "funciona", "detalhe", "detalhes", "explica", "explicacao", "descrição", "descricao", "info", "informacao", "informações", "informacoes"]),
    !.
detail_query_signal(Tokens) :-
    contiguous_sublist(["o", "que"], Tokens),
    !.
detail_query_signal(Tokens) :-
    contiguous_sublist(["como", "funciona"], Tokens),
    !.

parse_status_query(Text, Stat) :-
    tokenize_for_match(Text, Tokens),
    ( append(_, ["status" | Tail], Tokens)
    ; append(_, ["stats" | Tail], Tokens)
    ; append(_, ["atributo" | Tail], Tokens)
    ; append(_, ["atributos" | Tail], Tokens)
    ; starts_with_tokens(Tokens, ["maior"], Tail)
    ; starts_with_tokens(Tokens, ["top"], Tail)
    ),
    extract_stat_from_tokens(Tail, Stat).

parse_status_full_query(Text, Stat) :-
    tokenize_for_match(Text, Tokens),
    ( member("status", Tokens)
    ; member("stats", Tokens)
    ; member("atributos", Tokens)
    ),
    ( member("completo", Tokens) ; member("lista", Tokens) ; member("todos", Tokens) ),
    extract_stat_from_tokens(Tokens, Stat).

safe_number_word_value(Token, Number) :-
    current_predicate(number_word_value/2),
    number_word_value(Token, Number).

safe_generation_number_word(Token, Generation) :-
    current_predicate(generation_number_word/2),
    generation_number_word(Token, Generation).

extract_target_name_after_relation(Text, TargetName) :-
    tokenize_for_match(Text, Tokens),
    append(_, [Rel | Tail], Tokens),
    ( counter_relation_token(Rel) ; compare_separator_token(Rel) ),
    find_best_pokemon_mention_in_tokens(Tail, TargetName),
    !.

find_best_pokemon_mention_in_tokens(Tokens, Name) :-
    findall(Len-FoundName,
        ( pokemon_in_scope(_, FoundName, _, _, _, _, _),
          pokemon_name_mentioned_in_tokens(FoundName, Tokens, Len)
        ),
        Matches),
    Matches \= [],
    keysort(Matches, Asc),
    reverse(Asc, [_BestLen-Name | _]).

starts_with_tokens(Tokens, Prefix) :-
    append(Prefix, _, Tokens).
starts_with_tokens(Tokens, Prefix, Rest) :-
    append(Prefix, Rest, Tokens).

drop_first_n(List, N, Rest) :-
    length(Prefix, N),
    append(Prefix, Rest, List),
    !.
drop_first_n(_, _, []).

single_word([Word], Name) :-
    normalize_name_token(Word, Name),
    Name \= "",
    \+ string_number(Name, _),
    \+ member(Name, ["tipo", "numero", "nome", "info", "pokemon", "sim", "nao", "não", "ok", "okay", "help", "ajuda", "obrigado", "valeu"]).

single_numeric_word([Word]) :-
    string_number(Word, _).

extract_name_from_tokens(RawTokens, Name) :-
    findall(Token,
        ( member(Raw, RawTokens),
          normalize_name_token(Raw, Token),
          Token \= "",
          \+ name_stopword(Token)
        ),
        NameTokens),
    NameTokens \= [],
    atomic_list_concat(NameTokens, '_', Name).

normalize_name_token(RawToken, Normalized) :-
    input_to_string(RawToken, RawText),
    string_lower(RawText, Lower),
    split_string(Lower, " ,.;:!?()[]{}\"'/-_", "", Parts0),
    include(non_empty_string, Parts0, Parts),
    atomic_list_concat(Parts, '_', Combined0),
    atom_string(Combined0, Normalized).

extract_number(Tokens, Number) :-
    member(Token, Tokens),
    token_to_number(Token, Number),
    !.

token_to_number(Token, Number) :-
    string_number(Token, Number),
    !.
token_to_number(Token, Number) :-
    sub_string(Token, 0, 1, _, "#"),
    sub_string(Token, 1, _, 0, Digits),
    string_number(Digits, Number).

string_number(Text, Number) :-
    catch(number_string(Number, Text), _, fail).

extract_type_filters(Tokens, TypeFilters) :-
    findall(Type,
        ( member(Token, Tokens),
          token_to_type_candidates(Token, Candidates),
          member(Candidate, Candidates),
          \+ member(Candidate, ["e", "ou", "com", "de", "do", "da", "pokemon", "pokemons", "pokémon", "pokémons"]),
          normalize_type(Candidate, Type),
          valid_type(Type)
        ),
        TypesRaw),
    sort(TypesRaw, TypeFilters),
    TypeFilters \= [].

token_to_type_candidates(Token, Candidates) :-
    split_string(Token, "/,+", "", Candidates0),
    include(non_empty_string, Candidates0, Candidates).

non_empty_string(Text) :- Text \= "".

tokenize_for_match(Text, Tokens) :-
    input_to_string(Text, TextString),
    ( cache_tokenized_input(TextString, CachedTokens) ->
        Tokens = CachedTokens
    ; string_lower(TextString, Lower),
      split_string(Lower, " ,.;:!?()[]{}\"'/-_", "", RawTokens),
      include(non_empty_string, RawTokens, NonEmptyRaw),
      maplist(normalize_input_token, NonEmptyRaw, TokensRaw),
      include(non_empty_string, TokensRaw, Tokens),
      assertz(cache_tokenized_input(TextString, Tokens))
    ).

normalize_input_token(RawToken, Normalized) :-
    input_to_string(RawToken, RawText),
    string_lower(RawText, Lower),
    string_chars(Lower, Chars),
    maplist(fold_accent_char, Chars, FoldedChars),
    string_chars(FoldedText, FoldedChars),
    ( common_typo_token(FoldedText, Corrected) -> Normalized = Corrected ; Normalized = FoldedText ).

% Correções explícitas e seguras para palavras de intenção (não nomes de Pokémon).
common_typo_token("pokemom", "pokemon").
common_typo_token("pokemo", "pokemon").
common_typo_token("poekmon", "pokemon").
common_typo_token("pokeomn", "pokemon").
common_typo_token("pnkemon", "pokemon").
common_typo_token("pokemonss", "pokemons").
common_typo_token("qantos", "quantos").
common_typo_token("qunatos", "quantos").
common_typo_token("quantso", "quantos").
common_typo_token("quntos", "quantos").
common_typo_token("quanots", "quantos").
common_typo_token("qnts", "qts").
common_typo_token("qal", "qual").
common_typo_token("qul", "qual").
common_typo_token("cntra", "contra").
common_typo_token("contraa", "contra").
common_typo_token("vnce", "vence").
common_typo_token("vense", "vence").
common_typo_token("ganhha", "ganha").
common_typo_token("ganh", "ganha").
common_typo_token("geracoa", "geracao").
common_typo_token("geracap", "geracao").
common_typo_token("geraçao", "geracao").
common_typo_token("geraaco", "geracao").
common_typo_token("gera", "gen").
common_typo_token("nivle", "nivel").
common_typo_token("nviel", "nivel").
common_typo_token("nive", "nivel").
common_typo_token("evoluçao", "evolucao").
common_typo_token("evolucap", "evolucao").
common_typo_token("comparacoa", "comparacao").
common_typo_token("comparcao", "comparacao").
common_typo_token("habilidae", "habilidade").
common_typo_token("estrateiga", "estrategia").
common_typo_token("estragia", "estrategia").
common_typo_token("synergia", "sinergia").
common_typo_token("contrra", "contra").
common_typo_token("simulacaoo", "simulacao").
common_typo_token("simulaçao", "simulacao").
common_typo_token("vgcc", "vgc").

pokemon_name_mentioned_in_tokens(Name, Tokens, Len) :-
    ( pokemon_name_index_tokens(Name, NameTokens) ->
        true
    ; atom_string(Name, NameText),
      split_string(NameText, "_", "", NameTokensRaw),
      include(non_empty_string, NameTokensRaw, NameTokens)
    ),
    NameTokens \= [],
    contiguous_sublist(NameTokens, Tokens),
    length(NameTokens, Len).

contiguous_sublist(SubList, List) :-
    append(_, Rest, List),
    append(SubList, _, Rest).

valid_type(Type) :-
    all_types(Types),
    member(Type, Types).

extract_ability_token(Tokens, Ability) :-
    include(valid_ability_word, Tokens, Words),
    Words \= [],
    atomic_list_concat(Words, '_', Ability).

valid_ability_word(Token) :-
    Token \= "",
    \+ member(Token, ["com", "de", "do", "da", "que", "tem", "têm", "pokemon", "pokemons", "pokémon", "pokémons"]).

extract_best_ability_mention_from_tokens(Tokens, Ability) :-
    findall(Len-FoundAbility,
        ( ability_catalog_entry(FoundAbility),
          catalog_atom_mentioned_in_tokens(FoundAbility, Tokens, Len)
        ),
        Matches),
    Matches \= [],
    keysort(Matches, Sorted),
    reverse(Sorted, [_BestLen-Ability | _]).

extract_best_item_mention_from_tokens(Tokens, Item) :-
    findall(Len-FoundItem,
        ( item_catalog_entry(FoundItem),
          catalog_atom_mentioned_in_tokens(FoundItem, Tokens, Len)
        ),
        Matches),
    Matches \= [],
    keysort(Matches, Sorted),
    reverse(Sorted, [_BestLen-Item | _]).

extract_best_move_mention_from_tokens(Tokens, Move) :-
    findall(Len-FoundMove,
        ( move_catalog_entry(FoundMove),
          catalog_atom_mentioned_in_tokens(FoundMove, Tokens, Len)
        ),
        Matches),
    Matches \= [],
    keysort(Matches, Sorted),
    reverse(Sorted, [_BestLen-Move | _]).

catalog_atom_mentioned_in_tokens(Atom, Tokens, Len) :-
    atom_string(Atom, AtomText),
    split_string(AtomText, "_", "", AtomPartsRaw),
    include(valid_catalog_word, AtomPartsRaw, AtomParts),
    AtomParts \= [],
    contiguous_sublist(AtomParts, Tokens),
    length(AtomParts, Len).

valid_catalog_word(Token) :-
    Token \= "",
    \+ member(Token, ["de", "do", "da", "com", "para", "sem", "e", "ou", "the", "of", "and"]).

ability_catalog_entry(Ability) :-
    current_predicate(ability_entry/5),
    ability_entry(Ability, _Generation, _IsMainSeries, _ShortEffect, _Effect).

item_catalog_entry(Item) :-
    current_predicate(item_entry/6),
    item_entry(Item, _Category, _Cost, _FlingPower, _FlingEffect, _Description).

extract_stat_from_tokens(Tokens, Stat) :-
    include(non_empty_string, Tokens, Words),
    stat_from_words(Words, Stat),
    !.

extract_stats_from_tokens(Tokens, Stats) :-
        findall(Stat,
                ( stat_pair_alias(W1, W2, Stat),
                    contiguous_sublist([W1, W2], Tokens)
                ),
                PairStats),
        findall(Stat,
                ( member(Token, Tokens),
                    stat_token_alias(Token, Stat)
                ),
                TokenStats),
        append(PairStats, TokenStats, StatsRaw),
        sort(StatsRaw, Stats).

stat_from_words(Words, Stat) :-
    append(_, [W1, W2 | _], Words),
    stat_pair_alias(W1, W2, Stat),
    !.
stat_from_words(Words, Stat) :-
    member(Word, Words),
    stat_token_alias(Word, Stat),
    !.

% ============================================================
% RESPOSTAS: CONSULTAS BÁSICAS
% (info, tipo, habilidade, status, evolução simples)
% ============================================================

answer_pokemon(Identifier) :-
    pokemon_info(Identifier, Pokemon),
    !,
    print_lookup_hint(Identifier),
    print_pokemon_info(Pokemon).
answer_pokemon(Identifier) :-
    mega_base_identifier(Identifier, BaseIdentifier),
    pokemon_info(BaseIdentifier, Pokemon),
    !,
    display_pokemon_name(BaseIdentifier, BaseLabel),
    format('Bot: Ainda não tenho os dados da forma Mega; mostrando dados do ~w base.~n', [BaseLabel]),
    print_pokemon_info(Pokemon).
answer_pokemon(Identifier) :-
    writeln('Bot: Não consegui encontrar esse Pokémon.'),
    print_suggestion_for_identifier(info, Identifier).

print_lookup_hint(Identifier) :-
    number(Identifier),
    !,
    format('Bot: Consulta por numero da Pokedex (#~w).~n', [Identifier]).
print_lookup_hint(_) :-
    true.

answer_type_query(TypeFilters) :-
    type_pokemon_list(TypeFilters, Names),
    Names \= [],
    !,
    remember_candidate_list(Names),
    length(Names, Count),
    type_filters_text(TypeFilters, FiltersText),
    sample_names_text(Names, 8, SampleText),
    format('Bot: Encontrei ~w Pokémon do tipo ~w.~n', [Count, FiltersText]),
    format('  Exemplos: ~w~n', [SampleText]).
answer_type_query(TypeFilters) :-
    type_filters_text(TypeFilters, FiltersText),
    format('Bot: Não encontrei Pokémon para o filtro de tipo ~w.~n', [FiltersText]).

answer_type_query_with_clarification(TypeFilters) :-
    retractall(pending_type_preferences(_)),
    assertz(pending_type_preferences(TypeFilters)),
    type_filters_text(TypeFilters, FiltersText),
    format('Bot: Para o tipo ~w, quer aplicar filtros antes?~n', [FiltersText]),
    writeln('Bot: Você pode responder: "padrão", "sem lendários", "sem mega" ou combinar filtros.').

answer_type_query_with_context_filters(TypeFilters, ContextFilters) :-
    type_pokemon_list(TypeFilters, Names),
    apply_context_filters(Names, ContextFilters, FilteredNames),
    FilteredNames \= [],
    !,
    remember_candidate_list(FilteredNames),
    length(FilteredNames, Count),
    type_filters_text(TypeFilters, FiltersText),
    sample_names_text(FilteredNames, 8, SampleText),
    format('Bot: Com os filtros aplicados, encontrei ~w Pokémon do tipo ~w.~n', [Count, FiltersText]),
    format('  Exemplos: ~w~n', [SampleText]).
answer_type_query_with_context_filters(TypeFilters, _) :-
    type_filters_text(TypeFilters, FiltersText),
    format('Bot: Com esses filtros, não encontrei resultados para o tipo ~w.~n', [FiltersText]).

answer_ability_query(Ability) :-
    ability_pokemon_list(Ability, Names),
    Names \= [],
    !,
    remember_candidate_list(Names),
    length(Names, Count),
    display_label(Ability, AbilityLabel),
    ability_effect_text(Ability, AbilityEffect),
    sample_names_text(Names, 8, SampleText),
    format('Bot: Habilidade ~w �?" efeito: ~w~n', [AbilityLabel, AbilityEffect]),
    format('Bot: Encontrei ~w Pokémon que podem possuir a habilidade ~w.~n', [Count, AbilityLabel]),
    format('  Exemplos: ~w~n', [SampleText]).
answer_ability_query(Ability) :-
    display_label(Ability, AbilityLabel),
    format('Bot: Não encontrei Pokémon com a habilidade ~w.~n', [AbilityLabel]).


answer_pokemon_ability_details_query(NameIdentifier) :-
    pokemon_info(NameIdentifier, pokemon(_ID, NameAtom, _, _, _, Abilities, _)),
    !,
    display_pokemon_name(NameAtom, NameLabel),
    ( Abilities = [] ->
        format('Bot: Não encontrei habilidades cadastradas para ~w.~n', [NameLabel])
    ; writeln('Bot: Detalhes das habilidades:'),
      format('  Pokémon: ~w~n', [NameLabel]),
      print_ability_effect_lines(Abilities)
    ).
answer_pokemon_ability_details_query(NameIdentifier) :-
    display_pokemon_name(NameIdentifier, NameLabel),
    format('Bot: Não consegui identificar o Pokémon para consultar habilidades (~w).~n', [NameLabel]).

print_ability_effect_lines([]).
print_ability_effect_lines([Ability | Rest]) :-
    display_label(Ability, AbilityLabel),
    ability_effect_text(Ability, AbilityEffect),
    format('  - ~w: ~w~n', [AbilityLabel, AbilityEffect]),
    print_ability_effect_lines(Rest).

answer_global_move_list_query :-
    move_catalog(Moves),
    Moves \= [],
    !,
    length(Moves, Count),
    sample_move_names_text(Moves, 30, SampleText),
    format('Bot: Tenho ~w moves catalogados na base atual.~n', [Count]),
    format('  Amostra: ~w~n', [SampleText]),
    writeln('Bot: Se quiser, peça também o movelist de um Pokémon (ex.: "moves do charizard").').
answer_global_move_list_query :-
    writeln('Bot: Ainda não encontrei moves catalogados na base local.').

answer_pokemon_movelist_query(NameIdentifier) :-
    pokemon_info(NameIdentifier, pokemon(ID, NameAtom, _, _, _, _, _)),
    !,
    pokemon_move_list_for_id(ID, NameAtom, Moves, Source),
    display_pokemon_name(NameAtom, NameLabel),
    length(Moves, Count),
    sample_move_names_text(Moves, 20, SampleText),
    format('Bot: Movelist de ~w (~w moves): ~w.~n', [NameLabel, Count, SampleText]),
    ( Source = exact ->
        true
    ; Source = base(BaseName) ->
        display_pokemon_name(BaseName, BaseLabel),
        format('Bot: Observação: usei a movelist da forma base (~w).~n', [BaseLabel])
    ; Source = fallback ->
        writeln('Bot: Observação: ainda não tenho movelist específica desse Pokémon; mostrei um fallback mínimo.')
    ).
answer_pokemon_movelist_query(NameIdentifier) :-
    display_pokemon_name(NameIdentifier, NameLabel),
    format('Bot: Não consegui identificar o Pokémon para mostrar movelist (~w).~n', [NameLabel]).

answer_specific_item_query(ItemIdentifier) :-
    item_info(ItemIdentifier, item(Item, Category, Cost, FlingPower, FlingEffect, Description)),
    !,
    display_label(Item, ItemLabel),
    display_label(Category, CategoryLabel),
    item_effect_text(Description, EffectText),
    format('Bot: Item ~w (~w).~n', [ItemLabel, CategoryLabel]),
    format('  - Efeito: ~w~n', [EffectText]),
    format('  - Custo base: ~w~n', [Cost]),
    format('  - Fling power: ~w | Fling efeito: ~w~n', [FlingPower, FlingEffect]).
answer_specific_item_query(ItemIdentifier) :-
    display_label(ItemIdentifier, ItemLabel),
    format('Bot: Não encontrei detalhes para o item ~w.~n', [ItemLabel]).

answer_specific_move_query(MoveIdentifier) :-
    move_data(MoveIdentifier, Type, Category, BasePower, Accuracy, PP, Tags, EffectChance, Ailment, EffectCategory, Description),
    !,
    display_label(MoveIdentifier, MoveLabel),
    display_type_label(Type, TypeLabel),
    display_label(Category, CategoryLabel),
    move_power_text(Category, BasePower, PowerText),
    move_accuracy_text(Accuracy, AccuracyText),
    move_priority_from_tags(Tags, Priority),
    move_effect_text(Description, MoveEffectText),
    format('Bot: Move ~w.~n', [MoveLabel]),
    format('  - Tipo: ~w | Categoria: ~w~n', [TypeLabel, CategoryLabel]),
    format('  - Poder: ~w | Precisão: ~w | PP: ~w | Prioridade: ~w~n', [PowerText, AccuracyText, PP, Priority]),
    format('  - Efeito: ~w~n', [MoveEffectText]),
    format('  - Metadados: chance_efeito=~w | ailment=~w | classe_efeito=~w~n', [EffectChance, Ailment, EffectCategory]).
answer_specific_move_query(MoveIdentifier) :-
    display_label(MoveIdentifier, MoveLabel),
    format('Bot: Não encontrei detalhes para o move ~w.~n', [MoveLabel]).

item_info(Identifier, item(Item, Category, Cost, FlingPower, FlingEffect, Description)) :-
    downcase_atom(Identifier, Item),
    current_predicate(item_entry/6),
    item_entry(Item, Category, Cost, FlingPower, FlingEffect, Description).

item_effect_text(RawDescription, EffectText) :-
    input_to_string(RawDescription, DescriptionText),
    normalize_space(string(Normalized), DescriptionText),
    ( Normalized == "" ->
        EffectText = 'Sem descrição disponível.'
    ; EffectText = Normalized
    ).

move_power_text(status, _BasePower, 'status') :- !.
move_power_text(_Category, BasePower, '-') :-
    BasePower =< 0,
    !.
move_power_text(_Category, BasePower, BasePower).

move_accuracy_text(0, 'sempre acerta') :- !.
move_accuracy_text(Accuracy, Text) :-
    format(atom(Text), '~w%', [Accuracy]).

move_effect_text(DescriptionAtom, EffectText) :-
    input_to_string(DescriptionAtom, DescriptionText),
    normalize_space(string(Normalized), DescriptionText),
    ( Normalized == "" ->
        EffectText = 'Sem descrição disponível.'
    ; EffectText = Normalized
    ).

move_priority_from_tags(Tags, Priority) :-
    member(Tag, Tags),
    atom(Tag),
    atom_string(Tag, TagText),
    string_concat("priority_", NumberText, TagText),
    string_number(NumberText, Priority),
    !.
move_priority_from_tags(_Tags, 0).

answer_status_query(Stat) :-
    top_pokemon_by_stat(Stat, 8, TopPairs),
    TopPairs \= [],
    !,
    display_stat_label(Stat, StatLabel),
    stat_command_text(Stat, StatCommandText),
    top_pairs_names_text(TopPairs, TopText),
    format('Bot: Estes são alguns Pokémon com destaque em ~w: ~w.~n', [StatLabel, TopText]),
    format('Bot: Deseja saber a lista completa de Pokémon com ~w como maior ou segundo maior status?~n', [StatLabel]),
    format('  Se quiser, digite: status ~w completo~n', [StatCommandText]).
answer_status_query(Stat) :-
    display_stat_label(Stat, StatLabel),
    format('Bot: Não consegui montar ranking para o status ~w.~n', [StatLabel]).

answer_status_full_query(Stat) :-
    status_top2_pokemon_list(Stat, Names),
    Names \= [],
    !,
    remember_candidate_list(Names),
    display_stat_label(Stat, StatLabel),
    length(Names, Count),
    sample_names_text(Names, 20, SampleText),
    format('Bot: Encontrei ~w Pokémon com ~w entre os 2 maiores status.~n', [Count, StatLabel]),
    format('  Amostra: ~w~n', [SampleText]).
answer_status_full_query(Stat) :-
    display_stat_label(Stat, StatLabel),
    format('Bot: Não encontrei Pokémon com ~w no perfil principal.~n', [StatLabel]).


% ============================================================
% RESPOSTAS: COUNTER / MATCHUP / GERA�?�fO
% ============================================================

level_constraint_reference_level(at_most(MaxLevel), MaxLevel) :- !.
level_constraint_reference_level(at_least(MinLevel), MinLevel) :- !.
level_constraint_reference_level(between(_MinLevel, MaxLevel), MaxLevel) :- !.
level_constraint_reference_level(LevelValue, LevelValue) :-
    integer(LevelValue),
    !.
level_constraint_reference_level(none, 50).

pokemon_reachable_by_level(PokemonID, at_most(MaxLevel)) :-
    !,
    level_gate_species_id(PokemonID, SpeciesID),
    species_min_obtain_level(SpeciesID, MinLevel),
    MinLevel =< MaxLevel.
pokemon_reachable_by_level(PokemonID, at_least(MinLevel)) :-
    !,
    level_gate_species_id(PokemonID, SpeciesID),
    species_min_obtain_level(SpeciesID, SpeciesMinLevel),
    SpeciesMinLevel >= MinLevel.
pokemon_reachable_by_level(PokemonID, between(MinLevel, MaxLevel)) :-
    !,
    level_gate_species_id(PokemonID, SpeciesID),
    species_min_obtain_level(SpeciesID, SpeciesMinLevel),
    SpeciesMinLevel >= MinLevel,
    SpeciesMinLevel =< MaxLevel.
pokemon_reachable_by_level(PokemonID, MaxLevel) :-
    integer(MaxLevel),
    !,
    level_gate_species_id(PokemonID, SpeciesID),
    species_min_obtain_level(SpeciesID, MinLevel),
    MinLevel =< MaxLevel.
pokemon_reachable_by_level(_PokemonID, none) :-
    !.
pokemon_reachable_by_level(PokemonID, MaxLevel) :-
    level_gate_species_id(PokemonID, SpeciesID),
    species_min_obtain_level(SpeciesID, MinLevel),
    MinLevel =< MaxLevel.

level_gate_species_id(PokemonID, SpeciesID) :-
    pokemon_form_base(PokemonID, BaseSpeciesID),
    !,
    SpeciesID = BaseSpeciesID.
level_gate_species_id(PokemonID, SpeciesID) :-
    pokemon_mega_base(PokemonID, BaseSpeciesID),
    !,
    SpeciesID = BaseSpeciesID.
level_gate_species_id(PokemonID, PokemonID).

species_min_obtain_level(SpeciesID, MinLevel) :-
    species_min_obtain_level(SpeciesID, [], MinLevel).

species_min_obtain_level(SpeciesID, _Visited, 1) :-
    \+ pokemon_evolution(_FromID, SpeciesID, _Trigger, _MinLevel, _Condition),
    !.
species_min_obtain_level(SpeciesID, Visited, MinLevel) :-
    findall(CandidateLevel,
        ( pokemon_evolution(FromID, SpeciesID, Trigger, RawMinLevel, _Condition),
          \+ member(FromID, Visited),
          species_min_obtain_level(FromID, [SpeciesID | Visited], PreviousMinLevel),
          evolution_min_required_level(Trigger, RawMinLevel, RequiredLevel),
          CandidateLevel is max(PreviousMinLevel, RequiredLevel)
        ),
        CandidateLevels),
    CandidateLevels \= [],
    min_list(CandidateLevels, MinLevel),
    !.
species_min_obtain_level(_SpeciesID, _Visited, 1).

evolution_min_required_level(level_up, RawMinLevel, RequiredLevel) :-
    number(RawMinLevel),
    !,
    RequiredLevel = RawMinLevel.
evolution_min_required_level(_Trigger, _RawMinLevel, 1).

% ============================================================
% RESPOSTAS: NOVOS INTENTS (RANKING, EVOLU�?�fO, COBERTURA)
% ============================================================

generation_scope_text(all, 'todas as gerações').
generation_scope_text(Generation, Text) :-
    format(atom(Text), 'geração ~w', [Generation]).

generation_filter_matches(all, _ID).
generation_filter_matches(Generation, ID) :-
    generation_matches_id(Generation, ID).

counter_pair_passes_filters(Filters, _Score-Name-_AttackMult-_DefenseMult) :-
    name_passes_filters(Filters, Name).

% ============================================================
% RESPOSTAS: MATCHUP POR NÍVEL E FILTROS CONTEXTUAIS
% ============================================================

answer_count_without_type_query(TypeFilters) :-
    findall(Name,
        ( pokemon_in_scope(_, Name, _, _, Types, _, _),
          \+ pokemon_has_any_type(TypeFilters, Types)
        ),
        NamesRaw),
    sort(NamesRaw, Names),
    length(Names, Count),
    type_filters_text(TypeFilters, FiltersText),
    format('Bot: Existem ~w Pokémon sem o tipo ~w.~n', [Count, FiltersText]),
    ( Count > 0 ->
        sample_names_text(Names, 10, SampleText),
        format('  Exemplos: ~w~n', [SampleText])
    ; true
    ).

pokemon_has_any_type([], _) :- fail.
pokemon_has_any_type([Type | _], Types) :- member(Type, Types), !.
pokemon_has_any_type([_ | Rest], Types) :- pokemon_has_any_type(Rest, Types).

apply_context_filters(Names, Filters, FilteredNames) :-
    include(name_passes_filters(Filters), Names, NamesFiltered),
    sort(NamesFiltered, FilteredNames).

name_passes_optional_filters([], _Name) :- !.
name_passes_optional_filters(Filters, Name) :-
    name_passes_filters(Filters, Name).

name_passes_filters(Filters, Name) :-
    \+ (member(no_mega, Filters), is_mega_name(Name)),
    \+ (member(no_legendary, Filters), is_legendary_or_mythical_name(Name)),
    ( \+ member(only_mega, Filters) ; is_mega_name(Name) ),
    ( \+ member(only_legendary, Filters) ; is_legendary_or_mythical_name(Name) ),
    ( \+ member(only_unevolved, Filters) ; is_unevolved_name(Name) ),
    ( \+ member(only_evolved, Filters) ; is_evolved_name(Name) ).

is_unevolved_name(Name) :-
    pokemon_info(Name, pokemon(ID, _Name, _Height, _Weight, _Types, _Abilities, _Stats)),
    level_gate_species_id(ID, SpeciesID),
    \+ pokemon_evolution(_FromID, SpeciesID, _Trigger, _MinLevel, _Condition).

is_evolved_name(Name) :-
    pokemon_info(Name, pokemon(ID, _Name, _Height, _Weight, _Types, _Abilities, _Stats)),
    level_gate_species_id(ID, SpeciesID),
    pokemon_evolution(_FromID, SpeciesID, _Trigger, _MinLevel, _Condition).

is_mega_name(Name) :-
    atom_string(Name, NameText),
    sub_string(NameText, _, _, _, '_mega').

is_legendary_or_mythical_name(Name) :-
    pokemon_in_scope(ID, Name, _, _, _, _, _),
    legendary_or_mythical_species_id_for_pokemon(ID).

legendary_or_mythical_species_id_for_pokemon(ID) :-
    pokemon_form_base(ID, BaseSpeciesID),
    !,
    legendary_or_mythical_species_id(BaseSpeciesID).
legendary_or_mythical_species_id_for_pokemon(ID) :-
    pokemon_mega_base(ID, BaseSpeciesID),
    !,
    legendary_or_mythical_species_id(BaseSpeciesID).
legendary_or_mythical_species_id_for_pokemon(ID) :-
    legendary_or_mythical_species_id(ID).

legendary_or_mythical_species_id(144).
legendary_or_mythical_species_id(145).
legendary_or_mythical_species_id(146).
legendary_or_mythical_species_id(150).
legendary_or_mythical_species_id(151).
legendary_or_mythical_species_id(243).
legendary_or_mythical_species_id(244).
legendary_or_mythical_species_id(245).
legendary_or_mythical_species_id(249).
legendary_or_mythical_species_id(250).
legendary_or_mythical_species_id(251).
legendary_or_mythical_species_id(377).
legendary_or_mythical_species_id(378).
legendary_or_mythical_species_id(379).
legendary_or_mythical_species_id(380).
legendary_or_mythical_species_id(381).
legendary_or_mythical_species_id(382).
legendary_or_mythical_species_id(383).
legendary_or_mythical_species_id(384).
legendary_or_mythical_species_id(385).
legendary_or_mythical_species_id(386).
legendary_or_mythical_species_id(480).
legendary_or_mythical_species_id(481).
legendary_or_mythical_species_id(482).
legendary_or_mythical_species_id(483).
legendary_or_mythical_species_id(484).
legendary_or_mythical_species_id(485).
legendary_or_mythical_species_id(486).
legendary_or_mythical_species_id(487).
legendary_or_mythical_species_id(488).
legendary_or_mythical_species_id(489).
legendary_or_mythical_species_id(490).
legendary_or_mythical_species_id(491).
legendary_or_mythical_species_id(492).
legendary_or_mythical_species_id(493).
legendary_or_mythical_species_id(638).
legendary_or_mythical_species_id(639).
legendary_or_mythical_species_id(640).
legendary_or_mythical_species_id(641).
legendary_or_mythical_species_id(642).
legendary_or_mythical_species_id(643).
legendary_or_mythical_species_id(644).
legendary_or_mythical_species_id(645).
legendary_or_mythical_species_id(646).
legendary_or_mythical_species_id(647).
legendary_or_mythical_species_id(648).
legendary_or_mythical_species_id(649).
legendary_or_mythical_species_id(716).
legendary_or_mythical_species_id(717).
legendary_or_mythical_species_id(718).
legendary_or_mythical_species_id(719).
legendary_or_mythical_species_id(720).
legendary_or_mythical_species_id(721).
legendary_or_mythical_species_id(785).
legendary_or_mythical_species_id(786).
legendary_or_mythical_species_id(787).
legendary_or_mythical_species_id(788).
legendary_or_mythical_species_id(789).
legendary_or_mythical_species_id(790).
legendary_or_mythical_species_id(791).
legendary_or_mythical_species_id(792).
legendary_or_mythical_species_id(793).
legendary_or_mythical_species_id(794).
legendary_or_mythical_species_id(795).
legendary_or_mythical_species_id(796).
legendary_or_mythical_species_id(797).
legendary_or_mythical_species_id(798).
legendary_or_mythical_species_id(799).
legendary_or_mythical_species_id(800).
legendary_or_mythical_species_id(801).
legendary_or_mythical_species_id(802).
legendary_or_mythical_species_id(807).
legendary_or_mythical_species_id(808).
legendary_or_mythical_species_id(809).
legendary_or_mythical_species_id(888).
legendary_or_mythical_species_id(889).
legendary_or_mythical_species_id(890).
legendary_or_mythical_species_id(891).
legendary_or_mythical_species_id(892).
legendary_or_mythical_species_id(893).
legendary_or_mythical_species_id(894).
legendary_or_mythical_species_id(895).
legendary_or_mythical_species_id(896).
legendary_or_mythical_species_id(897).
legendary_or_mythical_species_id(898).
legendary_or_mythical_species_id(899).
legendary_or_mythical_species_id(900).
legendary_or_mythical_species_id(901).
legendary_or_mythical_species_id(905).
legendary_or_mythical_species_id(1001).
legendary_or_mythical_species_id(1002).
legendary_or_mythical_species_id(1003).
legendary_or_mythical_species_id(1004).
legendary_or_mythical_species_id(1007).
legendary_or_mythical_species_id(1008).
legendary_or_mythical_species_id(1009).
legendary_or_mythical_species_id(1010).
legendary_or_mythical_species_id(1014).
legendary_or_mythical_species_id(1015).
legendary_or_mythical_species_id(1016).
legendary_or_mythical_species_id(1017).
legendary_or_mythical_species_id(1020).
legendary_or_mythical_species_id(1021).
legendary_or_mythical_species_id(1022).
legendary_or_mythical_species_id(1023).
legendary_or_mythical_species_id(1024).
legendary_or_mythical_species_id(1025).

% ============================================================
% RESPOSTAS CONTEXTUAIS E UTILITÁRIOS DE LISTA
% ============================================================

answer_contextual_stat_query(Stats) :-
    last_list_candidates(Names),
    Names \= [],
    !,
    answer_contextual_stat_for_list(Stats, Names).
answer_contextual_stat_query(_) :-
    writeln('Bot: Ainda não tenho uma lista recente para comparar. Peça primeiro um grupo de Pokémon por tipo, habilidade ou estratégia.').

answer_contextual_stat_for_list(Stats, Names) :-
    findall(Stat-BestName-BestValue,
        ( member(Stat, Stats),
          best_candidate_for_stat(Names, Stat, BestName, BestValue)
        ),
        Results),
    Results \= [],
    !,
    writeln('Bot: Comparando os Pokémon da última lista:'),
    print_contextual_stat_results(Results).
answer_contextual_stat_for_list(_, _) :-
    writeln('Bot: Não consegui comparar esse status dentro da última lista.').

best_candidate_for_stat(Names, Stat, BestName, BestValue) :-
    findall(Value-Name,
        ( member(Name, Names),
          pokemon_in_scope(_, Name, _, _, _, _, PokeStats),
          member(Stat-Value, PokeStats)
        ),
        Pairs),
    Pairs \= [],
    keysort(Pairs, Sorted),
    reverse(Sorted, [BestValue-BestName | _]).

print_contextual_stat_results([]).
print_contextual_stat_results([Stat-Name-Value | Rest]) :-
    display_stat_label(Stat, StatLabel),
    display_pokemon_name(Name, NameLabel),
    format('  - Em ~w, o destaque é ~w (~w).~n', [StatLabel, NameLabel, Value]),
    print_contextual_stat_results(Rest).

remember_candidate_list(Names) :-
    retractall(last_list_candidates(_)),
    assertz(last_list_candidates(Names)).

pokemon_info(Identifier, Pokemon) :-
    number(Identifier),
    !,
    ( pokemon_in_scope(Identifier, Name, Height, Weight, Types, Abilities, Stats)
    ; pokemon(Identifier, Name, Height, Weight, Types, Abilities, Stats)
    ),
    Pokemon = pokemon(Identifier, Name, Height, Weight, Types, Abilities, Stats).
pokemon_info(Identifier, Pokemon) :-
    downcase_atom(Identifier, Name),
    ( pokemon_in_scope(ID, Name, Height, Weight, Types, Abilities, Stats)
    ; pokemon(ID, Name, Height, Weight, Types, Abilities, Stats)
    ),
    Pokemon = pokemon(ID, Name, Height, Weight, Types, Abilities, Stats).

type_pokemon_count(Type, Count) :-
    current_generation_key(GenerationKey),
    cache_type_count(GenerationKey, Type, Count),
    !.
type_pokemon_count(Type, Count) :-
    current_generation_key(GenerationKey),
    findall(Name,
        ( pokemon_in_scope(_, Name, _, _, Types, _, _),
          member(Type, Types)
        ),
        NamesRaw),
    sort(NamesRaw, UniqueNames),
    length(UniqueNames, Count),
    assertz(cache_type_count(GenerationKey, Type, Count)).

type_pokemon_list(TypeFilters, Names) :-
    current_generation_key(GenerationKey),
    cache_type_list(GenerationKey, TypeFilters, Names),
    !.
type_pokemon_list(TypeFilters, Names) :-
    current_generation_key(GenerationKey),
    findall(Name,
        ( pokemon_in_scope(_, Name, _, _, Types, _, _),
          pokemon_matches_type_filters(TypeFilters, Types)
        ),
        NamesRaw),
    sort(NamesRaw, Names),
    assertz(cache_type_list(GenerationKey, TypeFilters, Names)).

pokemon_matches_type_filters([], _).
pokemon_matches_type_filters([Type | Rest], PokemonTypes) :-
    member(Type, PokemonTypes),
    pokemon_matches_type_filters(Rest, PokemonTypes).

ability_pokemon_list(Ability, Names) :-
    current_generation_key(GenerationKey),
    cache_ability_list(GenerationKey, Ability, Names),
    !.
ability_pokemon_list(Ability, Names) :-
    current_generation_key(GenerationKey),
    findall(Name,
        ( pokemon_in_scope(_, Name, _, _, _, Abilities, _),
          member(Ability, Abilities)
        ),
        NamesRaw),
    sort(NamesRaw, Names),
    assertz(cache_ability_list(GenerationKey, Ability, Names)).

move_catalog(Moves) :-
    cache_move_catalog(Moves),
    !.
move_catalog(Moves) :-
    findall(Move, move_catalog_entry(Move), MovesRaw),
    sort(MovesRaw, Moves),
    assertz(cache_move_catalog(Moves)).

move_catalog_entry(Move) :-
    current_predicate(move_entry/11),
    move_entry(Move, _Type, _Category, _BasePower, _Accuracy, _PP, _Tags, _EffectChance, _Ailment, _EffectCategory, _Description).
move_catalog_entry(Move) :-
    current_predicate(move_entry/8),
    move_entry(Move, _Type, _Category, _BasePower, _Accuracy, _PP, _Tags, _Description).
move_catalog_entry(Move) :-
    pokemon_move_list(_PokemonName, Moves),
    member(Move, Moves).

move_data(Move, Type, Category, BasePower, Accuracy, PP, Tags, EffectChance, Ailment, EffectCategory, Description) :-
    current_predicate(move_entry/11),
    move_entry(Move, Type, Category, BasePower, Accuracy, PP, Tags, EffectChance, Ailment, EffectCategory, Description),
    !.
move_data(Move, Type, Category, BasePower, Accuracy, PP, Tags, null, none, unknown, Description) :-
    current_predicate(move_entry/8),
    move_entry(Move, Type, Category, BasePower, Accuracy, PP, Tags, Description).

pokemon_move_list_for_id(ID, Name, Moves, Source) :-
    nonvar(ID),
    ( cache_pokemon_move_list(ID, Moves, Source) ->
        true
    ; pokemon_move_list_for_id_uncached(ID, Name, Moves, Source),
      assertz(cache_pokemon_move_list(ID, Moves, Source))
    ),
    !.
pokemon_move_list_for_id(ID, Name, Moves, Source) :-
    pokemon_move_list_for_id_uncached(ID, Name, Moves, Source).

pokemon_move_list_for_id_uncached(ID, Name, Moves, exact) :-
    \+ is_special_form_id(ID),
    pokemon_move_list(Name, Moves),
    !.
pokemon_move_list_for_id_uncached(ID, _Name, Moves, base(BaseName)) :-
    special_form_base_name(ID, BaseName),
    pokemon_move_list(BaseName, Moves),
    !.
pokemon_move_list_for_id_uncached(_ID, _Name, Moves, fallback) :-
    pokemon_move_list(unknown, Moves).

special_form_base_name(ID, BaseName) :-
    pokemon_form_base(ID, BaseID),
    pokemon_info(BaseID, pokemon(_, BaseName, _, _, _, _, _)),
    !.
special_form_base_name(ID, BaseName) :-
    pokemon_mega_base(ID, BaseID),
    pokemon_info(BaseID, pokemon(_, BaseName, _, _, _, _, _)).

sample_move_names_text(Moves, Limit, Text) :-
    take_first_n(Moves, Limit, Sample),
    maplist(display_label, Sample, Labels),
    atomic_list_concat(Labels, ', ', Text).

top_pokemon_by_stat(Stat, Limit, TopPairs) :-
    findall(Value-Name,
        ( pokemon_in_scope(_, Name, _, _, _, _, Stats),
          member(Stat-Value, Stats)
        ),
        Pairs),
    keysort(Pairs, AscPairs),
    reverse(AscPairs, DescPairs),
    take_first_n(DescPairs, Limit, TopPairs).

status_top2_pokemon_list(Stat, Names) :-
    findall(Name,
        ( pokemon_in_scope(_, Name, _, _, _, _, Stats),
          stat_in_top_two(Stat, Stats)
        ),
        NamesRaw),
    sort(NamesRaw, Names).

stat_in_top_two(Stat, Stats) :-
    keysort_stats_desc(Stats, Sorted),
    take_first_n(Sorted, 2, Top2),
    member(Stat-_, Top2).

keysort_stats_desc(Stats, SortedDesc) :-
    findall(Value-Stat,
        member(Stat-Value, Stats),
        StatValuePairs),
    keysort(StatValuePairs, Asc),
    reverse(Asc, Desc),
    findall(Stat-Value,
        member(Value-Stat, Desc),
        SortedDesc).

% ============================================================
% UTILITÁRIOS GERAIS (DADOS, TEXTO E EXIBIÇÃO)
% ============================================================

take_first_n(List, N, Taken) :-
    length(Taken, N),
    append(Taken, _, List),
    !.
take_first_n(List, _, List).

bullet_block_text(Indent, Items, Text) :-
    maplist(prefixed_line(Indent), Items, Lines),
    atomic_list_concat(Lines, '\n', Text).

prefixed_line(Indent, Item, Line) :-
    format(atom(Line), '~w~w', [Indent, Item]).

sample_names_text(Names, Limit, Text) :-
    take_first_n(Names, Limit, Sample),
    maplist(display_pokemon_name, Sample, Labels),
    bullet_block_text('    - ', Labels, Block),
    format(atom(Text), '\n~w', [Block]).

top_pairs_names_text(Pairs, Text) :-
    maplist(pair_to_name_text, Pairs, Items),
    atomic_list_concat(Items, ', ', Text).

pair_to_name_text(_Value-Name, Text) :-
    display_pokemon_name(Name, NameLabel),
    format(atom(Text), '~w', [NameLabel]).

display_pokemon_name(NameAtom, Label) :-
    atom_string(NameAtom, Text),
    split_string(Text, "_-", "", Parts),
    maplist(capitalize_word, Parts, CapParts),
    atomic_list_concat(CapParts, ' ', Label).

capitalize_word("", "").
capitalize_word(Word, Capitalized) :-
    string_chars(Word, [First | Rest]),
    upcase_atom(First, FirstUp),
    string_chars(Capitalized, [FirstUp | Rest]).

type_filters_text(TypeFilters, Text) :-
    maplist(display_type_label, TypeFilters, Labels),
    atomic_list_concat(Labels, ' + ', Text).

normalize_type(InputType, ApiType) :-
    downcase_atom(InputType, TypeAtom),
    ( type_alias(TypeAtom, ApiType) -> true ; ApiType = TypeAtom ).

pokemon_in_scope(ID, Name, Height, Weight, Types, Abilities, Stats) :-
    pokemon(ID, Name, Height, Weight, Types, Abilities, Stats),
    active_generation_matches(ID).

active_generation_matches(_) :-
    active_generation(all),
    !.
active_generation_matches(ID) :-
    pokemon_form_base(ID, BaseID),
    !,
    active_generation_matches(BaseID).
active_generation_matches(ID) :-
    pokemon_mega_base(ID, BaseID),
    !,
    active_generation_matches(BaseID).
active_generation_matches(ID) :-
    active_generation(Generation),
    generation_range(Generation, MinID, MaxID),
    ID >= MinID,
    ID =< MaxID.

generation_range(1, 1, 151).
generation_range(2, 152, 251).
generation_range(3, 252, 386).
generation_range(4, 387, 493).
generation_range(5, 494, 649).
generation_range(6, 650, 721).
generation_range(7, 722, 809).
generation_range(8, 810, 905).
generation_range(9, 906, 1025).

print_pokemon_info(pokemon(ID, Name, Height, Weight, Types, Abilities, Stats)) :-
    maplist(display_type_label, Types, TypeLabels),
    maplist(display_label, Abilities, AbilityLabels),
    atomic_list_concat(TypeLabels, ', ', TypesText),
    atomic_list_concat(AbilityLabels, ', ', AbilitiesText),
    HeightM is Height / 10,
    WeightKg is Weight / 10,
    type_effectiveness_summary(Types, Weaknesses, Resistances, Immunities),
    effect_list_text(Weaknesses, WeakText),
    effect_list_text(Resistances, ResistText),
    type_list_text(Immunities, ImmunityText),
    build_brief_description(Types, Abilities, Stats, Description),
    pokemon_lore_text(ID, LoreRaw),
    beautify_lore_text(LoreRaw, LoreText),
    display_pokemon_name(Name, DisplayName),
    writeln('Bot: Pokémon encontrado!'),
    format('  Nome: ~w~n', [DisplayName]),
    format('  Número Pokédex: ~w~n', [ID]),
    format('  Altura: ~1f m (~w dm)~n', [HeightM, Height]),
    format('  Peso: ~1f kg (~w hg)~n', [WeightKg, Weight]),
    format('  Tipos: ~w~n', [TypesText]),
    format('  Habilidades: ~w~n', [AbilitiesText]),
    print_pokemon_moveset_info(ID, Name),
    format('  Fraquezas: ~w~n', [WeakText]),
    format('  Resistências: ~w~n', [ResistText]),
    format('  Imunidades: ~w~n', [ImmunityText]),
    format('  Descrição: ~w~n', [Description]),
    format('  Lore: ~w~n', [LoreText]),
    writeln('  Status base:'),
    print_stats(Stats).

print_pokemon_moveset_info(ID, Name) :-
    pokemon_move_list_for_id(ID, Name, Moves, Source),
    Moves \= [],
    !,
    length(Moves, Count),
    ( Count > 25 ->
        sample_move_names_text(Moves, 25, MovesText),
        format('  Moveset (~w moves, amostra): ~w~n', [Count, MovesText])
    ; sample_move_names_text(Moves, Count, MovesText),
      format('  Moveset (~w moves): ~w~n', [Count, MovesText])
    ),
    print_moveset_source_note(Source).
print_pokemon_moveset_info(_, _) :-
    writeln('  Moveset: sem dados de moves na base local.').

print_moveset_source_note(exact) :-
    !.
print_moveset_source_note(base(BaseName)) :-
    display_pokemon_name(BaseName, BaseLabel),
    format('  Observação moveset: movelist obtida da forma base (~w).~n', [BaseLabel]).
print_moveset_source_note(fallback) :-
    writeln('  Observação moveset: usei um fallback mínimo para este Pokémon.').

pokemon_lore_text(ID, LoreText) :-
    pokemon_lore(ID, LoreText),
    !.
pokemon_lore_text(_, 'Sem lore local disponível para este Pokémon.').

beautify_lore_text(Raw, Pretty) :-
    atom_string(Raw, RawText),
    lore_replace(RawText, "pokemon", "Pokémon", T1),
    lore_replace(T1, "regiao", "região", T2),
    lore_replace(T2, "eletrico", "elétrico", T3),
    lore_replace(T3, "psiquico", "psíquico", T4),
    lore_replace(T4, "dragao", "dragão", T5),
    lore_replace(T5, "agua", "água", T6),
    lore_replace(T6, "trovao", "trovão", T7),
    lore_replace(T7, "nao", "não", T8),
    lore_replace(T8, "lanca", "lança", T9),
    normalize_space(atom(Pretty), T9).

lore_replace(Input, Search, Replace, Output) :-
    ( sub_string(Input, Before, _, After, Search) ->
        sub_string(Input, 0, Before, _, Prefix),
        string_length(Search, SearchLength),
        Start is Before + SearchLength,
        sub_string(Input, Start, After, 0, Suffix),
        string_concat(Prefix, Replace, Temp),
        string_concat(Temp, Suffix, Next),
        lore_replace(Next, Search, Replace, Output)
    ; Output = Input
    ).

print_stats([]).
print_stats([Name-Value | Rest]) :-
    display_stat_label(Name, Label),
    format('    - ~w: ~w~n', [Label, Value]),
    print_stats(Rest).

display_label(Value, Label) :-
    atom_string(Value, Text),
    split_string(Text, "_", "", Parts),
    atomic_list_concat(Parts, ' ', Label).

type_effectiveness_summary(DefenseTypes, Weaknesses, Resistances, Immunities) :-
    all_types(AttackTypes),
    findall(Type-M,
        ( member(Type, AttackTypes),
          combined_multiplier(Type, DefenseTypes, M),
          M > 1.0
        ),
        Weaknesses),
    findall(Type-M,
        ( member(Type, AttackTypes),
          combined_multiplier(Type, DefenseTypes, M),
          M > 0.0,
          M < 1.0
        ),
        Resistances),
    findall(Type,
        ( member(Type, AttackTypes),
          combined_multiplier(Type, DefenseTypes, 0.0)
        ),
        Immunities).

combined_multiplier(AttackType, DefenseTypes, Multiplier) :-
    foldl(type_multiplier_fold(AttackType), DefenseTypes, 1.0, Multiplier).

type_multiplier_fold(AttackType, DefenseType, Acc, Result) :-
    type_multiplier(AttackType, DefenseType, ThisMultiplier),
    Result is Acc * ThisMultiplier.

type_multiplier(AttackType, DefenseType, Multiplier) :-
    ( type_chart(AttackType, DefenseType, Multiplier) -> true ; Multiplier = 1.0 ).

effect_list_text([], 'nenhuma').
effect_list_text(Effects, Text) :-
    maplist(effect_label, Effects, Labels),
    atomic_list_concat(Labels, ', ', Text).

effect_label(Type-Multiplier, Label) :-
    display_type_label(Type, TypeLabel),
    multiplier_text(Multiplier, MultText),
    format(atom(Label), '~w (~w)', [TypeLabel, MultText]).

multiplier_text(Multiplier, Text) :-
    RoundedInt is round(Multiplier),
    RoundedTenths is round(Multiplier * 10),
    ( abs(Multiplier - RoundedInt) < 0.00001 ->
        format(atom(Text), 'x~0f', [Multiplier])
    ; abs((Multiplier * 10) - RoundedTenths) < 0.00001 ->
        format(atom(Text), 'x~1f', [Multiplier])
    ; format(atom(Text), 'x~2f', [Multiplier])
    ).

type_list_text([], 'nenhuma').
type_list_text(Types, Text) :-
    maplist(display_type_label, Types, Labels),
    atomic_list_concat(Labels, ', ', Text).

build_brief_description(Types, Abilities, Stats, Description) :-
    maplist(display_type_label, Types, TypeLabels),
    atomic_list_concat(TypeLabels, '/', TypeText),
    dominant_stat(Stats, MainStat, _MainValue),
    stat_profile(MainStat, Profile),
    first_ability_text(Abilities, AbilityText),
    display_stat_label(MainStat, MainStatText),
    format(atom(Description), 'Pokémon do tipo ~w, com ~w. Destaque em ~w. Habilidade de destaque: ~w.', [TypeText, Profile, MainStatText, AbilityText]).

dominant_stat([Stat-Value], Stat, Value).
dominant_stat([Stat-Value | Rest], BestStat, BestValue) :-
    dominant_stat(Rest, CurrentStat, CurrentValue),
    ( Value >= CurrentValue ->
        BestStat = Stat,
        BestValue = Value
    ; BestStat = CurrentStat,
      BestValue = CurrentValue
    ).

first_ability_text([Ability | _], Text) :-
    display_label(Ability, Text).
first_ability_text([], 'desconhecida').

ability_brief_text(Ability, Text) :-
    ( ability_effect(Ability, _Category, _Trigger, _CombatModel, Description) ->
        Text = Description
    ; ability_catalog_text(Ability, CatalogText) ->
        Text = CatalogText
    ; ability_effect(unknown, _DefaultCategory, _DefaultTrigger, _DefaultModel, Description),
      Text = Description
    ).

ability_effect_text(Ability, Text) :-
    ( ability_catalog_effect_text(Ability, CatalogEffectText) ->
        Text = CatalogEffectText
    ; ability_brief_text(Ability, FallbackText) ->
        Text = FallbackText
    ; Text = 'Sem descrição de efeito disponível.'
    ).

ability_catalog_effect_text(Ability, Text) :-
    current_predicate(ability_entry/5),
    ability_entry(Ability, _Generation, _IsMainSeries, ShortEffect, Effect),
    ( text_is_present(Effect) ->
        Text = Effect
    ; text_is_present(ShortEffect) ->
        Text = ShortEffect
    ),
    !.

ability_catalog_text(Ability, Text) :-
    current_predicate(ability_entry/5),
    ability_entry(Ability, _Generation, _IsMainSeries, ShortEffect, Effect),
    ( text_is_present(ShortEffect) ->
        Text = ShortEffect
    ; text_is_present(Effect) ->
        Text = Effect
    ),
    !.

text_is_present(Text) :-
    nonvar(Text),
    atom(Text),
    atom_length(Text, Length),
    Length > 0.

ability_effect_or_default(Ability, Category, Trigger, CombatModel, Description) :-
    ( ability_effect(Ability, Category, Trigger, CombatModel, Description) ->
        true
    ; ability_effect(unknown, Category, Trigger, CombatModel, Description)
    ).

display_type_label(Type, Label) :-
    ( type_pt(Type, Label) -> true ; display_label(Type, Label) ).

display_stat_label(Stat, Label) :-
    ( stat_pt(Stat, Label) -> true ; display_label(Stat, Label) ).

% ============================================================
% SAÍDA PADRÃO DE MENSAGENS (CENTRALIZADA)
% ============================================================

print_follow_up_prompt :-
    say_response(follow_up_prompt).

say_response(Key) :-
    response_text(Key, Text),
    !,
    writeln(Text).
say_response(_) :-
    true.

