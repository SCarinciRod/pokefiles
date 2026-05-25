"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.DeterministicEngine = void 0;
const better_sqlite3_1 = __importDefault(require("better-sqlite3"));
const mechanics_1 = require("./mechanics");
const DEFAULT_LEVEL = 50;
function safeJsonParse(value) {
    try {
        return JSON.parse(value);
    }
    catch {
        return value;
    }
}
function mapMarkers(rows) {
    return rows.map((row) => ({
        marker: row.marker,
        value_type: row.value_type,
        value_text: row.value_text,
        value_number: row.value_number,
        value_bool: row.value_bool
    }));
}
function mapEffects(rows) {
    return rows.map((row) => ({
        category: row.category,
        trigger: row.trigger,
        model: safeJsonParse(row.model_json),
        description: row.description,
        confidence: row.confidence
    }));
}
class DeterministicEngine {
    constructor(dbPath) {
        this.pokemonCache = new Map();
        this.moveCache = new Map();
        this.abilityCache = new Map();
        this.itemCache = new Map();
        this.compareActionOrder = mechanics_1.compareActionOrder;
        this.db = new better_sqlite3_1.default(dbPath, { readonly: true });
        this.db.pragma('foreign_keys = ON');
        this.stmtPokemonByIdentifier = this.db.prepare('SELECT id, identifier, height_dm, weight_hg, source_generation FROM pokemon WHERE identifier = ?');
        this.stmtPokemonTypes = this.db.prepare('SELECT type_id FROM pokemon_types WHERE pokemon_id = ? ORDER BY slot');
        this.stmtPokemonAbilities = this.db.prepare('SELECT ability_id FROM pokemon_abilities WHERE pokemon_id = ? ORDER BY slot');
        this.stmtPokemonStats = this.db.prepare('SELECT stat_id, value FROM pokemon_stats WHERE pokemon_id = ?');
        this.stmtPokemonMoves = this.db.prepare('SELECT move_id FROM pokemon_moves WHERE pokemon_identifier = ? ORDER BY move_id');
        this.stmtMoveById = this.db.prepare('SELECT id, type_id, category, base_power, accuracy, pp, effect_chance, ailment, effect_category, description FROM moves WHERE id = ?');
        this.stmtMoveTags = this.db.prepare('SELECT tag FROM move_tags WHERE move_id = ?');
        this.stmtAbilityById = this.db.prepare('SELECT id, generation, is_main_series, short_effect, effect FROM abilities WHERE id = ?');
        this.stmtAbilityMarkers = this.db.prepare('SELECT marker, value_type, value_text, value_number, value_bool FROM ability_markers WHERE ability_id = ?');
        this.stmtAbilityEffects = this.db.prepare('SELECT category, trigger, model_json, description, NULL AS confidence FROM ability_effects WHERE ability_id = ?');
        this.stmtItemById = this.db.prepare('SELECT id, category, cost, fling_power, fling_effect, description FROM items WHERE id = ?');
        this.stmtItemMarkers = this.db.prepare('SELECT marker, value_type, value_text, value_number, value_bool FROM item_markers WHERE item_id = ?');
        this.stmtItemEffects = this.db.prepare('SELECT category, trigger, model_json, description, confidence FROM held_item_effects WHERE item_id = ?');
        this.stmtTypeChart = this.db.prepare('SELECT attack_type, defense_type, multiplier FROM type_chart');
        this.stmtAllPokemon = this.db.prepare('SELECT id, identifier, height_dm, weight_hg, source_generation FROM pokemon ORDER BY id');
        this.typeChart = this.loadTypeChart();
    }
    loadTypeChart() {
        const rows = this.stmtTypeChart.all();
        const chart = new Map();
        for (const row of rows) {
            let bucket = chart.get(row.attack_type);
            if (!bucket) {
                bucket = new Map();
                chart.set(row.attack_type, bucket);
            }
            bucket.set(row.defense_type, row.multiplier);
        }
        return chart;
    }
    getAllPokemon() {
        const rows = this.stmtAllPokemon.all();
        return rows.map((row) => this.buildPokemonContext(row));
    }
    buildPokemonContext(row, includeMoves = false) {
        const types = this.stmtPokemonTypes.all(row.id).map((r) => r.type_id);
        const abilities = this.stmtPokemonAbilities.all(row.id).map((r) => r.ability_id);
        const statsRows = this.stmtPokemonStats.all(row.id);
        const baseStats = (0, mechanics_1.createEmptyStatMap)(1);
        for (const statRow of statsRows) {
            const statId = statRow.stat_id;
            if (statId in baseStats) {
                baseStats[statId] = statRow.value;
            }
        }
        const moves = includeMoves
            ? this.stmtPokemonMoves.all(row.identifier).map((r) => r.move_id)
            : undefined;
        return {
            id: row.id,
            identifier: row.identifier,
            height_dm: row.height_dm,
            weight_hg: row.weight_hg,
            source_generation: row.source_generation,
            types,
            abilities,
            baseStats,
            moves
        };
    }
    getPokemonContext(identifier, options = {}) {
        const cached = this.pokemonCache.get(identifier);
        if (cached)
            return cached;
        const row = this.stmtPokemonByIdentifier.get(identifier);
        if (!row)
            return null;
        const context = this.buildPokemonContext(row, options.includeMoves);
        this.pokemonCache.set(identifier, context);
        return context;
    }
    getPokemonStats(identifier, spread) {
        const context = this.getPokemonContext(identifier);
        if (!context)
            return null;
        return (0, mechanics_1.calculateStats)(context.baseStats, spread);
    }
    getMove(moveId) {
        const cached = this.moveCache.get(moveId);
        if (cached)
            return cached;
        const row = this.stmtMoveById.get(moveId);
        if (!row)
            return null;
        const tags = this.stmtMoveTags.all(moveId).map((r) => r.tag);
        const move = { ...row, tags };
        this.moveCache.set(moveId, move);
        return move;
    }
    getAbility(abilityId) {
        const cached = this.abilityCache.get(abilityId);
        if (cached)
            return cached;
        const row = this.stmtAbilityById.get(abilityId);
        if (!row)
            return null;
        const markers = mapMarkers(this.stmtAbilityMarkers.all(abilityId));
        const effects = mapEffects(this.stmtAbilityEffects.all(abilityId));
        const ability = {
            id: row.id,
            generation: row.generation,
            is_main_series: row.is_main_series === 1,
            short_effect: row.short_effect,
            effect: row.effect,
            markers,
            effects
        };
        this.abilityCache.set(abilityId, ability);
        return ability;
    }
    getItem(itemId) {
        const cached = this.itemCache.get(itemId);
        if (cached)
            return cached;
        const row = this.stmtItemById.get(itemId);
        if (!row)
            return null;
        const markers = mapMarkers(this.stmtItemMarkers.all(itemId));
        const effects = mapEffects(this.stmtItemEffects.all(itemId));
        const item = {
            id: row.id,
            category: row.category,
            cost: row.cost,
            fling_power: row.fling_power,
            fling_effect: row.fling_effect,
            description: row.description,
            markers,
            effects
        };
        this.itemCache.set(itemId, item);
        return item;
    }
    getMovePriority(move) {
        return (0, mechanics_1.computePriorityFromTags)(move.tags);
    }
    computeStats(baseStats, spread) {
        const normalized = {
            level: spread.level ?? DEFAULT_LEVEL,
            evs: spread.evs,
            ivs: spread.ivs,
            nature: spread.nature
        };
        return (0, mechanics_1.calculateStats)(baseStats, normalized);
    }
    computeDamageProfile(request) {
        const { attacker, defender, attackerStats, defenderStats, move, level } = request;
        if (move.category === 'status' || move.base_power <= 0) {
            return { min: 0, avg: 0, max: 0 };
        }
        const attackStat = move.category === 'physical'
            ? attackerStats.attack
            : attackerStats.special_attack;
        const defenseStat = move.category === 'physical'
            ? defenderStats.defense
            : defenderStats.special_defense;
        const typeMultiplier = (0, mechanics_1.computeTypeMultiplier)(this.typeChart, move.type_id, defender.types);
        const stab = (0, mechanics_1.computeStab)(move.type_id, attacker.types);
        const modifiers = (0, mechanics_1.makeDamageModifiers)({
            ...request.modifiers,
            type: typeMultiplier,
            stab
        });
        return (0, mechanics_1.damageProfileGen5Plus)(level, move.base_power, attackStat, defenseStat, modifiers);
    }
    getTypeChart() {
        return this.typeChart;
    }
    /** Run an arbitrary SELECT and return all rows. For export scripts only — not for production use. */
    queryAll(sql, params = []) {
        return this.db.prepare(sql).all(...params);
    }
    close() {
        this.db.close();
    }
}
exports.DeterministicEngine = DeterministicEngine;
