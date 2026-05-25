"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_NATURE = exports.STAT_IDS = void 0;
exports.createEmptyStatMap = createEmptyStatMap;
exports.calculateStat = calculateStat;
exports.calculateStats = calculateStats;
exports.computeTypeMultiplier = computeTypeMultiplier;
exports.computeStab = computeStab;
exports.computePriorityFromTags = computePriorityFromTags;
exports.makeDamageModifiers = makeDamageModifiers;
exports.damageProfileGen5Plus = damageProfileGen5Plus;
exports.compareActionOrder = compareActionOrder;
exports.STAT_IDS = [
    'hp',
    'attack',
    'defense',
    'special_attack',
    'special_defense',
    'speed'
];
exports.DEFAULT_NATURE = { plus: 'neutral', minus: 'neutral' };
function createEmptyStatMap(defaultValue = 1) {
    return {
        hp: defaultValue,
        attack: defaultValue,
        defense: defaultValue,
        special_attack: defaultValue,
        special_defense: defaultValue,
        speed: defaultValue
    };
}
function clampInt(value, min, max) {
    if (!Number.isFinite(value))
        return min;
    return Math.max(min, Math.min(max, Math.floor(value)));
}
function natureMultiplier(statId, nature) {
    if (nature.plus === statId && nature.minus !== statId)
        return 1.1;
    if (nature.minus === statId && nature.plus !== statId)
        return 0.9;
    return 1.0;
}
function calculateStat(statId, base, level, iv, ev, nature) {
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
function calculateStats(baseStats, spread) {
    const nature = spread.nature ?? exports.DEFAULT_NATURE;
    const stats = createEmptyStatMap(1);
    for (const statId of exports.STAT_IDS) {
        const base = baseStats[statId] ?? 1;
        const iv = spread.ivs?.[statId] ?? 31;
        const ev = spread.evs?.[statId] ?? 0;
        stats[statId] = calculateStat(statId, base, spread.level, iv, ev, nature);
    }
    return stats;
}
function computeTypeMultiplier(chart, attackType, defenseTypes) {
    const byAttack = chart.get(attackType);
    if (!byAttack)
        return 1.0;
    let multiplier = 1.0;
    for (const defenseType of defenseTypes) {
        const value = byAttack.get(defenseType);
        if (value !== undefined) {
            multiplier *= value;
        }
    }
    return multiplier;
}
function computeStab(moveType, attackerTypes) {
    return attackerTypes.includes(moveType) ? 1.5 : 1.0;
}
function computePriorityFromTags(tags) {
    let best = null;
    for (const tag of tags) {
        const match = /^priority_(-?\d+)$/.exec(tag);
        if (!match)
            continue;
        const value = parseInt(match[1], 10);
        if (best === null || value > best) {
            best = value;
        }
    }
    return best ?? 0;
}
function makeDamageModifiers(overrides = {}) {
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
function baseDamageGen5Plus(level, power, attack, defense) {
    const levelTerm = Math.floor((2 * level) / 5) + 2;
    const numerator = levelTerm * power * attack;
    const raw = Math.floor(numerator / defense);
    return Math.floor(raw / 50) + 2;
}
function roundHalfDownPositive(value) {
    const floorValue = Math.floor(value);
    const fraction = value - floorValue;
    return fraction > 0.5 ? floorValue + 1 : floorValue;
}
function applyDamageModifiers(baseDamage, ordered) {
    let damage = baseDamage;
    for (const mod of ordered) {
        damage = roundHalfDownPositive(damage * mod);
    }
    return damage <= 0 ? 1 : damage;
}
function damageProfileGen5Plus(level, powerInput, attackEffRaw, defenseEffRaw, modifiers) {
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
function compareActionOrder(a, b, trickRoom = false) {
    if (a.priority > b.priority)
        return 'first';
    if (a.priority < b.priority)
        return 'second';
    if (a.speed !== b.speed) {
        if (trickRoom) {
            return a.speed < b.speed ? 'first' : 'second';
        }
        return a.speed > b.speed ? 'first' : 'second';
    }
    return a.damage >= b.damage ? 'first' : 'second';
}
