"use strict";
/**
 * battle_ai.ts
 *
 * Rule-based AI for VGC doubles battles.
 *
 * Decision layers (in priority order):
 *   1. KO opponent immediately if possible
 *   2. Win-condition awareness (Trick Room, Tailwind, weather setup)
 *   3. Support ally (Helping Hand, redirect if ally is threatened)
 *   4. Maximum expected damage
 *   5. Switch if current matchup is dead-weight
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.BattleAI = void 0;
// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function activePoke(team) {
    return team.active.filter((p) => !!p && !p.fainted);
}
function benchPoke(team) {
    return team.party.filter((p) => !p.fainted && !team.active.includes(p));
}
// Does the team have a specific win condition present in the party?
function hasAbility(team, ...abilities) {
    return team.party.some((p) => !p.fainted && abilities.includes(p.currentAbility));
}
function hasMoveInSet(poke, moves) {
    return poke.config.moves.some((m) => moves.includes(m));
}
// ---------------------------------------------------------------------------
// AI class
// ---------------------------------------------------------------------------
class BattleAI {
    constructor(sim, engine) {
        this.sim = sim;
        this.engine = engine;
    }
    /**
     * Choose actions for both active slots of the given team.
     * Returns an array of BattleActions (may be 0–2 move/switch actions).
     */
    chooseActions(state, myTeamIdx) {
        const myTeam = state.teams[myTeamIdx];
        const oppTeamIdx = (1 - myTeamIdx);
        const oppTeam = state.teams[oppTeamIdx];
        const actions = [];
        for (let slot = 0; slot < 2; slot++) {
            const poke = myTeam.active[slot];
            if (!poke || poke.fainted)
                continue;
            const action = this.chooseSingleAction(state, poke, myTeamIdx, slot, oppTeam);
            actions.push(action);
        }
        return actions;
    }
    chooseSingleAction(state, poke, myTeamIdx, slot, oppTeam) {
        const myTeam = state.teams[myTeamIdx];
        const opponents = activePoke(oppTeam);
        // ── Layer 0: paralysis full-paralysis skip (handled by sim; AI picks normally) ──
        // ── Layer 1: KO opportunity ───────────────────────────────────────────────
        for (const moveId of poke.config.moves) {
            if (!this.canUseMoveNow(poke, moveId))
                continue;
            const move = this.engine.getMove(moveId);
            if (!move || move.category === 'status')
                continue;
            for (const opp of opponents) {
                const dmg = this.sim.simulateDamage(state, poke, opp, moveId);
                if (dmg >= opp.currentHp) {
                    return { kind: 'move', actorUid: poke.uid, moveId, targetUid: opp.uid };
                }
            }
        }
        // ── Layer 2: Win-condition setup ──────────────────────────────────────────
        // Trick Room: set up if team has slow Pokémon (avg speed < 60) and TR not active
        if (!state.field.trickRoom && hasMoveInSet(poke, ['trick_room'])) {
            const avgSpeed = myTeam.party.filter((p) => !p.fainted).reduce((s, p) => s + p.stats.speed, 0)
                / myTeam.party.filter((p) => !p.fainted).length;
            if (avgSpeed < 65) {
                return { kind: 'move', actorUid: poke.uid, moveId: 'trick_room', targetUid: poke.uid };
            }
        }
        // Tailwind: set up if team has high-speed Pokémon and TW not active
        if (myTeam.tailwindTurns === 0 && hasMoveInSet(poke, ['tailwind'])) {
            const maxSpeed = Math.max(...myTeam.party.filter((p) => !p.fainted).map((p) => p.stats.speed));
            if (maxSpeed > 90) {
                return { kind: 'move', actorUid: poke.uid, moveId: 'tailwind', targetUid: poke.uid };
            }
        }
        // Follow Me / Rage Powder: protect a high-value ally under threat
        if (hasMoveInSet(poke, ['follow_me', 'rage_powder'])) {
            const ally = myTeam.active.find((p) => p && p !== poke && !p.fainted);
            if (ally) {
                const allyCritical = opponents.some((opp) => poke.config.moves.some((m) => {
                    const dmg = this.sim.simulateDamage(state, opp, ally, m);
                    return dmg >= ally.currentHp * 0.7;
                }));
                if (allyCritical) {
                    const redirectId = poke.config.moves.includes('follow_me') ? 'follow_me' : 'rage_powder';
                    return { kind: 'move', actorUid: poke.uid, moveId: redirectId, targetUid: poke.uid };
                }
            }
        }
        // Helping Hand: boost ally if ally can KO with boost
        if (hasMoveInSet(poke, ['helping_hand'])) {
            const ally = myTeam.active.find((p) => p && p !== poke && !p.fainted);
            if (ally) {
                const allyCanKo = opponents.some((opp) => ally.config.moves.some((m) => {
                    const dmg = this.sim.simulateDamage(state, ally, opp, m);
                    return dmg * 1.5 >= opp.currentHp && dmg < opp.currentHp;
                }));
                if (allyCanKo) {
                    return { kind: 'move', actorUid: poke.uid, moveId: 'helping_hand', targetUid: ally.uid };
                }
            }
        }
        // ── Layer 3: Weather setter — swap in if beneficiary is active but weather wrong ──
        const weatherBeneficiaryAbilities = ['swift_swim', 'chlorophyll', 'sand_rush', 'slush_rush', 'solar_power', 'surge_surfer'];
        const ally = myTeam.active.find((p) => p && p !== poke && !p.fainted);
        if (ally && weatherBeneficiaryAbilities.includes(ally.currentAbility)) {
            const neededWeather = {
                swift_swim: 'rain', chlorophyll: 'sun', sand_rush: 'sandstorm', slush_rush: 'hail', solar_power: 'sun',
            };
            const needed = neededWeather[ally.currentAbility];
            if (needed && state.field.weather !== needed) {
                // Can we set weather?
                const weatherMoves = { rain_dance: 'rain', sunny_day: 'sun', sandstorm: 'sandstorm', hail: 'hail' };
                for (const [wMove, wKind] of Object.entries(weatherMoves)) {
                    if (poke.config.moves.includes(wMove) && wKind === needed) {
                        return { kind: 'move', actorUid: poke.uid, moveId: wMove, targetUid: poke.uid };
                    }
                }
                // Or swap in a weather setter from bench
                const setter = benchPoke(myTeam).find((p) => {
                    const setterAbilityWeather = { drought: 'sun', drizzle: 'rain', sand_stream: 'sandstorm', snow_warning: 'hail' };
                    return setterAbilityWeather[p.currentAbility] === needed;
                });
                if (setter) {
                    const setterIdx = myTeam.party.indexOf(setter);
                    return { kind: 'switch', teamIdx: myTeam.teamIdx, activeSlot: slot, partyIdx: setterIdx };
                }
            }
        }
        // ── Layer 4: Protect if low HP and there's a KO threat ────────────────────
        if (hasMoveInSet(poke, ['protect', 'detect'])) {
            const threatened = opponents.some((opp) => opp.config.moves.some((m) => {
                const dmg = this.sim.simulateDamage(state, opp, poke, m);
                return dmg >= poke.currentHp;
            }));
            if (threatened && poke.currentHp < poke.maxHp * 0.5) {
                const protectId = poke.config.moves.includes('protect') ? 'protect' : 'detect';
                return { kind: 'move', actorUid: poke.uid, moveId: protectId, targetUid: poke.uid };
            }
        }
        // ── Layer 5: Switch if dead-weight matchup ────────────────────────────────
        const allImmune = opponents.every((opp) => poke.config.moves.every((m) => {
            const move = this.engine.getMove(m);
            if (!move || move.category === 'status')
                return true;
            return this.sim.simulateDamage(state, poke, opp, m) === 0;
        }));
        if (allImmune) {
            const bench = benchPoke(myTeam);
            const counter = bench.find((b) => opponents.some((opp) => b.config.moves.some((m) => {
                const dmg = this.sim.simulateDamage(state, b, opp, m);
                return dmg > 0;
            })));
            if (counter) {
                const benchIdx = myTeam.party.indexOf(counter);
                return { kind: 'switch', teamIdx: myTeam.teamIdx, activeSlot: slot, partyIdx: benchIdx };
            }
        }
        // ── Layer 6: Maximum expected damage ──────────────────────────────────────
        let bestAction = null;
        let bestScore = -1;
        for (const moveId of poke.config.moves) {
            if (!this.canUseMoveNow(poke, moveId))
                continue;
            const move = this.engine.getMove(moveId);
            if (!move)
                continue;
            if (move.category === 'status' || move.base_power === 0) {
                // Give status moves a baseline score
                const statusScore = this.scoreStatusMove(state, poke, myTeam, opponents, moveId);
                if (statusScore > bestScore) {
                    bestScore = statusScore;
                    bestAction = { kind: 'move', actorUid: poke.uid, moveId, targetUid: opponents[0]?.uid ?? poke.uid };
                }
                continue;
            }
            for (const opp of opponents) {
                const dmg = this.sim.simulateDamage(state, poke, opp, moveId);
                // Score: damage as fraction of HP (capped at 1), boosted by priority moves
                const movePriority = move.tags.some((t) => t.startsWith('priority_')) ? 0.1 : 0;
                const score = Math.min(1, dmg / opp.currentHp) + movePriority;
                if (score > bestScore) {
                    bestScore = score;
                    bestAction = { kind: 'move', actorUid: poke.uid, moveId, targetUid: opp.uid };
                }
            }
        }
        if (bestAction)
            return bestAction;
        // Fallback: first available move against first opponent (should never reach here)
        const firstMove = poke.config.moves[0];
        const firstOpp = opponents[0];
        return {
            kind: 'move',
            actorUid: poke.uid,
            moveId: firstMove ?? 'splash',
            targetUid: firstOpp?.uid ?? poke.uid,
        };
    }
    canUseMoveNow(poke, moveId) {
        if (poke.choiceLocked && poke.choiceLocked !== moveId)
            return false;
        if ((poke.ppRemaining[moveId] ?? 1) <= 0)
            return false;
        return true;
    }
    scoreStatusMove(state, poke, myTeam, opponents, moveId) {
        switch (moveId) {
            case 'trick_room': return state.field.trickRoom ? 0 : 0.3;
            case 'tailwind': return myTeam.tailwindTurns > 0 ? 0 : 0.3;
            case 'follow_me':
            case 'rage_powder': return 0.2;
            case 'helping_hand': return 0.25;
            case 'protect':
            case 'detect': return 0.1;
            // Setup moves
            case 'swords_dance':
            case 'nasty_plot':
            case 'dragon_dance': return poke.currentHp > poke.maxHp * 0.7 ? 0.35 : 0.05;
            default: return 0.05;
        }
    }
    /**
     * Choose a replacement Pokémon from the bench for a given team.
     * Called when a Pokémon faints and a switch is required.
     */
    chooseForcedSwitch(state, myTeamIdx) {
        const myTeam = state.teams[myTeamIdx];
        const oppTeam = state.teams[(1 - myTeamIdx)];
        const opponents = activePoke(oppTeam);
        const bench = benchPoke(myTeam);
        if (bench.length === 0)
            return -1; // no replacement
        // Score each bench Pokémon
        let bestIdx = -1;
        let bestScore = -Infinity;
        for (const candidate of bench) {
            let score = 0;
            // How much damage can it deal to opponents?
            for (const opp of opponents) {
                const maxDmg = Math.max(...candidate.config.moves.map((m) => this.sim.simulateDamage(state, candidate, opp, m)));
                score += maxDmg / Math.max(1, opp.maxHp);
            }
            // How much damage does it take from opponents?
            for (const opp of opponents) {
                const maxIncoming = Math.max(...opp.config.moves.map((m) => this.sim.simulateDamage(state, opp, candidate, m)));
                score -= maxIncoming / Math.max(1, candidate.maxHp);
            }
            // Bonus for weather ability matching current weather
            const weatherAbilityBonus = { drought: 'sun', drizzle: 'rain', sand_stream: 'sandstorm', snow_warning: 'hail' };
            if (state.field.weather !== 'none' && weatherAbilityBonus[candidate.currentAbility] === state.field.weather)
                score += 0.5;
            if (score > bestScore) {
                bestScore = score;
                bestIdx = myTeam.party.indexOf(candidate);
            }
        }
        return bestIdx;
    }
}
exports.BattleAI = BattleAI;
