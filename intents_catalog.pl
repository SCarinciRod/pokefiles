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

resolve_intent_rule(Text, _Tokens, answer_pokemon(Number), _Mode) :-
    parse_info_by_number(Text, Number).
resolve_intent_rule(Text, _Tokens, answer_pokemon(Name), _Mode) :-
    parse_info_by_name(Text, Name).

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

resolve_intent_rule(Text, Tokens, answer_pokemon_movelist_query(Name), Mode) :-
    allow_guard(Mode, move_or_ability_domain_signal, Tokens),
    parse_pokemon_movelist_query(Text, Name).
resolve_intent_rule(Text, Tokens, answer_global_move_list_query, Mode) :-
    allow_guard(Mode, move_or_ability_domain_signal, Tokens),
    parse_move_list_query(Text).
resolve_intent_rule(Text, Tokens, answer_held_item_recommendation_query(Name, Strategy), Mode) :-
    allow_guard(Mode, item_domain_signal, Tokens),
    parse_held_item_recommendation_query(Text, Name, Strategy).
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
