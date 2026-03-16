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
:- multifile pokemon/7.
:- multifile pokemon_lore/2.
:- multifile pokemon_mega_base/2.
:- multifile pokemon_form_base/2.
:- multifile pokemon_evolution/5.

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
    expand_file_name('db/language_references.pl', LanguageRefFiles),
    expand_file_name('db/bot_static_lexicon.pl', BotStaticLexiconFiles),
    expand_file_name('db/bot_type_data.pl', BotTypeDataFiles),
    expand_file_name('db/bot_ui_texts.pl', BotUITextFiles),
    expand_file_name('db/bot_response_texts.pl', BotResponseTextFiles),
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
    ).

set_default_generation :-
    retractall(active_generation(_)),
    assertz(active_generation(all)),
    retractall(last_list_candidates(_)),
    retractall(pending_confirmation(_)),
    retractall(pending_level_roster(_, _, _)),
    retractall(pending_counter_preferences(_)),
    retractall(pending_counter_level_preferences(_, _)),
    retractall(pending_type_preferences(_)),
    retractall(pending_list_preferences(_)).

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
    ( parse_generation_command(Text, Generation) ->
        set_active_generation(Generation)
    ; member(Text, ['ajuda', 'help']) ->
        show_help
    ; should_stop(Text) ->
        say_response(goodbye)
    ; answer_query(Text)
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
    writeln('Bot: Agora estou consultando todas as geracoes carregadas.').
set_active_generation(Generation) :-
    retractall(active_generation(_)),
    assertz(active_generation(Generation)),
    format('Bot: Agora estou consultando apenas a geracao ~w.~n', [Generation]).

% ============================================================
% ORQUESTRADOR DE INTENTS
% Ordem importa: regras mais específicas antes das genéricas.
% ============================================================

answer_query(Text) :-
    ( handle_pending_confirmation(Text) ->
        print_follow_up_prompt
    ; handle_pending_level_roster(Text) ->
        print_follow_up_prompt
    ; handle_pending_counter_preferences(Text) ->
        print_follow_up_prompt
    ; handle_pending_type_preferences(Text) ->
        print_follow_up_prompt
    ; handle_pending_list_preferences(Text) ->
        print_follow_up_prompt
    ; parse_info_by_number(Text, Number) ->
        answer_pokemon(Number),
        print_follow_up_prompt
    ; parse_info_by_name(Text, Name) ->
        answer_pokemon(Name),
        print_follow_up_prompt
    ; parse_level1_with_modifiers_query(Text, Level1Intent, Modifiers) ->
        answer_level1_with_modifiers(Level1Intent, Modifiers),
        print_follow_up_prompt
    ; parse_level2_only_composed_query(Text, Mode, Modifiers) ->
        answer_level2_only_composed_query(Mode, Modifiers),
        print_follow_up_prompt
    ; parse_level_matchup_query(Text, TargetName, TargetLevel, OwnLevel) ->
        answer_level_matchup_query(Text, TargetName, TargetLevel, OwnLevel),
        print_follow_up_prompt
    ; parse_counter_composed_query(Text, TargetName, Generation, TypeFilters, ContextFilters, MaxLevel) ->
        answer_counter_composed_query(TargetName, Generation, TypeFilters, ContextFilters, MaxLevel),
        print_follow_up_prompt
    ; parse_counter_level_cap_query(Text, TargetName, MaxLevel) ->
        answer_counter_level_cap_query_with_clarification(TargetName, MaxLevel),
        print_follow_up_prompt
    ; parse_megas_per_generation_summary_query(Text) ->
        answer_megas_per_generation_summary_query,
        print_follow_up_prompt
    ; parse_pokemon_per_generation_summary_query(Text) ->
        answer_pokemon_per_generation_summary_query,
        print_follow_up_prompt
    ; parse_legendary_per_generation_summary_query(Text) ->
        answer_legendary_per_generation_summary_query,
        print_follow_up_prompt
    ; parse_mega_by_generation_query(Text, Generation, TypeFilters, ContextFilters) ->
        answer_mega_by_generation_query(Generation, TypeFilters, ContextFilters),
        print_follow_up_prompt
    ; parse_legendary_by_generation_query(Text, Generation, TypeFilters, ContextFilters) ->
        answer_legendary_by_generation_query(Generation, TypeFilters, ContextFilters),
        print_follow_up_prompt
    ; parse_legendary_by_type_query(Text, TypeFilters, ContextFilters) ->
        answer_legendary_by_type_query(TypeFilters, ContextFilters),
        print_follow_up_prompt
    ; parse_generation_type_query(Text, Generation, TypeFilters, ContextFilters) ->
        answer_generation_type_query(Generation, TypeFilters, ContextFilters),
        print_follow_up_prompt
    ; parse_pokemon_by_generation_query(Text, Generation, TypeFilters, ContextFilters) ->
        answer_pokemon_by_generation_query(Generation, TypeFilters, ContextFilters),
        print_follow_up_prompt
    ; parse_mega_count_query(Text) ->
        answer_mega_count_query,
        print_follow_up_prompt
    ; parse_evolution_count_query(Text, Method) ->
        answer_evolution_count_query(Method),
        print_follow_up_prompt
    ; parse_ranked_metric_query(Text, Metric, Limit, Generation) ->
        answer_ranked_metric_query(Metric, Limit, Generation),
        print_follow_up_prompt
    ; parse_bst_threshold_query(Text, Comparator, Threshold, Generation) ->
        answer_bst_threshold_query(Comparator, Threshold, Generation),
        print_follow_up_prompt
    ; parse_evolution_structure_query(Text, Kind, Generation) ->
        answer_evolution_structure_query(Kind, Generation),
        print_follow_up_prompt
    ; parse_evolution_chain_query(Text, Name) ->
        answer_evolution_chain_query(Name),
        print_follow_up_prompt
    ; parse_type_coverage_query(Text, TargetType) ->
        answer_type_coverage_query(TargetType),
        print_follow_up_prompt
    ; parse_double_weakness_query(Text, AttackType) ->
        answer_double_weakness_query(AttackType),
        print_follow_up_prompt
    ; parse_most_immunities_query(Text, Limit) ->
        answer_most_immunities_query(Limit),
        print_follow_up_prompt
    ; parse_team_coverage_query(Text) ->
        answer_team_coverage_query,
        print_follow_up_prompt
    ; parse_rank_team_vs_target_query(Text, TeamNames, TargetName) ->
        answer_rank_team_vs_target_query(TeamNames, TargetName),
        print_follow_up_prompt
    ; parse_best_team_member_vs_target_query(Text, TeamNames, TargetName) ->
        answer_best_team_member_vs_target_query(TeamNames, TargetName),
        print_follow_up_prompt
    ; parse_best_switch_query(Text, TargetName) ->
        answer_best_switch_query_with_clarification(TargetName),
        print_follow_up_prompt
    ; parse_weak_against_type_query(Text, TypeFilters) ->
        answer_weak_against_type_query_with_clarification(TypeFilters),
        print_follow_up_prompt
    ; parse_immunity_type_query(Text, TypeFilters) ->
        answer_immunity_type_query_with_clarification(TypeFilters),
        print_follow_up_prompt
    ; parse_role_type_query(Text, RoleKey, TypeFilters) ->
        answer_role_type_query(RoleKey, TypeFilters),
        print_follow_up_prompt
    ; parse_counter_with_filters_query(Text, TargetName, ContextFilters) ->
        answer_counter_with_filters_query(TargetName, ContextFilters),
        print_follow_up_prompt
    ; parse_counter_compound_query(Text, TargetName, TypeFilters, ContextFilters) ->
        answer_counter_with_all_filters(TargetName, TypeFilters, ContextFilters),
        print_follow_up_prompt
    ; parse_filtered_counter_query(Text, TypeFilters, TargetName) ->
        answer_filtered_counter_query(TypeFilters, TargetName),
        print_follow_up_prompt
    ; parse_counter_query(Text, TargetName) ->
        answer_counter_query_with_clarification(TargetName),
        print_follow_up_prompt
    ; parse_context_filter_query(Text, ContextFilters) ->
        answer_context_filter_query(ContextFilters),
        print_follow_up_prompt
    ; parse_team_compare_query(Text, NameA, NameB) ->
        answer_team_compare_query(NameA, NameB),
        print_follow_up_prompt
    ; parse_multi_compare_query(Text, Names) ->
        answer_multi_compare_query(Names),
        print_follow_up_prompt
    ; parse_compare_query(Text, NameA, NameB) ->
        answer_compare_query(NameA, NameB),
        print_follow_up_prompt
    ; parse_battle_sim_query(Text, NameA, NameB) ->
        answer_battle_sim_query(NameA, NameB),
        print_follow_up_prompt
    ; parse_ambiguous_two_pokemon_query(Text, NameA, NameB) ->
        answer_ambiguous_two_pokemon_query(NameA, NameB),
        print_follow_up_prompt
    ; parse_count_without_type_query(Text, TypeFilters) ->
        answer_count_without_type_query(TypeFilters),
        print_follow_up_prompt
    ; parse_type_query(Text, TypeFilters) ->
        answer_type_query_with_clarification(TypeFilters),
        print_follow_up_prompt
    ; parse_natural_type_query(Text, TypeFilters) ->
        answer_type_query_with_clarification(TypeFilters),
        print_follow_up_prompt
    ; parse_ability_query(Text, Ability) ->
        answer_ability_query(Ability),
        print_follow_up_prompt
    ; parse_status_full_query(Text, Stat) ->
        answer_status_full_query(Stat),
        print_follow_up_prompt
    ; parse_status_query(Text, Stat) ->
        answer_status_query(Stat),
        print_follow_up_prompt
    ; parse_evolution_level_query(Text, Name) ->
        answer_evolution_level_query(Name),
        print_follow_up_prompt
    ; parse_contextual_stat_query(Text, Stats) ->
        answer_contextual_stat_query(Stats),
        print_follow_up_prompt
    ; parse_natural_pokemon_query(Text, NaturalName) ->
        answer_pokemon(NaturalName),
        print_follow_up_prompt
        ; say_response(not_understood),
      print_follow_up_prompt
    ).

% ============================================================
% NÍVEL 1/NÍVEL 2 (INTENT BASE + MODIFICADORES)
% ============================================================

parse_level1_with_modifiers_query(Text, Intent, modifiers(Generation, MaxLevel, TypeFilters, ContextFilters)) :-
    tokenize_for_match(Text, Tokens),
    parse_level2_modifiers(Tokens, Generation, MaxLevel, TypeFilters, ContextFilters),
    has_any_level2_modifier(Generation, MaxLevel, TypeFilters, ContextFilters),
    parse_level1_primary_intent(Text, Intent).

parse_level1_primary_intent(Text, info(Name)) :-
    ( parse_info_by_name(Text, Name)
    ; parse_natural_pokemon_query(Text, Name)
    ).
parse_level1_primary_intent(Text, counter(TargetName)) :-
    parse_counter_query(Text, TargetName),
    !.
parse_level1_primary_intent(Text, battle(NameA, NameB)) :-
    ( parse_battle_sim_query(Text, NameA, NameB)
    ; parse_ambiguous_two_pokemon_query(Text, NameA, NameB)
    ),
    !.

parse_level2_modifiers(Tokens, Generation, MaxLevel, TypeFilters, ContextFilters) :-
    ( parse_generation_from_tokens(Tokens, Generation) -> true ; Generation = none ),
    ( extract_modifier_max_level(Tokens, MaxLevel) -> true ; MaxLevel = none ),
    ( extract_type_filters(Tokens, TypeFilters) -> true ; TypeFilters = [] ),
    extract_context_filters(Tokens, ContextFilters).

parse_level2_only_composed_query(Text, Mode, modifiers(Generation, MaxLevel, TypeFilters, ContextFilters)) :-
    tokenize_for_match(Text, Tokens),
    parse_level2_modifiers(Tokens, Generation, MaxLevel, TypeFilters, ContextFilters),
    has_any_level2_modifier(Generation, MaxLevel, TypeFilters, ContextFilters),
    \+ parse_level1_primary_intent(Text, _),
    ( quantity_intent_tokens(Tokens) -> Mode = count ; Mode = list ).

extract_modifier_max_level(Tokens, MaxLevel) :-
    ( level_cap_indicator_tokens(Tokens)
    ; has_token_with_prefix(Tokens, "lv")
    ; has_token_with_prefix(Tokens, "nivel")
    ; has_token_with_prefix(Tokens, "nível")
    ),
    extract_levels_from_tokens(Tokens, Levels),
    Levels \= [],
    last(Levels, MaxLevel).

has_any_level2_modifier(Generation, MaxLevel, TypeFilters, ContextFilters) :-
    Generation \= none
    ; MaxLevel \= none
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

answer_level1_with_modifiers(info(Name), _Modifiers) :-
    answer_pokemon(Name).
answer_level1_with_modifiers(counter(TargetIdentifier), modifiers(Generation, MaxLevel, TypeFilters, ContextFilters)) :-
    answer_counter_with_level2_modifiers(TargetIdentifier, Generation, MaxLevel, TypeFilters, ContextFilters).
answer_level1_with_modifiers(battle(NameA, NameB), modifiers(Generation, MaxLevel, TypeFilters, ContextFilters)) :-
    answer_battle_with_level2_modifiers(NameA, NameB, Generation, MaxLevel, TypeFilters, ContextFilters).

answer_level2_only_composed_query(Mode, modifiers(Generation, MaxLevel, TypeFilters, ContextFilters)) :-
    findall(Name,
        ( pokemon(ID, Name, _Height, _Weight, Types, _Abilities, _Stats),
          ( Generation == none ; generation_matches_id(Generation, ID) ),
          pokemon_matches_optional_type_filters(TypeFilters, Types),
          name_passes_filters(ContextFilters, Name),
          ( MaxLevel == none
          ; pokemon_info(Name, pokemon(CandidateID, _, _, _, _, _, _)),
            pokemon_reachable_by_level(CandidateID, MaxLevel)
          )
        ),
        NamesRaw),
    sort(NamesRaw, Names),
    answer_level2_only_candidates(Mode, Generation, MaxLevel, TypeFilters, ContextFilters, Names).

answer_level2_only_candidates(count, Generation, MaxLevel, TypeFilters, _ContextFilters, Names) :-
    !,
    length(Names, Count),
    level2_modifiers_text(Generation, MaxLevel, TypeFilters, ModText),
    format('Bot: Encontrei ~w Pokémon ~w.~n', [Count, ModText]).
answer_level2_only_candidates(_, Generation, MaxLevel, TypeFilters, _ContextFilters, Names) :-
    Names \= [],
    !,
    remember_candidate_list(Names),
    length(Names, Count),
    sample_names_text(Names, 12, SampleText),
    level2_modifiers_text(Generation, MaxLevel, TypeFilters, ModText),
    format('Bot: Encontrei ~w Pokémon ~w.~n', [Count, ModText]),
    format('  Exemplos: ~w~n', [SampleText]).
answer_level2_only_candidates(_, Generation, MaxLevel, TypeFilters, _ContextFilters, _) :-
    level2_modifiers_text(Generation, MaxLevel, TypeFilters, ModText),
    format('Bot: Não encontrei Pokémon ~w.~n', [ModText]).

level2_modifiers_text(Generation, MaxLevel, TypeFilters, Text) :-
    generation_text_optional(Generation, GText),
    level_text_optional(MaxLevel, LText),
    type_text_optional(TypeFilters, TText),
    atomic_list_concat([GText, LText, TText], ' ', RawText),
    normalize_space(atom(Text), RawText).

generation_text_optional(none, '').
generation_text_optional(Generation, Text) :-
    format(atom(Text), 'na geração ~w', [Generation]).

level_text_optional(none, '').
level_text_optional(MaxLevel, Text) :-
    format(atom(Text), 'até nível ~w', [MaxLevel]).

type_text_optional([], '').
type_text_optional(TypeFilters, Text) :-
    type_filters_text(TypeFilters, FiltersText),
    format(atom(Text), 'do tipo ~w', [FiltersText]).

answer_counter_with_level2_modifiers(TargetIdentifier, Generation, MaxLevel, TypeFilters, ContextFilters) :-
    Generation \= none,
    MaxLevel \= none,
    !,
    answer_counter_composed_query(TargetIdentifier, Generation, TypeFilters, ContextFilters, MaxLevel).
answer_counter_with_level2_modifiers(TargetIdentifier, none, MaxLevel, TypeFilters, ContextFilters) :-
    MaxLevel \= none,
    !,
    answer_counter_level_cap_query_with_filters(TargetIdentifier, MaxLevel, TypeFilters, ContextFilters).
answer_counter_with_level2_modifiers(TargetIdentifier, Generation, none, TypeFilters, ContextFilters) :-
    Generation \= none,
    !,
    answer_counter_generation_query(TargetIdentifier, Generation, TypeFilters, ContextFilters).
answer_counter_with_level2_modifiers(TargetIdentifier, none, none, TypeFilters, ContextFilters) :-
    answer_counter_with_all_filters(TargetIdentifier, TypeFilters, ContextFilters).

answer_counter_generation_query(TargetIdentifier, Generation, TypeFilters, ContextFilters) :-
    resolve_counter_target(TargetIdentifier, pokemon(TargetID, TargetName, _, _, TargetTypes, _, TargetStats), UsedFallback),
    findall(Score-Name-AttackMult-DefenseMult,
        ( pokemon(CandidateID, Name, _Height, _Weight, CandidateTypes, _Abilities, CandidateStats),
          generation_matches_id(Generation, CandidateID),
          CandidateID =\= TargetID,
          pokemon_matches_optional_type_filters(TypeFilters, CandidateTypes),
          name_passes_filters(ContextFilters, Name),
          counter_metrics(CandidateTypes, CandidateStats, TargetTypes, TargetStats, AttackMult, DefenseMult, AttackPressure, DefensePressure),
          AttackMult > 1.0,
          Score is (AttackPressure * 2.5) - DefensePressure
        ),
        PairsRaw),
    keysort(PairsRaw, Asc),
    reverse(Asc, DescRaw),
    dedupe_counter_pairs_by_name(DescRaw, TopUnique),
    take_first_n(TopUnique, 8, TopPairs),
    TopPairs \= [],
    !,
    display_pokemon_name(TargetName, TargetLabel),
    counter_pairs_text(TopPairs, CounterText),
    ( UsedFallback == true ->
        writeln('Bot: Ainda não tenho a ficha da forma especial alvo, então usei a forma base para análise.');
      true
    ),
    format('Bot: Contra ~w, na geração ~w, boas opções são: ~w.~n', [TargetLabel, Generation, CounterText]).
answer_counter_generation_query(TargetIdentifier, Generation, TypeFilters, _ContextFilters) :-
    display_pokemon_name(TargetIdentifier, TargetLabel),
    type_filters_text_if_any(TypeFilters, TypeText),
    format('Bot: Não encontrei counters para ~w na geração ~w~w.~n', [TargetLabel, Generation, TypeText]).

answer_battle_with_level2_modifiers(NameA, NameB, Generation, MaxLevel, TypeFilters, ContextFilters) :-
    pokemon_info(NameA, pokemon(IDA, NameAtomA, _, _, TypesA, _, StatsA)),
    pokemon_info(NameB, pokemon(IDB, NameAtomB, _, _, TypesB, _, StatsB)),
    battle_pair_passes_modifiers(IDA, NameAtomA, TypesA, Generation, TypeFilters, ContextFilters),
    battle_pair_passes_modifiers(IDB, NameAtomB, TypesB, Generation, TypeFilters, ContextFilters),
    !,
    ( MaxLevel == none ->
        StatsAUsed = StatsA,
        StatsBUsed = StatsB,
        MaxLabel = ''
    ; scale_stats_by_level(StatsA, MaxLevel, StatsAUsed),
      scale_stats_by_level(StatsB, MaxLevel, StatsBUsed),
      format(atom(MaxLabel), ' (nível até ~w)', [MaxLevel])
    ),
    display_pokemon_name(NameAtomA, LabelA),
    display_pokemon_name(NameAtomB, LabelB),
    battle_profile(TypesA, StatsAUsed, TypesB, StatsBUsed, ProfileA),
    battle_profile(TypesB, StatsBUsed, TypesA, StatsAUsed, ProfileB),
    simulate_duel(ProfileA, ProfileB, WinnerSide, Turns),
    ( WinnerSide == a -> WinnerLabel = LabelA ; WinnerLabel = LabelB ),
    remember_candidate_list([NameAtomA, NameAtomB]),
    profile_mode_text(ProfileA.mode, ModeAText),
    profile_mode_text(ProfileB.mode, ModeBText),
    multiplier_text(ProfileA.multiplier, MultAText),
    multiplier_text(ProfileB.multiplier, MultBText),
    ( Turns =:= 1 -> TurnWord = 'turno' ; TurnWord = 'turnos' ),
    format('Bot: Simulação teórica 1x1 entre ~w e ~w~w:~n', [LabelA, LabelB, MaxLabel]),
    format('  - ~w tende a atacar pelo lado ~w (~w, dano ~1f/turno).~n', [LabelA, ModeAText, MultAText, ProfileA.damage]),
    format('  - ~w tende a atacar pelo lado ~w (~w, dano ~1f/turno).~n', [LabelB, ModeBText, MultBText, ProfileB.damage]),
    format('  - Vencedor provável: ~w (em cerca de ~w ~w).~n', [WinnerLabel, Turns, TurnWord]),
    writeln('Bot: Observação: é uma aproximação sem moves específicos, itens, clima e boosts.').
answer_battle_with_level2_modifiers(NameA, NameB, _Generation, _MaxLevel, _TypeFilters, _ContextFilters) :-
    format('Bot: Não consegui aplicar esses modificadores ao embate entre ~w e ~w.~n', [NameA, NameB]).

battle_pair_passes_modifiers(ID, Name, Types, Generation, TypeFilters, ContextFilters) :-
    ( Generation == none ; generation_matches_id(Generation, ID) ),
    pokemon_matches_optional_type_filters(TypeFilters, Types),
    name_passes_filters(ContextFilters, Name).

% ============================================================
% ESTADO DE CONVERSA (PENDÊNCIAS / CONFIRMAÇÕES)
% ============================================================

handle_pending_counter_preferences(Text) :-
    pending_counter_preferences(TargetName),
    !,
    tokenize_for_match(Text, Tokens),
    ( has_cancel_token(Tokens) ->
        retractall(pending_counter_preferences(_)),
        say_response(pending_counter_cancel)
    ; counter_preferences_from_text(Text, TypeFilters, ContextFilters) ->
        retractall(pending_counter_preferences(_)),
        answer_counter_with_all_filters(TargetName, TypeFilters, ContextFilters)
    ; counter_preferences_default_text(Tokens) ->
        retractall(pending_counter_preferences(_)),
        answer_counter_query(TargetName)
    ; say_response(pending_counter_help)
    ).

handle_pending_counter_preferences(Text) :-
    pending_counter_level_preferences(TargetName, MaxLevel),
    !,
    tokenize_for_match(Text, Tokens),
    ( has_cancel_token(Tokens) ->
        retractall(pending_counter_level_preferences(_, _)),
        say_response(pending_counter_level_cancel)
    ; counter_preferences_from_text(Text, TypeFilters, ContextFilters) ->
        retractall(pending_counter_level_preferences(_, _)),
        answer_counter_level_cap_query_with_filters(TargetName, MaxLevel, TypeFilters, ContextFilters)
    ; counter_preferences_default_text(Tokens) ->
        retractall(pending_counter_level_preferences(_, _)),
        answer_counter_level_cap_query(TargetName, MaxLevel)
    ; say_response(pending_counter_help)
    ).

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

parse_counter_level_cap_query(Text, TargetName, MaxLevel) :-
    tokenize_for_match(Text, Tokens),
    counter_intent_tokens(Tokens),
    level_cap_indicator_tokens(Tokens),
    parse_natural_pokemon_query(Text, TargetName),
    extract_levels_from_tokens(Tokens, Levels),
    Levels \= [],
    last(Levels, MaxLevel).

parse_counter_composed_query(Text, TargetName, Generation, TypeFilters, ContextFilters, MaxLevel) :-
    tokenize_for_match(Text, Tokens),
    counter_intent_tokens(Tokens),
    parse_natural_pokemon_query(Text, TargetName),
    parse_generation_from_tokens(Tokens, Generation),
    extract_levels_from_tokens(Tokens, Levels),
    Levels \= [],
    last(Levels, MaxLevel),
    ( extract_type_filters(Tokens, TypeFilters) ; TypeFilters = [] ),
    extract_context_filters(Tokens, ContextFilters).

parse_mega_count_query(Text) :-
    tokenize_for_match(Text, Tokens),
    quantity_intent_tokens(Tokens),
    ( member("mega", Tokens)
    ; member("megas", Tokens)
    ; contiguous_sublist(["mega", "evolucoes"], Tokens)
    ; contiguous_sublist(["mega", "evoluções"], Tokens)
    ; contiguous_sublist(["megas", "evolucoes"], Tokens)
    ; contiguous_sublist(["megas", "evoluções"], Tokens)
    ; contiguous_sublist(["evolucao", "mega"], Tokens)
    ; contiguous_sublist(["evolução", "mega"], Tokens)
    ; contiguous_sublist(["evolucoes", "mega"], Tokens)
    ; contiguous_sublist(["evoluções", "mega"], Tokens)
    ).

parse_megas_per_generation_summary_query(Text) :-
    tokenize_for_match(Text, Tokens),
    ( member("mega", Tokens) ; member("megas", Tokens) ),
    ( contiguous_sublist(["por", "geracao"], Tokens)
    ; contiguous_sublist(["por", "geração"], Tokens)
    ).

parse_pokemon_per_generation_summary_query(Text) :-
    tokenize_for_match(Text, Tokens),
    pokemon_noun_tokens(Tokens),
    ( contiguous_sublist(["por", "geracao"], Tokens)
    ; contiguous_sublist(["por", "geração"], Tokens)
    ).

parse_legendary_per_generation_summary_query(Text) :-
    tokenize_for_match(Text, Tokens),
    legendary_request_tokens(Tokens),
    ( contiguous_sublist(["por", "geracao"], Tokens)
    ; contiguous_sublist(["por", "geração"], Tokens)
    ).

parse_mega_by_generation_query(Text, Generation, TypeFilters, ContextFilters) :-
    tokenize_for_match(Text, Tokens),
    parse_generation_from_tokens(Tokens, Generation),
    mega_tokens(Tokens),
    ( extract_type_filters(Tokens, TypeFilters) ; TypeFilters = [] ),
    extract_context_filters(Tokens, RawContext),
    ensure_filter_present(only_mega, RawContext, ContextFilters).

parse_legendary_by_generation_query(Text, Generation, TypeFilters, ContextFilters) :-
    tokenize_for_match(Text, Tokens),
    parse_generation_from_tokens(Tokens, Generation),
    legendary_request_tokens(Tokens),
    ( extract_type_filters(Tokens, TypeFilters) ; TypeFilters = [] ),
    extract_context_filters(Tokens, RawContext),
    ensure_filter_present(only_legendary, RawContext, ContextFilters).

parse_legendary_by_type_query(Text, TypeFilters, ContextFilters) :-
    tokenize_for_match(Text, Tokens),
    legendary_request_tokens(Tokens),
    extract_type_filters(Tokens, TypeFilters),
    extract_context_filters(Tokens, RawContext),
    ensure_filter_present(only_legendary, RawContext, ContextFilters).

parse_generation_type_query(Text, Generation, TypeFilters, ContextFilters) :-
    tokenize_for_match(Text, Tokens),
    parse_generation_from_tokens(Tokens, Generation),
    extract_type_filters(Tokens, TypeFilters),
    TypeFilters \= [],
    ( member("tipo", Tokens)
    ; member("tipos", Tokens)
    ; pokemon_noun_tokens(Tokens)
    ; quantity_intent_tokens(Tokens)
    ; list_intent_tokens(Tokens)
    ),
    \+ legendary_request_tokens(Tokens),
    extract_context_filters(Tokens, ContextFilters).

parse_pokemon_by_generation_query(Text, Generation, TypeFilters, ContextFilters) :-
    tokenize_for_match(Text, Tokens),
    parse_generation_from_tokens(Tokens, Generation),
    ( pokemon_noun_tokens(Tokens)
    ; quantity_intent_tokens(Tokens)
    ; list_intent_tokens(Tokens)
    ),
    \+ legendary_request_tokens(Tokens),
    \+ mega_tokens(Tokens),
    ( extract_type_filters(Tokens, TypeFilters) ; TypeFilters = [] ),
    extract_context_filters(Tokens, ContextFilters).

legendary_request_tokens(Tokens) :-
    member(Token, Tokens),
    legendary_request_token(Token),
    !.

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

ensure_filter_present(Filter, Filters, Filters) :-
    member(Filter, Filters),
    !.
ensure_filter_present(Filter, Filters, [Filter | Filters]).

parse_evolution_count_query(Text, Method) :-
    tokenize_for_match(Text, Tokens),
    quantity_intent_tokens(Tokens),
    has_evolution_intent_tokens(Tokens),
    evolution_method_tokens(Tokens, Method).

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
    findall(Name,
        ( pokemon_in_scope(_, Name, _, _, _, _, _),
          pokemon_name_mentioned_in_tokens(Name, Tokens, _)
        ),
        NamesRaw),
    sort(NamesRaw, Names).

parse_info_by_number(Text, Number) :-
    split_string(Text, " ", "", Tokens),
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
    split_string(Text, " ", "", Tokens),
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

parse_counter_query(Text, TargetName) :-
    tokenize_for_match(Text, Tokens),
    \+ parse_battle_pair_from_tokens(Tokens, _, _),
    append(_, ["contra" | Tail], Tokens),
    extract_name_from_tokens(Tail, TargetName).
parse_counter_query(Text, TargetName) :-
    tokenize_for_match(Text, Tokens),
    \+ parse_battle_pair_from_tokens(Tokens, _, _),
    ( counter_intent_tokens(Tokens)
    ; starts_with_tokens(Tokens, ["ganha", "de"])
    ; starts_with_tokens(Tokens, ["ganhar", "de"])
    ; starts_with_tokens(Tokens, ["quem", "ganha", "de"])
    ; starts_with_tokens(Tokens, ["quem", "vence", "de"])
    ; starts_with_tokens(Tokens, ["quem", "ganha", "contra"])
    ; starts_with_tokens(Tokens, ["quem", "vence", "contra"])
    ; starts_with_tokens(Tokens, ["bom", "contra"])
    ; starts_with_tokens(Tokens, ["boa", "contra"])
    ),
    parse_natural_pokemon_query(Text, TargetName).
parse_counter_query(Text, TargetName) :-
    tokenize_for_match(Text, Tokens),
    ( starts_with_tokens(Tokens, ["counter", "de"])
    ; starts_with_tokens(Tokens, ["counter", "do"])
    ; starts_with_tokens(Tokens, ["counter", "da"])
    ; starts_with_tokens(Tokens, ["counters", "de"])
    ; starts_with_tokens(Tokens, ["counters", "do"])
    ; starts_with_tokens(Tokens, ["counters", "da"])
    ),
    parse_natural_pokemon_query(Text, TargetName).
parse_counter_query(Text, TargetName) :-
    tokenize_for_match(Text, Tokens),
    ( member("counter", Tokens)
    ; member("counters", Tokens)
    ; member("check", Tokens)
    ),
        ( member(RelToken, Tokens),
            counter_relation_token(RelToken),
            append(_, [RelToken | Tail], Tokens)
    ),
    extract_name_from_tokens(Tail, TargetName).

parse_counter_compound_query(Text, TargetName, TypeFilters, ContextFilters) :-
    tokenize_for_match(Text, Tokens),
    \+ parse_battle_pair_from_tokens(Tokens, _, _),
    counter_intent_tokens(Tokens),
    parse_natural_pokemon_query(Text, TargetName),
    ( extract_type_filters(Tokens, TypeFilters) ; TypeFilters = [] ),
    extract_context_filters(Tokens, ContextFilters),
    ( TypeFilters \= [] ; ContextFilters \= [] ).

counter_intent_tokens(Tokens) :-
    ( member(Token, Tokens), counter_intent_token(Token)
    ; counter_intent_phrase(Phrase), contiguous_sublist(Phrase, Tokens)
    ),
    !.

parse_counter_with_filters_query(Text, TargetName, ContextFilters) :-
        tokenize_for_match(Text, Tokens),
        ( member("contra", Tokens)
        ; member("counter", Tokens)
        ; member("counterar", Tokens)
        ; member("sola", Tokens)
        ; member("ganhar", Tokens)
        ; member("vencer", Tokens)
        ),
        findall(Filter,
                ( context_filter_token(Filter, FilterTokens),
                    contiguous_sublist(FilterTokens, Tokens)
                ),
                RawFilters),
        sort(RawFilters, ContextFilters),
        ContextFilters \= [],
        parse_natural_pokemon_query(Text, TargetName).

parse_filtered_counter_query(Text, TypeFilters, TargetName) :-
    tokenize_for_match(Text, Tokens),
    member("contra", Tokens),
    extract_type_filters(Tokens, TypeFilters),
    TypeFilters \= [],
    append(_, ["contra" | Tail], Tokens),
    extract_name_from_tokens(Tail, TargetName),
    pokemon_info(TargetName, _).

parse_best_switch_query(Text, TargetName) :-
    tokenize_for_match(Text, Tokens),
    ( starts_with_tokens(Tokens, ["quem", "entra", "melhor", "contra"])
    ; starts_with_tokens(Tokens, ["qual", "entra", "melhor", "contra"])
    ; starts_with_tokens(Tokens, ["quem", "segura", "melhor", "contra"])
    ; starts_with_tokens(Tokens, ["qual", "segura", "melhor", "contra"])
    ; contiguous_sublist(["segura", "melhor", "contra"], Tokens)
    ),
    append(_, ["contra" | Tail], Tokens),
    extract_name_from_tokens(Tail, TargetName).

parse_team_compare_query(Text, NameA, NameB) :-
    tokenize_for_match(Text, Tokens),
    ( member("time", Tokens)
    ; member("equipe", Tokens)
    ; member("comp", Tokens)
    ),
    ( member("melhor", Tokens)
    ; member("vale", Tokens)
    ; member("forte", Tokens)
    ; member("forte", Tokens)
    ),
    split_compare_tokens(Tokens, LeftTokens, RightTokens),
    extract_name_from_tokens(LeftTokens, NameA),
    extract_name_from_tokens(RightTokens, NameB),
    NameA \= NameB.

parse_context_filter_query(Text, Filters) :-
    tokenize_for_match(Text, Tokens),
    ( member("desses", Tokens)
    ; member("desse", Tokens)
    ; member("deles", Tokens)
    ; member("deles", Tokens)
    ),
    findall(Filter,
        ( context_filter_token(Filter, FilterTokens),
          contiguous_sublist(FilterTokens, Tokens)
        ),
        FiltersRaw),
    sort(FiltersRaw, Filters),
    Filters \= [].

parse_compare_query(Text, NameA, NameB) :-
    tokenize_for_match(Text, Tokens),
    ( append(_, ["compare" | Tail], Tokens)
    ; append(_, ["comparar" | Tail], Tokens)
    ; append(_, ["compara" | Tail], Tokens)
    ; append(_, ["comparacao", "entre" | Tail], Tokens)
    ; append(_, ["comparação", "entre" | Tail], Tokens)
    ; append(_, ["diferença", "entre" | Tail], Tokens)
    ; append(_, ["diferenca", "entre" | Tail], Tokens)
    ; append(_, ["diferenças", "entre" | Tail], Tokens)
    ; append(_, ["diferencas", "entre" | Tail], Tokens)
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
    append(LeftTokens, RelationTokens, LeftAndRelation),
    append(LeftAndRelation, RightTokens, Tokens),
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

parse_natural_pokemon_query(Text, Name) :-
    tokenize_for_match(Text, Tokens),
    findall(Len-FoundName,
        ( pokemon_in_scope(_, FoundName, _, _, _, _, _),
          pokemon_name_mentioned_in_tokens(FoundName, Tokens, Len)
        ),
        Matches),
    Matches \= [],
    keysort(Matches, Sorted),
    reverse(Sorted, [_BestLen-Name | _]).

parse_type_query(Text, TypeFilters) :-
    split_string(Text, " ", "", Tokens),
    ( append(_, ["tipo" | Tail], Tokens)
    ; append(_, ["tipos" | Tail], Tokens)
    ),
    extract_type_filters(Tail, TypeFilters).

parse_natural_type_query(Text, TypeFilters) :-
    tokenize_for_match(Text, Tokens),
    ( member("pokemon", Tokens)
    ; member("pokemons", Tokens)
    ; member("pokémon", Tokens)
    ; member("pokémons", Tokens)
    ; member("tipo", Tokens)
    ; member("tipos", Tokens)
    ; member("elemento", Tokens)
    ; member("elementos", Tokens)
    ; member("quais", Tokens)
    ; member("mostra", Tokens)
    ; member("liste", Tokens)
    ),
    extract_type_filters(Tokens, TypeFilters).

parse_count_without_type_query(Text, TypeFilters) :-
    tokenize_for_match(Text, Tokens),
    member("quantos", Tokens),
    member("sem", Tokens),
    ( member("tipo", Tokens) ; member("tipos", Tokens) ),
    extract_type_filters(Tokens, TypeFilters),
    TypeFilters \= [].

parse_weak_against_type_query(Text, TypeFilters) :-
    tokenize_for_match(Text, Tokens),
    ( member("fraco", Tokens)
    ; member("fracos", Tokens)
    ; member("fraqueza", Tokens)
    ; member("fraquezas", Tokens)
    ; member("vulneravel", Tokens)
    ; member("vulneraveis", Tokens)
    ),
    ( member("contra", Tokens)
    ; member("a", Tokens)
    ),
    extract_type_filters(Tokens, TypeFilters),
    TypeFilters \= [].

parse_immunity_type_query(Text, TypeFilters) :-
    tokenize_for_match(Text, Tokens),
    ( member("imunidade", Tokens)
    ; member("imunidades", Tokens)
    ; member("imune", Tokens)
    ; member("imunes", Tokens)
    ),
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

parse_evolution_level_query(Text, Name) :-
    tokenize_for_match(Text, Tokens),
    ( member(Token, Tokens), evolution_intent_token(Token) ),
    level_word_tokens(Tokens),
    parse_natural_pokemon_query(Text, Name).

parse_ranked_metric_query(Text, Metric, Limit, Generation) :-
    tokenize_for_match(Text, Tokens),
    has_ranking_signal(Tokens),
    ranked_metric_from_tokens(Tokens, Metric),
    ( parse_limit_from_tokens(Tokens, ParsedLimit) -> Limit = ParsedLimit ; Limit = 10 ),
    ( parse_generation_from_tokens(Tokens, ParsedGeneration) -> Generation = ParsedGeneration ; Generation = all ).

parse_bst_threshold_query(Text, Comparator, Threshold, Generation) :-
    tokenize_for_match(Text, Tokens),
    ranked_metric_from_tokens(Tokens, bst),
    threshold_comparator_from_tokens(Tokens, Comparator),
    extract_threshold_value(Tokens, Threshold),
    ( parse_generation_from_tokens(Tokens, ParsedGeneration) -> Generation = ParsedGeneration ; Generation = all ).

parse_evolution_structure_query(Text, Kind, Generation) :-
    tokenize_for_match(Text, Tokens),
    has_evolution_intent_tokens(Tokens),
    evolution_structure_kind_from_tokens(Tokens, Kind),
    ( parse_generation_from_tokens(Tokens, ParsedGeneration) -> Generation = ParsedGeneration ; Generation = all ).

parse_evolution_chain_query(Text, Name) :-
    tokenize_for_match(Text, Tokens),
    has_evolution_intent_tokens(Tokens),
    ( member(Token, Tokens), evolution_chain_token(Token) ),
    parse_natural_pokemon_query(Text, Name).

parse_type_coverage_query(Text, TargetType) :-
    tokenize_for_match(Text, Tokens),
    ( member(Token, Tokens), coverage_intent_token(Token) ),
    extract_type_filters(Tokens, [TargetType | _]).

parse_double_weakness_query(Text, AttackType) :-
    tokenize_for_match(Text, Tokens),
    ( contiguous_sublist(["dupla", "fraqueza"], Tokens)
    ; member("4x", Tokens)
    ),
    extract_type_filters(Tokens, [AttackType | _]).

parse_most_immunities_query(Text, Limit) :-
    tokenize_for_match(Text, Tokens),
    ( member(Token, Tokens), immunity_intent_token(Token) ),
    has_ranking_signal(Tokens),
    ( parse_limit_from_tokens(Tokens, ParsedLimit) -> Limit = ParsedLimit ; Limit = 10 ).

parse_team_coverage_query(Text) :-
    tokenize_for_match(Text, Tokens),
    ( member(Token, Tokens), team_intent_token(Token) ),
    ( member(Token, Tokens), coverage_intent_token(Token) ).

parse_multi_compare_query(Text, Names) :-
    tokenize_for_match(Text, Tokens),
    ( member(Token, Tokens), compare_intent_token(Token) ),
    extract_all_pokemon_mentions(Text, Names),
    length(Names, Count),
    Count >= 3.

parse_rank_team_vs_target_query(Text, TeamNames, TargetName) :-
    tokenize_for_match(Text, Tokens),
    has_ranking_signal(Tokens),
    ( member(Token, Tokens), team_intent_token(Token) ),
    ( member(Token, Tokens), counter_relation_token(Token)
    ; member(Token, Tokens), counter_intent_token(Token)
    ),
    extract_target_name_after_relation(Text, TargetName),
    extract_all_pokemon_mentions(Text, Mentions),
    exclude(=(TargetName), Mentions, TeamNames),
    TeamNames \= [].

parse_best_team_member_vs_target_query(Text, TeamNames, TargetName) :-
    tokenize_for_match(Text, Tokens),
    ( member(Token, Tokens), team_intent_token(Token) ),
    ( contiguous_sublist(["entra", "melhor"], Tokens)
    ; contiguous_sublist(["melhor", "contra"], Tokens)
    ; contiguous_sublist(["quem", "entra"], Tokens)
    ),
    extract_target_name_after_relation(Text, TargetName),
    extract_all_pokemon_mentions(Text, Mentions),
    exclude(=(TargetName), Mentions, TeamNames),
    TeamNames \= [].

has_ranking_signal(Tokens) :-
    member("top", Tokens),
    !.
has_ranking_signal(Tokens) :-
    member(Token, Tokens),
    ranking_intent_token(Token),
    !.
has_ranking_signal(Tokens) :-
    member("mais", Tokens),
    ranked_metric_from_tokens(Tokens, _).

ranked_metric_from_tokens(Tokens, speed) :-
    ( member("rapido", Tokens)
    ; member("rápido", Tokens)
    ; member("rapidos", Tokens)
    ; member("rápidos", Tokens)
    ; member("veloz", Tokens)
    ; member("speed", Tokens)
    ).
ranked_metric_from_tokens(Tokens, defensive_bulk) :-
    ( member("defensivo", Tokens)
    ; member("tanque", Tokens)
    ; member("bulk", Tokens)
    ; member("resistente", Tokens)
    ).
ranked_metric_from_tokens(Tokens, physical_attack) :-
    ( contiguous_sublist(["ataque", "fisico"], Tokens)
    ; contiguous_sublist(["ataque", "físico"], Tokens)
    ; contiguous_sublist(["atk", "fisico"], Tokens)
    ; contiguous_sublist(["atk", "físico"], Tokens)
    ).
ranked_metric_from_tokens(Tokens, special_attack) :-
    ( contiguous_sublist(["ataque", "especial"], Tokens)
    ; contiguous_sublist(["sp", "atk"], Tokens)
    ; contiguous_sublist(["special", "attack"], Tokens)
    ).
ranked_metric_from_tokens(Tokens, bst) :-
    ( member("bst", Tokens)
    ; contiguous_sublist(["soma", "stats"], Tokens)
    ; contiguous_sublist(["total", "stats"], Tokens)
    ).
ranked_metric_from_tokens(Tokens, tallest) :-
    ( member("altura", Tokens), (member("maior", Tokens); member("altos", Tokens); member("alto", Tokens)) ).
ranked_metric_from_tokens(Tokens, shortest) :-
    member("altura", Tokens),
    ( member("menor", Tokens)
    ; member("baixos", Tokens)
    ; member("baixo", Tokens)
    ).
ranked_metric_from_tokens(Tokens, heaviest) :-
    member("peso", Tokens),
    ( member("maior", Tokens)
    ; member("pesado", Tokens)
    ; member("pesados", Tokens)
    ).
ranked_metric_from_tokens(Tokens, lightest) :-
    member("peso", Tokens),
    ( member("menor", Tokens)
    ; member("leve", Tokens)
    ; member("leves", Tokens)
    ).

parse_limit_from_tokens(Tokens, Limit) :-
    member("top", Tokens),
    extract_threshold_value(Tokens, Parsed),
    Parsed =< 30,
    Limit = Parsed,
    !.
parse_limit_from_tokens(Tokens, Limit) :-
    extract_threshold_value(Tokens, Parsed),
    Parsed =< 20,
    Limit = Parsed,
    !.

extract_threshold_value(Tokens, Threshold) :-
    findall(Number,
        ( member(Token, Tokens),
          token_to_numeric_value(Token, Number),
          integer(Number),
          Number >= 1,
          Number =< 999
        ),
        NumbersSingle),
    findall(Number,
        token_compound_numeric_value(Tokens, Number),
        NumbersCompound),
    append(NumbersSingle, NumbersCompound, Numbers),
    Numbers \= [],
    max_list(Numbers, Threshold).

token_to_numeric_value(Token, Number) :-
    string_number(Token, Number),
    integer(Number).
token_to_numeric_value(Token, Number) :-
    safe_number_word_value(Token, Number).

token_compound_numeric_value(Tokens, Number) :-
    append(_, [TensToken, "e", UnitToken | _], Tokens),
    safe_number_word_value(TensToken, Tens),
    safe_number_word_value(UnitToken, Units),
    member(Tens, [20, 30, 40, 50, 60, 70, 80, 90]),
    between(1, 9, Units),
    Number is Tens + Units.

safe_number_word_value(Token, Number) :-
    current_predicate(number_word_value/2),
    number_word_value(Token, Number).

safe_generation_number_word(Token, Generation) :-
    current_predicate(generation_number_word/2),
    generation_number_word(Token, Generation).

threshold_comparator_from_tokens(Tokens, ge) :-
    ( member("acima", Tokens)
    ; contiguous_sublist(["maior", "que"], Tokens)
    ; contiguous_sublist(["maiores", "que"], Tokens)
    ; member(">=", Tokens)
    ; member("minimo", Tokens)
    ; member("mínimo", Tokens)
    ).
threshold_comparator_from_tokens(Tokens, le) :-
    ( member("abaixo", Tokens)
    ; contiguous_sublist(["menor", "que"], Tokens)
    ; contiguous_sublist(["menores", "que"], Tokens)
    ; member("<=", Tokens)
    ; member("maximo", Tokens)
    ; member("máximo", Tokens)
    ).

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
    atom_string(Text, TextString),
    split_string(TextString, " ,.;:!?()[]{}\"'/-_", "", RawTokens),
    include(non_empty_string, RawTokens, Tokens).

pokemon_name_mentioned_in_tokens(Name, Tokens, Len) :-
    atom_string(Name, NameText),
    split_string(NameText, "_", "", NameTokensRaw),
    include(non_empty_string, NameTokensRaw, NameTokens),
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
    sample_names_text(Names, 8, SampleText),
    format('Bot: Encontrei ~w Pokémon com a habilidade ~w.~n', [Count, AbilityLabel]),
    format('  Exemplos: ~w~n', [SampleText]).
answer_ability_query(Ability) :-
    display_label(Ability, AbilityLabel),
    format('Bot: Não encontrei Pokémon com a habilidade ~w.~n', [AbilityLabel]).

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

answer_evolution_level_query(NameIdentifier) :-
    pokemon_info(NameIdentifier, pokemon(ID, NameAtom, _, _, _, _, _)),
    !,
    display_pokemon_name(NameAtom, NameLabel),
    findall(ToID-Trigger-MinLevel-Condition,
        pokemon_evolution(ID, ToID, Trigger, MinLevel, Condition),
        EvolutionsRaw),
    sort(EvolutionsRaw, Evolutions),
    ( Evolutions \= [] ->
        format('Bot: Evoluções de ~w:~n', [NameLabel]),
        print_evolution_options(Evolutions)
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
answer_evolution_level_query(_) :-
    writeln('Bot: Não consegui identificar o Pokémon para consultar nível de evolução.').

print_evolution_options([]).
print_evolution_options([ToID-Trigger-MinLevel-Condition | Rest]) :-
    evolution_target_label(ToID, ToLabel),
    evolution_condition_text(Trigger, MinLevel, Condition, ConditionText),
    format('  - ~w~n', [ConditionText]),
    format('    -> evolui para: ~w~n', [ToLabel]),
    print_evolution_options(Rest).

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
    display_label(Condition, CondLabel),
    format(atom(Text), ' (condição: ~w)', [CondLabel]).

build_evolution_condition_text(TriggerText, LevelText, '', Text) :-
    format(atom(Text), '~w~w.', [TriggerText, LevelText]).
build_evolution_condition_text(TriggerText, LevelText, ExtraText, Text) :-
    ExtraText \= '',
    format(atom(Text), '~w~w~w.', [TriggerText, LevelText, ExtraText]).

% ============================================================
% RESPOSTAS: COUNTER / MATCHUP / GERAÇÃO
% ============================================================

answer_counter_query(TargetIdentifier) :-
    resolve_counter_target(TargetIdentifier, pokemon(TargetID, TargetName, _, _, TargetTypes, _, TargetStats), UsedFallback),
    recommend_counters(TargetID, TargetTypes, TargetStats, CounterPairs),
    CounterPairs \= [],
    !,
    display_pokemon_name(TargetName, TargetLabel),
    counter_pairs_text(CounterPairs, CounterText),
    ( UsedFallback == true ->
        writeln('Bot: Ainda não tenho a ficha da forma Mega, então usei a forma base para sugerir counters.')
    ; true
    ),
    extract_counter_names(CounterPairs, CounterNames),
    remember_candidate_list(CounterNames),
    format('Bot: Contra ~w, uma boa estratégia é usar: ~w.~n', [TargetLabel, CounterText]),
    writeln('Bot: Se quiser, eu também posso sugerir opções mais ofensivas ou mais defensivas.').
answer_counter_query(TargetIdentifier) :-
    resolve_counter_target(TargetIdentifier, pokemon(_, TargetName, _, _, _, _, _), _),
    !,
    display_pokemon_name(TargetName, TargetLabel),
    format('Bot: Não encontrei counters fortes o suficiente para ~w com o filtro atual de geração.~n', [TargetLabel]).
answer_counter_query(TargetIdentifier) :-
    writeln('Bot: Não consegui identificar o Pokémon alvo. Exemplo: "qual é um bom pokemon contra charizard mega x".'),
    print_suggestion_for_identifier(counter, TargetIdentifier).

answer_counter_query_with_clarification(TargetIdentifier) :-
    retractall(pending_counter_preferences(_)),
    assertz(pending_counter_preferences(TargetIdentifier)),
    display_pokemon_name(TargetIdentifier, TargetLabel),
    format('Bot: Antes de sugerir counters para ~w, quer aplicar algum filtro?~n', [TargetLabel]),
    writeln('Bot: Você pode responder: "padrão", "sem lendários", "sem mega", "tipo gelo" ou combinar filtros.').

counter_preferences_from_text(Text, TypeFilters, ContextFilters) :-
    tokenize_for_match(Text, Tokens),
    findall(Filter,
        ( context_filter_token(Filter, FilterTokens),
          contiguous_sublist(FilterTokens, Tokens)
        ),
        ContextRaw),
    sort(ContextRaw, ContextFilters),
    ( extract_type_filters(Tokens, TypeFilters)
    ; TypeFilters = []
    ),
    ( ContextFilters \= [] ; TypeFilters \= [] ).

answer_counter_with_all_filters(TargetIdentifier, TypeFilters, ContextFilters) :-
    resolve_counter_target(TargetIdentifier, pokemon(TargetID, TargetName, _, _, TargetTypes, _, TargetStats), UsedFallback),
    ( TypeFilters == [] ->
        recommend_counters(TargetID, TargetTypes, TargetStats, BasePairs)
    ; type_pokemon_list(TypeFilters, CandidateNames),
      recommend_counters_from_candidates(CandidateNames, TargetID, TargetTypes, TargetStats, BasePairs)
    ),
    BasePairs \= [],
    include(counter_pair_passes_filters(ContextFilters), BasePairs, FilteredPairs),
    FilteredPairs \= [],
    !,
    display_pokemon_name(TargetName, TargetLabel),
    counter_pairs_text(FilteredPairs, CounterText),
    ( UsedFallback == true ->
        writeln('Bot: Ainda não tenho a ficha da forma especial alvo, então usei a forma base para análise.')
    ; true
    ),
    extract_counter_names(FilteredPairs, CounterNames),
    remember_candidate_list(CounterNames),
    format('Bot: Contra ~w, considerando seus filtros, boas opções são: ~w.~n', [TargetLabel, CounterText]).
answer_counter_with_all_filters(TargetIdentifier, _, _) :-
    answer_counter_query(TargetIdentifier).

answer_counter_with_filters_query(TargetIdentifier, Filters) :-
    resolve_counter_target(TargetIdentifier, pokemon(TargetID, TargetName, _, _, TargetTypes, _, TargetStats), UsedFallback),
    recommend_counters(TargetID, TargetTypes, TargetStats, CounterPairs),
    CounterPairs \= [],
    include(counter_pair_passes_filters(Filters), CounterPairs, FilteredPairs),
    FilteredPairs \= [],
    !,
    display_pokemon_name(TargetName, TargetLabel),
    counter_pairs_text(FilteredPairs, CounterText),
    ( UsedFallback == true ->
        writeln('Bot: Ainda não tenho a ficha da forma especial alvo, então usei a forma base para análise.')
    ; true
    ),
    extract_counter_names(FilteredPairs, CounterNames),
    remember_candidate_list(CounterNames),
    format('Bot: Contra ~w, considerando seus filtros, boas opções são: ~w.~n', [TargetLabel, CounterText]).
answer_counter_with_filters_query(TargetIdentifier, _) :-
    answer_counter_query(TargetIdentifier).

answer_counter_level_cap_query(TargetIdentifier, MaxLevel) :-
    resolve_counter_target(TargetIdentifier, pokemon(_, TargetName, _, _, TargetTypes, _, TargetStatsRaw), _),
    scale_stats_by_level(TargetStatsRaw, MaxLevel, TargetStats),
    findall(Score-Name-AttackMult-DefenseMult,
        ( pokemon_in_scope(_, Name, _, _, CandidateTypes, _, CandidateStatsRaw),
                    pokemon_info(Name, pokemon(CandidateID, _, _, _, _, _, _)),
                    pokemon_reachable_by_level(CandidateID, MaxLevel),
          scale_stats_by_level(CandidateStatsRaw, MaxLevel, CandidateStats),
          counter_metrics(CandidateTypes, CandidateStats, TargetTypes, TargetStats, AttackMult, DefenseMult, AttackPressure, DefensePressure),
          AttackMult > 1.0,
          Score is (AttackPressure * 2.5) - DefensePressure
        ),
        PairsRaw),
    keysort(PairsRaw, Asc),
    reverse(Asc, DescRaw),
    dedupe_counter_pairs_by_name(DescRaw, Desc),
    take_first_n(Desc, 8, TopPairs),
    TopPairs \= [],
    !,
    display_pokemon_name(TargetName, TargetLabel),
    counter_pairs_text(TopPairs, CounterText),
    format('Bot: Contra ~w, no cenário de nível até ~w, bons counters são: ~w.~n', [TargetLabel, MaxLevel, CounterText]).
answer_counter_level_cap_query(TargetIdentifier, MaxLevel) :-
    display_pokemon_name(TargetIdentifier, TargetLabel),
    format('Bot: Não encontrei counters válidos para ~w no recorte de nível até ~w.~n', [TargetLabel, MaxLevel]).

answer_counter_level_cap_query_with_clarification(TargetIdentifier, MaxLevel) :-
    retractall(pending_counter_level_preferences(_, _)),
    assertz(pending_counter_level_preferences(TargetIdentifier, MaxLevel)),
    display_pokemon_name(TargetIdentifier, TargetLabel),
    format('Bot: Para counterar ~w até nível ~w, quer aplicar filtros antes?~n', [TargetLabel, MaxLevel]),
    writeln('Bot: Você pode responder: "padrão", "sem lendários", "sem mega", "tipo gelo" ou combinar filtros.').

answer_counter_level_cap_query_with_filters(TargetIdentifier, MaxLevel, TypeFilters, ContextFilters) :-
    resolve_counter_target(TargetIdentifier, pokemon(_, TargetName, _, _, TargetTypes, _, TargetStatsRaw), _),
    scale_stats_by_level(TargetStatsRaw, MaxLevel, TargetStats),
    findall(Score-Name-AttackMult-DefenseMult,
        ( pokemon_in_scope(_, Name, _, _, CandidateTypes, _, CandidateStatsRaw),
          pokemon_info(Name, pokemon(CandidateID, _, _, _, _, _, _)),
          pokemon_reachable_by_level(CandidateID, MaxLevel),
          pokemon_matches_optional_type_filters_by_name(TypeFilters, Name),
          scale_stats_by_level(CandidateStatsRaw, MaxLevel, CandidateStats),
          counter_metrics(CandidateTypes, CandidateStats, TargetTypes, TargetStats, AttackMult, DefenseMult, AttackPressure, DefensePressure),
          AttackMult > 1.0,
          Score is (AttackPressure * 2.5) - DefensePressure
        ),
        PairsRaw),
    keysort(PairsRaw, Asc),
    reverse(Asc, DescRaw),
    dedupe_counter_pairs_by_name(DescRaw, UniquePairs),
    include(counter_pair_passes_filters(ContextFilters), UniquePairs, FilteredPairs),
    take_first_n(FilteredPairs, 8, TopPairs),
    TopPairs \= [],
    !,
    display_pokemon_name(TargetName, TargetLabel),
    counter_pairs_text(TopPairs, CounterText),
    format('Bot: Contra ~w, no cenário de nível até ~w e considerando seus filtros, boas opções são: ~w.~n', [TargetLabel, MaxLevel, CounterText]).
answer_counter_level_cap_query_with_filters(TargetIdentifier, MaxLevel, _, _) :-
    answer_counter_level_cap_query(TargetIdentifier, MaxLevel).

answer_counter_composed_query(TargetIdentifier, Generation, TypeFilters, ContextFilters, MaxLevel) :-
    resolve_counter_target(TargetIdentifier, pokemon(_, TargetName, _, _, TargetTypes, _, TargetStatsRaw), _),
    scale_stats_by_level(TargetStatsRaw, MaxLevel, TargetStats),
    findall(Score-Name-AttackMult-DefenseMult,
        ( pokemon(ID, Name, _Height, _Weight, CandidateTypes, _Abilities, CandidateStatsRaw),
          generation_matches_id(Generation, ID),
          pokemon_info(Name, pokemon(CandidateID, _, _, _, _, _, _)),
          pokemon_reachable_by_level(CandidateID, MaxLevel),
          pokemon_matches_optional_type_filters(TypeFilters, CandidateTypes),
          name_passes_filters(ContextFilters, Name),
          scale_stats_by_level(CandidateStatsRaw, MaxLevel, CandidateStats),
          counter_metrics(CandidateTypes, CandidateStats, TargetTypes, TargetStats, AttackMult, DefenseMult, AttackPressure, DefensePressure),
          AttackMult > 1.0,
          Score is (AttackPressure * 2.5) - DefensePressure
        ),
        PairsRaw),
    keysort(PairsRaw, Asc),
    reverse(Asc, DescRaw),
    dedupe_counter_pairs_by_name(DescRaw, UniquePairs),
    take_first_n(UniquePairs, 8, TopPairs),
    TopPairs \= [],
    !,
    extract_counter_names(TopPairs, CounterNames),
    remember_candidate_list(CounterNames),
    display_pokemon_name(TargetName, TargetLabel),
    counter_pairs_text(TopPairs, CounterText),
    type_filters_text_if_any(TypeFilters, TypeText),
    format('Bot: Contra ~w, na geração ~w, até nível ~w~w, os melhores counters são: ~w.~n', [TargetLabel, Generation, MaxLevel, TypeText, CounterText]).
answer_counter_composed_query(TargetIdentifier, Generation, TypeFilters, _ContextFilters, MaxLevel) :-
    display_pokemon_name(TargetIdentifier, TargetLabel),
    type_filters_text_if_any(TypeFilters, TypeText),
    format('Bot: Não encontrei counters para ~w na geração ~w até nível ~w~w.~n', [TargetLabel, Generation, MaxLevel, TypeText]).

type_filters_text_if_any([], '').
type_filters_text_if_any(TypeFilters, Text) :-
    TypeFilters \= [],
    type_filters_text(TypeFilters, FiltersText),
    format(atom(Text), ' com tipo ~w', [FiltersText]).

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

answer_mega_count_query :-
        findall(Name,
                ( pokemon_in_scope(_, Name, _, _, _, _, _),
                    is_mega_name(Name)
                ),
                NamesRaw),
        sort(NamesRaw, Names),
        length(Names, Count),
        format('Bot: Existem ~w formas Mega na base atual.~n', [Count]).

answer_megas_per_generation_summary_query :-
    findall(Generation-Count,
        ( between(1, 9, Generation),
          collect_generation_names(Generation, [], [only_mega], Names),
          length(Names, Count)
        ),
        Summary),
    writeln('Bot: Quantidade de formas Mega por geração:'),
    print_generation_summary(Summary).

answer_pokemon_per_generation_summary_query :-
    findall(Generation-Count,
        ( between(1, 9, Generation),
          collect_generation_names(Generation, [], [], Names),
          length(Names, Count)
        ),
        Summary),
    writeln('Bot: Quantidade de Pokémon por geração:'),
    print_generation_summary(Summary).

answer_legendary_per_generation_summary_query :-
    findall(Generation-Count,
        ( between(1, 9, Generation),
          collect_generation_names(Generation, [], [only_legendary], Names),
          length(Names, Count)
        ),
        Summary),
    writeln('Bot: Quantidade de lendários/míticos por geração:'),
    print_generation_summary(Summary).

answer_mega_by_generation_query(Generation, TypeFilters, ContextFilters) :-
    ensure_filter_present(only_mega, ContextFilters, EffectiveFilters),
    collect_generation_names(Generation, TypeFilters, EffectiveFilters, Names),
    Names \= [],
    !,
    remember_candidate_list(Names),
    length(Names, Count),
    sample_names_text(Names, 10, SampleText),
    generation_type_query_text(Generation, TypeFilters, QueryText),
    format('Bot: Encontrei ~w formas Mega ~w.~n', [Count, QueryText]),
    format('  Exemplos: ~w~n', [SampleText]).
answer_mega_by_generation_query(Generation, TypeFilters, _) :-
    generation_type_query_text(Generation, TypeFilters, QueryText),
    format('Bot: Não encontrei formas Mega ~w.~n', [QueryText]).

answer_legendary_by_generation_query(Generation, TypeFilters, ContextFilters) :-
    ensure_filter_present(only_legendary, ContextFilters, EffectiveFilters),
    collect_generation_names(Generation, TypeFilters, EffectiveFilters, Names),
    Names \= [],
    !,
    remember_candidate_list(Names),
    length(Names, Count),
    sample_names_text(Names, 10, SampleText),
    generation_type_query_text(Generation, TypeFilters, QueryText),
    format('Bot: Encontrei ~w lendários/míticos ~w.~n', [Count, QueryText]),
    format('  Exemplos: ~w~n', [SampleText]).
answer_legendary_by_generation_query(Generation, TypeFilters, _) :-
    generation_type_query_text(Generation, TypeFilters, QueryText),
    format('Bot: Não encontrei lendários/míticos ~w.~n', [QueryText]).

answer_legendary_by_type_query(TypeFilters, ContextFilters) :-
    ensure_filter_present(only_legendary, ContextFilters, EffectiveFilters),
    collect_scoped_names(TypeFilters, EffectiveFilters, Names),
    Names \= [],
    !,
    remember_candidate_list(Names),
    length(Names, Count),
    type_filters_text(TypeFilters, FiltersText),
    sample_names_text(Names, 12, SampleText),
    format('Bot: Encontrei ~w lendários/míticos do tipo ~w no recorte atual.~n', [Count, FiltersText]),
    format('  Exemplos: ~w~n', [SampleText]).
answer_legendary_by_type_query(TypeFilters, _) :-
    type_filters_text(TypeFilters, FiltersText),
    format('Bot: Não encontrei lendários/míticos do tipo ~w no recorte atual.~n', [FiltersText]).

answer_generation_type_query(Generation, TypeFilters, ContextFilters) :-
    collect_generation_names(Generation, TypeFilters, ContextFilters, Names),
    Names \= [],
    !,
    remember_candidate_list(Names),
    length(Names, Count),
    sample_names_text(Names, 12, SampleText),
    generation_type_query_text(Generation, TypeFilters, QueryText),
    format('Bot: Encontrei ~w Pokémon ~w.~n', [Count, QueryText]),
    format('  Exemplos: ~w~n', [SampleText]).
answer_generation_type_query(Generation, TypeFilters, _) :-
    generation_type_query_text(Generation, TypeFilters, QueryText),
    format('Bot: Não encontrei Pokémon ~w.~n', [QueryText]).

answer_pokemon_by_generation_query(Generation, TypeFilters, ContextFilters) :-
    collect_generation_names(Generation, TypeFilters, ContextFilters, Names),
    Names \= [],
    !,
    remember_candidate_list(Names),
    length(Names, Count),
    sample_names_text(Names, 12, SampleText),
    generation_type_query_text(Generation, TypeFilters, QueryText),
    format('Bot: Existem ~w Pokémon ~w.~n', [Count, QueryText]),
    format('  Exemplos: ~w~n', [SampleText]).
answer_pokemon_by_generation_query(Generation, TypeFilters, _) :-
    generation_type_query_text(Generation, TypeFilters, QueryText),
    format('Bot: Não encontrei Pokémon ~w.~n', [QueryText]).

collect_generation_names(Generation, TypeFilters, ContextFilters, Names) :-
    findall(Name,
        ( pokemon(ID, Name, _Height, _Weight, Types, _Abilities, _Stats),
          generation_matches_id(Generation, ID),
          pokemon_matches_optional_type_filters(TypeFilters, Types),
          name_passes_filters(ContextFilters, Name)
        ),
        NamesRaw),
    sort(NamesRaw, Names).

collect_scoped_names(TypeFilters, ContextFilters, Names) :-
    findall(Name,
        ( pokemon_in_scope(_ID, Name, _Height, _Weight, Types, _Abilities, _Stats),
          pokemon_matches_optional_type_filters(TypeFilters, Types),
          name_passes_filters(ContextFilters, Name)
        ),
        NamesRaw),
    sort(NamesRaw, Names).

generation_matches_id(Generation, ID) :-
    pokemon_form_base(ID, BaseID),
    !,
    generation_matches_id(Generation, BaseID).
generation_matches_id(Generation, ID) :-
    pokemon_mega_base(ID, BaseID),
    !,
    generation_matches_id(Generation, BaseID).
generation_matches_id(Generation, ID) :-
    generation_range(Generation, MinID, MaxID),
    ID >= MinID,
    ID =< MaxID.

generation_type_query_text(Generation, [], Text) :-
    format(atom(Text), 'da geração ~w', [Generation]).
generation_type_query_text(Generation, TypeFilters, Text) :-
    TypeFilters \= [],
    type_filters_text(TypeFilters, FiltersText),
    format(atom(Text), 'do tipo ~w na geração ~w', [FiltersText, Generation]).

print_generation_summary([]).
print_generation_summary([Generation-Count | Rest]) :-
    format('  - Geração ~w: ~w~n', [Generation, Count]),
    print_generation_summary(Rest).

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

% ============================================================
% RESPOSTAS: NOVOS INTENTS (RANKING, EVOLUÇÃO, COBERTURA)
% ============================================================

answer_ranked_metric_query(Metric, Limit, Generation) :-
    ranked_metric_pairs(Metric, Generation, Pairs),
    Pairs \= [],
    take_first_n(Pairs, Limit, TopPairs),
    TopPairs \= [],
    !,
    extract_names_from_pairs(TopPairs, Names),
    remember_candidate_list(Names),
    ranked_metric_label(Metric, MetricLabel),
    generation_scope_text(Generation, ScopeText),
    writeln('Bot: Ranking encontrado:'),
    format('  Métrica: ~w (~w)~n', [MetricLabel, ScopeText]),
    print_ranked_metric_lines(Metric, TopPairs, 1).
answer_ranked_metric_query(Metric, _Limit, Generation) :-
    ranked_metric_label(Metric, MetricLabel),
    generation_scope_text(Generation, ScopeText),
    format('Bot: Não encontrei ranking de ~w no recorte ~w.~n', [MetricLabel, ScopeText]).

answer_bst_threshold_query(Comparator, Threshold, Generation) :-
    findall(Name,
        ( pokemon_in_scope(ID, Name, _Height, _Weight, _Types, _Abilities, Stats),
          generation_filter_matches(Generation, ID),
          total_stats_value(Stats, BST),
          bst_threshold_matches(Comparator, BST, Threshold)
        ),
        NamesRaw),
    sort(NamesRaw, Names),
    Names \= [],
    !,
    remember_candidate_list(Names),
    length(Names, Count),
    sample_names_text(Names, 12, SampleText),
    bst_comparator_text(Comparator, ComparatorText),
    generation_scope_text(Generation, ScopeText),
    format('Bot: Encontrei ~w Pokémon com BST ~w ~w (~w).~n', [Count, ComparatorText, Threshold, ScopeText]),
    format('  Exemplos: ~w~n', [SampleText]).
answer_bst_threshold_query(Comparator, Threshold, Generation) :-
    bst_comparator_text(Comparator, ComparatorText),
    generation_scope_text(Generation, ScopeText),
    format('Bot: Não encontrei Pokémon com BST ~w ~w (~w).~n', [ComparatorText, Threshold, ScopeText]).

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
    display_pokemon_name(NameAtom, NameLabel),
    writeln('Bot: Cadeia evolutiva completa:'),
    format('  Referência: ~w~n', [NameLabel]),
    print_chain_by_stage(StagePairs).
answer_evolution_chain_query(_) :-
    writeln('Bot: Não consegui identificar o Pokémon para montar a cadeia evolutiva.').

answer_type_coverage_query(TargetType) :-
    findall(Multiplier-AttackType,
        ( all_types(Types),
          member(AttackType, Types),
          combined_multiplier(AttackType, [TargetType], Multiplier),
          Multiplier > 1.0
        ),
        PairsRaw),
    keysort(PairsRaw, Asc),
    reverse(Asc, Desc),
    Desc \= [],
    !,
    display_type_label(TargetType, TargetLabel),
    take_first_n(Desc, 6, Top),
    coverage_pairs_text(Top, Text),
    format('Bot: Tipos que cobrem melhor ~w: ~w.~n', [TargetLabel, Text]).
answer_type_coverage_query(TargetType) :-
    display_type_label(TargetType, TargetLabel),
    format('Bot: Não encontrei cobertura super efetiva para o tipo ~w.~n', [TargetLabel]).

answer_double_weakness_query(AttackType) :-
    findall(Name,
        ( pokemon_in_scope(_, Name, _, _, Types, _, _),
          combined_multiplier(AttackType, Types, Multiplier),
          Multiplier >= 4.0
        ),
        NamesRaw),
    sort(NamesRaw, Names),
    length(Names, Count),
    display_type_label(AttackType, TypeLabel),
    format('Bot: Encontrei ~w Pokémon com dupla fraqueza (4x) a ~w.~n', [Count, TypeLabel]),
    ( Count > 0 ->
        remember_candidate_list(Names),
        sample_names_text(Names, 12, SampleText),
        format('  Exemplos: ~w~n', [SampleText])
    ; true
    ).

answer_most_immunities_query(Limit) :-
    findall(Count-Name,
        ( pokemon_in_scope(_, Name, _, _, Types, _, _),
          type_effectiveness_summary(Types, _Weak, _Resist, Immunities),
          length(Immunities, Count),
          Count > 0
        ),
        PairsRaw),
    keysort(PairsRaw, Asc),
    reverse(Asc, Desc),
    Desc \= [],
    !,
    take_first_n(Desc, Limit, Top),
    extract_names_from_pairs(Top, Names),
    remember_candidate_list(Names),
    writeln('Bot: Pokémon com mais imunidades:'),
    print_ranked_metric_lines(immunities, Top, 1).
answer_most_immunities_query(_) :-
    writeln('Bot: Não encontrei Pokémon com imunidades no recorte atual.').

answer_team_coverage_query :-
    greedy_coverage_team(6, Team),
    Team \= [],
    !,
    remember_candidate_list(Team),
    sample_names_text(Team, 6, TeamText),
    coverage_by_team(Team, CoveredTypes),
    length(CoveredTypes, CoveredCount),
    format('Bot: Time heurístico de cobertura (6): ~w.~n', [TeamText]),
    format('Bot: Esse time pressiona super efetivo ~w tipos diferentes.~n', [CoveredCount]).
answer_team_coverage_query :-
    writeln('Bot: Não consegui montar um time de cobertura no recorte atual.').

answer_multi_compare_query(Names) :-
    compare_candidates_ranked(Names, Ranked),
    Ranked \= [],
    !,
    remember_candidate_list(Names),
    writeln('Bot: Comparação rápida do grupo:'),
    print_multi_compare_lines(Ranked, 1).
answer_multi_compare_query(_) :-
    writeln('Bot: Não consegui comparar esse grupo de Pokémon.').

answer_rank_team_vs_target_query(TeamNames, TargetIdentifier) :-
    resolve_counter_target(TargetIdentifier, pokemon(TargetID, TargetName, _, _, TargetTypes, _, TargetStats), _),
    findall(Score-Name,
        ( member(Name, TeamNames),
          pokemon_in_scope(CandidateID, Name, _, _, CandidateTypes, _, CandidateStats),
          CandidateID =\= TargetID,
          counter_metrics(CandidateTypes, CandidateStats, TargetTypes, TargetStats, _AttackMult, _DefenseMult, AttackPressure, DefensePressure),
          Score is (AttackPressure * 2.5) - DefensePressure
        ),
        PairsRaw),
    keysort(PairsRaw, Asc),
    reverse(Asc, Ranked),
    Ranked \= [],
    !,
    display_pokemon_name(TargetName, TargetLabel),
    format('Bot: Ranking do seu time contra ~w:~n', [TargetLabel]),
    print_ranked_metric_lines(team_matchup, Ranked, 1).
answer_rank_team_vs_target_query(_, TargetIdentifier) :-
    display_pokemon_name(TargetIdentifier, TargetLabel),
    format('Bot: Não consegui ranquear seu time contra ~w com os nomes informados.~n', [TargetLabel]).

answer_best_team_member_vs_target_query(TeamNames, TargetIdentifier) :-
    answer_rank_team_vs_target_query(TeamNames, TargetIdentifier),
    resolve_counter_target(TargetIdentifier, pokemon(TargetID, _, _, _, TargetTypes, _, TargetStats), _),
    findall(Score-Name,
        ( member(Name, TeamNames),
          pokemon_in_scope(CandidateID, Name, _, _, CandidateTypes, _, CandidateStats),
          CandidateID =\= TargetID,
          counter_metrics(CandidateTypes, CandidateStats, TargetTypes, TargetStats, _AttackMult, _DefenseMult, AttackPressure, DefensePressure),
          Score is (AttackPressure * 2.5) - DefensePressure
        ),
        PairsRaw),
    keysort(PairsRaw, Asc),
    reverse(Asc, [BestScore-BestName | _]),
    display_pokemon_name(BestName, BestLabel),
    format('Bot: Melhor entrada do seu time nesse cenário: ~w (score ~2f).~n', [BestLabel, BestScore]).
answer_best_team_member_vs_target_query(_TeamNames, TargetIdentifier) :-
    display_pokemon_name(TargetIdentifier, TargetLabel),
    format('Bot: Não consegui apontar a melhor entrada do seu time contra ~w.~n', [TargetLabel]).

ranked_metric_pairs(Metric, Generation, OrderedPairs) :-
    findall(Value-Name,
        ( pokemon_in_scope(ID, Name, Height, Weight, _Types, _Abilities, Stats),
          generation_filter_matches(Generation, ID),
          ranked_metric_value(Metric, Height, Weight, Stats, Value)
        ),
        PairsRaw),
    keysort(PairsRaw, Asc),
    ( metric_sort_order(Metric, asc) -> OrderedPairs = Asc ; reverse(Asc, OrderedPairs) ).

ranked_metric_value(speed, _Height, _Weight, Stats, Value) :- member(speed-Value, Stats).
ranked_metric_value(defensive_bulk, _Height, _Weight, Stats, Value) :-
    member(hp-HP, Stats),
    member(defense-Def, Stats),
    member(special_defense-SpDef, Stats),
    Value is HP + Def + SpDef.
ranked_metric_value(physical_attack, _Height, _Weight, Stats, Value) :- member(attack-Value, Stats).
ranked_metric_value(special_attack, _Height, _Weight, Stats, Value) :- member(special_attack-Value, Stats).
ranked_metric_value(bst, _Height, _Weight, Stats, Value) :- total_stats_value(Stats, Value).
ranked_metric_value(tallest, Height, _Weight, _Stats, Height).
ranked_metric_value(shortest, Height, _Weight, _Stats, Height).
ranked_metric_value(heaviest, _Height, Weight, _Stats, Weight).
ranked_metric_value(lightest, _Height, Weight, _Stats, Weight).
ranked_metric_value(immunities, _Height, _Weight, _Stats, _Value) :- fail.
ranked_metric_value(team_matchup, _Height, _Weight, _Stats, _Value) :- fail.

metric_sort_order(shortest, asc).
metric_sort_order(lightest, asc).
metric_sort_order(_, desc).

ranked_metric_label(speed, 'velocidade').
ranked_metric_label(defensive_bulk, 'bulk defensivo (HP+Def+SpDef)').
ranked_metric_label(physical_attack, 'ataque físico').
ranked_metric_label(special_attack, 'ataque especial').
ranked_metric_label(bst, 'BST (soma dos status base)').
ranked_metric_label(tallest, 'altura (maiores)').
ranked_metric_label(shortest, 'altura (menores)').
ranked_metric_label(heaviest, 'peso (maiores)').
ranked_metric_label(lightest, 'peso (menores)').
ranked_metric_label(immunities, 'imunidades').
ranked_metric_label(team_matchup, 'matchup do time').

generation_scope_text(all, 'todas as gerações').
generation_scope_text(Generation, Text) :-
    format(atom(Text), 'geração ~w', [Generation]).

generation_filter_matches(all, _ID).
generation_filter_matches(Generation, ID) :-
    generation_matches_id(Generation, ID).

print_ranked_metric_lines(_Metric, [], _Index).
print_ranked_metric_lines(Metric, [Value-Name | Rest], Index) :-
    display_pokemon_name(Name, Label),
    ranked_metric_value_text(Metric, Value, ValueText),
    format('  ~w) ~w — ~w~n', [Index, Label, ValueText]),
    NextIndex is Index + 1,
    print_ranked_metric_lines(Metric, Rest, NextIndex).

ranked_metric_value_text(tallest, HeightDecimeters, Text) :-
    HeightMeters is HeightDecimeters / 10,
    format(atom(Text), '~1f m', [HeightMeters]).
ranked_metric_value_text(shortest, HeightDecimeters, Text) :-
    HeightMeters is HeightDecimeters / 10,
    format(atom(Text), '~1f m', [HeightMeters]).
ranked_metric_value_text(heaviest, WeightHectograms, Text) :-
    WeightKg is WeightHectograms / 10,
    format(atom(Text), '~1f kg', [WeightKg]).
ranked_metric_value_text(lightest, WeightHectograms, Text) :-
    WeightKg is WeightHectograms / 10,
    format(atom(Text), '~1f kg', [WeightKg]).
ranked_metric_value_text(team_matchup, Value, Text) :-
    format(atom(Text), 'score ~2f', [Value]).
ranked_metric_value_text(_, Value, Text) :-
    format(atom(Text), '~w', [Value]).

extract_names_from_pairs(Pairs, Names) :-
    findall(Name,
        member(_Value-Name, Pairs),
        Names).

bst_threshold_matches(ge, Value, Threshold) :- Value >= Threshold.
bst_threshold_matches(le, Value, Threshold) :- Value =< Threshold.

bst_comparator_text(ge, '>=').
bst_comparator_text(le, '<=').

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

coverage_pairs_text(Pairs, Text) :-
    maplist(coverage_pair_label, Pairs, Labels),
    atomic_list_concat(Labels, ', ', Text).

coverage_pair_label(Multiplier-Type, Label) :-
    display_type_label(Type, TypeLabel),
    multiplier_text(Multiplier, MultText),
    format(atom(Label), '~w (~w)', [TypeLabel, MultText]).

greedy_coverage_team(Size, Team) :-
    findall(Name,
        pokemon_in_scope(_ID, Name, _Height, _Weight, _Types, _Abilities, _Stats),
        NamesRaw),
    sort(NamesRaw, Names),
    greedy_coverage_team(Names, [], [], Size, Team).

greedy_coverage_team(_Pool, TeamAcc, _Covered, 0, Team) :-
    reverse(TeamAcc, Team),
    !.
greedy_coverage_team(Pool, TeamAcc, Covered, SlotsLeft, Team) :-
    best_coverage_pick(Pool, Covered, BestName, BestNewCovered),
    !,
    delete(Pool, BestName, RemainingPool),
    append(Covered, BestNewCovered, CoveredRaw),
    sort(CoveredRaw, UpdatedCovered),
    NextSlots is SlotsLeft - 1,
    greedy_coverage_team(RemainingPool, [BestName | TeamAcc], UpdatedCovered, NextSlots, Team).
greedy_coverage_team(_Pool, TeamAcc, _Covered, _SlotsLeft, Team) :-
    reverse(TeamAcc, Team).

best_coverage_pick(Pool, Covered, BestName, BestNewCovered) :-
    findall(NewCount-Name-NewCovered,
        ( member(Name, Pool),
          pokemon_info(Name, pokemon(_, _, _, _, Types, _, _)),
          offensive_coverage_types(Types, Coverage),
          subtract(Coverage, Covered, NewCovered),
          length(NewCovered, NewCount)
        ),
        Candidates),
    keysort(Candidates, Sorted),
    reverse(Sorted, [_BestCount-BestName-BestNewCovered | _]).

offensive_coverage_types(AttackTypes, CoveredTypes) :-
    all_types(TargetTypes),
    findall(TargetType,
        ( member(TargetType, TargetTypes),
          member(AttackType, AttackTypes),
          combined_multiplier(AttackType, [TargetType], Multiplier),
          Multiplier > 1.0
        ),
        CoveredRaw),
    sort(CoveredRaw, CoveredTypes).

coverage_by_team(TeamNames, CoveredTypes) :-
    findall(Type,
        ( member(Name, TeamNames),
          pokemon_info(Name, pokemon(_, _, _, _, Types, _, _)),
          offensive_coverage_types(Types, TeamCovered),
          member(Type, TeamCovered)
        ),
        CoveredRaw),
    sort(CoveredRaw, CoveredTypes).

compare_candidates_ranked(Names, Ranked) :-
    findall(BST-Name,
        ( member(Name, Names),
          pokemon_info(Name, pokemon(_, _, _, _, _, _, Stats)),
          total_stats_value(Stats, BST)
        ),
        PairsRaw),
    keysort(PairsRaw, Asc),
    reverse(Asc, Ranked).

print_multi_compare_lines([], _Index).
print_multi_compare_lines([BST-Name | Rest], Index) :-
    pokemon_info(Name, pokemon(_, _, _, _, Types, _, Stats)),
    compare_role_profile(Stats, RoleText, _Bucket),
    display_pokemon_name(Name, NameLabel),
    type_list_text(Types, TypeText),
    format('  ~w) ~w — BST ~w, tipos: ~w, perfil: ~w~n', [Index, NameLabel, BST, TypeText, RoleText]),
    Next is Index + 1,
    print_multi_compare_lines(Rest, Next).

counter_pair_passes_filters(Filters, _Score-Name-_AttackMult-_DefenseMult) :-
    name_passes_filters(Filters, Name).

% ============================================================
% RESPOSTAS: MATCHUP POR NÍVEL E FILTROS CONTEXTUAIS
% ============================================================

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
    resolve_counter_target(TargetName, pokemon(_, TargetAtom, _, _, TargetTypes, _, TargetStatsRaw), _),
    scale_stats_by_level(TargetStatsRaw, TargetLevel, TargetStats),
    findall(Score-Name-Winner-Turns,
        ( member(Name, RosterNames),
                    once(pokemon_info(Name, pokemon(_, NameAtom, _, _, Types, _, StatsRaw))),
          scale_stats_by_level(StatsRaw, OwnLevel, ScaledStats),
          battle_profile(Types, ScaledStats, TargetTypes, TargetStats, ProfileA),
          battle_profile(TargetTypes, TargetStats, Types, ScaledStats, ProfileB),
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
    writeln('Bot: Observação: é uma simulação aproximada por stats/tipos (sem moveset, item, habilidade ativa e clima).').
answer_level_matchup_from_roster(_, _, _, _) :-
    writeln('Bot: Não consegui avaliar esse cenário por nível com os dados informados.').

scale_stats_by_level([], _, []).
scale_stats_by_level([Stat-Value | Rest], Level, [Stat-Scaled | ScaledRest]) :-
    Factor is max(0.25, Level / 50.0),
    Scaled is max(1, round(Value * Factor)),
    scale_stats_by_level(Rest, Level, ScaledRest).

print_level_matchup_results([]).
print_level_matchup_results([_Score-Name-Winner-Turns | Rest]) :-
    display_pokemon_name(Name, NameLabel),
    ( Winner == win -> Verdict = 'chance boa de vitória'
    ; Verdict = 'duelo desfavorável'
    ),
    ( Turns =:= 1 -> TurnWord = 'turno' ; TurnWord = 'turnos' ),
    format('  - ~w: ~w (estimativa ~w ~w).~n', [NameLabel, Verdict, Turns, TurnWord]),
    print_level_matchup_results(Rest).

answer_filtered_counter_query(TypeFilters, TargetIdentifier) :-
    resolve_counter_target(TargetIdentifier, pokemon(TargetID, TargetName, _, _, TargetTypes, _, TargetStats), UsedFallback),
    type_pokemon_list(TypeFilters, CandidateNames),
    CandidateNames \= [],
    recommend_counters_from_candidates(CandidateNames, TargetID, TargetTypes, TargetStats, TopPairs),
    TopPairs \= [],
    !,
    display_pokemon_name(TargetName, TargetLabel),
    type_filters_text(TypeFilters, FiltersText),
    counter_pairs_text(TopPairs, CounterText),
    ( UsedFallback == true ->
        writeln('Bot: Ainda não tenho a ficha da forma especial alvo, então usei a forma base para análise.');
      true
    ),
    extract_counter_names(TopPairs, CounterNames),
    remember_candidate_list(CounterNames),
    format('Bot: Entre os Pokémon do tipo ~w, os com mais chances contra ~w são: ~w.~n', [FiltersText, TargetLabel, CounterText]).
answer_filtered_counter_query(TypeFilters, TargetIdentifier) :-
    resolve_counter_target(TargetIdentifier, pokemon(_, TargetName, _, _, _, _, _), _),
    !,
    type_filters_text(TypeFilters, FiltersText),
    display_pokemon_name(TargetName, TargetLabel),
    format('Bot: Não encontrei candidatos no grupo ~w com dados suficientes para comparar contra ~w.~n', [FiltersText, TargetLabel]).
answer_filtered_counter_query(TypeFilters, TargetIdentifier) :-
    writeln('Bot: Não consegui identificar o Pokémon alvo da comparação.'),
    print_suggestion_for_identifier(filtered_counter(TypeFilters), TargetIdentifier).

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
    format('Bot: Quem entra melhor contra ~w: ~w.~n', [TargetLabel, SwitchText]).
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
    format('Bot: Com os filtros aplicados, quem entra melhor contra ~w: ~w.~n', [TargetLabel, SwitchText]).
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
    pokemon_info(NameA, pokemon(_, NameAtomA, _, _, _, _, StatsA)),
    pokemon_info(NameB, pokemon(_, NameAtomB, _, _, _, _, StatsB)),
    !,
    answer_compare_query(NameA, NameB),
    display_pokemon_name(NameAtomA, LabelA),
    display_pokemon_name(NameAtomB, LabelB),
    compare_role_profile(StatsA, _, BucketA),
    compare_role_profile(StatsB, _, BucketB),
    ( BucketA == BucketB ->
        format('Bot: Para time, ~w e ~w disputam a mesma função principal. Escolha pelo matchup do meta do seu grupo.~n', [LabelA, LabelB])
    ; format('Bot: Para time, ~w e ~w tendem a cumprir funções diferentes e podem até se complementar.~n', [LabelA, LabelB])
    ).
answer_team_compare_query(NameA, NameB) :-
    writeln('Bot: Não consegui montar comparação de função para time.'),
    print_suggestion_for_pair(compare, NameA, NameB).

% ============================================================
% RESPOSTAS: TIPOLOGIA, COMPARAÇÃO E BATALHA
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
    pokemon_info(NameA, pokemon(_, NameAtomA, _, _, TypesA, _, StatsA)),
    pokemon_info(NameB, pokemon(_, NameAtomB, _, _, TypesB, _, StatsB)),
    !,
    display_pokemon_name(NameAtomA, LabelA),
    display_pokemon_name(NameAtomB, LabelB),
    best_attack_between_types(TypesA, TypesB, AttackAB),
    best_attack_between_types(TypesB, TypesA, AttackBA),
    defensive_pressure_between_types(TypesA, TypesB, DefenseAB),
    defensive_pressure_between_types(TypesB, TypesA, DefenseBA),
    total_stats_value(StatsA, TotalA),
    total_stats_value(StatsB, TotalB),
    compare_role_profile(StatsA, RoleA, BucketA),
    compare_role_profile(StatsB, RoleB, BucketB),
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
    print_role_comparison_note(BucketA, BucketB, LabelA, LabelB).
answer_compare_query(NameA, NameB) :-
    writeln('Bot: Não consegui comparar esses dois Pokémon. Tente: "compare charizard vs blastoise".'),
    print_suggestion_for_pair(compare, NameA, NameB).

compare_role_profile(Stats, RoleText, Bucket) :-
    stat_value(Stats, hp, HP),
    stat_value(Stats, attack, Atk),
    stat_value(Stats, defense, Def),
    stat_value(Stats, special_attack, SpAtk),
    stat_value(Stats, special_defense, SpDef),
    stat_value(Stats, speed, Speed),
    Offense is max(Atk, SpAtk),
    Bulk is (HP + Def + SpDef) / 3.0,
    ( Offense >= 125, Speed >= 95, Bulk < 95 ->
        Role = sweeper,
        Bucket = offensive
    ; Bulk >= 110, Offense < 125 ->
        Role = tank,
        Bucket = defensive
    ; Offense >= 120, Speed >= 80 ->
        Role = wallbreaker,
        Bucket = offensive
    ; Speed >= 120, Offense < 110 ->
        Role = fast_support,
        Bucket = support
    ; Role = balanced,
      Bucket = balanced
    ),
    role_label(Role, RoleText).

role_label(sweeper, 'Sweeper (foco em dano e velocidade)').
role_label(tank, 'Tank (foco em resistência e trocas seguras)').
role_label(wallbreaker, 'Wallbreaker (quebra defesas com alta pressão ofensiva)').
role_label(fast_support, 'Suporte veloz (impacta mais por utilidade e ritmo)').
role_label(balanced, 'Equilibrado (perfil misto sem extremo dominante)').

print_role_comparison_note(BucketA, BucketB, LabelA, LabelB) :-
    ( BucketA == BucketB ->
        format('  - Leitura final: ambos têm classe tática parecida, comparação mais direta (~w vs ~w).~n', [LabelA, LabelB])
    ; format('  - Leitura final: são classes táticas diferentes; compare por função de time, não só por número bruto.~n', [])
    ).

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

answer_battle_sim_query(NameA, NameB) :-
    pokemon_info(NameA, pokemon(_, NameAtomA, _, _, TypesA, _, StatsA)),
    pokemon_info(NameB, pokemon(_, NameAtomB, _, _, TypesB, _, StatsB)),
    !,
    display_pokemon_name(NameAtomA, LabelA),
    display_pokemon_name(NameAtomB, LabelB),
    battle_profile(TypesA, StatsA, TypesB, StatsB, ProfileA),
    battle_profile(TypesB, StatsB, TypesA, StatsA, ProfileB),
    simulate_duel(ProfileA, ProfileB, WinnerSide, Turns),
    ( WinnerSide == a -> WinnerLabel = LabelA ; WinnerLabel = LabelB ),
    remember_candidate_list([NameAtomA, NameAtomB]),
    profile_mode_text(ProfileA.mode, ModeAText),
    profile_mode_text(ProfileB.mode, ModeBText),
    multiplier_text(ProfileA.multiplier, MultAText),
    multiplier_text(ProfileB.multiplier, MultBText),
    ( Turns =:= 1 -> TurnWord = 'turno' ; TurnWord = 'turnos' ),
    format('Bot: Simulação teórica 1x1 entre ~w e ~w:~n', [LabelA, LabelB]),
    format('  - ~w tende a atacar pelo lado ~w (~w, dano ~1f/turno).~n', [LabelA, ModeAText, MultAText, ProfileA.damage]),
    format('  - ~w tende a atacar pelo lado ~w (~w, dano ~1f/turno).~n', [LabelB, ModeBText, MultBText, ProfileB.damage]),
    format('  - Vencedor provável: ~w (em cerca de ~w ~w).~n', [WinnerLabel, Turns, TurnWord]),
    writeln('Bot: Observação: é uma aproximação sem moves específicos, itens, clima e boosts.').
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

battle_profile(AttackerTypes, AttackerStats, DefenderTypes, DefenderStats, profile{mode:Mode, multiplier:Multiplier, damage:Damage, hp:HP, speed:Speed}) :-
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
    ).

stab_bonus([], 1.0).
stab_bonus(_, 1.5).

simulate_duel(ProfileA, ProfileB, WinnerSide, Turns) :-
    HitsAToB is ceiling(ProfileB.hp / max(1.0, ProfileA.damage)),
    HitsBToA is ceiling(ProfileA.hp / max(1.0, ProfileB.damage)),
    ( ProfileA.speed > ProfileB.speed ->
        decide_winner_with_order(HitsAToB, HitsBToA, a, Winner, Turns)
    ; ProfileB.speed > ProfileA.speed ->
        decide_winner_with_order(HitsAToB, HitsBToA, b, Winner, Turns)
    ; ( ProfileA.damage >= ProfileB.damage ->
            decide_winner_with_order(HitsAToB, HitsBToA, a, Winner, Turns)
        ; decide_winner_with_order(HitsAToB, HitsBToA, b, Winner, Turns)
      )
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
    atomic_list_concat(Items, ', ', Text).

switch_pair_text(_Score-Name-DefenseMult-Bulk, Text) :-
    display_pokemon_name(Name, NameLabel),
    multiplier_text(DefenseMult, DefenseText),
    format(atom(Text), '~w (recebe até ~w / bulk ~w)', [NameLabel, DefenseText, Bulk]).

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

extract_counter_names(CounterPairs, Names) :-
    findall(Name,
        member(_Score-Name-_AttackMult-_DefenseMult, CounterPairs),
        NamesRaw),
    sort(NamesRaw, Names).

remember_candidate_list(Names) :-
    retractall(last_list_candidates(_)),
    assertz(last_list_candidates(Names)).

resolve_counter_target(TargetIdentifier, Pokemon, false) :-
    pokemon_info(TargetIdentifier, Pokemon),
    !.
resolve_counter_target(TargetIdentifier, Pokemon, true) :-
    mega_base_identifier(TargetIdentifier, BaseIdentifier),
    pokemon_info(BaseIdentifier, Pokemon).

mega_base_identifier(Identifier, BaseIdentifier) :-
    downcase_atom(Identifier, IdentifierAtom),
    atomic_list_concat([BaseAtom | _], '_mega_', IdentifierAtom),
    BaseAtom \= IdentifierAtom,
    atom_string(BaseAtom, BaseIdentifier).

recommend_counters(TargetID, TargetTypes, TargetStats, TopPairs) :-
    findall(Score-Name-AttackMult-DefenseMult,
                ( pokemon_in_scope(CandidateID, Name, _, _, CandidateTypes, _, CandidateStats),
          CandidateID =\= TargetID,
                    counter_metrics(CandidateTypes, CandidateStats, TargetTypes, TargetStats, AttackMult, DefenseMult, AttackPressure, DefensePressure),
          AttackMult > 1.0,
                    Score is (AttackPressure * 2.5) - DefensePressure
        ),
        PairsRaw),
    keysort(PairsRaw, PairsAsc),
    reverse(PairsAsc, PairsDescRaw),
    dedupe_counter_pairs_by_name(PairsDescRaw, PairsDesc),
    take_first_n(PairsDesc, 6, TopPairs).

recommend_counters_from_candidates(CandidateNames, TargetID, TargetTypes, TargetStats, TopPairs) :-
    findall(Score-Name-AttackMult-DefenseMult,
        ( member(Name, CandidateNames),
          pokemon_in_scope(CandidateID, Name, _, _, CandidateTypes, _, Stats),
          CandidateID =\= TargetID,
                    counter_metrics(CandidateTypes, Stats, TargetTypes, TargetStats, AttackMult, DefenseMult, AttackPressure, DefensePressure),
                    Score is (AttackPressure * 2.5) - DefensePressure
        ),
        PairsRaw),
    keysort(PairsRaw, PairsAsc),
    reverse(PairsAsc, PairsDescRaw),
    dedupe_counter_pairs_by_name(PairsDescRaw, PairsDesc),
    take_first_n(PairsDesc, 6, TopPairs).

dedupe_counter_pairs_by_name(Pairs, UniquePairs) :-
    dedupe_counter_pairs_by_name(Pairs, [], Rev),
    reverse(Rev, UniquePairs).

dedupe_counter_pairs_by_name([], _Seen, []).
dedupe_counter_pairs_by_name([Score-Name-AttackMult-DefenseMult | Rest], Seen, Acc) :-
    ( memberchk(Name, Seen) ->
        dedupe_counter_pairs_by_name(Rest, Seen, Acc)
    ; dedupe_counter_pairs_by_name(Rest, [Name | Seen], Tail),
      Acc = [Score-Name-AttackMult-DefenseMult | Tail]
    ).

total_stats_value(Stats, Total) :-
    findall(Value, member(_Stat-Value, Stats), Values),
    sum_list(Values, Total).

counter_metrics(CandidateTypes, CandidateStats, TargetTypes, TargetStats, AttackMult, DefenseMult, AttackPressure, DefensePressure) :-
    findall(Attack,
        ( member(CandidateType, CandidateTypes),
          combined_multiplier(CandidateType, TargetTypes, Attack)
        ),
        AttackValues),
    max_list(AttackValues, AttackMult),
    findall(Defense,
        ( member(TargetType, TargetTypes),
          combined_multiplier(TargetType, CandidateTypes, Defense)
        ),
        DefenseValues),
    max_list(DefenseValues, DefenseMult),
    attacking_stat_value(CandidateStats, CandidateAttackStat),
    defending_stat_against(CandidateStats, TargetStats, CandidateDefenseStat),
    attacking_stat_value(TargetStats, TargetAttackStat),
    target_defense_against(TargetStats, CandidateStats, TargetDefenseStat),
    AttackPressure is AttackMult * (CandidateAttackStat / max(1.0, TargetDefenseStat)),
    DefensePressure is DefenseMult * (TargetAttackStat / max(1.0, CandidateDefenseStat)).

attacking_stat_value(Stats, Value) :-
    member(attack-Atk, Stats),
    member(special_attack-SpAtk, Stats),
    ( Atk >= SpAtk + 10 -> Value = Atk
    ; SpAtk >= Atk + 10 -> Value = SpAtk
    ; Value is (Atk + SpAtk) / 2.0
    ).

defending_stat_against(CandidateStats, TargetStats, Value) :-
    offensive_bias(TargetStats, Bias),
    defense_value_for_bias(CandidateStats, Bias, Value).

target_defense_against(TargetStats, CandidateStats, Value) :-
    offensive_bias(CandidateStats, Bias),
    defense_value_for_bias(TargetStats, Bias, Value).

offensive_bias(Stats, physical) :-
    member(attack-Atk, Stats),
    member(special_attack-SpAtk, Stats),
    Atk >= SpAtk + 10,
    !.
offensive_bias(Stats, special) :-
    member(attack-Atk, Stats),
    member(special_attack-SpAtk, Stats),
    SpAtk >= Atk + 10,
    !.
offensive_bias(_, mixed).

defense_value_for_bias(Stats, physical, Value) :-
    member(defense-Value, Stats),
    !.
defense_value_for_bias(Stats, special, Value) :-
    member(special_defense-Value, Stats),
    !.
defense_value_for_bias(Stats, mixed, Value) :-
    member(defense-Def, Stats),
    member(special_defense-SpDef, Stats),
    Value is (Def + SpDef) / 2.0.

counter_pairs_text(CounterPairs, Text) :-
    maplist(counter_pair_text, CounterPairs, Items),
    atomic_list_concat(Items, ', ', Text).

counter_pair_text(_Score-Name-AttackMult-DefenseMult, Text) :-
    display_pokemon_name(Name, NameLabel),
    multiplier_text(AttackMult, AttackText),
    multiplier_text(DefenseMult, DefenseText),
    format(atom(Text), '~w (bate ~w / recebe até ~w)', [NameLabel, AttackText, DefenseText]).

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
        findall(Name,
        ( pokemon_in_scope(_, Name, _, _, Types, _, _),
                    member(Type, Types)
                ),
                NamesRaw),
    sort(NamesRaw, UniqueNames),
    length(UniqueNames, Count).

type_pokemon_list(TypeFilters, Names) :-
    findall(Name,
        ( pokemon_in_scope(_, Name, _, _, Types, _, _),
          pokemon_matches_type_filters(TypeFilters, Types)
        ),
        NamesRaw),
    sort(NamesRaw, Names).

pokemon_matches_type_filters([], _).
pokemon_matches_type_filters([Type | Rest], PokemonTypes) :-
    member(Type, PokemonTypes),
    pokemon_matches_type_filters(Rest, PokemonTypes).

ability_pokemon_list(Ability, Names) :-
    findall(Name,
        ( pokemon_in_scope(_, Name, _, _, _, Abilities, _),
          member(Ability, Abilities)
        ),
        NamesRaw),
    sort(NamesRaw, Names).

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

sample_names_text(Names, Limit, Text) :-
    take_first_n(Names, Limit, Sample),
    maplist(display_pokemon_name, Sample, Labels),
    atomic_list_concat(Labels, ', ', Text).

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
    format('  Fraquezas: ~w~n', [WeakText]),
    format('  Resistências: ~w~n', [ResistText]),
    format('  Imunidades: ~w~n', [ImmunityText]),
    format('  Descrição: ~w~n', [Description]),
    format('  Lore: ~w~n', [LoreText]),
    writeln('  Status base:'),
    print_stats(Stats).

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
