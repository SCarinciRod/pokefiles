:- encoding(utf8).

competitive_training_profile(PokemonID, BaseStats, EVs, Nature) :-
    compare_role_key(PokemonID, BaseStats, Role, _Bucket),
    competitive_role_training(Role, BaseStats, EVs, Nature),
    !.
competitive_training_profile(_PokemonID, _BaseStats, EVs, Nature) :-
    competitive_role_training(balanced, [], EVs, Nature).

competitive_role_training(physical_sweeper, _BaseStats, evs(4, 252, 0, 0, 0, 252), nature(speed, special_attack)).
competitive_role_training(special_sweeper, _BaseStats, evs(4, 0, 0, 252, 0, 252), nature(speed, attack)).
competitive_role_training(setup_sweeper, BaseStats, EVs, Nature) :-
    stat_value(BaseStats, attack, Atk),
    stat_value(BaseStats, special_attack, SpAtk),
    ( Atk >= SpAtk ->
        EVs = evs(4, 252, 0, 0, 0, 252),
        Nature = nature(speed, special_attack)
    ; EVs = evs(4, 0, 0, 252, 0, 252),
      Nature = nature(speed, attack)
    ).
competitive_role_training(physical_wall, _BaseStats, evs(252, 0, 252, 0, 4, 0), nature(defense, special_attack)).
competitive_role_training(special_wall, _BaseStats, evs(252, 0, 4, 0, 252, 0), nature(special_defense, attack)).
competitive_role_training(tank, BaseStats, EVs, Nature) :-
    stat_value(BaseStats, attack, Atk),
    stat_value(BaseStats, special_attack, SpAtk),
    ( Atk >= SpAtk ->
        EVs = evs(252, 252, 4, 0, 0, 0),
        Nature = nature(attack, special_attack)
    ; EVs = evs(252, 0, 4, 252, 0, 0),
      Nature = nature(special_attack, attack)
    ).
competitive_role_training(lead, _BaseStats, evs(4, 0, 0, 252, 0, 252), nature(speed, attack)).
competitive_role_training(hazard_setter, _BaseStats, evs(252, 0, 252, 0, 4, 0), nature(defense, special_attack)).
competitive_role_training(hazard_remover, _BaseStats, evs(252, 0, 4, 0, 0, 252), nature(speed, attack)).
competitive_role_training(pivot_volt_turn, _BaseStats, evs(252, 0, 4, 0, 0, 252), nature(speed, special_attack)).
competitive_role_training(cleric, _BaseStats, evs(252, 0, 4, 0, 252, 0), nature(special_defense, attack)).
competitive_role_training(support_utility, _BaseStats, evs(252, 0, 4, 0, 252, 0), nature(special_defense, attack)).
competitive_role_training(balanced, _BaseStats, evs(252, 0, 84, 84, 84, 4), nature(neutral, neutral)).

compare_role_profile(Identifier, Stats, RoleText, Bucket) :-
    compare_role_key(Identifier, Stats, Role, Bucket),
    role_label(Role, RoleText).

compare_role_key(Identifier, Stats, Role, Bucket) :-
    pokemon_role_move_inventory(Identifier, Moves),
    pokemon_role_ability_inventory(Identifier, Abilities),
    stat_value(Stats, hp, HP),
    stat_value(Stats, attack, Atk),
    stat_value(Stats, defense, Def),
    stat_value(Stats, special_attack, SpAtk),
    stat_value(Stats, special_defense, SpDef),
    stat_value(Stats, speed, Speed),
    OffensePeak is max(Atk, SpAtk),
    BulkAverage is (HP + Def + SpDef) / 3.0,
    ( competitive_role_lead(Moves, Speed) ->
        Role = lead,
        Bucket = support
    ; competitive_role_setup_sweeper(Moves, Abilities, OffensePeak, Speed) ->
        Role = setup_sweeper,
        Bucket = offensive
    ; Atk >= 105, Atk >= SpAtk + 8, Speed >= 95 ->
        Role = physical_sweeper,
        Bucket = offensive
    ; SpAtk >= 105, SpAtk >= Atk + 8, Speed >= 95 ->
        Role = special_sweeper,
        Bucket = offensive
    ; Def >= 120, HP >= 85, Def >= SpDef + 15 ->
        Role = physical_wall,
        Bucket = defensive
    ; SpDef >= 120, HP >= 85, SpDef >= Def + 15 ->
        Role = special_wall,
        Bucket = defensive
    ; BulkAverage >= 105, OffensePeak >= 95 ->
        Role = tank,
        Bucket = defensive
    ; has_any_move(Moves, [stealth_rock, spikes, toxic_spikes, sticky_web]) ->
        Role = hazard_setter,
        Bucket = support
    ; has_any_move(Moves, [defog, rapid_spin, mortal_spin, court_change]) ->
        Role = hazard_remover,
        Bucket = support
    ; has_any_move(Moves, [u_turn, volt_switch, flip_turn, parting_shot, chilly_reception, teleport]) ->
        Role = pivot_volt_turn,
        Bucket = support
    ; has_any_move(Moves, [aromatherapy, heal_bell, lunar_blessing, jungle_healing]) ->
        Role = cleric,
        Bucket = support
    ; competitive_role_general_support(Moves, Speed) ->
        Role = support_utility,
        Bucket = support
    ; Role = balanced,
      Bucket = balanced
    ).

pokemon_role_move_inventory(Identifier, Moves) :-
    pokemon_info(Identifier, pokemon(ID, Name, _, _, _, _, _)),
    pokemon_move_list_for_id(ID, Name, MovesRaw, _Source),
    sort(MovesRaw, Moves),
    !.
pokemon_role_move_inventory(_Identifier, []).

pokemon_role_ability_inventory(Identifier, Abilities) :-
    pokemon_info(Identifier, pokemon(_ID, _Name, _Height, _Weight, _Types, AbilityList, _Stats)),
    sort(AbilityList, Abilities),
    !.
pokemon_role_ability_inventory(_Identifier, []).

has_any_move(Moves, Candidates) :-
    member(Move, Candidates),
    member(Move, Moves),
    !.

competitive_role_lead(Moves, Speed) :-
    has_any_move(Moves, [stealth_rock, spikes, toxic_spikes, sticky_web]),
    ( has_any_move(Moves, [taunt, encore])
    ; Speed >= 100
    ),
    !.

competitive_role_setup_sweeper(Moves, _Abilities, OffensePeak, Speed) :-
    has_any_move(Moves, [swords_dance, dragon_dance, nasty_plot, quiver_dance, calm_mind, bulk_up, shell_smash, agility, coil, work_up, belly_drum]),
    OffensePeak >= 100,
    Speed >= 80,
    !.
competitive_role_setup_sweeper(Moves, Abilities, OffensePeak, Speed) :-
    member(unburden, Abilities),
    has_any_move(Moves, [swords_dance, bulk_up, agility, work_up]),
    has_any_move(Moves, [acrobatics, close_combat, high_jump_kick, flying_press]),
    OffensePeak >= 88,
    Speed >= 105,
    !.

competitive_role_general_support(Moves, Speed) :-
    has_any_move(Moves, [will_o_wisp, thunder_wave, toxic, leech_seed, yawn, haze, reflect, light_screen, aurora_veil, trick_room]),
    ( Speed >= 80 ; has_any_move(Moves, [trick_room]) ),
    !.

role_label(physical_sweeper, 'Physical Sweeper (dano físico e pressão de velocidade)').
role_label(special_sweeper, 'Special Sweeper (dano especial e pressão de velocidade)').
role_label(setup_sweeper, 'Setup Sweeper (usa setup antes de varrer)').
role_label(physical_wall, 'Physical Wall (foco em segurar dano físico)').
role_label(special_wall, 'Special Wall (foco em segurar dano especial)').
role_label(tank, 'Tank (aguenta troca e devolve dano consistente)').
role_label(lead, 'Lead (abre partida com controle de ritmo/hazards)').
role_label(hazard_setter, 'Hazard Setter (coloca hazards no campo)').
role_label(hazard_remover, 'Hazard Remover (remove hazards do campo)').
role_label(pivot_volt_turn, 'Pivot/Volt-Turn (mantém momentum com troca ofensiva)').
role_label(cleric, 'Cleric (suporte de cura/status para o time)').
role_label(support_utility, 'Support (controle utilitário de campo e status)').
role_label(balanced, 'Equilibrado (perfil misto sem extremo dominante)').

print_role_comparison_note(BucketA, BucketB, LabelA, LabelB) :-
    ( BucketA == BucketB ->
        format('  - Leitura final: ambos têm classe tática parecida, comparação mais direta (~w vs ~w).~n', [LabelA, LabelB])
    ; format('  - Leitura final: são classes táticas diferentes; compare por função de time, não só por número bruto.~n', [])
    ).
