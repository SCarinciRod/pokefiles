import { StatMap, StatId, Nature } from './types';

// ---------------------------------------------------------------------------
// Configuration (input by user or AI)
// ---------------------------------------------------------------------------

export type BattleEVs = Partial<Record<StatId, number>>;

export interface BattlePokemonConfig {
  identifier: string;
  ability: string;
  item: string | null;
  moves: string[];                // up to 4 move IDs
  evs?: BattleEVs;
  ivs?: Partial<Record<StatId, number>>;
  nature?: Nature;
  megaStoneId?: string;           // e.g. 'charizardite_x' — triggers mega evo
}

export interface BattleTeamConfig {
  pokemon: BattlePokemonConfig[]; // 4-6 entries; first 4 are the "bring 4" box
}

// ---------------------------------------------------------------------------
// In-battle state types
// ---------------------------------------------------------------------------

export type StatusCondition =
  | 'healthy'
  | 'burned'
  | 'paralyzed'
  | 'poisoned'
  | 'badly_poisoned'
  | 'frozen'
  | 'asleep';

export interface StatBoosts {
  attack: number;
  defense: number;
  special_attack: number;
  special_defense: number;
  speed: number;
  accuracy: number;
  evasion: number;
}

export function emptyBoosts(): StatBoosts {
  return { attack: 0, defense: 0, special_attack: 0, special_defense: 0, speed: 0, accuracy: 0, evasion: 0 };
}

export type WeatherKind = 'none' | 'sun' | 'rain' | 'sandstorm' | 'hail' | 'harsh_sun' | 'heavy_rain';
export type TerrainKind = 'none' | 'electric' | 'psychic' | 'grassy' | 'misty';

export interface BattlePokemon {
  uid: string;                    // unique within battle: 'team0_0', 'team1_2', …
  config: BattlePokemonConfig;    // original config (immutable)
  identifier: string;             // current dex id (changes on mega evo)
  currentTypes: string[];         // current types (changes on mega evo)
  currentAbility: string;         // current ability (changes on mega evo)
  maxHp: number;
  currentHp: number;
  stats: StatMap;                 // computed at battle start (level 50, EVs, nature)
  boosts: StatBoosts;             // stat stage modifiers, –6…+6
  status: StatusCondition;
  statusTurns: number;            // sleep turns remaining / badly-poison counter
  isProtected: boolean;           // reset each turn
  isFlinched: boolean;            // reset each turn
  itemConsumed: boolean;          // one-use items: berry, sash, etc.
  megaEvolved: boolean;
  choiceLocked: string | null;    // move ID if Choice item has locked a move
  helpingHandBoosted: boolean;    // +50% damage this turn from Helping Hand
  ppRemaining: Record<string, number>;
  turnsInBattle: number;          // 0 = just switched in (for Fake Out etc.)
  fainted: boolean;
}

export interface BattleTeam {
  party: BattlePokemon[];                                 // all Pokémon in order
  active: [BattlePokemon | null, BattlePokemon | null];  // current field slots
  tailwindTurns: number;
  teamIdx: 0 | 1;
}

export interface BattleField {
  weather: WeatherKind;
  weatherTurns: number;           // 0 = no weather
  terrain: TerrainKind;
  terrainTurns: number;
  trickRoom: boolean;
  trickRoomTurns: number;
}

export interface BattleState {
  teams: [BattleTeam, BattleTeam];
  field: BattleField;
  turn: number;
  log: string[];
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

export type BattleAction =
  | { kind: 'move'; actorUid: string; moveId: string; targetUid: string }
  | { kind: 'switch'; teamIdx: 0 | 1; activeSlot: 0 | 1; partyIdx: number }
  | { kind: 'pass' };  // slot is empty / just fainted with no replacement

// ---------------------------------------------------------------------------
// Turn result
// ---------------------------------------------------------------------------

export interface TurnResult {
  state: BattleState;
  winner: 0 | 1 | null;           // null = battle continues
  requiresSwitch: [boolean, boolean]; // which teams need to send a replacement
}

// ---------------------------------------------------------------------------
// Ability hook context
// ---------------------------------------------------------------------------

export interface AbilityContext {
  state: BattleState;
  self: BattlePokemon;
  selfTeamIdx: 0 | 1;
  opponents: BattlePokemon[];     // currently active opponents
  allies: BattlePokemon[];        // currently active allies (not self)
  // mutable modifiers adjusted by ability hooks:
  speedMult: number;
  damageMult: number;             // outgoing
  defenseMult: number;            // incoming
  log: (msg: string) => void;
}

export type AbilityEventName =
  | 'on_switch_in'
  | 'on_move_use'      // before the move is executed (attacker)
  | 'on_damage_calc'   // during damage calc (can modify speedMult / damageMult)
  | 'on_hit_by_move'   // after taking damage (can trigger abilities like Weakness Policy)
  | 'on_stat_change'   // when a stat drop is attempted on self
  | 'on_turn_end';     // end-of-turn effects

export type AbilityHandlerFn = (ctx: AbilityContext) => void;

export interface AbilityHandlers {
  on_switch_in?: AbilityHandlerFn;
  on_move_use?: AbilityHandlerFn;
  on_damage_calc?: AbilityHandlerFn;
  on_hit_by_move?: AbilityHandlerFn;
  on_stat_change?: AbilityHandlerFn;
  on_turn_end?: AbilityHandlerFn;
}

// ---------------------------------------------------------------------------
// Item hook context (subset — damage + end of turn)
// ---------------------------------------------------------------------------

export interface ItemContext {
  state: BattleState;
  holder: BattlePokemon;
  holderTeamIdx: 0 | 1;
  moveTypeId?: string;            // type of the incoming/outgoing move
  isIncoming?: boolean;           // true if holder is the target
  typeMult?: number;              // current type effectiveness (for berry trigger)
  damageMult: number;             // outgoing damage multiplier (writable)
  defenseMult: number;            // incoming damage multiplier (writable)
  log: (msg: string) => void;
}

export interface ItemHandlers {
  on_damage_calc?: (ctx: ItemContext) => void;
  on_hit?: (ctx: ItemContext) => void;        // after damage dealt to holder
  on_turn_end?: (ctx: ItemContext) => void;
}
