import Database from 'better-sqlite3';
import {
  AbilityInfo,
  DamageProfile,
  DamageRequest,
  EffectEntry,
  ItemInfo,
  MarkerValue,
  MoveInfo,
  PokemonContext,
  StatId,
  StatMap,
  StatSpread
} from './types';
import {
  calculateStats,
  compareActionOrder,
  computePriorityFromTags,
  computeStab,
  computeTypeMultiplier,
  createEmptyStatMap,
  damageProfileGen5Plus,
  makeDamageModifiers
} from './mechanics';

type PokemonRow = {
  id: number;
  identifier: string;
  height_dm: number;
  weight_hg: number;
  source_generation: number | null;
};

type StatRow = {
  stat_id: StatId;
  value: number;
};

type TypeRow = {
  type_id: string;
};

type AbilitySlotRow = {
  ability_id: string;
};

type MoveRow = {
  id: string;
  type_id: string;
  category: string;
  base_power: number;
  accuracy: number;
  pp: number;
  effect_chance: number | null;
  ailment: string | null;
  effect_category: string | null;
  description: string;
};

type AbilityRow = {
  id: string;
  generation: string | null;
  is_main_series: number;
  short_effect: string | null;
  effect: string | null;
};

type ItemRow = {
  id: string;
  category: string | null;
  cost: number;
  fling_power: number;
  fling_effect: string | null;
  description: string | null;
};

type MarkerRow = {
  marker: string;
  value_type: string;
  value_text: string;
  value_number: number | null;
  value_bool: number | null;
};

type EffectRow = {
  category: string;
  trigger: string;
  model_json: string;
  description: string;
  confidence: number | null;
};

type MoveTagRow = {
  tag: string;
};

type TypeChartRow = {
  attack_type: string;
  defense_type: string;
  multiplier: number;
};

type MoveIdRow = {
  move_id: string;
};

const DEFAULT_LEVEL = 50;

function safeJsonParse(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function mapMarkers(rows: MarkerRow[]): MarkerValue[] {
  return rows.map((row) => ({
    marker: row.marker,
    value_type: row.value_type,
    value_text: row.value_text,
    value_number: row.value_number,
    value_bool: row.value_bool
  }));
}

function mapEffects(rows: EffectRow[]): EffectEntry[] {
  return rows.map((row) => ({
    category: row.category,
    trigger: row.trigger,
    model: safeJsonParse(row.model_json),
    description: row.description,
    confidence: row.confidence
  }));
}

export class DeterministicEngine {
  private db: Database.Database;
  private typeChart: Map<string, Map<string, number>>;
  private pokemonCache = new Map<string, PokemonContext>();
  private moveCache = new Map<string, MoveInfo>();
  private abilityCache = new Map<string, AbilityInfo>();
  private itemCache = new Map<string, ItemInfo>();

  private stmtPokemonByIdentifier: Database.Statement;
  private stmtPokemonTypes: Database.Statement;
  private stmtPokemonAbilities: Database.Statement;
  private stmtPokemonStats: Database.Statement;
  private stmtPokemonMoves: Database.Statement;
  private stmtMoveById: Database.Statement;
  private stmtMoveTags: Database.Statement;
  private stmtAbilityById: Database.Statement;
  private stmtAbilityMarkers: Database.Statement;
  private stmtAbilityEffects: Database.Statement;
  private stmtItemById: Database.Statement;
  private stmtItemMarkers: Database.Statement;
  private stmtItemEffects: Database.Statement;
  private stmtTypeChart: Database.Statement;
  private stmtAllPokemon: Database.Statement;

  constructor(dbPath: string) {
    this.db = new Database(dbPath, { readonly: true });
    this.db.pragma('foreign_keys = ON');

    this.stmtPokemonByIdentifier = this.db.prepare(
      'SELECT id, identifier, height_dm, weight_hg, source_generation FROM pokemon WHERE identifier = ?'
    );
    this.stmtPokemonTypes = this.db.prepare(
      'SELECT type_id FROM pokemon_types WHERE pokemon_id = ? ORDER BY slot'
    );
    this.stmtPokemonAbilities = this.db.prepare(
      'SELECT ability_id FROM pokemon_abilities WHERE pokemon_id = ? ORDER BY slot'
    );
    this.stmtPokemonStats = this.db.prepare(
      'SELECT stat_id, value FROM pokemon_stats WHERE pokemon_id = ?'
    );
    this.stmtPokemonMoves = this.db.prepare(
      'SELECT move_id FROM pokemon_moves WHERE pokemon_identifier = ? ORDER BY move_id'
    );
    this.stmtMoveById = this.db.prepare(
      'SELECT id, type_id, category, base_power, accuracy, pp, effect_chance, ailment, effect_category, description FROM moves WHERE id = ?'
    );
    this.stmtMoveTags = this.db.prepare('SELECT tag FROM move_tags WHERE move_id = ?');
    this.stmtAbilityById = this.db.prepare(
      'SELECT id, generation, is_main_series, short_effect, effect FROM abilities WHERE id = ?'
    );
    this.stmtAbilityMarkers = this.db.prepare(
      'SELECT marker, value_type, value_text, value_number, value_bool FROM ability_markers WHERE ability_id = ?'
    );
    this.stmtAbilityEffects = this.db.prepare(
      'SELECT category, trigger, model_json, description, NULL AS confidence FROM ability_effects WHERE ability_id = ?'
    );
    this.stmtItemById = this.db.prepare(
      'SELECT id, category, cost, fling_power, fling_effect, description FROM items WHERE id = ?'
    );
    this.stmtItemMarkers = this.db.prepare(
      'SELECT marker, value_type, value_text, value_number, value_bool FROM item_markers WHERE item_id = ?'
    );
    this.stmtItemEffects = this.db.prepare(
      'SELECT category, trigger, model_json, description, confidence FROM held_item_effects WHERE item_id = ?'
    );
    this.stmtTypeChart = this.db.prepare(
      'SELECT attack_type, defense_type, multiplier FROM type_chart'
    );
    this.stmtAllPokemon = this.db.prepare(
      'SELECT id, identifier, height_dm, weight_hg, source_generation FROM pokemon ORDER BY id'
    );

    this.typeChart = this.loadTypeChart();
  }

  private loadTypeChart(): Map<string, Map<string, number>> {
    const rows = this.stmtTypeChart.all() as TypeChartRow[];
    const chart = new Map<string, Map<string, number>>();
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

  getAllPokemon(): PokemonContext[] {
    const rows = this.stmtAllPokemon.all() as PokemonRow[];
    return rows.map((row) => this.buildPokemonContext(row));
  }

  private buildPokemonContext(row: PokemonRow, includeMoves = false): PokemonContext {
    const types = (this.stmtPokemonTypes.all(row.id) as TypeRow[]).map((r) => r.type_id);
    const abilities = (this.stmtPokemonAbilities.all(row.id) as AbilitySlotRow[]).map((r) => r.ability_id);
    const statsRows = this.stmtPokemonStats.all(row.id) as StatRow[];
    const baseStats = createEmptyStatMap(1);

    for (const statRow of statsRows) {
      const statId = statRow.stat_id;
      if (statId in baseStats) {
        baseStats[statId] = statRow.value;
      }
    }

    const moves = includeMoves
      ? (this.stmtPokemonMoves.all(row.identifier) as MoveIdRow[]).map((r) => r.move_id)
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

  getPokemonContext(identifier: string, options: { includeMoves?: boolean } = {}): PokemonContext | null {
    const cached = this.pokemonCache.get(identifier);
    if (cached) return cached;

    const row = this.stmtPokemonByIdentifier.get(identifier) as PokemonRow | undefined;
    if (!row) return null;

    const context = this.buildPokemonContext(row, options.includeMoves);
    this.pokemonCache.set(identifier, context);
    return context;
  }

  getPokemonStats(identifier: string, spread: StatSpread): StatMap | null {
    const context = this.getPokemonContext(identifier);
    if (!context) return null;
    return calculateStats(context.baseStats, spread);
  }

  getMove(moveId: string): MoveInfo | null {
    const cached = this.moveCache.get(moveId);
    if (cached) return cached;

    const row = this.stmtMoveById.get(moveId) as MoveRow | undefined;
    if (!row) return null;

    const tags = (this.stmtMoveTags.all(moveId) as MoveTagRow[]).map((r) => r.tag);
    const move: MoveInfo = { ...row, tags };
    this.moveCache.set(moveId, move);
    return move;
  }

  getAbility(abilityId: string): AbilityInfo | null {
    const cached = this.abilityCache.get(abilityId);
    if (cached) return cached;

    const row = this.stmtAbilityById.get(abilityId) as AbilityRow | undefined;
    if (!row) return null;

    const markers = mapMarkers(this.stmtAbilityMarkers.all(abilityId) as MarkerRow[]);
    const effects = mapEffects(this.stmtAbilityEffects.all(abilityId) as EffectRow[]);

    const ability: AbilityInfo = {
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

  getItem(itemId: string): ItemInfo | null {
    const cached = this.itemCache.get(itemId);
    if (cached) return cached;

    const row = this.stmtItemById.get(itemId) as ItemRow | undefined;
    if (!row) return null;

    const markers = mapMarkers(this.stmtItemMarkers.all(itemId) as MarkerRow[]);
    const effects = mapEffects(this.stmtItemEffects.all(itemId) as EffectRow[]);

    const item: ItemInfo = {
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

  getMovePriority(move: MoveInfo): number {
    return computePriorityFromTags(move.tags);
  }

  computeStats(baseStats: StatMap, spread: Partial<StatSpread>): StatMap {
    const normalized: StatSpread = {
      level: spread.level ?? DEFAULT_LEVEL,
      evs: spread.evs,
      ivs: spread.ivs,
      nature: spread.nature
    };
    return calculateStats(baseStats, normalized);
  }

  computeDamageProfile(request: DamageRequest): DamageProfile {
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

    const typeMultiplier = computeTypeMultiplier(this.typeChart, move.type_id, defender.types);
    const stab = computeStab(move.type_id, attacker.types);

    const modifiers = makeDamageModifiers({
      ...request.modifiers,
      type: typeMultiplier,
      stab
    });

    return damageProfileGen5Plus(level, move.base_power, attackStat, defenseStat, modifiers);
  }

  compareActionOrder = compareActionOrder;

  getTypeChart(): Map<string, Map<string, number>> {
    return this.typeChart;
  }

  /** Run an arbitrary SELECT and return all rows. For export scripts only — not for production use. */
  queryAll<T = Record<string, unknown>>(sql: string, params: unknown[] = []): T[] {
    return this.db.prepare(sql).all(...params) as T[];
  }

  close(): void {
    this.db.close();
  }
}
