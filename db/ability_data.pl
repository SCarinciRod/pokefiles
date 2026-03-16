:- encoding(utf8).

:- multifile ability_effect/5.

% ability_effect(Ability, Category, Trigger, CombatModel, Description).
% - Category: offensive | defensive | utility | weather | status | trap
% - Trigger: on_move | on_hit | passive | on_switch | on_status
% - CombatModel: metadados iniciais para futura simulação

ability_effect(overgrow, offensive, passive, [type_boost-grass, hp_threshold-0.33, multiplier-1.5], 'Aumenta golpes de Grass quando HP está baixo (<= 1/3).').
ability_effect(blaze, offensive, passive, [type_boost-fire, hp_threshold-0.33, multiplier-1.5], 'Aumenta golpes de Fire quando HP está baixo (<= 1/3).').
ability_effect(torrent, offensive, passive, [type_boost-water, hp_threshold-0.33, multiplier-1.5], 'Aumenta golpes de Water quando HP está baixo (<= 1/3).').
ability_effect(swarm, offensive, passive, [type_boost-bug, hp_threshold-0.33, multiplier-1.5], 'Aumenta golpes de Bug quando HP está baixo (<= 1/3).').
ability_effect(solar_power, offensive, weather, [weather-sun, special_attack_multiplier-1.5, hp_loss_per_turn-0.125], 'No sol, aumenta Sp. Atk e perde HP por turno.').
ability_effect(rain_dish, defensive, weather, [weather-rain, heal_per_turn-0.0625], 'Na chuva, recupera HP por turno.').
ability_effect(chlorophyll, utility, weather, [weather-sun, speed_multiplier-2.0], 'No sol, dobra Speed.').
ability_effect(swift_swim, utility, weather, [weather-rain, speed_multiplier-2.0], 'Na chuva, dobra Speed.').
ability_effect(sand_rush, utility, weather, [weather-sandstorm, speed_multiplier-2.0], 'Na tempestade de areia, dobra Speed.').
ability_effect(sand_force, offensive, weather, [weather-sandstorm, type_boost-[rock,ground,steel], multiplier-1.3], 'Na areia, aumenta dano de Rock/Ground/Steel.').

ability_effect(shield_dust, defensive, passive, [ignore_secondary_effects-true], 'Previne efeitos secundários recebidos de golpes.').
ability_effect(shed_skin, defensive, passive, [status_cure_chance_per_turn-0.33], 'Chance de curar status no fim do turno.').
ability_effect(compound_eyes, offensive, passive, [accuracy_multiplier-1.3], 'Aumenta a precisão dos golpes.').
ability_effect(tinted_lens, offensive, passive, [resisted_hit_multiplier-2.0], 'Golpes pouco efetivos causam mais dano.').
ability_effect(sniper, offensive, passive, [critical_multiplier-1.5], 'Aumenta dano de golpes críticos.').
ability_effect(guts, offensive, on_status, [attack_multiplier-1.5, ignore_burn_attack_drop-true], 'Com status, aumenta Attack e ignora penalidade de burn no Attack.').
ability_effect(hustle, offensive, passive, [attack_multiplier-1.5, accuracy_multiplier-0.8], 'Aumenta Attack e reduz precisão física.').
ability_effect(technician, offensive, passive, [base_power_cap-60, multiplier-1.5], 'Aumenta golpes de baixo poder base (<=60).').
ability_effect(sheer_force, offensive, passive, [secondary_effect_required-true, move_multiplier-1.3], 'Aumenta golpes com efeito secundário e remove esse efeito.').
ability_effect(defiant, offensive, on_stat_drop, [attack_stages-2], 'Quando um stat cai por efeito externo, ganha +2 Attack.').
ability_effect(moxie, offensive, on_ko, [attack_stages-1], 'Ao nocautear alvo, ganha +1 Attack.').
ability_effect(reckless, offensive, passive, [recoil_move_multiplier-1.2], 'Aumenta golpes com recoil.').

ability_effect(sturdy, defensive, passive, [full_hp_survive_ko_hit-true], 'Com HP cheio, sobrevive a golpe que nocautearia (fica com 1 HP).').
ability_effect(thick_fat, defensive, passive, [damage_multiplier-fire-0.5, damage_multiplier-ice-0.5], 'Reduz dano de golpes Fire e Ice.').
ability_effect(flash_fire, defensive, on_hit, [immunity-fire, next_fire_multiplier-1.5], 'Imune a Fire; ao ativar, fortalece golpes Fire.').
ability_effect(levitate, defensive, passive, [immunity-ground], 'Imunidade a golpes Ground (salvo exceções modernas).').
ability_effect(water_absorb, defensive, on_hit, [immunity-water, heal_fraction-0.25], 'Imunidade a Water e recupera HP ao ser atingido.').
ability_effect(lightning_rod, defensive, on_hit, [redirect-electric, immunity-electric, special_attack_stages-1], 'Redireciona golpes Electric e concede imunidade; pode aumentar Sp. Atk.').
ability_effect(magic_guard, defensive, passive, [indirect_damage_immunity-true], 'Não sofre dano indireto (hazards, status chip etc.).').
ability_effect(multiscale, defensive, passive, [full_hp_damage_multiplier-0.5], 'Com HP cheio, reduz dano recebido pela metade.').
ability_effect(inner_focus, defensive, passive, [flinch_immunity-true], 'Imune a flinch.').
ability_effect(shell_armor, defensive, passive, [critical_immunity-true], 'Imune a golpes críticos.').
ability_effect(battle_armor, defensive, passive, [critical_immunity-true], 'Imune a golpes críticos.').
ability_effect(clear_body, defensive, passive, [prevent_stat_drop_by_opponent-true], 'Impede redução de stats por efeitos do oponente.').

ability_effect(static, status, on_contact, [status-inflict-paralysis, chance-0.3], 'Contato pode paralisar o atacante.').
ability_effect(flame_body, status, on_contact, [status-inflict-burn, chance-0.3], 'Contato pode queimar o atacante.').
ability_effect(poison_point, status, on_contact, [status-inflict-poison, chance-0.3], 'Contato pode envenenar o atacante.').
ability_effect(effect_spore, status, on_contact, [status-inflict-random-[sleep,poison,paralysis], chance-0.3], 'Contato pode causar status aleatório.').
ability_effect(synchronize, status, on_status, [reflect_status_to_source-[burn,poison,paralysis]], 'Ao receber burn/poison/paralysis, reflete ao causador.').
ability_effect(liquid_ooze, status, on_drain, [drain_reversal-true], 'Golpes de drenagem no alvo causam dano ao atacante.').
ability_effect(natural_cure, utility, on_switch, [cure_self_status-true], 'Cura status ao trocar.').
ability_effect(oblivious, utility, passive, [attract_immunity-true, taunt_immunity-true], 'Imune a Attract e Taunt.').
ability_effect(own_tempo, utility, passive, [confusion_immunity-true], 'Imune a confusão.').
ability_effect(regenerator, utility, on_switch, [heal_fraction-0.33], 'Recupera HP ao sair de campo.').
ability_effect(drought, weather, on_switch, [set_weather-sun], 'Ativa sol ao entrar.').
ability_effect(drizzle, weather, on_switch, [set_weather-rain], 'Ativa chuva ao entrar.').
ability_effect(snow_cloak, utility, weather, [weather-hail, evasion_multiplier-1.25], 'No granizo, aumenta evasão.').
ability_effect(arena_trap, trap, passive, [trap_grounded_targets-true], 'Impede troca de alvos no chão (com exceções).').
ability_effect(magnet_pull, trap, passive, [trap_type-steel], 'Impede troca de alvos Steel.').
ability_effect(pressure, utility, passive, [extra_pp_consumption-1], 'Movimentos contra este Pokémon gastam PP extra.').

ability_effect(run_away, utility, passive, [battle_escape_support-true], 'Facilita fuga em batalhas selvagens; impacto competitivo baixo.').
ability_effect(pickup, utility, passive, [out_of_battle_item_pickup-true], 'Coleta itens fora de batalha; sem impacto direto em duelo.').
ability_effect(keen_eye, utility, passive, [prevent_accuracy_drop-true], 'Impede redução de precisão.').
ability_effect(big_pecks, utility, passive, [prevent_defense_drop-true], 'Impede redução de Defense por efeitos externos.').
ability_effect(unnerve, utility, on_switch, [block_berry_consumption_by_foe-true], 'Oponente não consome berries enquanto esta ability está ativa.').
ability_effect(immunity, status, passive, [poison_immunity-true], 'Imune a envenenamento.').
ability_effect(hydration, status, weather, [weather-rain, cure_status_end_turn-true], 'Na chuva, cura status no fim do turno.').
ability_effect(ice_body, defensive, weather, [weather-hail, heal_per_turn-0.0625], 'No granizo, recupera HP por turno.').
ability_effect(damp, utility, passive, [block_self_destruct_moves-true], 'Bloqueia moves explosivos em campo.').
ability_effect(analytic, offensive, passive, [move_after_target_multiplier-1.3], 'Aumenta dano ao agir depois do alvo.').
ability_effect(download, offensive, on_switch, [raise_best_attack_stat-1], 'Ao entrar, aumenta Attack ou Sp. Atk conforme a defesa rival.').
ability_effect(serene_grace, offensive, passive, [secondary_effect_chance_multiplier-2.0], 'Dobra chance de efeitos secundários.').
ability_effect(healer, utility, passive, [ally_status_cure_chance_end_turn-0.3], 'Pode curar status de aliado em dupla.').

ability_effect(unknown, utility, passive, [], 'Habilidade sem modelagem detalhada ainda.').
