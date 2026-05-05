import {
  ActionOrder,
  ActionProfile,
  DamageModifiers,
  DamageProfile,
  Nature,
  StatId,
  StatMap,
  StatSpread
} from './types';

export const STAT_IDS: StatId[] = [
  'hp',
  'attack',
  'defense',
  'special_attack',
  'special_defense',
  'speed'
];

export const DEFAULT_NATURE: Nature = { plus: 'neutral', minus: 'neutral' };

export function createEmptyStatMap(defaultValue = 1): StatMap {
  return {
    hp: defaultValue,
    attack: defaultValue,
    defense: defaultValue,
    special_attack: defaultValue,
    special_defense: defaultValue,
    speed: defaultValue
  };
}

function clampInt(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, Math.floor(value)));
}

function natureMultiplier(statId: StatId, nature: Nature): number {
  if (nature.plus === statId && nature.minus !== statId) return 1.1;
  if (nature.minus === statId && nature.plus !== statId) return 0.9;
  return 1.0;
}

export function calculateStat(
  statId: StatId,
  base: number,
  level: number,
  iv: number,
  ev: number,
  nature: Nature
): number {
  const baseSafe = Math.max(1, Math.floor(base));
  const ivSafe = clampInt(iv, 0, 31);
  const evSafe = clampInt(ev, 0, 252);
  const levelSafe = Math.max(1, Math.floor(level));
  const shared = Math.floor(((2 * baseSafe + ivSafe + Math.floor(evSafe / 4)) * levelSafe) / 100);

  if (statId === 'hp') {
    return shared + levelSafe + 10;
  }

  const raw = shared + 5;
  return Math.floor(raw * natureMultiplier(statId, nature));
}

export function calculateStats(baseStats: StatMap, spread: StatSpread): StatMap {
  const nature = spread.nature ?? DEFAULT_NATURE;
  const stats = createEmptyStatMap(1);
  for (const statId of STAT_IDS) {
    const base = baseStats[statId] ?? 1;
    const iv = spread.ivs?.[statId] ?? 31;
    const ev = spread.evs?.[statId] ?? 0;
    stats[statId] = calculateStat(statId, base, spread.level, iv, ev, nature);
  }
  return stats;
}

export function computeTypeMultiplier(
  chart: Map<string, Map<string, number>>,
  attackType: string,
  defenseTypes: string[]
): number {
  const byAttack = chart.get(attackType);
  if (!byAttack) return 1.0;
  let multiplier = 1.0;
  for (const defenseType of defenseTypes) {
    const value = byAttack.get(defenseType);
    if (value !== undefined) {
      multiplier *= value;
    }
  }
  return multiplier;
}

export function computeStab(moveType: string, attackerTypes: string[]): number {
  return attackerTypes.includes(moveType) ? 1.5 : 1.0;
}

export function computePriorityFromTags(tags: string[]): number {
  let best: number | null = null;
  for (const tag of tags) {
    const match = /^priority_(-?\d+)$/.exec(tag);
    if (!match) continue;
    const value = parseInt(match[1], 10);
    if (best === null || value > best) {
      best = value;
    }
  }
  return best ?? 0;
}

export function makeDamageModifiers(overrides: Partial<DamageModifiers> = {}): DamageModifiers {
  return {
    targets: 1,
    parental_bond: 1,
    weather: 1,
    glaive_rush: 1,
    critical: 1,
    stab: 1,
    type: 1,
    burn: 1,
    other: 1,
    zmove: 1,
    tera_shield: 1,
    ...overrides
  };
}

function baseDamageGen5Plus(level: number, power: number, attack: number, defense: number): number {
  const levelTerm = Math.floor((2 * level) / 5) + 2;
  const numerator = levelTerm * power * attack;
  const raw = Math.floor(numerator / defense);
  return Math.floor(raw / 50) + 2;
}

function roundHalfDownPositive(value: number): number {
  const floorValue = Math.floor(value);
  const fraction = value - floorValue;
  return fraction > 0.5 ? floorValue + 1 : floorValue;
}

function applyDamageModifiers(baseDamage: number, ordered: number[]): number {
  let damage = baseDamage;
  for (const mod of ordered) {
    damage = roundHalfDownPositive(damage * mod);
  }
  return damage <= 0 ? 1 : damage;
}

export function damageProfileGen5Plus(
  level: number,
  powerInput: number,
  attackEffRaw: number,
  defenseEffRaw: number,
  modifiers: DamageModifiers
): DamageProfile {
  if (modifiers.type <= 0) {
    return { min: 0, avg: 0, max: 0 };
  }

  const power = Math.max(1, Math.round(powerInput));
  const attack = Math.max(1, Math.round(attackEffRaw));
  const defense = Math.max(1, Math.round(defenseEffRaw));
  const baseDamage = baseDamageGen5Plus(level, power, attack, defense);

  const ordered = [
    modifiers.targets,
    modifiers.parental_bond,
    modifiers.weather,
    modifiers.glaive_rush,
    modifiers.critical,
    0.85,
    modifiers.stab,
    modifiers.type,
    modifiers.burn,
    modifiers.other,
    modifiers.zmove,
    modifiers.tera_shield
  ];

  const min = applyDamageModifiers(baseDamage, ordered);
  const avg = applyDamageModifiers(baseDamage, [
    modifiers.targets,
    modifiers.parental_bond,
    modifiers.weather,
    modifiers.glaive_rush,
    modifiers.critical,
    0.925,
    modifiers.stab,
    modifiers.type,
    modifiers.burn,
    modifiers.other,
    modifiers.zmove,
    modifiers.tera_shield
  ]);
  const max = applyDamageModifiers(baseDamage, [
    modifiers.targets,
    modifiers.parental_bond,
    modifiers.weather,
    modifiers.glaive_rush,
    modifiers.critical,
    1.0,
    modifiers.stab,
    modifiers.type,
    modifiers.burn,
    modifiers.other,
    modifiers.zmove,
    modifiers.tera_shield
  ]);

  return { min, avg, max };
}

export function compareActionOrder(
  a: ActionProfile,
  b: ActionProfile,
  trickRoom = false
): ActionOrder {
  if (a.priority > b.priority) return 'first';
  if (a.priority < b.priority) return 'second';

  if (a.speed !== b.speed) {
    if (trickRoom) {
      return a.speed < b.speed ? 'first' : 'second';
    }
    return a.speed > b.speed ? 'first' : 'second';
  }

  return a.damage >= b.damage ? 'first' : 'second';
}
