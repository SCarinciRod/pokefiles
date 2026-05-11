export type StatId = 'hp' | 'attack' | 'defense' | 'special_attack' | 'special_defense' | 'speed';

export type StatMap = Record<StatId, number>;

export type Nature = {
  plus: StatId | 'neutral';
  minus: StatId | 'neutral';
};

export type StatSpread = {
  level: number;
  evs?: Partial<Record<StatId, number>>;
  ivs?: Partial<Record<StatId, number>>;
  nature?: Nature;
};

export type PokemonCore = {
  id: number;
  identifier: string;
  height_dm: number;
  weight_hg: number;
  source_generation: number | null;
};

export type PokemonContext = PokemonCore & {
  types: string[];
  abilities: string[];
  baseStats: StatMap;
  moves?: string[];
};

export type MoveInfo = {
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
  tags: string[];
};

export type MarkerValue = {
  marker: string;
  value_type: string;
  value_text: string;
  value_number: number | null;
  value_bool: number | null;
};

export type EffectEntry = {
  category: string;
  trigger: string;
  model: unknown;
  description: string;
  confidence: number | null;
};

export type AbilityInfo = {
  id: string;
  generation: string | null;
  is_main_series: boolean;
  short_effect: string | null;
  effect: string | null;
  markers: MarkerValue[];
  effects: EffectEntry[];
};

export type ItemInfo = {
  id: string;
  category: string | null;
  cost: number;
  fling_power: number;
  fling_effect: string | null;
  description: string | null;
  markers: MarkerValue[];
  effects: EffectEntry[];
};

export type DamageModifiers = {
  targets: number;
  parental_bond: number;
  weather: number;
  glaive_rush: number;
  critical: number;
  stab: number;
  type: number;
  burn: number;
  other: number;
  zmove: number;
  tera_shield: number;
};

export type DamageProfile = {
  min: number;
  avg: number;
  max: number;
};

export type ActionProfile = {
  priority: number;
  speed: number;
  damage: number;
};

export type ActionOrder = 'first' | 'second';

export type DamageRequest = {
  level: number;
  attacker: PokemonContext;
  defender: PokemonContext;
  attackerStats: StatMap;
  defenderStats: StatMap;
  move: MoveInfo;
  modifiers?: Partial<DamageModifiers>;
};
