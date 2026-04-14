:- encoding(utf8).
:- use_module(library(plunit)).
:- ensure_loaded('../pokedex_bot.pl').

:- dynamic test_db_ready/0.

ensure_test_db_ready :-
    ( test_db_ready ->
        true
    ; load_database,
      assertz(test_db_ready)
    ),
    set_default_generation.

assert_similarity_feedback(Output) :-
    ( sub_atom(Output, _, _, _, 'inferência de nome por similaridade')
    ; sub_atom(Output, _, _, _, 'inferência de nomes por similaridade')
    ; sub_atom(Output, _, _, _, 'Corrigi automaticamente o nome com alta confiança e vou continuar.')
    ; sub_atom(Output, _, _, _, 'Corrigi automaticamente os nomes com alta confiança e vou continuar.')
    ),
    !,
    assertion(sub_atom(Output, _, _, _, 'Peliper -> Pelipper')).

:- begin_tests(nlp_token_heuristics).

test(token_typos_are_normalized, [setup(ensure_test_db_ready)]) :-
    once(tokenize_for_match("qunatos pokemom do tipo fogo", Tokens)),
    memberchk("quantos", Tokens),
    memberchk("pokemon", Tokens).

test(parse_info_name_with_typo_keyword, [setup(ensure_test_db_ready)]) :-
    once(parse_info_by_name("pokemom nome pikachu", Name)),
    assertion(Name == pikachu).

test(parse_counter_query_with_typo_verb, [setup(ensure_test_db_ready)]) :-
    once(parse_counter_query("quem vense contra charizard", Name)),
    assertion(Name == charizard).

test(parse_level2_with_typo_tokens, [setup(ensure_test_db_ready)]) :-
    once(parse_level2_only_composed_query(
        "qunatos pokemom do tipo fogo ate nivle 40",
        Mode,
        modifiers(Generation, LevelConstraint, TypeFilters, _)
    )),
    assertion(Mode == count),
    assertion(Generation == none),
    assertion(LevelConstraint == at_most(40)),
    assertion(member(fire, TypeFilters)).

test(parse_level2_with_lower_bound_constraint, [setup(ensure_test_db_ready)]) :-
    once(parse_level2_only_composed_query(
        "quais pokemons acima do nivel 40 tipo fogo",
        _Mode,
        modifiers(_Generation, LevelConstraint, TypeFilters, _)
    )),
    assertion(LevelConstraint == at_least(40)),
    assertion(member(fire, TypeFilters)).

test(parse_level2_with_upper_bound_constraint, [setup(ensure_test_db_ready)]) :-
    once(parse_level2_only_composed_query(
        "quais pokemons abaixo do nivel 40 tipo fogo",
        _Mode,
        modifiers(_Generation, LevelConstraint, TypeFilters, _)
    )),
    assertion(LevelConstraint == at_most(40)),
    assertion(member(fire, TypeFilters)).

test(parse_count_without_type_with_short_quantity_token, [setup(ensure_test_db_ready)]) :-
    once(parse_count_without_type_query("qntos pokemons sem tipo agua", TypeFilters)),
    assertion(member(water, TypeFilters)).

test(parse_natural_type_query_with_list_synonym, [setup(ensure_test_db_ready)]) :-
    once(parse_natural_type_query("exiba pokemons tipo fogo", TypeFilters)),
    assertion(member(fire, TypeFilters)).

test(parse_natural_type_query_two_types_without_tipo_keyword, [setup(ensure_test_db_ready)]) :-
    once(parse_natural_type_query("quantos eletrico e planta", TypeFilters)),
    assertion(member(electric, TypeFilters)),
    assertion(member(grass, TypeFilters)).

test(parse_evolution_level_query_with_happiness_focus, [setup(ensure_test_db_ready)]) :-
    once(parse_evolution_level_query("como o eevee evolui por felicidade", Name)),
    assertion(Name == eevee).

test(parse_evolution_should_have_query_with_level, [setup(ensure_test_db_ready)]) :-
    once(parse_evolution_should_have_query("tenho um bulbasaur nivel 20 ele ja deveria ter evoluido", Name, Level)),
    assertion(Name == bulbasaur),
    assertion(Level == 20).

test(parse_evolution_chain_query_with_tree_focus, [setup(ensure_test_db_ready)]) :-
    once(parse_evolution_chain_query("me mostra a arvore completa do eevee", Name)),
    assertion(Name == eevee).

test(resolve_intent_prefers_should_have_query, [setup(ensure_test_db_ready)]) :-
    Text = "tenho um bulbasaur nivel 20 ele ja deveria ter evoluido",
    once(tokenize_for_match(Text, Tokens)),
    once(resolve_intent(guarded, Text, Tokens, Goal)),
    assertion(Goal = answer_evolution_should_have_query(bulbasaur, 20)).

test(resolve_intent_prefers_specific_evolution_query, [setup(ensure_test_db_ready)]) :-
    Text = "como o eevee evolui por felicidade",
    once(tokenize_for_match(Text, Tokens)),
    once(resolve_intent(guarded, Text, Tokens, Goal)),
    assertion(Goal = answer_evolution_level_query(eevee)).

test(evolution_condition_text_uses_item_label_only, [setup(ensure_test_db_ready)]) :-
    once(evolution_extra_condition_text(item_thunder_stone, Text)),
    assertion(sub_atom(Text, _, _, _, 'usar item thunder stone')),
    \+ sub_atom(Text, _, _, _, 'id:').

test(evolution_condition_text_item_without_description_tail, [setup(ensure_test_db_ready)]) :-
    once(evolution_extra_condition_text(item_thunder_stone, Text)),
    \+ sub_atom(Text, _, _, _, ' - ').

test(evolution_condition_text_formats_happiness, [setup(ensure_test_db_ready)]) :-
    once(evolution_extra_condition_text(happiness_160, Text)),
    assertion(sub_atom(Text, _, _, _, 'felicidade 160+')).

test(condense_evolution_options_prefers_item_path, [setup(ensure_test_db_ready)]) :-
    Raw = [10-level_up-7-none, 10-use_item-none-item_fire_stone],
    once(condense_evolution_options(Raw, Condensed)),
    assertion(Condensed == [detailed(10, use_item, none, item_fire_stone)]).

test(condense_evolution_options_summarizes_multiple_non_item_paths, [setup(ensure_test_db_ready)]) :-
    Raw = [10-level_up-7-none, 10-level_up-8-time_day],
    once(condense_evolution_options(Raw, Condensed)),
    assertion(Condensed == [ambiguous(10, 2)]).

test(summarize_evolution_options_shows_only_target_names, [setup(ensure_test_db_ready)]) :-
    once(pokemon_info(eevee, pokemon(ID, _, _, _, _, _, _))),
    findall(ToID-Trigger-MinLevel-Condition,
        pokemon_evolution(ID, ToID, Trigger, MinLevel, Condition),
        EvolutionsRaw),
    sort(EvolutionsRaw, Evolutions),
    once(summarize_evolution_options(Evolutions, Summary)),
    assertion(sub_atom(Summary, _, _, _, 'Vaporeon')),
    assertion(sub_atom(Summary, _, _, _, 'Umbreon')),
    \+ sub_atom(Summary, _, _, _, 'requisito').

test(counter_pairs_text_is_multiline_block, [setup(ensure_test_db_ready)]) :-
    once(counter_pairs_text([1.0-charizard-2.0-1.0, 0.9-blastoise-1.5-1.0], Text)),
    assertion(sub_atom(Text, _, _, _, '\n  - ')).

test(switch_pair_text_hides_bulk_value, [setup(ensure_test_db_ready)]) :-
    once(switch_pair_text(1.0-charizard-0.5-400, Text)),
    \+ sub_atom(Text, _, _, _, 'bulk').

test(counter_metrics_considers_movelist_coverage, [setup(ensure_test_db_ready)]) :-
    once(pokemon_info(arcanine, pokemon(ArcanineID, _, _, _, ArcanineTypes, _, ArcanineStats))),
    once(pokemon_info(gyarados, pokemon(GyaradosID, _, _, _, GyaradosTypes, _, GyaradosStats))),
    once(counter_metrics(ArcanineID, ArcanineTypes, ArcanineStats, GyaradosID, GyaradosTypes, GyaradosStats, AttackMult, _DefenseMult, _AttackPressure, _DefensePressure)),
    assertion(AttackMult >= 2.0).

test(counter_pairs_text_with_target_includes_tactical_reason, [setup(ensure_test_db_ready)]) :-
    once(pokemon_info(gyarados, pokemon(TargetID, _, _, _, _, _, _))),
    once(counter_pairs_text(TargetID, [1.0-arcanine-4.0-2.0], Text)),
    assertion(sub_atom(Text, _, _, _, 'chave:')).

test(counter_pair_text_includes_tempo_details, [setup(ensure_test_db_ready)]) :-
    once(pokemon_info(gyarados, pokemon(TargetID, _, _, _, _, _, _))),
    once(counter_pair_text(TargetID, 1.0-arcanine-4.0-2.0, Text)),
    assertion(sub_atom(Text, _, _, _, 'age ')),
    assertion(sub_atom(Text, _, _, _, 'turno')).

test(counter_duel_outcome_second_equal_turns_is_loss, [setup(ensure_test_db_ready)]) :-
    once(counter_duel_outcome(second, 1, 1, Outcome)),
    assertion(Outcome == lose).

test(counter_duel_summary_never_uses_trade_ko_for_second_equal_turns, [setup(ensure_test_db_ready)]) :-
    once(counter_duel_summary_text(second, 1, 1, Text)),
    \+ sub_atom(Text, _, _, _, 'troca KO').

test(battle_profile_includes_key_move_and_note, [setup(ensure_test_db_ready)]) :-
    once(pokemon_info(charizard, pokemon(AttackerID, _, _, _, AttackerTypes, _, AttackerStats))),
    once(pokemon_info(blastoise, pokemon(DefenderID, _, _, _, DefenderTypes, _, DefenderStats))),
    once(battle_profile(AttackerID, AttackerTypes, AttackerStats, DefenderID, DefenderTypes, DefenderStats, Profile)),
    assertion(Profile.key_move \= none),
    assertion(Profile.move_note \= '').

test(duel_action_order_prefers_priority_over_speed, [setup(ensure_test_db_ready)]) :-
    ProfileA = profile{mode:physical, multiplier:1.0, damage:12.0, hp:100, speed:80, priority:1, key_move:none, move_note:'', ability_note:''},
    ProfileB = profile{mode:special, multiplier:1.0, damage:15.0, hp:100, speed:120, priority:0, key_move:none, move_note:'', ability_note:''},
    once(duel_action_order(ProfileA, ProfileB, first)).

test(compare_query_prints_deep_duel_section, [setup(ensure_test_db_ready)]) :-
    with_output_to(atom(Output), answer_compare_query(charizard, blastoise)),
    assertion(sub_atom(Output, _, _, _, 'Simulação aprofundada 1x1')).

test(battle_move_tempo_factor_penalizes_solar_beam_without_sun, [setup(ensure_test_db_ready)]) :-
    once(pokemon_info(charizard, pokemon(AttackerID, _, _, _, _, _, _))),
    once(battle_move_tempo_factor(AttackerID, solar_beam, 'Requires a turn to charge before attacking.', Factor, Note)),
    assertion(Factor < 1.0),
    assertion(sub_atom(Note, _, _, _, 'preparo')).

test(compare_role_profile_returns_competitive_bucket, [setup(ensure_test_db_ready)]) :-
    once(pokemon_info(charizard, pokemon(ID, _, _, _, _, _, Stats))),
    once(compare_role_profile(ID, Stats, RoleText, Bucket)),
    assertion(RoleText \= ''),
    assertion(member(Bucket, [offensive, defensive, support, balanced])).

test(gen5_damage_formula_example_matches_expected_range, [setup(ensure_test_db_ready)]) :-
    Modifiers = modifiers{
        targets:1.0,
        parental_bond:1.0,
        weather:1.0,
        glaive_rush:1.0,
        critical:1.0,
        stab:1.5,
        type:4.0,
        burn:1.0,
        other:1.0,
        zmove:1.0,
        tera_shield:1.0
    },
    once(battle_damage_profile_gen5_plus(75, 65, 123, 163, Modifiers, Profile)),
    assertion(Profile.min == 168),
    assertion(Profile.max == 196).

test(final_stat_formula_level50_no_iv_no_ev_matches_reference, [setup(ensure_test_db_ready)]) :-
    once(final_stat_from_base(special_attack, 100, 50, 0, 0, 1.0, Stat)),
    assertion(Stat == 105).

test(final_stat_formula_level50_max_iv_no_ev_matches_reference, [setup(ensure_test_db_ready)]) :-
    once(final_stat_from_base(special_attack, 100, 50, 31, 0, 1.0, Stat)),
    assertion(Stat == 120).

test(final_stat_formula_level50_max_iv_max_ev_nature_boost_matches_reference, [setup(ensure_test_db_ready)]) :-
    once(final_stat_from_base(special_attack, 100, 50, 31, 252, 1.1, Stat)),
    assertion(Stat == 167).

test(normalized_battle_level_clamps_range, [setup(ensure_test_db_ready)]) :-
    once(normalized_battle_level(0, Low)),
    once(normalized_battle_level(150, High)),
    assertion(Low == 1),
    assertion(High == 100).

test(battle_sim_output_mentions_default_level_50, [setup(ensure_test_db_ready)]) :-
    with_output_to(atom(Output), answer_battle_sim_query(charizard, blastoise)),
    assertion(sub_atom(Output, _, _, _, 'nível padrão 50')).

test(compare_output_mentions_default_level_50_in_deep_sim, [setup(ensure_test_db_ready)]) :-
    with_output_to(atom(Output), answer_compare_query(charizard, blastoise)),
    assertion(sub_atom(Output, _, _, _, 'Simulação aprofundada 1x1 (nível 50')).

test(stab_is_one_when_move_type_differs_from_user_type, [setup(ensure_test_db_ready)]) :-
    once(pokemon_info(charizard, pokemon(CharID, _, _, _, CharTypes, _, _))),
    once(battle_stab_multiplier(CharID, CharTypes, electric, STAB)),
    assertion(STAB == 1.0).

test(weather_modifier_applies_sun_and_rain_rules, [setup(ensure_test_db_ready)]) :-
    once(battle_weather_modifier(sun, flamethrower, fire, SunFire)),
    once(battle_weather_modifier(sun, surf, water, SunWater)),
    once(battle_weather_modifier(rain, surf, water, RainWater)),
    once(battle_weather_modifier(rain, flamethrower, fire, RainFire)),
    assertion(SunFire == 1.5),
    assertion(SunWater == 0.5),
    assertion(RainWater == 1.5),
    assertion(RainFire == 0.5).

test(psychic_terrain_blocks_priority_on_grounded_target, [setup(ensure_test_db_ready)]) :-
    once(battle_terrain_modifier(psychic, normal, 1, true, true, Mod)),
    assertion(Mod == 0.0).

test(recommend_counters_respects_top4_limit, [setup(ensure_test_db_ready)]) :-
    once(pokemon_info(charizard, pokemon(TargetID, _, _, _, TargetTypes, _, TargetStats))),
    once(recommend_counters(TargetID, TargetTypes, TargetStats, CounterPairs)),
    length(CounterPairs, Count),
    assertion(Count =< 4).

test(offensive_move_priority_extracts_tag_value, [setup(ensure_test_db_ready)]) :-
    once(offensive_move_priority([priority_2, physical], Priority)),
    assertion(Priority == 2).

test(offensive_move_priority_defaults_to_zero, [setup(ensure_test_db_ready)]) :-
    once(offensive_move_priority([physical, high_crit], Priority)),
    assertion(Priority == 0).

test(utility_move_usable_in_duel_excludes_helping_hand, [setup(ensure_test_db_ready)]) :-
    \+ utility_move_usable_in_duel(helping_hand, 'Ally''s next move inflicts half more damage.', unique).

test(recommend_counters_filters_fragile_non_viable_options, [setup(ensure_test_db_ready)]) :-
    once(pokemon_info(charizard, pokemon(TargetID, _TargetName, _H, _W, TargetTypes, _Abilities, TargetStats))),
    once(recommend_counters(TargetID, TargetTypes, TargetStats, CounterPairs)),
    \+ member(_Score-caterpie-_AttackMult-_DefenseMult, CounterPairs).

test(parse_weak_query_with_short_token, [setup(ensure_test_db_ready)]) :-
    once(parse_weak_against_type_query("quais sao vuln contra agua", TypeFilters)),
    assertion(member(water, TypeFilters)).

test(parse_counter_query_with_punir_token, [setup(ensure_test_db_ready)]) :-
    once(parse_counter_query("como punir charizard", Name)),
    assertion(Name == charizard).

test(parse_natural_type_query_with_manda_synonym, [setup(ensure_test_db_ready)]) :-
    once(parse_natural_type_query("manda pokemons tipo gelo", TypeFilters)),
    assertion(member(ice, TypeFilters)).

test(parse_ability_details_query_with_passiva_keyword, [setup(ensure_test_db_ready)]) :-
    once(parse_pokemon_ability_details_query("o que faz a passiva do tyranitar", Name)),
    assertion(Name == tyranitar).

test(parse_ability_details_query_with_ability_phrase, [setup(ensure_test_db_ready)]) :-
    once(parse_pokemon_ability_details_query("o que faz clear body do metagross", Name)),
    assertion(Name == metagross).

test(resolve_intent_routes_ability_details_without_keyword, [setup(ensure_test_db_ready)]) :-
    Text = "o que faz clear body do metagross",
    once(tokenize_for_match(Text, Tokens)),
    once(resolve_intent(guarded, Text, Tokens, Goal)),
    assertion(Goal = answer_pokemon_ability_details_query(metagross)).

test(resolve_intent_routes_ability_catalog_info_prompt, [setup(ensure_test_db_ready)]) :-
    Text = "info sobre rough skin",
    once(tokenize_for_match(Text, Tokens)),
    once(resolve_intent(guarded, Text, Tokens, Goal)),
    assertion(Goal = answer_ability_query(rough_skin)).

test(move_or_ability_domain_signal_with_ability_phrase, [setup(ensure_test_db_ready)]) :-
    once(tokenize_for_match("o que faz clear body do metagross", Tokens)),
    once(move_or_ability_domain_signal(Tokens)).

test(parse_compare_query_comparativo_entre, [setup(ensure_test_db_ready)]) :-
    once(parse_compare_query("comparativo entre pikachu e raichu", NameA, NameB)),
    assertion(NameA == pikachu),
    assertion(NameB == raichu).

test(parse_compare_query_with_comparando_token, [setup(ensure_test_db_ready)]) :-
    once(parse_compare_query("comparando pikachu e raichu", NameA, NameB)),
    assertion(NameA == pikachu),
    assertion(NameB == raichu).

test(parse_compare_query_ignores_trailing_clause_stopwords, [setup(ensure_test_db_ready)]) :-
    once(parse_compare_query("comparar pikachu e raichu e quem ganha", NameA, NameB)),
    assertion(NameA == pikachu),
    assertion(NameB == raichu).

test(counter_domain_signal_with_responde_token, [setup(ensure_test_db_ready)]) :-
    once(counter_domain_signal(["quem", "responde", "melhor", "contra", "charizard"])).

test(resolve_intent_routes_counter_with_resposta_token, [setup(ensure_test_db_ready)]) :-
    Text = "qual resposta para garchomp",
    once(tokenize_for_match(Text, Tokens)),
    once(resolve_intent(guarded, Text, Tokens, Goal)),
    assertion(Goal = answer_counter_query_with_clarification(garchomp)).

test(parse_natural_type_query_with_traga_synonym, [setup(ensure_test_db_ready)]) :-
    once(parse_natural_type_query("traga pokemons elemento fogo", TypeFilters)),
    assertion(member(fire, TypeFilters)).

test(compare_domain_signal_with_diferenca_token, [setup(ensure_test_db_ready)]) :-
    once(compare_or_battle_domain_signal(["qual", "a", "diferenca", "entre", "pikachu", "e", "raichu"])).

test(fallback_gate_with_skill_token, [setup(ensure_test_db_ready)]) :-
    once(should_run_intent_fallback(["skills", "do", "charizard"])).

test(infer_identifier_small_typo_pikachu, [setup(ensure_test_db_ready)]) :-
    once(infer_identifier("pikchu", Resolved, Status)),
    assertion(Resolved == pikachu),
    assertion(Status \= exact).

test(infer_identifier_small_typo_charizard, [setup(ensure_test_db_ready)]) :-
    once(infer_identifier("charzard", Resolved, Status)),
    assertion(Resolved == charizard),
    assertion(Status \= exact).

test(parse_held_item_recommendation_query_balanced, [setup(ensure_test_db_ready)]) :-
    once(parse_held_item_recommendation_query("qual held item combina com hawlucha", Name, Strategy)),
    assertion(Name == hawlucha),
    assertion(Strategy == balanced).

test(parse_held_item_recommendation_query_cover_weakness, [setup(ensure_test_db_ready)]) :-
    once(parse_held_item_recommendation_query("quais itens para cobrir fraqueza do dragonite", Name, Strategy)),
    assertion(Name == dragonite),
    assertion(Strategy == cover_weakness).

test(resolve_intent_routes_held_item_query, [setup(ensure_test_db_ready)]) :-
    Text = "melhor item para hawlucha",
    once(tokenize_for_match(Text, Tokens)),
    once(resolve_intent(guarded, Text, Tokens, Goal)),
    assertion(Goal = answer_held_item_recommendation_query(hawlucha, balanced)).

test(parse_held_item_recommendation_query_with_item_phrase, [setup(ensure_test_db_ready)]) :-
    once(parse_held_item_recommendation_query("melhor black sludge para toxapex", Name, Strategy)),
    assertion(Name == toxapex),
    assertion(Strategy == balanced).

test(parse_held_item_recommendation_query_with_typo_target_name, [setup(ensure_test_db_ready)]) :-
    once(parse_held_item_recommendation_query("melhor held item para peliper", Name, Strategy)),
    assertion(Name == peliper),
    assertion(Strategy == balanced).

test(resolve_intent_routes_held_item_query_with_item_phrase, [setup(ensure_test_db_ready)]) :-
    Text = "melhor black sludge para toxapex",
    once(tokenize_for_match(Text, Tokens)),
    once(resolve_intent(guarded, Text, Tokens, Goal)),
    assertion(Goal = answer_held_item_recommendation_query(toxapex, balanced)).

test(resolve_intent_routes_specific_item_detail_query, [setup(ensure_test_db_ready)]) :-
    Text = "o que faz black sludge",
    once(tokenize_for_match(Text, Tokens)),
    once(resolve_intent(guarded, Text, Tokens, Goal)),
    assertion(Goal = answer_specific_item_query(black_sludge)).

test(resolve_intent_routes_specific_move_detail_query, [setup(ensure_test_db_ready)]) :-
    Text = "qual o efeito de thunder wave",
    once(tokenize_for_match(Text, Tokens)),
    once(resolve_intent(guarded, Text, Tokens, Goal)),
    assertion(Goal = answer_specific_move_query(thunder_wave)).

test(resolve_intent_routes_specific_move_detail_query_without_move_keyword, [setup(ensure_test_db_ready)]) :-
    Text = "poder e precisao de hydro pump",
    once(tokenize_for_match(Text, Tokens)),
    once(resolve_intent(guarded, Text, Tokens, Goal)),
    assertion(Goal = answer_specific_move_query(hydro_pump)).

test(resolve_intent_routes_global_movelist_catalog_prompt, [setup(ensure_test_db_ready)]) :-
    Text = "quais sao os moves catalogados",
    once(tokenize_for_match(Text, Tokens)),
    once(resolve_intent(guarded, Text, Tokens, Goal)),
    assertion(Goal = answer_global_move_list_query).

test(held_item_output_highlights_unburden_focus_sash_synergy, [setup(ensure_test_db_ready)]) :-
    with_output_to(atom(Output), answer_held_item_recommendation_query(hawlucha, balanced)),
    assertion(sub_atom(Output, _, _, _, 'focus sash')),
    assertion(sub_atom(Output, _, _, _, 'Unburden')).

test(held_item_output_shows_context_matrix_section, [setup(ensure_test_db_ready)]) :-
    with_output_to(atom(Output), answer_held_item_recommendation_query(hawlucha, balanced)),
    assertion(sub_atom(Output, _, _, _, 'Quadro de possibilidades')).

test(choice_scarf_score_rewards_field_setter_pivot_execution, [setup(ensure_test_db_ready)]) :-
    Features = held_features{speed:88, offense_peak:95, has_pivot:true, has_weather_setter_ability:true, has_terrain_setter_ability:false, abilities:[drizzle], pivot_moves:[u_turn]},
    once(held_item_candidate_score(choice_scarf, Features, balanced, Score, _Objective, Reason)),
    assertion(Score >= 40),
    assertion(sub_atom(Reason, _, _, _, 'drizzle')),
    assertion(sub_atom(Reason, _, _, _, 'chuva')).

test(flame_orb_score_rewards_reliable_guts_activation, [setup(ensure_test_db_ready)]) :-
    Features = held_features{has_guts:true, has_facade:true, has_protect_turn:true},
    once(held_item_candidate_score(flame_orb, Features, balanced, Score, _Objective, Reason)),
    assertion(Score >= 50),
    assertion(sub_atom(Reason, _, _, _, 'blinda contra outros status negativos')).

test(move_tactical_catalog_marks_pivot_and_protection_roles, [setup(ensure_test_db_ready)]) :-
    assertion(move_has_tactical_role(u_turn, pivot)),
    assertion(move_has_tactical_role(u_turn, control)),
    assertion(move_has_tactical_role(protect, protection)),
    assertion(move_has_tactical_role(protect, control)).

test(move_tactical_catalog_marks_core_high_level_roles, [setup(ensure_test_db_ready)]) :-
    assertion(move_has_tactical_role(swords_dance, buff)),
    assertion(move_has_tactical_role(will_o_wisp, debuff)),
    assertion(move_has_tactical_role(stealth_rock, hazard)),
    assertion(move_has_tactical_role(recover, recovery)),
    assertion(move_has_tactical_role(flamethrower, damage)).

test(held_item_feature_pack_uses_tactical_catalog_roles, [setup(ensure_test_db_ready)]) :-
    once(pokemon_info(pelipper, pokemon(ID, Name, _, _, Types, Abilities, Stats))),
    once(pokemon_move_list_for_id(ID, Name, MovesRaw, _)),
    sort(MovesRaw, Moves),
    once(held_item_feature_pack(ID, Types, Abilities, Stats, Moves, Features)),
    assertion(Features.has_pivot == true),
    assertion(Features.has_protect_turn == true).

test(held_item_pelipper_output_mentions_pivot_move_example, [setup(ensure_test_db_ready)]) :-
    with_output_to(atom(Output), answer_held_item_recommendation_query(pelipper, balanced)),
    assertion(sub_atom(Output, _, _, _, 'choice scarf')),
    assertion(sub_atom(Output, _, _, _, 'drizzle')),
    assertion(sub_atom(Output, _, _, _, 'chuva')),
    assertion(
        sub_atom(Output, _, _, _, 'u turn')
        ; sub_atom(Output, _, _, _, 'volt switch')
        ; sub_atom(Output, _, _, _, 'flip turn')
        ; sub_atom(Output, _, _, _, 'parting shot')
        ; sub_atom(Output, _, _, _, 'teleport')
    ).

test(held_item_output_hides_score_and_offers_next_option, [setup(ensure_test_db_ready)]) :-
    with_output_to(atom(Output), answer_held_item_recommendation_query(hawlucha, balanced)),
    \+ sub_atom(Output, _, _, _, 'score'),
    assertion(sub_atom(Output, _, _, _, 'outra opção')).

test(held_item_pending_next_option_prints_followup_line, [setup(ensure_test_db_ready)]) :-
    answer_held_item_recommendation_query(hawlucha, balanced),
    with_output_to(atom(Output), handle_pending_held_item_options("outra opção")),
    assertion(sub_atom(Output, _, _, _, 'Se quiser outra opção')).

test(held_item_typo_name_prompts_similarity_confirmation, [setup(ensure_test_db_ready)]) :-
    with_output_to(atom(Output), answer_held_item_recommendation_query(peliper, balanced)),
    assertion(sub_atom(Output, _, _, _, 'inferência de nome por similaridade')),
    assertion(sub_atom(Output, _, _, _, 'Quer que eu continue usando Pelipper?')).

test(resolve_intent_routes_movelist_query_with_typo_target_name, [setup(ensure_test_db_ready)]) :-
    Text = "moves do peliper",
    once(tokenize_for_match(Text, Tokens)),
    once(resolve_intent(guarded, Text, Tokens, Goal)),
    assertion(Goal = answer_pokemon_movelist_query(peliper)).

test(movelist_typo_name_prompts_similarity_confirmation, [setup(ensure_test_db_ready)]) :-
    with_output_to(atom(Output), answer_pokemon_movelist_query(peliper)),
    assert_similarity_feedback(Output).

test(resolve_intent_routes_ability_details_with_typo_target_name, [setup(ensure_test_db_ready)]) :-
    once(parse_pokemon_ability_details_query("o que faz a habilidade do peliper", Name)),
    assertion(Name == peliper).

test(ability_details_typo_name_prompts_similarity_confirmation, [setup(ensure_test_db_ready)]) :-
    with_output_to(atom(Output), answer_pokemon_ability_details_query(peliper)),
    assert_similarity_feedback(Output).

test(resolve_intent_routes_evolution_level_query_with_typo_target_name, [setup(ensure_test_db_ready)]) :-
    Text = "nivel de evolucao do peliper",
    once(tokenize_for_match(Text, Tokens)),
    once(resolve_intent(guarded, Text, Tokens, Goal)),
    assertion(Goal = answer_evolution_level_query(peliper)).

test(evolution_level_typo_name_prompts_similarity_confirmation, [setup(ensure_test_db_ready)]) :-
    with_output_to(atom(Output), answer_evolution_level_query(peliper)),
    assert_similarity_feedback(Output).

test(resolve_intent_routes_compatible_partners_query_with_typo_target_name, [setup(ensure_test_db_ready)]) :-
    Text = "pokemons compativeis com peliper",
    once(tokenize_for_match(Text, Tokens)),
    once(resolve_intent(guarded, Text, Tokens, Goal)),
    Goal = answer_compatible_partners_query(peliper, _).

test(compatible_partners_typo_name_prompts_similarity_confirmation, [setup(ensure_test_db_ready)]) :-
    with_output_to(atom(Output), answer_compatible_partners_query(peliper, 6)),
    assert_similarity_feedback(Output).

test(resolve_intent_routes_pair_synergy_query_with_typo_target_name, [setup(ensure_test_db_ready)]) :-
    Text = "sinergia entre peliper e tyranitar",
    once(tokenize_for_match(Text, Tokens)),
    once(resolve_intent(guarded, Text, Tokens, Goal)),
    Goal = answer_pair_synergy_query(NameA, NameB),
    assertion(member(NameA, [peliper, tyranitar])),
    assertion(member(NameB, [peliper, tyranitar])),
    assertion(NameA \= NameB).

test(pair_synergy_typo_name_prompts_similarity_confirmation, [setup(ensure_test_db_ready)]) :-
    with_output_to(atom(Output), answer_pair_synergy_query(peliper, tyranitar)),
    assert_similarity_feedback(Output),
    assertion(sub_atom(Output, _, _, _, 'Pelipper')),
    assertion(sub_atom(Output, _, _, _, 'Tyranitar')).

test(parse_rank_team_vs_target_with_typo_target_name, [setup(ensure_test_db_ready)]) :-
    Text = "ranking do meu time pikachu e raichu contra peliper",
    once(parse_rank_team_vs_target_query(Text, TeamNames, TargetName)),
    assertion(TargetName == peliper),
    assertion(member(pikachu, TeamNames)),
    assertion(member(raichu, TeamNames)).

test(rank_team_vs_target_typo_name_prompts_similarity_confirmation, [setup(ensure_test_db_ready)]) :-
    with_output_to(atom(Output), answer_rank_team_vs_target_query([pikachu, raichu], peliper)),
    assert_similarity_feedback(Output).

test(pending_synergy_detail_yields_to_new_item_query, [setup(ensure_test_db_ready)]) :-
    once(with_output_to(atom(_PairOutput), answer_pair_synergy_query(tyranitar, garchomp))),
    \+ with_output_to(atom(_IgnoredOutput), handle_pending_synergy_details("melhor held item para pelipper")),
    Text = "melhor held item para pelipper",
    once(tokenize_for_match(Text, Tokens)),
    once(resolve_intent(guarded, Text, Tokens, Goal)),
    assertion(Goal = answer_held_item_recommendation_query(pelipper, balanced)).

test(held_item_output_prioritizes_rocky_helmet_for_ferrothorn, [setup(ensure_test_db_ready)]) :-
    with_output_to(atom(Output), answer_held_item_recommendation_query(ferrothorn, balanced)),
    assertion(sub_atom(Output, _, _, _, 'rocky helmet')),
    assertion(sub_atom(Output, _, _, _, 'iron barbs')).

test(compare_role_key_prefers_setup_for_hawlucha_unburden_archetype, [setup(ensure_test_db_ready)]) :-
    once(pokemon_info(hawlucha, pokemon(_ID, _Name, _H, _W, _Types, _Abilities, Stats))),
    once(compare_role_key(hawlucha, Stats, Role, _Bucket)),
    assertion(Role == setup_sweeper).

test(held_item_output_shows_official_setup_role_for_hawlucha, [setup(ensure_test_db_ready)]) :-
    with_output_to(atom(Output), answer_held_item_recommendation_query(hawlucha, balanced)),
    assertion(sub_atom(Output, _, _, _, 'Classificação oficial detectada: Setup Sweeper')).

test(resolve_intent_routes_tournament_timer_query, [setup(ensure_test_db_ready)]) :-
    Text = "regras vgc de tempo de movimento",
    once(tokenize_for_match(Text, Tokens)),
    once(resolve_intent(guarded, Text, Tokens, Goal)),
    assertion(Goal = answer_tournament_rules_query(timers)).

test(resolve_intent_prefers_rules_over_strategy_in_mixed_vgc_prompt, [setup(ensure_test_db_ready)]) :-
    Text = "regras vgc bo3 e topcut",
    once(tokenize_for_match(Text, Tokens)),
    once(resolve_intent(guarded, Text, Tokens, Goal)),
    assertion(Goal = answer_tournament_rules_query(match_format)).

test(resolve_intent_prefers_held_item_over_strategy_on_item_query, [setup(ensure_test_db_ready)]) :-
    Text = "qual held item combina com pelipper",
    once(tokenize_for_match(Text, Tokens)),
    once(resolve_intent(guarded, Text, Tokens, Goal)),
    assertion(Goal = answer_held_item_recommendation_query(pelipper, balanced)).

test(tournament_rules_output_is_marked_as_non_strategy, [setup(ensure_test_db_ready)]) :-
    with_output_to(atom(Output), answer_tournament_rules_query(general)),
    assertion(sub_atom(Output, _, _, _, 'apenas regulamento de torneio')),
    assertion(sub_atom(Output, _, _, _, 'nao orientacao de estrategia de batalha')).

test(resolve_intent_routes_doubles_strategy_speed_control, [setup(ensure_test_db_ready)]) :-
    Text = "qual estrategia de speed control no vgc doubles",
    once(tokenize_for_match(Text, Tokens)),
    once(resolve_intent(guarded, Text, Tokens, Goal)),
    assertion(Goal = answer_doubles_strategy_query(speed_control)).

test(resolve_intent_prefers_strategy_over_rules_in_mixed_vgc_prompt, [setup(ensure_test_db_ready)]) :-
    Text = "no vgc doubles qual plano de speed control contra trick room",
    once(tokenize_for_match(Text, Tokens)),
    once(resolve_intent(guarded, Text, Tokens, Goal)),
    Goal = answer_doubles_strategy_query(Topic),
    assertion(member(Topic, [speed_control, anti_trick_room])).

test(doubles_strategy_output_mentions_architecture_focus, [setup(ensure_test_db_ready)]) :-
    with_output_to(atom(Output), answer_doubles_strategy_query(general)),
    assertion(sub_atom(Output, _, _, _, 'Foco em arquitetura de jogo')),
    assertion(sub_atom(Output, _, _, _, 'numeros podem ser calibrados depois')).

test(resolve_intent_routes_pair_synergy_query, [setup(ensure_test_db_ready)]) :-
    Text = "sinergia entre tyranitar e garchomp",
    once(tokenize_for_match(Text, Tokens)),
    once(resolve_intent(guarded, Text, Tokens, Goal)),
    Goal = answer_pair_synergy_query(NameA, NameB),
    assertion(NameA \= NameB),
    assertion(member(NameA, [tyranitar, garchomp])),
    assertion(member(NameB, [tyranitar, garchomp])).

test(pair_synergy_output_mentions_sandstorm_for_tyranitar_garchomp, [setup(ensure_test_db_ready)]) :-
    with_output_to(atom(Output), answer_pair_synergy_query(tyranitar, garchomp)),
    assertion(sub_atom(Output, _, _, _, 'tempestade de areia')).

test(pair_synergy_output_marks_weak_pairs_as_initial_band, [setup(ensure_test_db_ready)]) :-
    with_output_to(atom(Output), answer_pair_synergy_query(magikarp, metapod)),
    assertion(sub_atom(Output, _, _, _, 'sinergia estrutural inicial')).

test(pair_synergy_output_mentions_role_flexibility_and_support_options, [setup(ensure_test_db_ready)]) :-
    with_output_to(atom(Output), answer_pair_synergy_query(tyranitar, garchomp)),
    assertion(sub_atom(Output, _, _, _, 'podem inverter conforme o matchup')),
    assertion(sub_atom(Output, _, _, _, 'opções de suporte como')).

test(pair_synergy_output_offers_detail_followup, [setup(ensure_test_db_ready)]) :-
    with_output_to(atom(Output), answer_pair_synergy_query(tyranitar, garchomp)),
    assertion(sub_atom(Output, _, _, _, 'detalhar 1')),
    assertion(sub_atom(Output, _, _, _, 'detalhar tudo')).

test(pair_synergy_pending_detail_by_index_prints_impact, [setup(ensure_test_db_ready)]) :-
    once(with_output_to(atom(_PairOutput), answer_pair_synergy_query(tyranitar, garchomp))),
    with_output_to(atom(Output), handle_pending_synergy_details("detalhar 1")),
    assertion(sub_atom(Output, _, _, _, 'Detalhamento #1')),
    assertion(sub_atom(Output, _, _, _, 'Impacto pratico')).

test(pair_turn_window_support_detects_setup_lane, [setup(ensure_test_db_ready)]) :-
    Enabler = pair_profile{name:clefable, has_redirection:true, has_fake_out:false, has_screens:false, has_damage_amplifier:false, has_pivot:false, has_protect:true},
    Carry = pair_profile{name:garchomp, has_setup:true, speed:95, offense_peak:130},
    once(pair_turn_window_support(Enabler, Carry, Score, Reason)),
    assertion(Score > 0),
    assertion(sub_atom(Reason, _, _, _, 'janela de execução')).

test(pair_item_activation_support_detects_guts_lane, [setup(ensure_test_db_ready)]) :-
    Enabler = pair_profile{name:amoonguss, has_redirection:true, has_fake_out:false, has_protect:true, has_screens:false},
    Carry = pair_profile{name:ursaring, has_guts:true, has_facade:true, has_poison_heal:false},
    once(pair_item_activation_support(Enabler, Carry, Score, Reason)),
    assertion(Score > 0),
    assertion(sub_atom(Reason, _, _, _, 'Flame Orb + Guts')).

test(resolve_intent_routes_compatible_partners_query, [setup(ensure_test_db_ready)]) :-
    Text = "pokemons compativeis com tyranitar",
    once(tokenize_for_match(Text, Tokens)),
    once(resolve_intent(guarded, Text, Tokens, Goal)),
    assertion(Goal = answer_compatible_partners_query(tyranitar, _)).

test(resolve_intent_routes_single_name_synergy_to_partners, [setup(ensure_test_db_ready)]) :-
    Text = "sinergia com tyranitar",
    once(tokenize_for_match(Text, Tokens)),
    once(resolve_intent(guarded, Text, Tokens, Goal)),
    assertion(Goal = answer_compatible_partners_query(tyranitar, _)).

test(compatible_partners_query_now_asks_for_refinement_preferences, [setup(ensure_test_db_ready)]) :-
    with_output_to(atom(Output), answer_compatible_partners_query(tyranitar, 8)),
    assertion(sub_atom(Output, _, _, _, 'Antes de listar parceiros')),
    assertion(sub_atom(Output, _, _, _, 'principal (carry) ou suporte')),
    assertion(sub_atom(Output, _, _, _, 'sem lendarios')).

test(compatible_partners_output_uses_multifactor_explanation, [setup(ensure_test_db_ready)]) :-
    once(answer_compatible_partners_query(tyranitar, 8)),
    with_output_to(atom(Output), handle_pending_partner_preferences("padrao")),
    assertion(sub_atom(Output, _, _, _, 'moveset, stats, habilidades e plano de item')),
    assertion(sub_atom(Output, _, _, _, 'outra opção')),
    \+ sub_atom(Output, _, _, _, 'score').

test(compatible_partners_output_offers_detail_followup, [setup(ensure_test_db_ready)]) :-
    once(answer_compatible_partners_query(tyranitar, 8)),
    with_output_to(atom(Output), handle_pending_partner_preferences("padrao")),
    assertion(sub_atom(Output, _, _, _, 'detalhar 1')),
    assertion(sub_atom(Output, _, _, _, 'detalhar <nome>')).

test(compatible_partners_refinement_applies_target_role_and_filter_summary, [setup(ensure_test_db_ready)]) :-
    once(answer_compatible_partners_query(tyranitar, 8)),
    with_output_to(atom(Output), handle_pending_partner_preferences("principal sem lendarios")),
    assertion(sub_atom(Output, _, _, _, 'Filtro aplicado:')),
    assertion(sub_atom(Output, _, _, _, 'papel do alvo: principal')),
    assertion(sub_atom(Output, _, _, _, 'sem lendarios/miticos')).

test(compatible_partners_include_name_is_priority_not_hard_filter, [setup(ensure_test_db_ready)]) :-
    assertion(partner_candidate_allowed_by_name_filters(rotom_wash, [garchomp], [])),
    assertion(partner_candidate_allowed_by_name_filters(garchomp, [garchomp], [])),
    \+ partner_candidate_allowed_by_name_filters(garchomp, [garchomp], [garchomp]).

test(compatible_partners_include_name_bonus_is_applied_only_to_selected_name, [setup(ensure_test_db_ready)]) :-
    once(partner_include_name_bonus(garchomp, [garchomp], Bonus, Reason)),
    assertion(Bonus > 0),
    assertion(sub_atom(Reason, _, _, _, 'prioridade no ranking')),
    once(partner_include_name_bonus(rotom_wash, [garchomp], NoBonus, EmptyReason)),
    assertion(NoBonus == 0),
    assertion(EmptyReason == '').

test(compatible_partners_dedupe_keeps_best_entry_per_name, [setup(ensure_test_db_ready)]) :-
    Pairs = [980-garchomp-[12-a], 940-garchomp-[10-b], 910-rotom_wash-[8-c]],
    once(partner_dedupe_pairs_by_name(Pairs, Unique)),
    assertion(Unique == [980-garchomp-[12-a], 910-rotom_wash-[8-c]]).

test(compatible_partners_pending_next_option_prints_followup_line, [setup(ensure_test_db_ready)]) :-
    once(with_output_to(atom(_PromptOutput), answer_compatible_partners_query(tyranitar, 8))),
    once(with_output_to(atom(_PrefOutput), handle_pending_partner_preferences("padrao"))),
    once(with_output_to(atom(Output), handle_pending_partner_options("outra opção"))),
    assertion(sub_atom(Output, _, _, _, 'Se quiser outra opção')).

test(compatible_partners_pending_options_defers_detail_requests, [setup(ensure_test_db_ready)]) :-
    once(with_output_to(atom(_PromptOutput), answer_compatible_partners_query(tyranitar, 8))),
    once(with_output_to(atom(_PrefOutput), handle_pending_partner_preferences("padrao"))),
    \+ with_output_to(atom(_IgnoredOutput), handle_pending_partner_options("detalhar 1")),
    with_output_to(atom(Output), handle_pending_synergy_details("detalhar 1")),
    assertion(sub_atom(Output, _, _, _, 'Detalhamento #1')),
    assertion(sub_atom(Output, _, _, _, 'Impacto pratico')).

:- end_tests(nlp_token_heuristics).
