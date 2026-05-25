"use strict";
/**
 * battle_sim.ts
 *
 * Core VGC Doubles battle simulator.
 * Handles: damage calc, KO, status, weather, terrain, Trick Room, Tailwind,
 * Mega Evolution, ability hooks, item hooks, and turn ordering.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.BattleSimulator = void 0;
exports.displayPokeName = displayPokeName;
const mechanics_1 = require("./mechanics");
const battle_types_1 = require("./battle_types");
const battle_abilities_1 = require("./battle_abilities");
// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const LEVEL = 50;
const WEATHER_BOOST = {
    sun: { fire: 1.5, water: 0.5 },
    harsh_sun: { fire: 1.5, water: 0 },
    rain: { water: 1.5, fire: 0.5 },
    heavy_rain: { water: 1.5, fire: 0 },
};
const TERRAIN_BOOST = {
    electric: { electric: 1.3 },
    psychic: { psychic: 1.3 },
    grassy: { grass: 1.3 },
};
// Move tags that imply spread targeting
const BITING_MOVES = new Set(['crunch', 'bite', 'hyper_fang', 'super_fang', 'poison_fang', 'fire_fang', 'ice_fang', 'thunder_fang', 'psychic_fangs', 'fishious_rend', 'jaw_lock']);
const PULSE_MOVES = new Set(['aura_sphere', 'dark_pulse', 'dragon_pulse', 'heal_pulse', 'origin_pulse', 'oblivion_wing', 'terrain_pulse', 'water_pulse']);
const CONTACT_MOVES_BLACKLIST = new Set(['earthquake', 'rock_slide', 'heat_wave', 'discharge', 'muddy_water', 'icy_wind', 'blizzard', 'lava_plume', 'surf', 'dazzling_gleam', 'sludge_wave', 'eruption', 'water_spout', 'hyper_voice', 'boomburst', 'bulldoze']);
function isSoundMove(tags) { return tags.includes('sound'); }
function isContactMove(moveId, tags) {
    return tags.includes('contact') && !CONTACT_MOVES_BLACKLIST.has(moveId);
}
// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function displayPokeName(id) {
    return id.split(/[-_]/).map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}
function clamp(v, lo, hi) {
    return Math.max(lo, Math.min(hi, v));
}
function boostMult(stage) {
    const s = clamp(stage, -6, 6);
    return s >= 0 ? (2 + s) / 2 : 2 / (2 - s);
}
function effectiveStat(poke, stat, ignoreBoosts = false) {
    const base = poke.stats[stat];
    if (stat === 'hp')
        return base;
    const b = ignoreBoosts ? 0 : poke.boosts[stat] ?? 0;
    return Math.max(1, Math.floor(base * boostMult(b)));
}
function effectiveSpeed(poke, team, field) {
    let spd = effectiveStat(poke, 'speed');
    // Item: Choice Scarf
    if (poke.config.item === 'choice_scarf' && !poke.itemConsumed)
        spd = Math.floor(spd * 1.5);
    // Ability: speed modifiers applied via context during sorting
    // Paralysis: ×0.5 speed
    if (poke.status === 'paralyzed')
        spd = Math.floor(spd * 0.5);
    // Tailwind: ×2
    if (team.tailwindTurns > 0)
        spd = spd * 2;
    return spd;
}
// ---------------------------------------------------------------------------
// Battle state construction
// ---------------------------------------------------------------------------
class BattleSimulator {
    constructor(engine) {
        this.engine = engine;
        this.typeChart = engine.getTypeChart();
    }
    // ── Init ────────────────────────────────────────────────────────────────
    initBattle(cfg0, cfg1) {
        const t0 = this.buildTeam(cfg0, 0);
        const t1 = this.buildTeam(cfg1, 1);
        const state = {
            teams: [t0, t1],
            field: { weather: 'none', weatherTurns: 0, terrain: 'none', terrainTurns: 0, trickRoom: false, trickRoomTurns: 0 },
            turn: 0,
            log: [],
        };
        // Trigger on_switch_in for initial active Pokémon
        for (let ti = 0; ti < 2; ti++) {
            const team = state.teams[ti];
            for (const poke of team.active) {
                if (poke)
                    this.triggerAbility(state, poke, ti, 'on_switch_in');
            }
        }
        // Mega Evolution on first move is done in executeMove; no action here at init.
        return state;
    }
    buildTeam(cfg, idx) {
        const party = cfg.pokemon.map((pc, i) => this.buildPokemon(pc, `team${idx}_${i}`));
        return {
            party,
            active: [party[0] ?? null, party[1] ?? null],
            tailwindTurns: 0,
            teamIdx: idx,
        };
    }
    buildPokemon(cfg, uid) {
        const ctx = this.engine.getPokemonContext(cfg.identifier);
        if (!ctx)
            throw new Error(`Pokémon desconhecido: ${cfg.identifier}`);
        const stats = (0, mechanics_1.calculateStats)(ctx.baseStats, {
            level: LEVEL,
            evs: cfg.evs ?? {},
            ivs: cfg.ivs ?? {},
            nature: cfg.nature,
        });
        const ppRemaining = {};
        for (const mid of cfg.moves) {
            const m = this.engine.getMove(mid);
            ppRemaining[mid] = m?.pp ?? 5;
        }
        return {
            uid, config: cfg,
            identifier: cfg.identifier,
            currentTypes: [...ctx.types],
            currentAbility: cfg.ability,
            maxHp: stats.hp, currentHp: stats.hp,
            stats,
            boosts: (0, battle_types_1.emptyBoosts)(),
            status: 'healthy', statusTurns: 0,
            isProtected: false, isFlinched: false,
            itemConsumed: false, megaEvolved: false,
            choiceLocked: null, helpingHandBoosted: false,
            ppRemaining, turnsInBattle: 0, fainted: false,
        };
    }
    // ── Mega Evolution ───────────────────────────────────────────────────────
    triggerMegaEvolution(state, poke, teamIdx) {
        if (poke.megaEvolved || !poke.config.megaStoneId)
            return;
        // Determine which mega form to use from the stone id
        const stoneId = poke.config.megaStoneId;
        let megaId = poke.identifier + '-mega';
        if (stoneId.endsWith('_x') || stoneId.includes('_x'))
            megaId = poke.identifier + '-mega-x';
        else if (stoneId.endsWith('_y') || stoneId.includes('_y'))
            megaId = poke.identifier + '-mega-y';
        const megaCtx = this.engine.getPokemonContext(megaId);
        if (!megaCtx) {
            // Try just '-mega'
            const altCtx = this.engine.getPokemonContext(poke.identifier + '-mega');
            if (!altCtx)
                return; // no mega form in DB
        }
        const resolvedCtx = this.engine.getPokemonContext(megaId) ?? this.engine.getPokemonContext(poke.identifier + '-mega');
        if (!resolvedCtx)
            return;
        const hpRatio = poke.currentHp / poke.maxHp;
        const newStats = (0, mechanics_1.calculateStats)(resolvedCtx.baseStats, {
            level: LEVEL,
            evs: poke.config.evs ?? {},
            ivs: poke.config.ivs ?? {},
            nature: poke.config.nature,
        });
        poke.identifier = resolvedCtx.identifier;
        poke.currentTypes = [...resolvedCtx.types];
        poke.currentAbility = resolvedCtx.abilities[0] ?? poke.currentAbility;
        poke.stats = newStats;
        poke.maxHp = newStats.hp;
        poke.currentHp = Math.max(1, Math.floor(newStats.hp * hpRatio));
        poke.megaEvolved = true;
        state.log.push(`${displayPokeName(poke.config.identifier)} Mega Evoluiu para ${displayPokeName(poke.identifier)}!`);
        this.triggerAbility(state, poke, teamIdx, 'on_switch_in'); // trigger new ability
    }
    // ── Turn execution ───────────────────────────────────────────────────────
    executeTurn(state, actions) {
        // Reset per-turn flags
        for (const team of state.teams) {
            for (const slot of team.active) {
                if (slot) {
                    slot.isProtected = false;
                    slot.isFlinched = false;
                    slot.helpingHandBoosted = false;
                }
            }
        }
        // Separate switches and moves
        const switches = actions.filter((a) => a.kind === 'switch');
        const moveActions = actions.filter((a) => a.kind === 'move');
        // Apply switches first (VGC: switches happen before moves in VGC ordering)
        for (const sw of switches) {
            this.applySwitch(state, sw);
        }
        // Sort move actions by priority/speed
        const sorted = this.sortMoveActions(state, moveActions);
        // Execute moves in order
        for (const action of sorted) {
            const actor = this.findByUid(state, action.actorUid);
            if (!actor || actor.fainted)
                continue;
            if (actor.isFlinched) {
                state.log.push(`${displayPokeName(actor.identifier)} ficou com medo e não pode agir!`);
                continue;
            }
            this.executeMove(state, action);
        }
        // End-of-turn effects
        this.applyEndOfTurn(state);
        // Tick field counters
        this.tickField(state);
        // Increment turnsInBattle for active Pokémon
        for (const team of state.teams) {
            for (const slot of team.active) {
                if (slot && !slot.fainted)
                    slot.turnsInBattle++;
            }
        }
        state.turn++;
        const winner = this.checkWin(state);
        const requiresSwitch = [
            this.teamNeedsSwitch(state.teams[0]),
            this.teamNeedsSwitch(state.teams[1]),
        ];
        return { state, winner, requiresSwitch };
    }
    teamNeedsSwitch(team) {
        const hasFainted = team.active.some((p) => p?.fainted);
        const hasReplacement = team.party.some((p) => !p.fainted && !team.active.includes(p));
        return hasFainted && hasReplacement;
    }
    checkWin(state) {
        const allFainted = (team) => team.party.every((p) => p.fainted);
        if (allFainted(state.teams[0]) && allFainted(state.teams[1]))
            return 1; // draw → AI wins
        if (allFainted(state.teams[0]))
            return 1;
        if (allFainted(state.teams[1]))
            return 0;
        return null;
    }
    // ── Switch logic ─────────────────────────────────────────────────────────
    applySwitch(state, action) {
        const team = state.teams[action.teamIdx];
        const outgoing = team.active[action.activeSlot];
        // Regenerator: heal 1/3 HP on switch-out
        if (outgoing && !outgoing.fainted && outgoing.currentAbility === 'regenerator') {
            const heal = Math.max(1, Math.floor(outgoing.maxHp / 3));
            outgoing.currentHp = Math.min(outgoing.maxHp, outgoing.currentHp + heal);
            state.log.push(`${displayPokeName(outgoing.identifier)} recuperou HP com Regenerator!`);
        }
        // Natural Cure: heal status on switch-out
        if (outgoing && !outgoing.fainted && outgoing.currentAbility === 'natural_cure' && outgoing.status !== 'healthy') {
            outgoing.status = 'healthy';
            outgoing.statusTurns = 0;
            state.log.push(`${displayPokeName(outgoing.identifier)} curou seu status com Natural Cure!`);
        }
        const incoming = team.party[action.partyIdx];
        if (!incoming || incoming.fainted)
            return;
        team.active[action.activeSlot] = incoming;
        incoming.turnsInBattle = 0;
        incoming.choiceLocked = null;
        state.log.push(`${displayPokeName(incoming.identifier)} entrou em campo!`);
        this.triggerAbility(state, incoming, action.teamIdx, 'on_switch_in');
    }
    // Public version for forced switches (after KO)
    forceSwitch(state, teamIdx, activeSlot, partyIdx) {
        this.applySwitch(state, { kind: 'switch', teamIdx, activeSlot, partyIdx });
    }
    // ── Action sorting ───────────────────────────────────────────────────────
    sortMoveActions(state, actions) {
        return [...actions].sort((a, b) => {
            const pa = this.getActionPriority(state, a);
            const pb = this.getActionPriority(state, b);
            if (pa !== pb)
                return pb - pa; // higher priority first (regardless of TR)
            const sa = this.getActionSpeed(state, a);
            const sb = this.getActionSpeed(state, b);
            if (sa !== sb) {
                return state.field.trickRoom ? sa - sb : sb - sa; // TR reverses
            }
            return 0; // tie → random (first-listed acts first)
        });
    }
    getActionPriority(state, action) {
        const move = this.engine.getMove(action.moveId);
        if (!move)
            return 0;
        let priority = (0, mechanics_1.computePriorityFromTags)(move.tags);
        // Prankster: status moves get +1 priority
        const actor = this.findByUid(state, action.actorUid);
        if (actor?.currentAbility === 'prankster' && move.category === 'status')
            priority += 1;
        return priority;
    }
    getActionSpeed(state, action) {
        const actor = this.findByUid(state, action.actorUid);
        if (!actor)
            return 0;
        const teamIdx = this.findTeamIdx(state, actor);
        const team = state.teams[teamIdx];
        let spd = effectiveStat(actor, 'speed');
        if (actor.status === 'paralyzed')
            spd = Math.floor(spd * 0.5);
        if (actor.config.item === 'choice_scarf' && !actor.itemConsumed)
            spd = Math.floor(spd * 1.5);
        if (team.tailwindTurns > 0)
            spd *= 2;
        // Apply speed-multiplying ability hooks
        const ctx = this.makeAbilityCtx(state, actor, teamIdx, (m) => state.log.push(m));
        const handler = battle_abilities_1.ABILITY_REGISTRY[actor.currentAbility];
        if (handler?.on_damage_calc) {
            handler.on_damage_calc(ctx);
            spd = Math.floor(spd * ctx.speedMult);
        }
        return spd;
    }
    // ── Move execution ───────────────────────────────────────────────────────
    executeMove(state, action) {
        const actor = this.findByUid(state, action.actorUid);
        if (!actor || actor.fainted)
            return;
        const move = this.engine.getMove(action.moveId);
        if (!move)
            return;
        const teamIdx = this.findTeamIdx(state, actor);
        // Mega Evolution on first move use
        if (!actor.megaEvolved && actor.config.megaStoneId) {
            this.triggerMegaEvolution(state, actor, teamIdx);
        }
        // Choice lock check
        if (actor.choiceLocked && actor.choiceLocked !== action.moveId) {
            state.log.push(`${displayPokeName(actor.identifier)} está preso em ${actor.choiceLocked}! Não pode usar outro golpe.`);
            return;
        }
        // Consume PP
        if (actor.ppRemaining[action.moveId] !== undefined) {
            actor.ppRemaining[action.moveId] = Math.max(0, actor.ppRemaining[action.moveId] - 1);
        }
        // Trigger on_move_use ability
        this.triggerAbility(state, actor, teamIdx, 'on_move_use');
        // Protean / Libero: change type to move's type before damage
        if ((actor.currentAbility === 'protean' || actor.currentAbility === 'libero') && !actor.megaEvolved) {
            actor.currentTypes = [move.type_id];
        }
        // Status moves
        if (move.category === 'status' || move.base_power === 0) {
            this.executeStatusMove(state, actor, teamIdx, action.moveId, action.targetUid);
            return;
        }
        // Damage move
        const isSpread = battle_abilities_1.SPREAD_MOVES.has(action.moveId);
        if (isSpread) {
            // Hit both opponents
            const oppTeamIdx = (1 - teamIdx);
            const oppTeam = state.teams[oppTeamIdx];
            for (const oppSlot of oppTeam.active) {
                if (oppSlot && !oppSlot.fainted) {
                    this.executeDamageMove(state, actor, teamIdx, oppSlot, action.moveId, move, true);
                }
            }
        }
        else {
            const target = this.findByUid(state, action.targetUid);
            if (target && !target.fainted) {
                this.executeDamageMove(state, actor, teamIdx, target, action.moveId, move, false);
            }
        }
        // Choice item: lock move after use
        if (['choice_band', 'choice_specs', 'choice_scarf'].includes(actor.config.item ?? '') && !actor.itemConsumed) {
            actor.choiceLocked = action.moveId;
        }
    }
    executeStatusMove(state, actor, teamIdx, moveId, targetUid) {
        const effect = (0, battle_abilities_1.getStatusMoveEffect)(moveId);
        const oppTeamIdx = (1 - teamIdx);
        switch (effect.kind) {
            case 'tailwind':
                state.teams[teamIdx].tailwindTurns = 4;
                state.log.push(`Um vento favorável está soprando para o time ${teamIdx + 1}!`);
                break;
            case 'trick_room':
                if (state.field.trickRoom) {
                    state.field.trickRoom = false;
                    state.field.trickRoomTurns = 0;
                    state.log.push('Trick Room foi cancelado!');
                }
                else {
                    state.field.trickRoom = true;
                    state.field.trickRoomTurns = 5;
                    state.log.push('O espaço foi distorcido! Pokémon mais lentos agem primeiro por 5 turnos!');
                }
                break;
            case 'follow_me':
            case 'rage_powder':
                state.log.push(`${displayPokeName(actor.identifier)} está chamando atenção! (${moveId})`);
                actor['_redirectActive'] = true;
                break;
            case 'helping_hand': {
                const ally = state.teams[teamIdx].active.find((p) => p && p !== actor && !p.fainted);
                if (ally) {
                    ally.helpingHandBoosted = true;
                    state.log.push(`${displayPokeName(actor.identifier)} está ajudando ${displayPokeName(ally.identifier)}! (+50% dano)`);
                }
                break;
            }
            case 'protect':
                if (effect.variant === 'single') {
                    actor.isProtected = true;
                    state.log.push(`${displayPokeName(actor.identifier)} se protegeu!`);
                }
                else if (effect.variant === 'wide') {
                    for (const slot of state.teams[teamIdx].active) {
                        if (slot)
                            slot.isProtected = true;
                    }
                    state.log.push(`O time ${teamIdx + 1} se protegeu de golpes em área!`);
                }
                else if (effect.variant === 'quick') {
                    for (const slot of state.teams[teamIdx].active) {
                        if (slot)
                            slot['_quickGuard'] = true;
                    }
                    state.log.push(`O time ${teamIdx + 1} se protegeu de golpes de prioridade!`);
                }
                break;
            case 'stat_boost':
                actor.boosts[effect.stat] = clamp(actor.boosts[effect.stat] + effect.stages, -6, 6);
                state.log.push(`${displayPokeName(actor.identifier)}: ${effect.stat} ${effect.stages > 0 ? '+' : ''}${effect.stages}!`);
                break;
            default:
                state.log.push(`${displayPokeName(actor.identifier)} usou ${moveId}.`);
        }
    }
    executeDamageMove(state, actor, teamIdx, target, moveId, move, isSpread) {
        const targetTeamIdx = this.findTeamIdx(state, target);
        // Check protection
        if (target.isProtected) {
            state.log.push(`${displayPokeName(target.identifier)} se protegeu do golpe!`);
            return;
        }
        // Accuracy check (simplified: 100% for moves with accuracy = 0 [never-miss], else accuracy/100)
        const accuracy = move.accuracy <= 0 ? 1.0 : move.accuracy / 100;
        if (Math.random() > accuracy) {
            state.log.push(`${displayPokeName(actor.identifier)} errou o golpe!`);
            return;
        }
        // Resolve attacking / defending stats
        const isPhysical = move.category === 'physical';
        const atkStatId = isPhysical ? 'attack' : 'special_attack';
        const defStatId = isPhysical ? 'defense' : 'special_defense';
        let atkStat = effectiveStat(actor, atkStatId);
        let defStat = effectiveStat(target, defStatId);
        // Hustle: +50% Atk, -80% accuracy (simplified: already handled in accuracy above)
        if (actor.currentAbility === 'hustle' && isPhysical)
            atkStat = Math.floor(atkStat * 1.5);
        // Huge Power / Pure Power: ×2 Atk
        if ((actor.currentAbility === 'huge_power' || actor.currentAbility === 'pure_power') && isPhysical) {
            atkStat = atkStat * 2;
        }
        // Assault Vest: ×1.5 SpD
        if (target.config.item === 'assault_vest' && !target.itemConsumed && !isPhysical) {
            defStat = Math.floor(defStat * 1.5);
        }
        // Type effectiveness
        let typeMult = (0, mechanics_1.computeTypeMultiplier)(this.typeChart, move.type_id, target.currentTypes);
        // Scrappy: can hit Ghost with Normal / Fighting
        if (actor.currentAbility === 'scrappy' && (move.type_id === 'normal' || move.type_id === 'fighting') && typeMult === 0) {
            typeMult = 1;
        }
        // Tinted Lens: NVE (0.5×) becomes neutral (1×)
        if (actor.currentAbility === 'tinted_lens' && typeMult < 1 && typeMult > 0)
            typeMult = 1;
        if (typeMult === 0) {
            state.log.push(`Não surtiu efeito em ${displayPokeName(target.identifier)}!`);
            return;
        }
        // STAB (with Adaptability)
        let stabMult = (0, mechanics_1.computeStab)(move.type_id, actor.currentTypes);
        if (actor.currentAbility === 'adaptability' && stabMult > 1)
            stabMult = 2;
        // Weather modifier
        const wBoost = WEATHER_BOOST[state.field.weather]?.[move.type_id] ?? 1;
        if (wBoost === 0) {
            state.log.push(`O ataque falhou no clima atual!`);
            return;
        }
        // Terrain modifier (only grounded Pokémon — simplified: always apply if terrain)
        const terrainMult = TERRAIN_BOOST[state.field.terrain]?.[move.type_id] ?? 1;
        // Helping Hand
        const helpingHandMult = actor.helpingHandBoosted ? 1.5 : 1;
        // Item damage boost (type-boosting items, Life Orb, Expert Belt)
        let itemDamageMult = 1;
        const item = actor.config.item;
        if (item && !actor.itemConsumed) {
            if (battle_abilities_1.ITEM_TYPE_BOOST[item] === move.type_id)
                itemDamageMult *= 1.2;
            if (item === 'life_orb')
                itemDamageMult *= 1.3;
            if (item === 'expert_belt' && typeMult > 1)
                itemDamageMult *= 1.2;
        }
        // Ability damage mods (outgoing)
        const actorCtx = this.makeAbilityCtx(state, actor, teamIdx, (m) => state.log.push(m));
        const actorHandler = battle_abilities_1.ABILITY_REGISTRY[actor.currentAbility];
        if (actorHandler?.on_damage_calc)
            actorHandler.on_damage_calc(actorCtx);
        let abilityDamageMult = actorCtx.damageMult;
        // Technician: moves with base power ≤ 60 get ×1.5
        if (actor.currentAbility === 'technician' && move.base_power <= 60)
            abilityDamageMult *= 1.5;
        // Tough Claws: contact moves ×1.3
        if (actor.currentAbility === 'tough_claws' && isContactMove(moveId, move.tags))
            abilityDamageMult *= 1.3;
        // Strong Jaw: biting moves ×1.5
        if (actor.currentAbility === 'strong_jaw' && BITING_MOVES.has(moveId))
            abilityDamageMult *= 1.5;
        // Mega Launcher: pulse/aura moves ×1.5
        if (actor.currentAbility === 'mega_launcher' && PULSE_MOVES.has(moveId))
            abilityDamageMult *= 1.5;
        // Parental Bond: will strike twice (track with flag)
        const parentalBondSecond = actor.currentAbility === 'parental_bond' && !isSpread;
        // Burn: halves physical damage
        const burnMult = (actor.status === 'burned' && isPhysical && actor.currentAbility !== 'guts') ? 0.5 : 1;
        // Ability defense mods (incoming on target)
        const targetCtx = this.makeAbilityCtx(state, target, targetTeamIdx, (m) => state.log.push(m));
        const targetHandler = battle_abilities_1.ABILITY_REGISTRY[target.currentAbility];
        if (targetHandler?.on_damage_calc)
            targetHandler.on_damage_calc(targetCtx);
        let abilityDefenseMult = targetCtx.defenseMult;
        // Filter / Solid Rock / Prism Armor: reduce SE damage by 25%
        if (typeMult > 1 && ['filter', 'solid_rock', 'prism_armor'].includes(target.currentAbility)) {
            abilityDefenseMult *= 0.75;
        }
        // Thick Fat: fire and ice at 0.5×
        if (target.currentAbility === 'thick_fat' && (move.type_id === 'fire' || move.type_id === 'ice')) {
            abilityDefenseMult *= 0.5;
        }
        // Fluffy: halves physical, doubles fire
        if (target.currentAbility === 'fluffy') {
            if (isPhysical)
                abilityDefenseMult *= 0.5;
            if (move.type_id === 'fire')
                abilityDefenseMult /= 0.5;
        }
        // Fur Coat: halves physical
        if (target.currentAbility === 'fur_coat' && isPhysical)
            abilityDefenseMult *= 0.5;
        // Ice Scales: halves special
        if (target.currentAbility === 'ice_scales' && !isPhysical)
            abilityDefenseMult *= 0.5;
        // Type-resist berry (on incoming hit)
        let berryMult = 1;
        const berryType = target.config.item ? battle_abilities_1.TYPE_RESIST_BERRY[target.config.item] : null;
        if (berryType && berryType === move.type_id && !target.itemConsumed && typeMult >= 1) {
            berryMult = 0.5;
            target.itemConsumed = true;
            state.log.push(`${displayPokeName(target.identifier)} usou ${target.config.item}!`);
        }
        // Spread reduction
        const spreadMult = isSpread ? 0.75 : 1;
        // Final damage calculation
        const modifiers = (0, mechanics_1.makeDamageModifiers)({
            targets: spreadMult,
            weather: wBoost * terrainMult,
            stab: stabMult,
            type: typeMult * berryMult * abilityDefenseMult,
            burn: burnMult,
            other: itemDamageMult * abilityDamageMult * helpingHandMult,
        });
        const profile = (0, mechanics_1.damageProfileGen5Plus)(LEVEL, move.base_power, atkStat, defStat, modifiers);
        // Random roll between min and max
        const damage = Math.floor(profile.min + Math.random() * (profile.max - profile.min + 1));
        // Log type effectiveness
        const effLabel = typeMult >= 4 ? ' Supercriticamente efetivo! (×4)' : typeMult >= 2 ? ' Superefeito!' : typeMult <= 0.25 ? ' Resistido (×0.25)' : typeMult <= 0.5 ? ' Resistido' : '';
        state.log.push(`${displayPokeName(actor.identifier)} usou ${moveId.replace(/_/g, ' ')} em ${displayPokeName(target.identifier)}! (${damage} dano)${effLabel}`);
        // Apply damage (Sturdy / Focus Sash)
        this.applyDamage(state, target, damage, actor, targetTeamIdx);
        // Parental Bond second hit (25% of first hit)
        if (parentalBondSecond && !target.fainted) {
            const secondHit = Math.max(1, Math.floor(damage * 0.25));
            state.log.push(`${displayPokeName(actor.identifier)} golpeou novamente! (${secondHit} dano)`);
            this.applyDamage(state, target, secondHit, actor, targetTeamIdx);
        }
        // Life Orb recoil (10% of max HP)
        if (actor.config.item === 'life_orb' && !actor.itemConsumed && damage > 0 && actor.currentAbility !== 'magic_guard') {
            const recoil = Math.max(1, Math.floor(actor.maxHp / 10));
            actor.currentHp = Math.max(0, actor.currentHp - recoil);
            state.log.push(`${displayPokeName(actor.identifier)} sofreu recoil do Life Orb! (-${recoil} HP)`);
            if (actor.currentHp === 0) {
                actor.fainted = true;
                state.log.push(`${displayPokeName(actor.identifier)} desmaiou!`);
            }
        }
        // Rocky Helmet recoil (1/6 of max HP to physical attacker)
        if (target.config.item === 'rocky_helmet' && !target.itemConsumed && isPhysical && !actor.fainted) {
            const recoil = Math.max(1, Math.floor(actor.maxHp / 6));
            actor.currentHp = Math.max(0, actor.currentHp - recoil);
            state.log.push(`${displayPokeName(actor.identifier)} foi ferido pelo Rocky Helmet! (-${recoil} HP)`);
            if (actor.currentHp === 0 && !actor.fainted) {
                actor.fainted = true;
                state.log.push(`${displayPokeName(actor.identifier)} desmaiou!`);
            }
        }
        // Secondary effects (status, flinch, stat drops)
        if (damage > 0 && !target.fainted && move.effect_chance && Math.random() * 100 < move.effect_chance) {
            this.applySecondaryEffect(state, actor, target, move.ailment ?? null);
        }
        // Ability: on_hit_by_move (Weakness Policy, etc.)
        if (!target.fainted) {
            const hitCtx = this.makeAbilityCtx(state, target, targetTeamIdx, (m) => state.log.push(m));
            if (targetHandler?.on_hit_by_move)
                targetHandler.on_hit_by_move(hitCtx);
            // Weakness Policy: +2 Atk/SpA if hit by SE
            if (target.config.item === 'weakness_policy' && !target.itemConsumed && typeMult > 1) {
                target.boosts.attack = clamp(target.boosts.attack + 2, -6, 6);
                target.boosts.special_attack = clamp(target.boosts.special_attack + 2, -6, 6);
                target.itemConsumed = true;
                state.log.push(`${displayPokeName(target.identifier)}: +2 Atk/SpA (Weakness Policy)!`);
            }
        }
    }
    applyDamage(state, target, damage, attacker, teamIdx) {
        const wasFullHp = target.currentHp === target.maxHp;
        // Sturdy / Focus Sash: survive fatal hit at 1 HP
        if (damage >= target.currentHp && (target.currentAbility === 'sturdy' || (target.config.item === 'focus_sash' && !target.itemConsumed)) && wasFullHp && damage > 0) {
            target.currentHp = 1;
            if (target.config.item === 'focus_sash' && !target.itemConsumed) {
                target.itemConsumed = true;
                state.log.push(`${displayPokeName(target.identifier)} sobreviveu com Focus Sash!`);
            }
            else {
                state.log.push(`${displayPokeName(target.identifier)} sobreviveu com Sturdy!`);
            }
            return;
        }
        target.currentHp = Math.max(0, target.currentHp - damage);
        // Sitrus Berry: restore 25% HP when at ≤ 50%
        if (!target.itemConsumed && target.config.item === 'sitrus_berry' && target.currentHp <= target.maxHp / 2) {
            const heal = Math.max(1, Math.floor(target.maxHp / 4));
            target.currentHp = Math.min(target.maxHp, target.currentHp + heal);
            target.itemConsumed = true;
            state.log.push(`${displayPokeName(target.identifier)} comeu a Sitrus Berry! (+${heal} HP)`);
        }
        // Lum Berry: cure status
        if (!target.itemConsumed && target.config.item === 'lum_berry' && target.status !== 'healthy') {
            target.status = 'healthy';
            target.statusTurns = 0;
            target.itemConsumed = true;
            state.log.push(`${displayPokeName(target.identifier)} usou a Lum Berry e curou seu status!`);
        }
        if (target.currentHp === 0) {
            target.fainted = true;
            target.currentHp = 0;
            const team = state.teams[teamIdx];
            // Remove from active slot
            for (let s = 0; s < 2; s++) {
                if (team.active[s] === target)
                    team.active[s] = null;
            }
            state.log.push(`${displayPokeName(target.identifier)} desmaiou!`);
        }
    }
    applySecondaryEffect(state, attacker, target, ailment) {
        if (!ailment)
            return;
        if (target.status !== 'healthy')
            return;
        if (state.field.terrain === 'misty')
            return; // Misty Terrain blocks status
        switch (ailment) {
            case 'burn':
                if (target.currentTypes.includes('fire'))
                    return;
                target.status = 'burned';
                state.log.push(`${displayPokeName(target.identifier)} foi queimado!`);
                break;
            case 'paralysis':
                if (target.currentTypes.includes('electric'))
                    return;
                target.status = 'paralyzed';
                state.log.push(`${displayPokeName(target.identifier)} está paralisado!`);
                break;
            case 'poison':
                if (target.currentTypes.includes('poison') || target.currentTypes.includes('steel'))
                    return;
                target.status = 'poisoned';
                state.log.push(`${displayPokeName(target.identifier)} foi envenenado!`);
                break;
            case 'freeze':
                if (target.currentTypes.includes('ice'))
                    return;
                target.status = 'frozen';
                state.log.push(`${displayPokeName(target.identifier)} foi congelado!`);
                break;
            case 'sleep':
                target.status = 'asleep';
                target.statusTurns = 1 + Math.floor(Math.random() * 3); // 1-3 turns
                state.log.push(`${displayPokeName(target.identifier)} adormeceu!`);
                break;
            case 'flinch':
                target.isFlinched = true;
                break;
        }
    }
    // ── End-of-turn effects ──────────────────────────────────────────────────
    applyEndOfTurn(state) {
        for (let ti = 0; ti < 2; ti++) {
            const team = state.teams[ti];
            for (const slot of team.active) {
                if (!slot || slot.fainted)
                    continue;
                this.applyEndOfTurnForPoke(state, slot, ti);
            }
        }
    }
    applyEndOfTurnForPoke(state, poke, teamIdx) {
        const ab = poke.currentAbility;
        const noResidual = ab === 'magic_guard';
        // Weather damage
        if (!noResidual) {
            const w = state.field.weather;
            if (w === 'sandstorm' && !['rock', 'steel', 'ground'].some((t) => poke.currentTypes.includes(t))
                && ab !== 'sand_veil' && ab !== 'sand_rush' && ab !== 'sand_force' && ab !== 'overcoat') {
                const dmg = Math.max(1, Math.floor(poke.maxHp / 16));
                poke.currentHp = Math.max(0, poke.currentHp - dmg);
                state.log.push(`${displayPokeName(poke.identifier)} sofreu dano da tempestade! (-${dmg})`);
            }
            if (w === 'hail' && !poke.currentTypes.includes('ice') && ab !== 'ice_body' && ab !== 'overcoat' && ab !== 'slush_rush') {
                const dmg = Math.max(1, Math.floor(poke.maxHp / 16));
                poke.currentHp = Math.max(0, poke.currentHp - dmg);
                state.log.push(`${displayPokeName(poke.identifier)} sofreu dano do granizo! (-${dmg})`);
            }
        }
        // Status residual
        if (!noResidual && ab !== 'poison_heal') {
            if (poke.status === 'burned') {
                const burnDmg = Math.max(1, Math.floor(poke.maxHp / 16));
                poke.currentHp = Math.max(0, poke.currentHp - burnDmg);
                state.log.push(`${displayPokeName(poke.identifier)}: queimadura! (-${burnDmg})`);
            }
            if (poke.status === 'poisoned') {
                const poisDmg = Math.max(1, Math.floor(poke.maxHp / 8));
                poke.currentHp = Math.max(0, poke.currentHp - poisDmg);
                state.log.push(`${displayPokeName(poke.identifier)}: veneno! (-${poisDmg})`);
            }
            if (poke.status === 'badly_poisoned') {
                poke.statusTurns++;
                const poisDmg = Math.max(1, Math.floor(poke.maxHp * poke.statusTurns / 16));
                poke.currentHp = Math.max(0, poke.currentHp - poisDmg);
                state.log.push(`${displayPokeName(poke.identifier)}: veneno profundo! (-${poisDmg})`);
            }
        }
        // Tick sleep
        if (poke.status === 'asleep') {
            poke.statusTurns--;
            if (poke.statusTurns <= 0) {
                poke.status = 'healthy';
                state.log.push(`${displayPokeName(poke.identifier)} acordou!`);
            }
        }
        // Thaw from freeze (20% chance per turn)
        if (poke.status === 'frozen' && Math.random() < 0.2) {
            poke.status = 'healthy';
            state.log.push(`${displayPokeName(poke.identifier)} descongelou!`);
        }
        // Leftovers
        if (poke.config.item === 'leftovers' && !poke.itemConsumed) {
            const heal = Math.max(1, Math.floor(poke.maxHp / 16));
            poke.currentHp = Math.min(poke.maxHp, poke.currentHp + heal);
        }
        // Poison Heal (handled in ability registry above)
        // Rain Dish / Ice Body / Dry Skin → ability on_turn_end
        const ctx = this.makeAbilityCtx(state, poke, teamIdx, (m) => state.log.push(m));
        const handler = battle_abilities_1.ABILITY_REGISTRY[poke.currentAbility];
        if (handler?.on_turn_end)
            handler.on_turn_end(ctx);
        // Speed Boost (via ability)
        // Check faint from end-of-turn damage
        if (poke.currentHp === 0 && !poke.fainted) {
            poke.fainted = true;
            const team = state.teams[teamIdx];
            for (let s = 0; s < 2; s++) {
                if (team.active[s] === poke)
                    team.active[s] = null;
            }
            state.log.push(`${displayPokeName(poke.identifier)} desmaiou!`);
        }
    }
    // ── Field counter ticking ─────────────────────────────────────────────────
    tickField(state) {
        const f = state.field;
        if (f.weatherTurns > 0) {
            f.weatherTurns--;
            if (f.weatherTurns === 0) {
                f.weather = 'none';
                state.log.push('O clima voltou ao normal.');
            }
        }
        if (f.terrainTurns > 0) {
            f.terrainTurns--;
            if (f.terrainTurns === 0) {
                f.terrain = 'none';
                state.log.push('O campo voltou ao normal.');
            }
        }
        if (f.trickRoomTurns > 0) {
            f.trickRoomTurns--;
            if (f.trickRoomTurns === 0) {
                f.trickRoom = false;
                state.log.push('O espaço voltou ao normal.');
            }
        }
        for (const team of state.teams) {
            if (team.tailwindTurns > 0) {
                team.tailwindTurns--;
                if (team.tailwindTurns === 0)
                    state.log.push(`O Tailwind do time ${team.teamIdx + 1} acabou.`);
            }
        }
    }
    // ── Ability trigger helper ───────────────────────────────────────────────
    triggerAbility(state, poke, teamIdx, event) {
        const handler = battle_abilities_1.ABILITY_REGISTRY[poke.currentAbility];
        if (!handler)
            return;
        const fn = handler[event];
        if (!fn)
            return;
        const ctx = this.makeAbilityCtx(state, poke, teamIdx, (m) => state.log.push(m));
        fn(ctx);
    }
    makeAbilityCtx(state, poke, teamIdx, log) {
        const oppTeamIdx = (1 - teamIdx);
        return {
            state, self: poke, selfTeamIdx: teamIdx,
            opponents: state.teams[oppTeamIdx].active.filter((p) => !!p && !p.fainted),
            allies: state.teams[teamIdx].active.filter((p) => !!p && !p.fainted && p !== poke),
            speedMult: 1, damageMult: 1, defenseMult: 1,
            log,
        };
    }
    // ── Lookup helpers ────────────────────────────────────────────────────────
    findByUid(state, uid) {
        for (const team of state.teams) {
            for (const poke of team.party) {
                if (poke.uid === uid)
                    return poke;
            }
        }
        return null;
    }
    findTeamIdx(state, poke) {
        return state.teams[0].party.includes(poke) ? 0 : 1;
    }
    getAllActive(state) {
        return state.teams.flatMap((t) => t.active.filter((p) => !!p && !p.fainted));
    }
    // ── Public helpers for the bridge ─────────────────────────────────────────
    /** Simulate expected average damage from attacker using moveId against defender. Returns 0 if immune. */
    simulateDamage(state, attacker, defender, moveId) {
        const move = this.engine.getMove(moveId);
        if (!move || move.category === 'status' || move.base_power === 0)
            return 0;
        const isPhysical = move.category === 'physical';
        const atkStat = effectiveStat(attacker, isPhysical ? 'attack' : 'special_attack');
        const defStat = effectiveStat(defender, isPhysical ? 'defense' : 'special_defense');
        const typeMult = (0, mechanics_1.computeTypeMultiplier)(this.typeChart, move.type_id, defender.currentTypes);
        if (typeMult === 0)
            return 0;
        const stabMult = (0, mechanics_1.computeStab)(move.type_id, attacker.currentTypes);
        const spreadMult = battle_abilities_1.SPREAD_MOVES.has(moveId) ? 0.75 : 1;
        const modifiers = (0, mechanics_1.makeDamageModifiers)({
            targets: spreadMult,
            stab: stabMult,
            type: typeMult,
            burn: (attacker.status === 'burned' && isPhysical && attacker.currentAbility !== 'guts') ? 0.5 : 1,
        });
        return (0, mechanics_1.damageProfileGen5Plus)(LEVEL, move.base_power, atkStat, defStat, modifiers).avg;
    }
}
exports.BattleSimulator = BattleSimulator;
