:- encoding(utf8).

parse_held_item_recommendation_query(Text, Name, Strategy) :-
    tokenize_for_match(Text, Tokens),
    ( member(Token, Tokens), item_intent_token(Token) ),
    parse_natural_pokemon_query(Text, Name),
    held_item_strategy_from_tokens(Tokens, Strategy).

held_item_strategy_from_tokens(Tokens, balanced) :-
    held_item_tokens_include_any(Tokens, ["forte", "forca", "potencializar", "aumentar", "dano", "ofensivo", "sweeper"]),
    held_item_tokens_include_any(Tokens, ["fraqueza", "cobrir", "cobertura", "defensivo", "defesa", "sobreviver", "segurar", "resistencia", "bulk"]),
    !.
held_item_strategy_from_tokens(Tokens, amplify_strength) :-
    held_item_tokens_include_any(Tokens, ["forte", "forca", "potencializar", "aumentar", "dano", "ofensivo", "sweeper", "ameaca"]),
    !.
held_item_strategy_from_tokens(Tokens, cover_weakness) :-
    held_item_tokens_include_any(Tokens, ["fraqueza", "cobrir", "cobertura", "defensivo", "defesa", "sobreviver", "segurar", "resistencia", "bulk", "mitigar"]),
    !.
held_item_strategy_from_tokens(_, balanced).

held_item_tokens_include_any(Tokens, Candidates) :-
    member(Token, Tokens),
    member(Token, Candidates),
    !.

answer_held_item_recommendation_query(NameIdentifier, Strategy) :-
    pokemon_info(NameIdentifier, pokemon(ID, NameAtom, _, _, Types, Abilities, Stats)),
    !,
    display_pokemon_name(NameAtom, NameLabel),
    held_item_recommendations_for_pokemon(ID, NameAtom, Types, Abilities, Stats, Strategy, Profile, ContextMatrix, Recommendations),
    held_item_strategy_label(Strategy, StrategyLabel),
    held_item_abilities_text(Abilities, AbilitiesText),
    remember_candidate_list([NameAtom]),
    format('Bot: Recomendação de held items para ~w (~w):~n', [NameLabel, StrategyLabel]),
    writeln('  - Critério: análise contextual em 4 camadas (sinergia habilidade-item, perfil do Pokémon, quadro de possibilidades e ranking final).'),
    print_held_item_profile_summary(Profile),
    format('  - Habilidades consideradas: ~w.~n', [AbilitiesText]),
    writeln('  - Quadro de possibilidades (perfil + habilidades + sinergias):'),
    print_held_item_context_matrix(ContextMatrix),
    writeln('  - Ranking contextual final:'),
    print_held_item_recommendation_lines(Recommendations).
answer_held_item_recommendation_query(NameIdentifier, _Strategy) :-
    display_pokemon_name(NameIdentifier, NameLabel),
    format('Bot: Não consegui identificar o Pokémon para analisar held item (~w).~n', [NameLabel]).

held_item_abilities_text([], 'nenhuma habilidade catalogada').
held_item_abilities_text(Abilities, Text) :-
    maplist(display_label, Abilities, Labels),
    atomic_list_concat(Labels, ', ', Text).

print_held_item_profile_summary(Profile) :-
    held_item_bucket_label(Profile.official_bucket, BucketLabel),
    format('  - Classificação oficial detectada: ~w (~w).~n', [Profile.official_role_text, BucketLabel]),
    format('  - Eixos auxiliares de contexto (não substituem a classe oficial): wall ~w | breaker ~w | setup ~w | speed control ~w | suporte ~w | anti-contato ~w.~n',
        [Profile.wall, Profile.breaker, Profile.setup, Profile.speed_control, Profile.support, Profile.contact_punish]).

held_item_bucket_label(offensive, 'bucket ofensivo').
held_item_bucket_label(defensive, 'bucket defensivo').
held_item_bucket_label(support, 'bucket de suporte').
held_item_bucket_label(balanced, 'bucket equilibrado').

print_held_item_context_matrix([]) :-
    writeln('    * Contexto insuficiente para montar o quadro com confiança.').
print_held_item_context_matrix([context_row(Context, Weight, Entries) | Rest]) :-
    held_item_context_label(Context, ContextLabel),
    held_item_context_entries_text(Entries, EntriesText),
    format('    * ~w (peso ~w): ~w~n', [ContextLabel, Weight, EntriesText]),
    print_held_item_context_matrix_nonempty(Rest).

print_held_item_context_matrix_nonempty([]).
print_held_item_context_matrix_nonempty([context_row(Context, Weight, Entries) | Rest]) :-
    held_item_context_label(Context, ContextLabel),
    held_item_context_entries_text(Entries, EntriesText),
    format('    * ~w (peso ~w): ~w~n', [ContextLabel, Weight, EntriesText]),
    print_held_item_context_matrix_nonempty(Rest).

held_item_context_label(contact_punish, 'anti-contato').
held_item_context_label(long_game_wall, 'jogo longo defensivo').
held_item_context_label(setup_sweep, 'setup sweep').
held_item_context_label(breaker, 'break imediato').
held_item_context_label(speed_control, 'controle de velocidade').
held_item_context_label(support, 'suporte').

held_item_context_entries_text([], 'sem itens fortes nesse contexto').
held_item_context_entries_text(Entries, Text) :-
    findall(Label,
        ( member(Fit-Item, Entries),
          display_label(Item, ItemLabel),
          format(atom(Label), '~w [fit ~w]', [ItemLabel, Fit])
        ),
        Labels),
    atomic_list_concat(Labels, '; ', Text).

held_item_strategy_label(amplify_strength, 'foco em potencializar ponto forte').
held_item_strategy_label(cover_weakness, 'foco em cobrir fraquezas').
held_item_strategy_label(balanced, 'foco balanceado').

print_held_item_recommendation_lines([]) :-
    writeln('  - Não consegui pontuar itens com confiança na base atual para esse caso.').
print_held_item_recommendation_lines([Score-Item-Objective-Reason | Rest]) :-
    print_held_item_recommendation_line(Score-Item-Objective-Reason),
    print_held_item_recommendation_lines_nonempty(Rest).

print_held_item_recommendation_lines_nonempty([]).
print_held_item_recommendation_lines_nonempty([Score-Item-Objective-Reason | Rest]) :-
    print_held_item_recommendation_line(Score-Item-Objective-Reason),
    print_held_item_recommendation_lines_nonempty(Rest).

print_held_item_recommendation_line(Score-Item-Objective-Reason) :-
    display_label(Item, ItemLabel),
    held_item_objective_label(Objective, ObjectiveLabel),
    held_item_effect_text(Item, EffectText),
    format('  - ~w (~w, score ~1f): ~w. Efeito: ~w~n', [ItemLabel, ObjectiveLabel, Score, Reason, EffectText]).

held_item_objective_label(strengthen, 'potencializar').
held_item_objective_label(cover_weakness, 'cobrir fraqueza').

held_item_effect_text(Item, EffectText) :-
    held_item_description(Item, Description),
    held_item_short_effect(Description, EffectText).

held_item_description(Item, Description) :-
    current_predicate(item_entry/6),
    item_entry(Item, _Category, _Cost, _FlingPower, _FlingEffect, RawDescription),
    !,
    input_to_string(RawDescription, Description).
held_item_description(_, 'Sem descrição curta disponível').

held_item_short_effect(Description, EffectText) :-
    ( sub_string(Description, Before, _Length, _After, '. ') ->
        sub_string(Description, 0, Before, _Rest, First)
    ; First = Description
    ),
    normalize_space(string(Normalized), First),
    ( Normalized == "" -> EffectText = Description ; EffectText = Normalized ).

held_item_recommendations_for_pokemon(ID, NameAtom, Types, Abilities, Stats, Strategy, Profile, ContextMatrix, Recommendations) :-
    pokemon_move_list_for_id(ID, NameAtom, MovesRaw, _Source),
    sort(MovesRaw, Moves),
    held_item_feature_pack(ID, Types, Abilities, Stats, Moves, Features),
    held_item_official_role_profile(NameAtom, Stats, OfficialRole, OfficialBucket, OfficialRoleText),
    held_item_build_profile(Features, OfficialRole, OfficialBucket, OfficialRoleText, Profile),
        held_item_context_weights(Features, Profile, ContextWeights),
        take_first_n(ContextWeights, 4, TopContextWeights),
        held_item_context_matrix(TopContextWeights, Features, ContextMatrix),
        findall(FinalScore-Item-Objective-FinalReason,
                ( held_item_candidate_id(Item),
                    held_item_candidate_score(Item, Features, balanced, BaseScore, BaseObjective, BaseReason),
                    held_item_contextual_bonus(Strategy, ContextWeights, Item, Features, ContextBonus, ContextObjective, ContextReason),
                    held_item_ability_item_bonus(Features.abilities, Item, AbilityBonus, AbilityReason),
                    held_item_merge_objective(BaseObjective, ContextObjective, Objective),
                    held_item_strategy_adjustment(Strategy, Objective, StrategyAdj),
                    FinalScore is BaseScore + ContextBonus + AbilityBonus + StrategyAdj,
                    FinalScore > 0,
                    held_item_compose_reason(BaseReason, ContextReason, AbilityReason, FinalReason)
                ),
                ScoredRaw),
    ( ScoredRaw == [] ->
        Recommendations = []
    ; keysort(ScoredRaw, ScoredAsc),
      reverse(ScoredAsc, ScoredDesc),
      take_first_n(ScoredDesc, 5, Recommendations)
    ).

held_item_feature_pack(PokemonID, Types, Abilities, Stats, Moves, Features) :-
    offensive_bias(Stats, Bias),
    stat_value(Stats, attack, Atk),
    stat_value(Stats, special_attack, SpAtk),
    stat_value(Stats, speed, Speed),
    stat_value(Stats, hp, HP),
    stat_value(Stats, defense, Def),
    stat_value(Stats, special_defense, SpDef),
    OffensePeak is max(Atk, SpAtk),
    BulkAverage is (HP + Def + SpDef) / 3.0,
    combined_multiplier(rock, Types, RockWeakMult),
    held_item_move_category_counts(Moves, OffensiveCount, StatusCount),
    held_item_bool_has_any_move(Moves, [swords_dance, dragon_dance, nasty_plot, quiver_dance, calm_mind, bulk_up, shell_smash, agility, coil, work_up, belly_drum], HasSetup),
    held_item_bool_has_any_move(Moves, [roost, recover, slack_off, soft_boiled, synthesis, morning_sun, moonlight, wish, rest], HasRecovery),
    held_item_bool_has_any_move(Moves, [u_turn, volt_switch, flip_turn, parting_shot, teleport], HasPivot),
    held_item_bool_has_any_move(Moves, [reflect, light_screen, aurora_veil], HasScreens),
    held_item_bool_has_any_move(Moves, [stealth_rock, spikes, toxic_spikes, sticky_web], HasHazards),
    held_item_bool_has_any_move(Moves, [leech_seed], HasLeechSeed),
    held_item_bool_has_any_move(Moves, [electric_terrain, psychic_terrain, grassy_terrain, misty_terrain], HasTerrainMove),
    held_item_bool_has_any_move(Moves, [close_combat, superpower, draco_meteor, leaf_storm, overheat, make_it_rain, v_create], HasSelfDropMove),
    held_item_bool_has_any_move(Moves, [facade], HasFacade),
    held_item_bool_has_any_move(Moves, [acrobatics], HasAcrobatics),
    held_item_bool_member(unburden, Abilities, HasUnburden),
    held_item_bool_member(guts, Abilities, HasGuts),
    held_item_bool_member(poison_heal, Abilities, HasPoisonHeal),
    held_item_bool_member(magic_guard, Abilities, HasMagicGuard),
    held_item_bool_member(regenerator, Abilities, HasRegenerator),
    held_item_bool_member(multiscale, Abilities, HasMultiscale),
    held_item_bool_member(sturdy, Abilities, HasSturdy),
    held_item_bool_has_any_ability(Abilities, [iron_barbs, rough_skin, flame_body, static], HasContactPunishAbility),
    held_item_bool_member(poison, Types, IsPoisonType),
    held_item_bool_can_evolve(PokemonID, CanEvolve),
    PhysicalBulk is (HP + Def) / 2.0,
    SpecialBulk is (HP + SpDef) / 2.0,
    Features = held_features{
        bias:Bias,
        abilities:Abilities,
        offense_peak:OffensePeak,
        speed:Speed,
        bulk_avg:BulkAverage,
        physical_bulk:PhysicalBulk,
        special_bulk:SpecialBulk,
        rock_weak_mult:RockWeakMult,
        offensive_count:OffensiveCount,
        status_count:StatusCount,
        has_setup:HasSetup,
        has_recovery:HasRecovery,
        has_pivot:HasPivot,
        has_screens:HasScreens,
        has_hazards:HasHazards,
        has_leech_seed:HasLeechSeed,
        has_terrain_move:HasTerrainMove,
        has_self_drop_move:HasSelfDropMove,
        has_facade:HasFacade,
        has_acrobatics:HasAcrobatics,
        has_unburden:HasUnburden,
        has_guts:HasGuts,
        has_poison_heal:HasPoisonHeal,
        has_magic_guard:HasMagicGuard,
        has_regenerator:HasRegenerator,
        has_multiscale:HasMultiscale,
        has_sturdy:HasSturdy,
        has_contact_punish_ability:HasContactPunishAbility,
        is_poison_type:IsPoisonType,
        can_evolve:CanEvolve
    }.

held_item_move_category_counts(Moves, OffensiveCount, StatusCount) :-
    findall(Category,
        ( member(Move, Moves),
          held_item_move_category(Move, Category)
        ),
        Categories),
    include(offensive_move_category, Categories, OffensiveCategories),
    length(OffensiveCategories, OffensiveCount),
    length(Categories, TotalCount),
    StatusCount is max(0, TotalCount - OffensiveCount).

held_item_move_category(Move, Category) :-
    move_data(Move, _Type, Category, _BasePower, _Accuracy, _PP, _Tags, _EffectChance, _Ailment, _EffectCategory, _Description),
    !.
held_item_move_category(_, status).

held_item_bool_has_any_move(Moves, CandidateMoves, true) :-
    has_any_move(Moves, CandidateMoves),
    !.
held_item_bool_has_any_move(_, _, false).

held_item_bool_member(Value, Values, true) :-
    member(Value, Values),
    !.
held_item_bool_member(_, _, false).

held_item_bool_has_any_ability(Abilities, CandidateAbilities, true) :-
    member(Ability, Abilities),
    member(Ability, CandidateAbilities),
    !.
held_item_bool_has_any_ability(_, _, false).

held_item_bool_can_evolve(PokemonID, true) :-
    level_gate_species_id(PokemonID, SpeciesID),
    pokemon_evolution(SpeciesID, _ToID, _Trigger, _MinLevel, _Condition),
    !.
held_item_bool_can_evolve(_, false).

held_item_candidate_id(focus_sash).
held_item_candidate_id(life_orb).
held_item_candidate_id(choice_band).
held_item_candidate_id(choice_specs).
held_item_candidate_id(choice_scarf).
held_item_candidate_id(leftovers).
held_item_candidate_id(assault_vest).
held_item_candidate_id(heavy_duty_boots).
held_item_candidate_id(eviolite).
held_item_candidate_id(weakness_policy).
held_item_candidate_id(flame_orb).
held_item_candidate_id(toxic_orb).
held_item_candidate_id(black_sludge).
held_item_candidate_id(light_clay).
held_item_candidate_id(rocky_helmet).
held_item_candidate_id(electric_seed).
held_item_candidate_id(psychic_seed).
held_item_candidate_id(grassy_seed).
held_item_candidate_id(misty_seed).
held_item_candidate_id(white_herb).

held_item_strategy_adjustment(balanced, _Objective, 0).
held_item_strategy_adjustment(amplify_strength, strengthen, 12).
held_item_strategy_adjustment(amplify_strength, cover_weakness, -6).
held_item_strategy_adjustment(cover_weakness, cover_weakness, 12).
held_item_strategy_adjustment(cover_weakness, strengthen, -6).

held_item_bonus_if(Condition, TrueBonus, FalseBonus, Bonus) :-
    ( call(Condition) ->
        Bonus = TrueBonus
    ; Bonus = FalseBonus
    ).

held_item_candidate_score(focus_sash, Features, Strategy, Score, cover_weakness, Reason) :-
    Base = 30,
    held_item_bonus_if(Features.speed >= 100, 8, 0, SpeedBonus),
    held_item_bonus_if(Features.has_setup == true, 10, 0, SetupBonus),
    held_item_bonus_if(Features.bulk_avg =< 85, 8, 0, FragileBonus),
    held_item_bonus_if(Features.has_unburden == true, 32, 0, UnburdenBonus),
    held_item_bonus_if(Features.has_acrobatics == true, 8, 0, AcrobaticsBonus),
    held_item_strategy_adjustment(Strategy, cover_weakness, StrategyAdj),
    Score is Base + SpeedBonus + SetupBonus + FragileBonus + UnburdenBonus + AcrobaticsBonus + StrategyAdj,
    ( Features.has_unburden == true ->
        Reason = 'turno de sobrevivência garantido e ativação de Unburden após consumo, criando janela forte de setup'
    ; Reason = 'sobrevive a um golpe letal em HP cheio e compra um turno crítico para setup ou pressão inicial'
    ).

held_item_candidate_score(rocky_helmet, Features, Strategy, Score, cover_weakness,
    'pune ataques de contato e transforma o papel defensivo em pressão passiva constante') :-
    Base = 16,
    held_item_bonus_if(Features.has_contact_punish_ability == true, 34, 0, ContactAbilityBonus),
    held_item_bonus_if(Features.bulk_avg >= 95, 14, 4, BulkBonus),
    held_item_bonus_if(Features.speed =< 70, 6, 0, SlowWallBonus),
    held_item_strategy_adjustment(Strategy, cover_weakness, StrategyAdj),
    Score is Base + ContactAbilityBonus + BulkBonus + SlowWallBonus + StrategyAdj.

held_item_candidate_score(life_orb, Features, Strategy, Score, strengthen,
    'amplifica dano bruto e funciona melhor em kit ofensivo com vários golpes de ataque') :-
    Base = 26,
    held_item_bonus_if(Features.offense_peak >= 110, 16, 0, OffenseHighBonus),
    held_item_bonus_if(Features.offense_peak >= 95, 8, 0, OffenseMidBonus),
    OffenseBonus is max(OffenseHighBonus, OffenseMidBonus),
    held_item_bonus_if(Features.offensive_count >= 6, 10, 0, MoveHighBonus),
    held_item_bonus_if(Features.offensive_count >= 4, 5, 0, MoveMidBonus),
    MoveBonus is max(MoveHighBonus, MoveMidBonus),
    held_item_bonus_if(Features.has_setup == true, 6, 0, SetupBonus),
    held_item_bonus_if(Features.bulk_avg =< 78, -8, 0, BulkPenalty),
    held_item_strategy_adjustment(Strategy, strengthen, StrategyAdj),
    Score is Base + OffenseBonus + MoveBonus + SetupBonus + BulkPenalty + StrategyAdj.

held_item_candidate_score(choice_band, Features, Strategy, Score, strengthen,
    'eleva o teto de dano físico quando o movepool é majoritariamente ofensivo e pouco dependente de status') :-
    Base = 8,
    held_item_bonus_if(Features.bias == physical, 24, -18, BiasBonus),
    held_item_bonus_if(Features.offense_peak >= 120, 10, 0, OffenseHighBonus),
    held_item_bonus_if(Features.offense_peak >= 105, 5, 0, OffenseMidBonus),
    OffenseBonus is max(OffenseHighBonus, OffenseMidBonus),
    held_item_bonus_if(Features.status_count =< 2, 8, -10, StatusPenalty),
    held_item_bonus_if(Features.has_setup == true, -6, 0, SetupPenalty),
    held_item_strategy_adjustment(Strategy, strengthen, StrategyAdj),
    Score is Base + BiasBonus + OffenseBonus + StatusPenalty + SetupPenalty + StrategyAdj.

held_item_candidate_score(choice_specs, Features, Strategy, Score, strengthen,
    'eleva o teto de dano especial quando o movepool é majoritariamente ofensivo e pouco dependente de status') :-
    Base = 8,
    held_item_bonus_if(Features.bias == special, 24, -18, BiasBonus),
    held_item_bonus_if(Features.offense_peak >= 120, 10, 0, OffenseHighBonus),
    held_item_bonus_if(Features.offense_peak >= 105, 5, 0, OffenseMidBonus),
    OffenseBonus is max(OffenseHighBonus, OffenseMidBonus),
    held_item_bonus_if(Features.status_count =< 2, 8, -10, StatusPenalty),
    held_item_bonus_if(Features.has_setup == true, -6, 0, SetupPenalty),
    held_item_strategy_adjustment(Strategy, strengthen, StrategyAdj),
    Score is Base + BiasBonus + OffenseBonus + StatusPenalty + SetupPenalty + StrategyAdj.

held_item_candidate_score(choice_scarf, Features, Strategy, Score, cover_weakness,
    'corrige matchup de velocidade e melhora revenge kill em perfis ofensivos ou de pivot') :-
    Base = 12,
    held_item_bonus_if(Features.speed < 95, 18, 0, SpeedLowBonus),
    held_item_bonus_if(Features.speed < 110, 10, -4, SpeedMidBonus),
    SpeedBonus is max(SpeedLowBonus, SpeedMidBonus),
    held_item_bonus_if(Features.offense_peak >= 100, 8, 0, OffenseBonus),
    held_item_bonus_if(Features.has_pivot == true, 6, 0, PivotBonus),
    held_item_strategy_adjustment(Strategy, cover_weakness, StrategyAdj),
    Score is Base + SpeedBonus + OffenseBonus + PivotBonus + StrategyAdj.

held_item_candidate_score(leftovers, Features, Strategy, Score, cover_weakness,
    'ganho passivo de HP por turno para aumentar consistência em trocas e jogos longos') :-
    Base = 18,
    held_item_bonus_if(Features.bulk_avg >= 95, 16, 0, BulkHighBonus),
    held_item_bonus_if(Features.bulk_avg >= 85, 8, 0, BulkMidBonus),
    BulkBonus is max(BulkHighBonus, BulkMidBonus),
    held_item_bonus_if(Features.has_recovery == true, 6, 0, RecoveryBonus),
    held_item_bonus_if(Features.status_count >= 3, 4, 0, UtilityBonus),
    held_item_strategy_adjustment(Strategy, cover_weakness, StrategyAdj),
    Score is Base + BulkBonus + RecoveryBonus + UtilityBonus + StrategyAdj.

held_item_candidate_score(assault_vest, Features, Strategy, Score, cover_weakness,
    'aumenta especial bulk em Pokémon com kit majoritariamente ofensivo e sem dependência de golpes de status') :-
    Base = 10,
    held_item_bonus_if(Features.status_count =< 1, 18, 0, StatusHighBonus),
    held_item_bonus_if(Features.status_count =< 2, 8, -14, StatusMidBonus),
    StatusBonus is max(StatusHighBonus, StatusMidBonus),
    held_item_bonus_if(Features.bulk_avg >= 85, 8, 0, BulkBonus),
    held_item_bonus_if(Features.has_setup == true, -8, 0, SetupPenalty),
    held_item_strategy_adjustment(Strategy, cover_weakness, StrategyAdj),
    Score is Base + StatusBonus + BulkBonus + SetupPenalty + StrategyAdj.

held_item_candidate_score(heavy_duty_boots, Features, Strategy, Score, cover_weakness,
    'remove pressão de hazards e facilita pivots repetidos durante a partida') :-
    Base = 10,
    held_item_bonus_if(Features.rock_weak_mult >= 4.0, 26, 0, RockHighBonus),
    held_item_bonus_if(Features.rock_weak_mult >= 2.0, 18, 0, RockMidBonus),
    RockBonus is max(RockHighBonus, RockMidBonus),
    held_item_bonus_if(Features.has_pivot == true, 8, 0, PivotBonus),
    held_item_bonus_if(Features.speed >= 100, 4, 0, SpeedBonus),
    held_item_strategy_adjustment(Strategy, cover_weakness, StrategyAdj),
    Score is Base + RockBonus + PivotBonus + SpeedBonus + StrategyAdj.

held_item_candidate_score(eviolite, Features, Strategy, Score, cover_weakness,
    'excelente para estágios não finalizados, elevando defesa física e especial simultaneamente') :-
    held_item_bonus_if(Features.can_evolve == true, 34, -50, Base),
    held_item_bonus_if(Features.bulk_avg >= 80, 12, 6, BulkBonus),
    held_item_strategy_adjustment(Strategy, cover_weakness, StrategyAdj),
    Score is Base + BulkBonus + StrategyAdj.

held_item_candidate_score(weakness_policy, Features, Strategy, Score, strengthen,
    'pune hits super efetivos e pode virar sweep quando o Pokémon aguenta o primeiro golpe') :-
    Base = 8,
    held_item_bonus_if(Features.bulk_avg >= 92, 12, 0, BulkBonus),
    held_item_bonus_if(Features.has_setup == true, 10, 0, SetupBonus),
    held_item_bonus_if(Features.offense_peak >= 110, 8, 0, OffenseBonus),
    held_item_strategy_adjustment(Strategy, strengthen, StrategyAdj),
    Score is Base + BulkBonus + SetupBonus + OffenseBonus + StrategyAdj.

held_item_candidate_score(flame_orb, Features, Strategy, Score, strengthen,
    'sinergia situacional com Guts/Facade para transformar status em pressão ofensiva') :-
    held_item_bonus_if(Features.has_guts == true, 36, -30, Base),
    held_item_bonus_if(Features.has_facade == true, 10, 0, FacadeBonus),
    held_item_strategy_adjustment(Strategy, strengthen, StrategyAdj),
    Score is Base + FacadeBonus + StrategyAdj.

held_item_candidate_score(toxic_orb, Features, Strategy, Score, cover_weakness,
    'sinergia situacional com Poison Heal para recuperação contínua e maior longevidade') :-
    held_item_bonus_if(Features.has_poison_heal == true, 36, -30, Base),
    held_item_bonus_if(Features.has_facade == true, 8, 0, FacadeBonus),
    held_item_strategy_adjustment(Strategy, cover_weakness, StrategyAdj),
    Score is Base + FacadeBonus + StrategyAdj.

held_item_candidate_score(black_sludge, Features, Strategy, Score, cover_weakness,
    'recuperação passiva sólida para tipos Poison em jogos longos') :-
    held_item_bonus_if(Features.is_poison_type == true, 24, -25, Base),
    held_item_bonus_if(Features.bulk_avg >= 85, 6, 0, BulkBonus),
    held_item_strategy_adjustment(Strategy, cover_weakness, StrategyAdj),
    Score is Base + BulkBonus + StrategyAdj.

held_item_candidate_score(light_clay, Features, Strategy, Score, cover_weakness,
    'estende Reflect/Light Screen para suporte de equipe quando o kit já usa telas') :-
    held_item_bonus_if(Features.has_screens == true, 30, -20, Base),
    held_item_strategy_adjustment(Strategy, cover_weakness, StrategyAdj),
    Score is Base + StrategyAdj.

held_item_candidate_score(electric_seed, Features, Strategy, Score, strengthen,
    'consumível que ativa Unburden e melhora bulk físico quando há Electric Terrain') :-
    held_item_bonus_if(Features.has_unburden == true, 34, -12, Base),
    held_item_bonus_if(Features.has_setup == true, 10, 0, SetupBonus),
    held_item_bonus_if(Features.has_terrain_move == true, 14, 0, TerrainSelfBonus),
    held_item_strategy_adjustment(Strategy, strengthen, StrategyAdj),
    Score is Base + SetupBonus + TerrainSelfBonus + StrategyAdj.

held_item_candidate_score(psychic_seed, Features, Strategy, Score, strengthen,
    'consumível que ativa Unburden e melhora bulk especial quando há Psychic Terrain') :-
    held_item_bonus_if(Features.has_unburden == true, 34, -12, Base),
    held_item_bonus_if(Features.has_setup == true, 10, 0, SetupBonus),
    held_item_bonus_if(Features.has_terrain_move == true, 14, 0, TerrainSelfBonus),
    held_item_strategy_adjustment(Strategy, strengthen, StrategyAdj),
    Score is Base + SetupBonus + TerrainSelfBonus + StrategyAdj.

held_item_candidate_score(grassy_seed, Features, Strategy, Score, strengthen,
    'consumível que ativa Unburden e melhora bulk físico quando há Grassy Terrain') :-
    held_item_bonus_if(Features.has_unburden == true, 34, -12, Base),
    held_item_bonus_if(Features.has_setup == true, 10, 0, SetupBonus),
    held_item_bonus_if(Features.has_terrain_move == true, 14, 0, TerrainSelfBonus),
    held_item_strategy_adjustment(Strategy, strengthen, StrategyAdj),
    Score is Base + SetupBonus + TerrainSelfBonus + StrategyAdj.

held_item_candidate_score(misty_seed, Features, Strategy, Score, strengthen,
    'consumível que ativa Unburden e melhora bulk especial quando há Misty Terrain') :-
    held_item_bonus_if(Features.has_unburden == true, 34, -12, Base),
    held_item_bonus_if(Features.has_setup == true, 10, 0, SetupBonus),
    held_item_bonus_if(Features.has_terrain_move == true, 14, 0, TerrainSelfBonus),
    held_item_strategy_adjustment(Strategy, strengthen, StrategyAdj),
    Score is Base + SetupBonus + TerrainSelfBonus + StrategyAdj.

held_item_candidate_score(white_herb, Features, Strategy, Score, strengthen,
    'mitiga queda de status e pode ativar Unburden em sets com Close Combat/Superpower') :-
    held_item_bonus_if(Features.has_self_drop_move == true, 34, -8, Base),
    held_item_bonus_if(Features.has_unburden == true, 24, 0, UnburdenBonus),
    held_item_bonus_if(Features.has_setup == true, 8, 0, SetupBonus),
    held_item_strategy_adjustment(Strategy, strengthen, StrategyAdj),
    Score is Base + UnburdenBonus + SetupBonus + StrategyAdj.

held_item_official_role_profile(Identifier, Stats, OfficialRole, OfficialBucket, OfficialRoleText) :-
    compare_role_key(Identifier, Stats, OfficialRole, OfficialBucket),
    role_label(OfficialRole, OfficialRoleText),
    !.
held_item_official_role_profile(_Identifier, _Stats, balanced, balanced, 'Equilibrado (perfil misto sem extremo dominante)').

held_item_build_profile(Features, OfficialRole, OfficialBucket, OfficialRoleText, Profile) :-
    held_item_bonus_if(Features.bulk_avg >= 105, 32, 0, WallBulkHigh),
    held_item_bonus_if(Features.bulk_avg >= 92, 18, 0, WallBulkMid),
    WallBulkBonus is max(WallBulkHigh, WallBulkMid),
    held_item_bonus_if(Features.has_recovery == true, 16, 0, WallRecoveryBonus),
    held_item_bonus_if(Features.has_hazards == true, 12, 0, WallHazardBonus),
    held_item_bonus_if(Features.has_leech_seed == true, 10, 0, WallLeechSeedBonus),
    held_item_bonus_if(Features.speed =< 65, 8, 0, WallSlowBonus),
    WallRaw is WallBulkBonus + WallRecoveryBonus + WallHazardBonus + WallLeechSeedBonus + WallSlowBonus,
    held_item_cap_score(WallRaw, WallScore),

    held_item_bonus_if(Features.offense_peak >= 125, 42, 0, BreakerOffenseHigh),
    held_item_bonus_if(Features.offense_peak >= 108, 28, 0, BreakerOffenseMid),
    BreakerOffenseBonus is max(BreakerOffenseHigh, BreakerOffenseMid),
    held_item_bonus_if(Features.offensive_count >= 6, 16, 8, BreakerMoveBonus),
    held_item_bonus_if(Features.speed >= 90, 10, 0, BreakerSpeedBonus),
    BreakerRaw is BreakerOffenseBonus + BreakerMoveBonus + BreakerSpeedBonus,
    held_item_cap_score(BreakerRaw, BreakerScore),

    held_item_bonus_if(Features.has_setup == true, 34, 0, SetupBaseBonus),
    held_item_bonus_if(Features.offense_peak >= 105, 20, 0, SetupOffenseBonus),
    held_item_bonus_if(Features.speed >= 80, 12, 0, SetupSpeedBonus),
    SetupRaw is SetupBaseBonus + SetupOffenseBonus + SetupSpeedBonus,
    held_item_cap_score(SetupRaw, SetupScore),

    held_item_bonus_if(Features.speed < 70, 34, 0, SpeedControlSlowBonus),
    held_item_bonus_if(Features.speed < 95, 18, 0, SpeedControlMidBonus),
    SpeedControlBase is max(SpeedControlSlowBonus, SpeedControlMidBonus),
    held_item_bonus_if(Features.offense_peak >= 100, 12, 0, SpeedControlOffenseBonus),
    held_item_bonus_if(Features.has_pivot == true, 10, 0, SpeedControlPivotBonus),
    SpeedControlRaw is SpeedControlBase + SpeedControlOffenseBonus + SpeedControlPivotBonus,
    held_item_cap_score(SpeedControlRaw, SpeedControlScore),

    held_item_bonus_if(Features.has_screens == true, 34, 0, SupportScreensBonus),
    held_item_bonus_if(Features.has_hazards == true, 24, 0, SupportHazardsBonus),
    held_item_bonus_if(Features.has_pivot == true, 12, 0, SupportPivotBonus),
    held_item_bonus_if(Features.status_count >= 3, 8, 0, SupportStatusBonus),
    SupportRaw is SupportScreensBonus + SupportHazardsBonus + SupportPivotBonus + SupportStatusBonus,
    held_item_cap_score(SupportRaw, SupportScore),

    held_item_bonus_if(Features.has_contact_punish_ability == true, 58, 0, ContactAbilityScore),
    held_item_bonus_if(Features.bulk_avg >= 95, 20, 0, ContactBulkScore),
    held_item_bonus_if(Features.speed =< 70, 8, 0, ContactSlowScore),
    ContactRaw is ContactAbilityScore + ContactBulkScore + ContactSlowScore,
    held_item_cap_score(ContactRaw, ContactPunishScore),

    Profile = held_profile{
        official_role:OfficialRole,
        official_bucket:OfficialBucket,
        official_role_text:OfficialRoleText,
        wall:WallScore,
        breaker:BreakerScore,
        setup:SetupScore,
        speed_control:SpeedControlScore,
        support:SupportScore,
        contact_punish:ContactPunishScore
    }.

held_item_cap_score(Value, Capped) :-
    Limited is max(0.0, min(100.0, Value)),
    Capped is round(Limited).

held_item_context_weights(_Features, Profile, ContextWeights) :-
    held_item_official_role_context_boosts(Profile.official_role, RoleBoosts),
    held_item_context_weight(Profile.wall, RoleBoosts, long_game_wall, WallWeight),
    held_item_context_weight(Profile.breaker, RoleBoosts, breaker, BreakerWeight),
    held_item_context_weight(Profile.setup, RoleBoosts, setup_sweep, SetupWeight),
    held_item_context_weight(Profile.speed_control, RoleBoosts, speed_control, SpeedControlWeight),
    held_item_context_weight(Profile.support, RoleBoosts, support, SupportWeight),
    held_item_context_weight(Profile.contact_punish, RoleBoosts, contact_punish, ContactWeight),
    Raw = [
        ContactWeight-contact_punish,
        WallWeight-long_game_wall,
        SetupWeight-setup_sweep,
        BreakerWeight-breaker,
        SpeedControlWeight-speed_control,
        SupportWeight-support
    ],
    findall(Weight-Context,
        ( member(Weight-Context, Raw),
          Weight >= 10
        ),
        Filtered),
    keysort(Filtered, SortedAsc),
    reverse(SortedAsc, ContextWeights).

held_item_context_weight(Base, RoleBoosts, Context, FinalWeight) :-
    held_item_context_boost(RoleBoosts, Context, Boost),
    Raw is Base + Boost,
    held_item_cap_score(Raw, FinalWeight).

held_item_context_boost(RoleBoosts, Context, Boost) :-
    member(Context-Boost, RoleBoosts),
    !.
held_item_context_boost(_RoleBoosts, _Context, 0).

held_item_official_role_context_boosts(physical_wall,
    [long_game_wall-35, contact_punish-20, support-10]).
held_item_official_role_context_boosts(special_wall,
    [long_game_wall-35, support-12]).
held_item_official_role_context_boosts(tank,
    [long_game_wall-28, breaker-12, contact_punish-8]).
held_item_official_role_context_boosts(setup_sweeper,
    [setup_sweep-32, breaker-18, speed_control-8]).
held_item_official_role_context_boosts(physical_sweeper,
    [breaker-34, speed_control-18, setup_sweep-8]).
held_item_official_role_context_boosts(special_sweeper,
    [breaker-34, speed_control-18, setup_sweep-8]).
held_item_official_role_context_boosts(lead,
    [support-20, speed_control-15, breaker-8]).
held_item_official_role_context_boosts(hazard_setter,
    [support-34, long_game_wall-14]).
held_item_official_role_context_boosts(hazard_remover,
    [support-30, speed_control-12]).
held_item_official_role_context_boosts(pivot_volt_turn,
    [support-24, speed_control-24, breaker-8]).
held_item_official_role_context_boosts(cleric,
    [support-34, long_game_wall-16]).
held_item_official_role_context_boosts(support_utility,
    [support-34, long_game_wall-10, speed_control-8]).
held_item_official_role_context_boosts(balanced,
    [long_game_wall-8, breaker-8, setup_sweep-8, speed_control-8, support-8, contact_punish-8]).

held_item_context_matrix(ContextWeights, Features, Matrix) :-
    findall(context_row(Context, Weight, TopEntries),
        ( member(Weight-Context, ContextWeights),
          Weight >= 18,
          findall(Fit-Item,
            ( held_item_candidate_id(Item),
              held_item_item_fit_in_context(Context, Item, Features, Fit, _Objective, _Reason),
              Fit > 0
            ),
            FitsRaw),
          FitsRaw \= [],
          keysort(FitsRaw, FitsAsc),
          reverse(FitsAsc, FitsDesc),
          take_first_n(FitsDesc, 3, TopEntries)
        ),
        Matrix).

held_item_strategy_context_multiplier(balanced, _Context, 1.0).
held_item_strategy_context_multiplier(amplify_strength, breaker, 1.25).
held_item_strategy_context_multiplier(amplify_strength, setup_sweep, 1.25).
held_item_strategy_context_multiplier(amplify_strength, speed_control, 1.10).
held_item_strategy_context_multiplier(amplify_strength, support, 0.80).
held_item_strategy_context_multiplier(amplify_strength, long_game_wall, 0.75).
held_item_strategy_context_multiplier(amplify_strength, contact_punish, 0.80).
held_item_strategy_context_multiplier(cover_weakness, contact_punish, 1.30).
held_item_strategy_context_multiplier(cover_weakness, long_game_wall, 1.25).
held_item_strategy_context_multiplier(cover_weakness, support, 1.10).
held_item_strategy_context_multiplier(cover_weakness, speed_control, 1.00).
held_item_strategy_context_multiplier(cover_weakness, setup_sweep, 0.75).
held_item_strategy_context_multiplier(cover_weakness, breaker, 0.70).

held_item_contextual_bonus(Strategy, ContextWeights, Item, Features, Bonus, Objective, Reason) :-
    findall(Contribution-LocalObjective-LocalReason,
        ( member(Weight-Context, ContextWeights),
          held_item_item_fit_in_context(Context, Item, Features, Fit, LocalObjective, LocalReason),
          held_item_strategy_context_multiplier(Strategy, Context, Multiplier),
          Contribution is (Weight * Fit * Multiplier) / 100.0
        ),
        Contributions),
    ( Contributions == [] ->
        Bonus = 0,
        Objective = none,
        Reason = ''
    ; keysort(Contributions, SortedAsc),
      reverse(SortedAsc, SortedDesc),
      SortedDesc = [_BestContribution-Objective-Reason | _],
      findall(Value, member(Value-_-_, SortedDesc), Values),
      sum_list(Values, Total),
      Bonus is Total / 5.0
    ).

held_item_ability_item_bonus(Abilities, Item, Bonus, Reason) :-
    findall(Score-Ability-Text,
        ( member(Ability, Abilities),
          held_item_ability_item_rule(Ability, Item, Score, Text)
        ),
        Synergies),
    ( Synergies == [] ->
        Bonus = 0,
        Reason = ''
    ; findall(Value, member(Value-_-_, Synergies), Values),
      sum_list(Values, Bonus),
      keysort(Synergies, SynergyAsc),
      reverse(SynergyAsc, [_TopScore-TopAbility-TopText | _]),
      display_label(TopAbility, AbilityLabel),
      format(atom(Reason), 'sinergia direta com ~w: ~w', [AbilityLabel, TopText])
    ).

held_item_ability_item_rule(iron_barbs, rocky_helmet, 58, 'chip acumulado em golpes de contato').
held_item_ability_item_rule(rough_skin, rocky_helmet, 52, 'chip acumulado em golpes de contato').
held_item_ability_item_rule(flame_body, rocky_helmet, 22, 'força trocas ao punir contato').
held_item_ability_item_rule(static, rocky_helmet, 22, 'força trocas ao punir contato').
held_item_ability_item_rule(unburden, focus_sash, 34, 'item consumível ativa boost de Speed com segurança').
held_item_ability_item_rule(unburden, electric_seed, 36, 'ativa Unburden em times com Electric Terrain').
held_item_ability_item_rule(unburden, psychic_seed, 36, 'ativa Unburden em times com Psychic Terrain').
held_item_ability_item_rule(unburden, grassy_seed, 36, 'ativa Unburden em times com Grassy Terrain').
held_item_ability_item_rule(unburden, misty_seed, 36, 'ativa Unburden em times com Misty Terrain').
held_item_ability_item_rule(unburden, white_herb, 28, 'consumo do item pode ativar Unburden em sequência de pressão').
held_item_ability_item_rule(guts, flame_orb, 40, 'converte burn em pressão ofensiva estável').
held_item_ability_item_rule(poison_heal, toxic_orb, 40, 'ativa recuperação por turno com consistência').
held_item_ability_item_rule(magic_guard, life_orb, 30, 'mantém boost ofensivo sem recuo de Life Orb').
held_item_ability_item_rule(regenerator, assault_vest, 18, 'compensa ausência de recovery no pivot').
held_item_ability_item_rule(multiscale, heavy_duty_boots, 20, 'preserva HP cheio e ativa Multiscale com mais frequência').
held_item_ability_item_rule(sturdy, heavy_duty_boots, 14, 'facilita manutenção de HP cheio para manter Sturdy ativo').

held_item_merge_objective(BaseObjective, none, BaseObjective).
held_item_merge_objective(_BaseObjective, ContextObjective, ContextObjective).

held_item_compose_reason(BaseReason, ContextReason, AbilityReason, FinalReason) :-
    findall(Part,
        held_item_compose_reason_part(BaseReason, ContextReason, AbilityReason, Part),
        Parts),
    atomic_list_concat(Parts, '; ', FinalReason).

held_item_compose_reason_part(BaseReason, _ContextReason, _AbilityReason, BaseReason).
held_item_compose_reason_part(_BaseReason, ContextReason, _AbilityReason, Part) :-
    held_item_non_empty_text(ContextReason),
    format(atom(Part), 'contexto: ~w', [ContextReason]).
held_item_compose_reason_part(_BaseReason, _ContextReason, AbilityReason, Part) :-
    held_item_non_empty_text(AbilityReason),
    format(atom(Part), 'habilidade: ~w', [AbilityReason]).

held_item_non_empty_text(Text) :-
    nonvar(Text),
    Text \= ''.

held_item_item_fit_in_context(contact_punish, rocky_helmet, Features, Fit, cover_weakness,
    'ideal para parede que pune contato continuamente') :-
    held_item_bonus_if(Features.has_contact_punish_ability == true, 95, 62, Fit).
held_item_item_fit_in_context(contact_punish, leftovers, _Features, 42, cover_weakness,
    'sustenta o ciclo de trocas para manter punição passiva').
held_item_item_fit_in_context(contact_punish, assault_vest, _Features, 35, cover_weakness,
    'ajuda a segurar hits especiais enquanto pressiona por chip').

held_item_item_fit_in_context(long_game_wall, leftovers, _Features, 92, cover_weakness,
    'melhor consistência para jogos longos').
held_item_item_fit_in_context(long_game_wall, rocky_helmet, Features, Fit, cover_weakness,
    'transforma switch-ins físicos em custo para o oponente') :-
    held_item_bonus_if(Features.has_contact_punish_ability == true, 86, 70, Fit).
held_item_item_fit_in_context(long_game_wall, black_sludge, Features, Fit, cover_weakness,
    'equivalente ao Leftovers para tipo Poison') :-
    held_item_bonus_if(Features.is_poison_type == true, 90, 10, Fit).
held_item_item_fit_in_context(long_game_wall, eviolite, Features, Fit, cover_weakness,
    'forte incremento de bulk em estágio não finalizado') :-
    held_item_bonus_if(Features.can_evolve == true, 88, 0, Fit).
held_item_item_fit_in_context(long_game_wall, heavy_duty_boots, Features, Fit, cover_weakness,
    'reduz dano indireto e melhora frequência de entrada') :-
    held_item_bonus_if(Features.rock_weak_mult >= 2.0, 70, 32, Fit).

held_item_item_fit_in_context(setup_sweep, focus_sash, Features, Fit, strengthen,
    'garante turno de setup em matchups agressivos') :-
    held_item_bonus_if(Features.has_setup == true, 90, 62, Fit).
held_item_item_fit_in_context(setup_sweep, life_orb, _Features, 84, strengthen,
    'maximiza snowball após setup').
held_item_item_fit_in_context(setup_sweep, white_herb, Features, Fit, strengthen,
    'boa em sets com queda de status e pressão contínua') :-
    held_item_bonus_if(Features.has_self_drop_move == true, 86, 42, Fit).
held_item_item_fit_in_context(setup_sweep, electric_seed, Features, Fit, strengthen,
    'forte em composições de terreno para ativar Unburden') :-
    held_item_bonus_if(Features.has_unburden == true, 88, 18, Fit).
held_item_item_fit_in_context(setup_sweep, psychic_seed, Features, Fit, strengthen,
    'forte em composições de terreno para ativar Unburden') :-
    held_item_bonus_if(Features.has_unburden == true, 88, 18, Fit).
held_item_item_fit_in_context(setup_sweep, grassy_seed, Features, Fit, strengthen,
    'forte em composições de terreno para ativar Unburden') :-
    held_item_bonus_if(Features.has_unburden == true, 88, 18, Fit).
held_item_item_fit_in_context(setup_sweep, misty_seed, Features, Fit, strengthen,
    'forte em composições de terreno para ativar Unburden') :-
    held_item_bonus_if(Features.has_unburden == true, 88, 18, Fit).
held_item_item_fit_in_context(setup_sweep, weakness_policy, Features, Fit, strengthen,
    'ameaça reverse sweep quando o usuário aguenta hit super efetivo') :-
    held_item_bonus_if(Features.bulk_avg >= 90, 76, 52, Fit).

held_item_item_fit_in_context(breaker, life_orb, _Features, 92, strengthen,
    'aumenta dano imediato sem lock de golpe').
held_item_item_fit_in_context(breaker, choice_band, Features, Fit, strengthen,
    'maximiza pressão física de break') :-
    held_item_bonus_if(Features.bias == physical, 90, 28, Fit).
held_item_item_fit_in_context(breaker, choice_specs, Features, Fit, strengthen,
    'maximiza pressão especial de break') :-
    held_item_bonus_if(Features.bias == special, 90, 28, Fit).
held_item_item_fit_in_context(breaker, weakness_policy, _Features, 64, strengthen,
    'pico de dano quando ativado na troca certa').

held_item_item_fit_in_context(speed_control, choice_scarf, _Features, 96, cover_weakness,
    'corrige speed tier e habilita revenge kill').
held_item_item_fit_in_context(speed_control, focus_sash, _Features, 48, cover_weakness,
    'ganha turno contra ameaças mais rápidas').
held_item_item_fit_in_context(speed_control, heavy_duty_boots, Features, Fit, cover_weakness,
    'mantém frequência de entrada em perfis de pivot') :-
    held_item_bonus_if(Features.has_pivot == true, 58, 24, Fit).

held_item_item_fit_in_context(support, light_clay, Features, Fit, cover_weakness,
    'estende telas e aumenta valor do suporte') :-
    held_item_bonus_if(Features.has_screens == true, 96, 0, Fit).
held_item_item_fit_in_context(support, leftovers, _Features, 70, cover_weakness,
    'sustentação estável para ciclos utilitários').
held_item_item_fit_in_context(support, heavy_duty_boots, Features, Fit, cover_weakness,
    'mantém pivots e utilidade ativos mesmo sob hazards') :-
    held_item_bonus_if(Features.rock_weak_mult >= 2.0, 72, 36, Fit).
held_item_item_fit_in_context(support, rocky_helmet, Features, Fit, cover_weakness,
    'suporte passivo de chip para punir pressão física') :-
    held_item_bonus_if(Features.has_contact_punish_ability == true, 78, 46, Fit).


