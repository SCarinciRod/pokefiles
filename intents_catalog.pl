% ============================================================
% CATALOGO DE REGRAS DE INTENT
% Contem apenas regras de mapeamento parse -> acao.
% ============================================================

resolve_intent_rule(Text, _Tokens, true, _Mode) :-
    handle_pending_confirmation(Text).
resolve_intent_rule(Text, _Tokens, true, _Mode) :-
    handle_pending_level_roster(Text).
resolve_intent_rule(Text, _Tokens, true, _Mode) :-
    handle_pending_counter_preferences(Text).
resolve_intent_rule(Text, _Tokens, true, _Mode) :-
    handle_pending_type_preferences(Text).
resolve_intent_rule(Text, _Tokens, true, _Mode) :-
    handle_pending_list_preferences(Text).
resolve_intent_rule(Text, _Tokens, true, _Mode) :-
    handle_pending_rank_focus(Text).
resolve_intent_rule(Text, _Tokens, true, _Mode) :-
    handle_pending_held_item_options(Text).
resolve_intent_rule(Text, _Tokens, true, _Mode) :-
    handle_pending_partner_preferences(Text).
resolve_intent_rule(Text, _Tokens, true, _Mode) :-
    handle_pending_partner_options(Text).
resolve_intent_rule(Text, _Tokens, true, _Mode) :-
    handle_pending_synergy_details(Text).

resolve_intent_rule(Text, Tokens, Goal, Mode) :-
    allow_guard(Mode, item_move_ability_conflict_signal, Tokens),
    resolve_item_move_ability_by_evidence(Text, Tokens, Goal),
    !.
resolve_intent_rule(Text, Tokens, Goal, Mode) :-
    allow_guard(Mode, strategy_rules_conflict_signal, Tokens),
    resolve_strategy_rules_by_evidence(Text, Tokens, Goal),
    !.

resolve_intent_rule(Text, _Tokens, answer_pokemon(Number), _Mode) :-
    parse_info_by_number(Text, Number).
resolve_intent_rule(Text, _Tokens, answer_pokemon(Name), _Mode) :-
    parse_info_by_name(Text, Name).

resolve_intent_rule(Text, Tokens, answer_tournament_rules_query(Topic), Mode) :-
    allow_guard(Mode, tournament_rules_domain_signal, Tokens),
    \+ strategy_domain_signal(Tokens),
    parse_tournament_rules_query(Text, Topic).

resolve_intent_rule(Text, Tokens, answer_pair_synergy_query(NameA, NameB), Mode) :-
    allow_guard(Mode, strategy_domain_signal, Tokens),
    parse_pair_synergy_query(Text, NameA, NameB).

resolve_intent_rule(Text, Tokens, answer_compatible_partners_query(Name, Limit), Mode) :-
    allow_guard(Mode, strategy_domain_signal, Tokens),
    \+ item_domain_signal(Tokens),
    parse_compatible_partners_query(Text, Name, Limit).

resolve_intent_rule(Text, Tokens, answer_doubles_strategy_query(Topic), Mode) :-
    allow_guard(Mode, strategy_domain_signal, Tokens),
    parse_doubles_strategy_query(Text, Topic).

resolve_intent_rule(Text, Tokens, answer_evolution_should_have_query(Name, CurrentLevel), Mode) :-
    allow_guard(Mode, evolution_domain_signal, Tokens),
    allow_guard(Mode, level_domain_signal, Tokens),
    parse_evolution_should_have_query(Text, Name, CurrentLevel).

resolve_intent_rule(Text, Tokens, answer_level1_with_modifiers(Level1Intent, Modifiers), Mode) :-
    allow_guard(Mode, modifier_domain_signal, Tokens),
    parse_level1_with_modifiers_query(Text, Level1Intent, Modifiers).
resolve_intent_rule(Text, Tokens, answer_level2_only_composed_query(ModeName, Modifiers), Mode) :-
    allow_guard(Mode, modifier_domain_signal, Tokens),
    parse_level2_only_composed_query(Text, ModeName, Modifiers).
resolve_intent_rule(Text, Tokens, answer_level_matchup_query(Text, TargetName, TargetLevel, OwnLevel), Mode) :-
    allow_guard(Mode, level_domain_signal, Tokens),
    parse_level_matchup_query(Text, TargetName, TargetLevel, OwnLevel).
resolve_intent_rule(Text, Tokens, answer_counter_composed_query(TargetName, Generation, TypeFilters, ContextFilters, MaxLevel), Mode) :-
    allow_guard(Mode, counter_domain_signal, Tokens),
    allow_guard(Mode, modifier_domain_signal, Tokens),
    parse_counter_composed_query(Text, TargetName, Generation, TypeFilters, ContextFilters, MaxLevel).
resolve_intent_rule(Text, Tokens, answer_counter_level_cap_query_with_clarification(TargetName, MaxLevel), Mode) :-
    allow_guard(Mode, counter_domain_signal, Tokens),
    allow_guard(Mode, level_domain_signal, Tokens),
    parse_counter_level_cap_query(Text, TargetName, MaxLevel).

resolve_intent_rule(Text, Tokens, answer_megas_per_generation_summary_query, Mode) :-
    allow_guard(Mode, generation_domain_signal, Tokens),
    parse_megas_per_generation_summary_query(Text).
resolve_intent_rule(Text, Tokens, answer_pokemon_per_generation_summary_query, Mode) :-
    allow_guard(Mode, generation_domain_signal, Tokens),
    parse_pokemon_per_generation_summary_query(Text).
resolve_intent_rule(Text, Tokens, answer_legendary_per_generation_summary_query, Mode) :-
    allow_guard(Mode, generation_domain_signal, Tokens),
    parse_legendary_per_generation_summary_query(Text).
resolve_intent_rule(Text, Tokens, answer_mega_by_generation_query(Generation, TypeFilters, ContextFilters), Mode) :-
    allow_guard(Mode, generation_domain_signal, Tokens),
    parse_mega_by_generation_query(Text, Generation, TypeFilters, ContextFilters).
resolve_intent_rule(Text, Tokens, answer_legendary_by_generation_query(Generation, TypeFilters, ContextFilters), Mode) :-
    allow_guard(Mode, generation_domain_signal, Tokens),
    parse_legendary_by_generation_query(Text, Generation, TypeFilters, ContextFilters).
resolve_intent_rule(Text, _Tokens, answer_legendary_by_type_query(TypeFilters, ContextFilters), _Mode) :-
    parse_legendary_by_type_query(Text, TypeFilters, ContextFilters).

resolve_intent_rule(Text, Tokens, answer_ranked_metric_needs_focus_query(Role, Limit, Generation), Mode) :-
    allow_guard(Mode, ranking_domain_signal, Tokens),
    parse_ranked_metric_needs_focus_query(Text, Role, Limit, Generation).
resolve_intent_rule(Text, Tokens, answer_ranked_metric_invalid_generation(Metric), Mode) :-
    allow_guard(Mode, ranking_domain_signal, Tokens),
    parse_ranked_metric_query_invalid_generation(Text, Metric).
resolve_intent_rule(Text, Tokens, answer_ranked_metric_query(Metric, Limit, Generation), Mode) :-
    allow_guard(Mode, ranking_domain_signal, Tokens),
    parse_ranked_metric_query(Text, Metric, Limit, Generation).

resolve_intent_rule(Text, Tokens, answer_generation_type_query(Generation, TypeFilters, ContextFilters), Mode) :-
    allow_guard(Mode, generation_domain_signal, Tokens),
    parse_generation_type_query(Text, Generation, TypeFilters, ContextFilters).
resolve_intent_rule(Text, Tokens, answer_pokemon_by_generation_query(Generation, TypeFilters, ContextFilters), Mode) :-
    allow_guard(Mode, generation_domain_signal, Tokens),
    parse_pokemon_by_generation_query(Text, Generation, TypeFilters, ContextFilters).

resolve_intent_rule(Text, _Tokens, answer_mega_count_query, _Mode) :-
    parse_mega_count_query(Text).
resolve_intent_rule(Text, Tokens, answer_evolution_count_query(Method), Mode) :-
    allow_guard(Mode, evolution_domain_signal, Tokens),
    parse_evolution_count_query(Text, Method).
resolve_intent_rule(Text, Tokens, answer_bst_threshold_query(Comparator, Threshold, Generation), Mode) :-
    allow_guard(Mode, ranking_domain_signal, Tokens),
    parse_bst_threshold_query(Text, Comparator, Threshold, Generation).
resolve_intent_rule(Text, Tokens, answer_evolution_structure_query(Kind, Generation), Mode) :-
    allow_guard(Mode, evolution_domain_signal, Tokens),
    parse_evolution_structure_query(Text, Kind, Generation).
resolve_intent_rule(Text, Tokens, answer_evolution_chain_query(Name), Mode) :-
    allow_guard(Mode, evolution_domain_signal, Tokens),
    parse_evolution_chain_query(Text, Name).
resolve_intent_rule(Text, _Tokens, answer_type_coverage_query(TargetType), _Mode) :-
    parse_type_coverage_query(Text, TargetType).
resolve_intent_rule(Text, _Tokens, answer_double_weakness_query(AttackType), _Mode) :-
    parse_double_weakness_query(Text, AttackType).
resolve_intent_rule(Text, _Tokens, answer_most_immunities_query(Limit), _Mode) :-
    parse_most_immunities_query(Text, Limit).
resolve_intent_rule(Text, _Tokens, answer_team_coverage_query, _Mode) :-
    parse_team_coverage_query(Text).
resolve_intent_rule(Text, _Tokens, answer_rank_team_vs_target_query(TeamNames, TargetName), _Mode) :-
    parse_rank_team_vs_target_query(Text, TeamNames, TargetName).
resolve_intent_rule(Text, _Tokens, answer_best_team_member_vs_target_query(TeamNames, TargetName), _Mode) :-
    parse_best_team_member_vs_target_query(Text, TeamNames, TargetName).

resolve_intent_rule(Text, Tokens, answer_best_switch_query_with_clarification(TargetName), Mode) :-
    allow_guard(Mode, type_domain_signal, Tokens),
    parse_best_switch_query(Text, TargetName).
resolve_intent_rule(Text, Tokens, answer_weak_against_type_query_with_clarification(TypeFilters), Mode) :-
    allow_guard(Mode, type_domain_signal, Tokens),
    parse_weak_against_type_query(Text, TypeFilters).
resolve_intent_rule(Text, Tokens, answer_immunity_type_query_with_clarification(TypeFilters), Mode) :-
    allow_guard(Mode, type_domain_signal, Tokens),
    parse_immunity_type_query(Text, TypeFilters).
resolve_intent_rule(Text, Tokens, answer_role_type_query(RoleKey, TypeFilters), Mode) :-
    allow_guard(Mode, type_domain_signal, Tokens),
    parse_role_type_query(Text, RoleKey, TypeFilters).

resolve_intent_rule(Text, Tokens, answer_counter_with_filters_query(TargetName, ContextFilters), Mode) :-
    allow_guard(Mode, counter_domain_signal, Tokens),
    parse_counter_with_filters_query(Text, TargetName, ContextFilters).
resolve_intent_rule(Text, Tokens, answer_counter_with_all_filters(TargetName, TypeFilters, ContextFilters), Mode) :-
    allow_guard(Mode, counter_domain_signal, Tokens),
    parse_counter_compound_query(Text, TargetName, TypeFilters, ContextFilters).
resolve_intent_rule(Text, Tokens, answer_filtered_counter_query(TypeFilters, TargetName), Mode) :-
    allow_guard(Mode, counter_domain_signal, Tokens),
    parse_filtered_counter_query(Text, TypeFilters, TargetName).
resolve_intent_rule(Text, Tokens, answer_counter_query_with_clarification(TargetName), Mode) :-
    allow_guard(Mode, counter_domain_signal, Tokens),
    parse_counter_query(Text, TargetName).

resolve_intent_rule(Text, _Tokens, answer_context_filter_query(ContextFilters), _Mode) :-
    parse_context_filter_query(Text, ContextFilters).
resolve_intent_rule(Text, Tokens, answer_team_compare_query(NameA, NameB), Mode) :-
    allow_guard(Mode, compare_or_battle_domain_signal, Tokens),
    parse_team_compare_query(Text, NameA, NameB).
resolve_intent_rule(Text, Tokens, answer_multi_compare_query(Names), Mode) :-
    allow_guard(Mode, compare_or_battle_domain_signal, Tokens),
    parse_multi_compare_query(Text, Names).
resolve_intent_rule(Text, Tokens, answer_compare_query(NameA, NameB), Mode) :-
    allow_guard(Mode, compare_or_battle_domain_signal, Tokens),
    parse_compare_query(Text, NameA, NameB).
resolve_intent_rule(Text, Tokens, answer_battle_sim_query(NameA, NameB), Mode) :-
    allow_guard(Mode, compare_or_battle_domain_signal, Tokens),
    parse_battle_sim_query(Text, NameA, NameB).
resolve_intent_rule(Text, _Tokens, answer_ambiguous_two_pokemon_query(NameA, NameB), _Mode) :-
    parse_ambiguous_two_pokemon_query(Text, NameA, NameB).

resolve_intent_rule(Text, Tokens, answer_count_without_type_query(TypeFilters), Mode) :-
    allow_guard(Mode, type_domain_signal, Tokens),
    parse_count_without_type_query(Text, TypeFilters).
resolve_intent_rule(Text, Tokens, answer_type_query_with_clarification(TypeFilters), Mode) :-
    allow_guard(Mode, type_domain_signal, Tokens),
    parse_type_query(Text, TypeFilters).
resolve_intent_rule(Text, Tokens, answer_type_query_with_clarification(TypeFilters), Mode) :-
    allow_guard(Mode, type_domain_signal, Tokens),
    parse_natural_type_query(Text, TypeFilters).

resolve_intent_rule(Text, Tokens, answer_held_item_recommendation_query(Name, Strategy), Mode) :-
    allow_guard(Mode, item_domain_signal, Tokens),
    parse_held_item_recommendation_query(Text, Name, Strategy).
resolve_intent_rule(Text, Tokens, answer_specific_item_query(Item), Mode) :-
    allow_guard(Mode, item_domain_signal, Tokens),
    parse_specific_item_query(Text, Item).
resolve_intent_rule(Text, Tokens, answer_specific_move_query(Move), Mode) :-
    allow_guard(Mode, move_or_ability_domain_signal, Tokens),
    parse_specific_move_query(Text, Move).
resolve_intent_rule(Text, Tokens, answer_pokemon_movelist_query(Name), Mode) :-
    allow_guard(Mode, move_or_ability_domain_signal, Tokens),
    parse_pokemon_movelist_query(Text, Name).
resolve_intent_rule(Text, Tokens, answer_global_move_list_query, Mode) :-
    allow_guard(Mode, move_or_ability_domain_signal, Tokens),
    parse_move_list_query(Text).
resolve_intent_rule(Text, Tokens, answer_pokemon_ability_details_query(Name), Mode) :-
    allow_guard(Mode, move_or_ability_domain_signal, Tokens),
    parse_pokemon_ability_details_query(Text, Name).
resolve_intent_rule(Text, Tokens, answer_ability_query(Ability), Mode) :-
    allow_guard(Mode, move_or_ability_domain_signal, Tokens),
    parse_ability_query(Text, Ability).

resolve_intent_rule(Text, Tokens, answer_status_full_query(Stat), Mode) :-
    allow_guard(Mode, status_domain_signal, Tokens),
    parse_status_full_query(Text, Stat).
resolve_intent_rule(Text, Tokens, answer_status_query(Stat), Mode) :-
    allow_guard(Mode, status_domain_signal, Tokens),
    parse_status_query(Text, Stat).
resolve_intent_rule(Text, Tokens, answer_evolution_level_query(Name), Mode) :-
    allow_guard(Mode, evolution_domain_signal, Tokens),
    parse_evolution_level_query(Text, Name).
resolve_intent_rule(Text, _Tokens, answer_contextual_stat_query(Stats), _Mode) :-
    parse_contextual_stat_query(Text, Stats).

resolve_intent_rule(Text, _Tokens, answer_pokemon(NaturalName), _Mode) :-
    parse_natural_pokemon_query(Text, NaturalName).

resolve_item_move_ability_by_evidence(Text, Tokens, Goal) :-
    findall(Score-CandidateGoal,
        item_move_ability_candidate_goal(Text, Tokens, Score, CandidateGoal),
        Candidates),
    Candidates \= [],
    keysort(Candidates, Sorted),
    reverse(Sorted, [_BestScore-Goal | _]).

item_move_ability_candidate_goal(Text, Tokens, Score, answer_held_item_recommendation_query(Name, Strategy)) :-
    parse_held_item_recommendation_query(Text, Name, Strategy),
    item_evidence_strength(Tokens, ItemEvidence),
    score_if_true(token_member_any(Tokens, ["melhor", "combina", "cobrir", "fraqueza", "ofensivo", "defensivo", "balanceado", "balanced", "forte", "segurar"]), 24, StrategyCue),
    Score is 120 + ItemEvidence + StrategyCue.
item_move_ability_candidate_goal(Text, Tokens, Score, answer_specific_item_query(Item)) :-
    parse_specific_item_query(Text, Item),
    item_evidence_strength(Tokens, ItemEvidence),
    score_if_true(detail_query_signal(Tokens), 28, DetailCue),
    ( parse_natural_pokemon_query(Text, _) -> ContextAdj = -6 ; ContextAdj = 8 ),
    Score is 108 + ItemEvidence + DetailCue + ContextAdj.
item_move_ability_candidate_goal(Text, Tokens, Score, answer_specific_move_query(Move)) :-
    parse_specific_move_query(Text, Move),
    move_evidence_strength(Tokens, MoveEvidence),
    score_if_true(detail_query_signal(Tokens), 26, DetailCue),
    Score is 104 + MoveEvidence + DetailCue.
item_move_ability_candidate_goal(Text, Tokens, Score, answer_pokemon_movelist_query(Name)) :-
    parse_pokemon_movelist_query(Text, Name),
    move_evidence_strength(Tokens, MoveEvidence),
    score_if_true(list_request_signal(Tokens), 26, ListCue),
    Score is 90 + MoveEvidence + ListCue.
item_move_ability_candidate_goal(Text, Tokens, Score, answer_global_move_list_query) :-
    parse_move_list_query(Text),
    move_evidence_strength(Tokens, MoveEvidence),
    score_if_true(list_request_signal(Tokens), 30, ListCue),
    Score is 84 + MoveEvidence + ListCue.
item_move_ability_candidate_goal(Text, Tokens, Score, answer_pokemon_ability_details_query(Name)) :-
    parse_pokemon_ability_details_query(Text, Name),
    ability_evidence_strength(Tokens, AbilityEvidence),
    score_if_true(detail_query_signal(Tokens), 18, DetailCue),
    Score is 112 + AbilityEvidence + DetailCue.
item_move_ability_candidate_goal(Text, Tokens, Score, answer_ability_query(Ability)) :-
    parse_ability_query(Text, Ability),
    ability_evidence_strength(Tokens, AbilityEvidence),
    score_if_true(detail_query_signal(Tokens), 20, DetailCue),
    ( parse_natural_pokemon_query(Text, _) -> ContextAdj = -8 ; ContextAdj = 10 ),
    Score is 92 + AbilityEvidence + DetailCue + ContextAdj.

resolve_strategy_rules_by_evidence(Text, Tokens, Goal) :-
    findall(Score-CandidateGoal,
        strategy_rules_candidate_goal(Text, Tokens, Score, CandidateGoal),
        Candidates),
    Candidates \= [],
    keysort(Candidates, Sorted),
    reverse(Sorted, [_BestScore-Goal | _]).

strategy_rules_candidate_goal(Text, Tokens, Score, answer_tournament_rules_query(Topic)) :-
    parse_tournament_rules_query(Text, Topic),
    rules_evidence_strength(Tokens, RulesEvidence),
    score_if_true(token_member_any(Tokens, ["regras", "regra", "regulamento", "manual", "torneio", "torneios", "juiz", "penalidade", "timer", "tempo"]), 24, RulesCue),
    Score is 100 + RulesEvidence + RulesCue.
strategy_rules_candidate_goal(Text, Tokens, Score, answer_pair_synergy_query(NameA, NameB)) :-
    parse_pair_synergy_query(Text, NameA, NameB),
    strategy_evidence_strength(Tokens, StrategyEvidence),
    Score is 124 + StrategyEvidence.
strategy_rules_candidate_goal(Text, Tokens, Score, answer_compatible_partners_query(Name, Limit)) :-
    parse_compatible_partners_query(Text, Name, Limit),
    strategy_evidence_strength(Tokens, StrategyEvidence),
    Score is 122 + StrategyEvidence.
strategy_rules_candidate_goal(Text, Tokens, Score, answer_doubles_strategy_query(Topic)) :-
    parse_doubles_strategy_query(Text, Topic),
    strategy_evidence_strength(Tokens, StrategyEvidence),
    score_if_true(token_member_any(Tokens, ["estrategia", "plano", "gameplan", "doubles", "dupla", "speed", "trick", "room", "bo3", "lead", "posicionamento"]), 22, StrategyCue),
    Score is 102 + StrategyEvidence + StrategyCue.

item_evidence_strength(Tokens, Score) :-
    count_token_pred_matches(Tokens, item_intent_token, TokenHits),
    count_phrase_pred_matches(Tokens, item_intent_phrase, PhraseHits),
    score_if_true(token_member_any(Tokens, ["item", "itens", "held", "equipar", "equipado", "equipa"]), 10, LexCue),
    Score is TokenHits * 6 + PhraseHits * 14 + LexCue.

move_evidence_strength(Tokens, Score) :-
    count_token_pred_matches(Tokens, move_intent_token, TokenHits),
    count_phrase_pred_matches(Tokens, battle_intent_phrase, PhraseHits),
    score_if_true(token_member_any(Tokens, ["move", "moves", "golpe", "golpes", "movelist", "moveset"]), 10, LexCue),
    Score is TokenHits * 6 + PhraseHits * 10 + LexCue.

ability_evidence_strength(Tokens, Score) :-
    count_token_pred_matches(Tokens, ability_keyword, TokenHits),
    count_phrase_pred_matches(Tokens, ability_keyword_phrase, PhraseHits),
    score_if_true(token_member_any(Tokens, ["habilidade", "habilidades", "ability", "abilities", "passiva", "trait", "traits"]), 10, LexCue),
    Score is TokenHits * 6 + PhraseHits * 14 + LexCue.

rules_evidence_strength(Tokens, Score) :-
    count_token_pred_matches(Tokens, tournament_rules_token, TokenHits),
    score_if_true(contiguous_sublist(["team", "list"], Tokens), 12, TeamListCue),
    score_if_true(contiguous_sublist(["team", "id"], Tokens), 12, TeamIdCue),
    score_if_true(contiguous_sublist(["morte", "subita"], Tokens), 10, SuddenDeathPtCue),
    score_if_true(contiguous_sublist(["sudden", "death"], Tokens), 10, SuddenDeathEnCue),
    Score is TokenHits * 8 + TeamListCue + TeamIdCue + SuddenDeathPtCue + SuddenDeathEnCue.

strategy_evidence_strength(Tokens, Score) :-
    count_token_pred_matches(Tokens, strategy_intent_token, StrategyHits),
    count_token_pred_matches(Tokens, doubles_format_token, DoublesHits),
    count_token_pred_matches(Tokens, speed_control_token, SpeedHits),
    count_token_pred_matches(Tokens, trick_room_token, TrickHits),
    count_token_pred_matches(Tokens, weather_plan_token, WeatherHits),
    count_token_pred_matches(Tokens, bo3_adaptation_token, Bo3Hits),
    count_token_pred_matches(Tokens, positioning_token, PositionHits),
    count_token_pred_matches(Tokens, synergy_intent_token, SynergyHits),
    Score is StrategyHits * 8 + DoublesHits * 7 + SpeedHits * 6 + TrickHits * 6 + WeatherHits * 6 + Bo3Hits * 6 + PositionHits * 6 + SynergyHits * 7.

count_token_pred_matches(Tokens, PredicateName, Count) :-
    findall(Token,
        ( member(Token, Tokens),
          Goal =.. [PredicateName, Token],
          call(Goal)
        ),
        RawMatches),
    sort(RawMatches, UniqueMatches),
    length(UniqueMatches, Count).

count_phrase_pred_matches(Tokens, PredicateName, Count) :-
    ( current_predicate(PredicateName/1) ->
        findall(Phrase,
            ( Goal =.. [PredicateName, Phrase],
              call(Goal),
              contiguous_sublist(Phrase, Tokens)
            ),
            RawMatches),
        sort(RawMatches, UniqueMatches),
        length(UniqueMatches, Count)
    ; Count = 0
    ).

score_if_true(Goal, Points, Points) :-
    call(Goal),
    !.
score_if_true(_Goal, _Points, 0).

list_request_signal(Tokens) :-
    token_member_any(Tokens, ["lista", "listar", "todos", "presentes", "mostrar", "mostra", "exiba", "traga"]),
    !.
list_request_signal(Tokens) :-
    contiguous_sublist(["lista", "de"], Tokens),
    !.
