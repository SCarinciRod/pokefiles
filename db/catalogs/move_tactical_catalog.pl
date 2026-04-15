:- encoding(utf8).

% Central tactical tags used by strategy/item engines.
% move_tactical_role(Move, Role) can return granular and broad roles.

move_has_tactical_role(Move, Role) :-
    move_tactical_role(Move, Role),
    !.

move_tactical_catalog(Role, Moves) :-
    setof(Move, move_tactical_role(Move, Role), Moves),
    !.
move_tactical_catalog(_Role, []).

move_tactical_roles(Move, Roles) :-
    setof(Role, move_tactical_role(Move, Role), Roles),
    !.
move_tactical_roles(_Move, []).

move_tactical_role(Move, Role) :-
    move_tactical_role_seed(Move, SeedRole),
    move_tactical_role_expand(SeedRole, Role).
move_tactical_role(Move, Role) :-
    move_tactical_role_inferred(Move, InferredRole),
    move_tactical_role_expand(InferredRole, Role).

move_tactical_role_expand(Role, Role).
move_tactical_role_expand(setup_buff, buff).
move_tactical_role_expand(ally_boost, buff).
move_tactical_role_expand(screen_control, buff).
move_tactical_role_expand(disruption, debuff).
move_tactical_role_expand(speed_control, debuff).
move_tactical_role_expand(status_spread, debuff).
move_tactical_role_expand(trick_room, control).
move_tactical_role_expand(protection, control).
move_tactical_role_expand(redirection, control).
move_tactical_role_expand(fake_out, control).
move_tactical_role_expand(screen_control, control).
move_tactical_role_expand(hazard, control).
move_tactical_role_expand(hazard_clear, control).
move_tactical_role_expand(terrain_control, control).
move_tactical_role_expand(weather_control, control).
move_tactical_role_expand(pivot, control).
move_tactical_role_expand(disruption, control).
move_tactical_role_expand(speed_control, control).

move_tactical_role_seed(u_turn, pivot).
move_tactical_role_seed(volt_switch, pivot).
move_tactical_role_seed(flip_turn, pivot).
move_tactical_role_seed(parting_shot, pivot).
move_tactical_role_seed(teleport, pivot).
move_tactical_role_seed(baton_pass, pivot).
move_tactical_role_seed(shed_tail, pivot).

move_tactical_role_seed(protect, protection).
move_tactical_role_seed(detect, protection).
move_tactical_role_seed(kings_shield, protection).
move_tactical_role_seed(spiky_shield, protection).
move_tactical_role_seed(baneful_bunker, protection).
move_tactical_role_seed(obstruct, protection).
move_tactical_role_seed(silk_trap, protection).
move_tactical_role_seed(burning_bulwark, protection).
move_tactical_role_seed(wide_guard, protection).
move_tactical_role_seed(quick_guard, protection).
move_tactical_role_seed(crafty_shield, protection).
move_tactical_role_seed(mat_block, protection).

move_tactical_role_seed(follow_me, redirection).
move_tactical_role_seed(rage_powder, redirection).

move_tactical_role_seed(fake_out, fake_out).

move_tactical_role_seed(tailwind, speed_control).
move_tactical_role_seed(icy_wind, speed_control).
move_tactical_role_seed(electroweb, speed_control).
move_tactical_role_seed(thunder_wave, speed_control).
move_tactical_role_seed(bulldoze, speed_control).
move_tactical_role_seed(scary_face, speed_control).
move_tactical_role_seed(trick_room, trick_room).

move_tactical_role_seed(helping_hand, ally_boost).
move_tactical_role_seed(coaching, ally_boost).
move_tactical_role_seed(howl, ally_boost).

move_tactical_role_seed(reflect, screen_control).
move_tactical_role_seed(light_screen, screen_control).
move_tactical_role_seed(aurora_veil, screen_control).

move_tactical_role_seed(stealth_rock, hazard).
move_tactical_role_seed(spikes, hazard).
move_tactical_role_seed(toxic_spikes, hazard).
move_tactical_role_seed(sticky_web, hazard).
move_tactical_role_seed(stone_axe, hazard).
move_tactical_role_seed(ceaseless_edge, hazard).

move_tactical_role_seed(defog, hazard_clear).
move_tactical_role_seed(rapid_spin, hazard_clear).
move_tactical_role_seed(mortal_spin, hazard_clear).
move_tactical_role_seed(tidy_up, hazard_clear).
move_tactical_role_seed(court_change, hazard_clear).

move_tactical_role_seed(electric_terrain, terrain_control).
move_tactical_role_seed(psychic_terrain, terrain_control).
move_tactical_role_seed(grassy_terrain, terrain_control).
move_tactical_role_seed(misty_terrain, terrain_control).

move_tactical_role_seed(rain_dance, weather_control).
move_tactical_role_seed(sunny_day, weather_control).
move_tactical_role_seed(sandstorm, weather_control).
move_tactical_role_seed(hail, weather_control).
move_tactical_role_seed(snowscape, weather_control).

move_tactical_role_seed(swords_dance, setup_buff).
move_tactical_role_seed(dragon_dance, setup_buff).
move_tactical_role_seed(nasty_plot, setup_buff).
move_tactical_role_seed(quiver_dance, setup_buff).
move_tactical_role_seed(calm_mind, setup_buff).
move_tactical_role_seed(bulk_up, setup_buff).
move_tactical_role_seed(shell_smash, setup_buff).
move_tactical_role_seed(agility, setup_buff).
move_tactical_role_seed(coil, setup_buff).
move_tactical_role_seed(work_up, setup_buff).
move_tactical_role_seed(belly_drum, setup_buff).

move_tactical_role_seed(taunt, disruption).
move_tactical_role_seed(snarl, disruption).
move_tactical_role_seed(will_o_wisp, disruption).
move_tactical_role_seed(encore, disruption).
move_tactical_role_seed(disable, disruption).
move_tactical_role_seed(yawn, disruption).
move_tactical_role_seed(roar, disruption).
move_tactical_role_seed(dragon_tail, disruption).

move_tactical_role_seed(close_combat, self_drop_pressure).
move_tactical_role_seed(superpower, self_drop_pressure).
move_tactical_role_seed(draco_meteor, self_drop_pressure).
move_tactical_role_seed(leaf_storm, self_drop_pressure).
move_tactical_role_seed(overheat, self_drop_pressure).
move_tactical_role_seed(make_it_rain, self_drop_pressure).
move_tactical_role_seed(v_create, self_drop_pressure).

move_tactical_role_seed(roost, recovery).
move_tactical_role_seed(recover, recovery).
move_tactical_role_seed(slack_off, recovery).
move_tactical_role_seed(soft_boiled, recovery).
move_tactical_role_seed(synthesis, recovery).
move_tactical_role_seed(morning_sun, recovery).
move_tactical_role_seed(moonlight, recovery).
move_tactical_role_seed(wish, recovery).
move_tactical_role_seed(rest, recovery).
move_tactical_role_seed(shore_up, recovery).
move_tactical_role_seed(heal_order, recovery).
move_tactical_role_seed(milk_drink, recovery).
move_tactical_role_seed(leech_seed, recovery).

move_tactical_role_inferred(Move, damage) :-
    move_entry(Move, _Type, Category, BasePower, _Accuracy, _PP, _Tags, _EffectChance, _Ailment, _EffectCategory, _Description),
    member(Category, [physical, special]),
    number(BasePower),
    BasePower > 0.

move_tactical_role_inferred(Move, recovery) :-
    move_entry(Move, _Type, _Category, _BasePower, _Accuracy, _PP, _Tags, _EffectChance, _Ailment, EffectCategory, _Description),
    member(EffectCategory, [heal, damage_heal]).

move_tactical_role_inferred(Move, buff) :-
    move_entry(Move, _Type, _Category, _BasePower, _Accuracy, _PP, _Tags, _EffectChance, _Ailment, EffectCategory, _Description),
    member(EffectCategory, [net_good_stats, damage_raise]).

move_tactical_role_inferred(Move, debuff) :-
    move_entry(Move, _Type, _Category, _BasePower, _Accuracy, _PP, _Tags, _EffectChance, _Ailment, EffectCategory, _Description),
    member(EffectCategory, [damage_lower, ailment]).

move_tactical_role_inferred(Move, control) :-
    move_entry(Move, _Type, _Category, _BasePower, _Accuracy, _PP, _Tags, _EffectChance, _Ailment, EffectCategory, _Description),
    member(EffectCategory, [field_effect, whole_field_effect]).
