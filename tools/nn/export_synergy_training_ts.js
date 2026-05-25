'use strict';
// Generates JSONL training files for the strategy model — V2 (94D features).
// Reads data directly from the SQLite database built by the generate_*.js pipeline.
//
// Feature vector per pair (A, B): 94D
//   types_A(18) + types_B(18) + stats_A(6) + stats_B(6)
//   + role_A(7 one-hot) + role_B(7) + ability_archetypes_A(8) + ability_archetypes_B(8)
//   + move_archetypes_A(8) + move_archetypes_B(8)
//
// Labels: multi-component score that mirrors the bridge.ts heuristic logic
//   (type coverage + weather synergy + role synergy + support synergy + stat synergy - penalties)
//
// Outputs (to .local_cache/nn_export/training/):
//   doubles_synergy_training.jsonl
//   counter_training.jsonl
//   held_item_training.jsonl
//   role_training.jsonl
//
// Run: node tools/nn/export_synergy_training_ts.js [--max-per-target=20]

const fs = require('fs');
const path = require('path');
const { openDb } = require('../pipeline/sqlite_writer');

// ---------------------------------------------------------------------------
// CLI args
// ---------------------------------------------------------------------------
const args = Object.fromEntries(
  process.argv.slice(2)
    .filter((a) => a.startsWith('--'))
    .map((a) => { const [k, v] = a.slice(2).split('='); return [k, v ?? 'true']; })
);

const MAX_PER_TARGET = parseInt(args['max-per-target'] ?? '20', 10);
const OUTPUT_DIR = path.resolve(
  args['output-dir'] ?? path.join(__dirname, '../../.local_cache/nn_export/training')
);

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const ALL_TYPES = [
  'normal','fire','water','electric','grass','ice',
  'fighting','poison','ground','flying','psychic','bug',
  'rock','ghost','dragon','dark','steel','fairy',
];

// Mirrors ROLE_THRESHOLDS from bridge.ts
const ROLE_THRESHOLDS = [
  { role: 'physical_sweeper',  test: (s) => s.attack >= 100 && s.speed >= 85 && (s.special_attack ?? 50) < 90 },
  { role: 'special_sweeper',   test: (s) => s.special_attack >= 100 && s.speed >= 85 && (s.attack ?? 50) < 90 },
  { role: 'physical_wall',     test: (s) => s.defense >= 100 && s.hp >= 90 },
  { role: 'special_wall',      test: (s) => s.special_defense >= 100 && s.hp >= 90 },
  { role: 'tank',              test: (s) => s.hp >= 100 && s.defense >= 80 && s.special_defense >= 80 },
  { role: 'lead',              test: (s) => s.speed >= 110 },
  { role: 'support_utility',   test: () => true },
];

const ALL_ROLES = ROLE_THRESHOLDS.map((r) => r.role);

// Ability archetype flags (8 per pokemon) — mirrors WEATHER_SETTERS/BENEFICIARIES in bridge.ts
const ABILITY_ARCHETYPES = [
  new Set(['drought','drizzle','sand_stream','snow_warning']),                                          // 0: weather_setter
  new Set(['swift_swim','chlorophyll','solar_power','slush_rush','sand_rush','harvest','flower_gift',   // 1: weather_beneficiary
           'rain_dish','hydration','dry_skin','ice_body','sand_force']),
  new Set(['intimidate']),                                                                              // 2: intimidate
  new Set(['electric_surge','psychic_surge','grassy_surge','misty_surge']),                            // 3: terrain_setter
  new Set(['surge_surfer','grass_pelt','analytic']),                                                   // 4: terrain_beneficiary
  new Set(['prankster']),                                                                               // 5: prankster
  new Set(['speed_boost']),                                                                             // 6: speed_boost
  new Set(['regenerator','multiscale','magic_guard','sturdy','thick_fat','filter','solid_rock']),       // 7: defensive_passive
];

// Move archetype flags (8 per pokemon) — mirrors moveset checks in bridge.ts handleSynergySuggestions
const MOVE_ARCHETYPES = [
  new Set(['fake_out']),                                                                                // 0: has_fake_out
  new Set(['trick_room']),                                                                              // 1: has_trick_room
  new Set(['tailwind']),                                                                                // 2: has_tailwind
  new Set(['follow_me','rage_powder']),                                                                 // 3: has_redirect
  new Set(['helping_hand']),                                                                            // 4: has_helping_hand
  new Set(['earthquake']),                                                                              // 5: has_earthquake
  new Set(['protect','wide_guard','quick_guard','detect','baneful_bunker','spiky_shield']),             // 6: has_protect
  new Set(['dragon_dance','nasty_plot','calm_mind','swords_dance','quiver_dance','shift_gear',          // 7: has_setup
           'shell_smash','bulk_up','coil']),
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function ensureDir(dir) { fs.mkdirSync(dir, { recursive: true }); }

function writeJsonl(outPath, records) {
  const lines = records.map((r) => JSON.stringify(r));
  fs.writeFileSync(outPath, lines.join('\n') + (lines.length ? '\n' : ''), 'utf8');
  console.log(`  → ${path.basename(outPath)}: ${lines.length} linhas`);
}

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function classifyRole(stats) {
  for (const { role, test } of ROLE_THRESHOLDS) {
    if (test(stats)) return role;
  }
  return 'support_utility';
}

// ---------------------------------------------------------------------------
// Type chart utilities
// ---------------------------------------------------------------------------
function buildTypeChart(rows) {
  const chart = {};
  for (const { attack_type, defense_type, multiplier } of rows) {
    if (!chart[attack_type]) chart[attack_type] = {};
    chart[attack_type][defense_type] = multiplier;
  }
  return chart;
}

// Effectiveness of atkType against a pokemon with defTypes (handles dual-type)
function effectiveness(chart, atkType, defTypes) {
  const row = chart[atkType] || {};
  return defTypes.reduce((mul, defType) => mul * (row[defType] ?? 1.0), 1.0);
}

// ---------------------------------------------------------------------------
// Load all required data from SQLite
// ---------------------------------------------------------------------------
function loadData(db) {
  const pokemonRows = db.prepare(
    `SELECT p.id, p.identifier, p.source_generation,
            GROUP_CONCAT(pt.type_id ORDER BY pt.slot) AS types
     FROM pokemon p
     LEFT JOIN pokemon_types pt ON p.id = pt.pokemon_id
     GROUP BY p.id`
  ).all();

  const statsRows = db.prepare(
    `SELECT ps.pokemon_id,
            MAX(CASE WHEN ps.stat_id='hp'               THEN ps.value END) AS hp,
            MAX(CASE WHEN ps.stat_id='attack'           THEN ps.value END) AS attack,
            MAX(CASE WHEN ps.stat_id='defense'          THEN ps.value END) AS defense,
            MAX(CASE WHEN ps.stat_id='special_attack'   THEN ps.value END) AS special_attack,
            MAX(CASE WHEN ps.stat_id='special_defense'  THEN ps.value END) AS special_defense,
            MAX(CASE WHEN ps.stat_id='speed'            THEN ps.value END) AS speed
     FROM pokemon_stats ps
     GROUP BY ps.pokemon_id`
  ).all();

  const typeChartRows = db.prepare('SELECT attack_type, defense_type, multiplier FROM type_chart').all();

  const abilityRows = db.prepare(
    `SELECT pokemon_id, ability_id FROM pokemon_abilities`
  ).all();

  const moveRows = db.prepare(
    `SELECT pokemon_id, move_id FROM pokemon_moves WHERE pokemon_id IS NOT NULL`
  ).all();

  const heldItemRows = db.prepare(
    `SELECT item_id, category, trigger, model_json, description, confidence
     FROM held_item_effects
     WHERE JSON_EXTRACT(model_json, '$[0]') IS NOT NULL`
  ).all().filter((r) => {
    try {
      const model = JSON.parse(r.model_json);
      return model.some((t) => t.startsWith('combat_relevance-combat'));
    } catch { return false; }
  });

  return { pokemonRows, statsRows, typeChartRows, abilityRows, moveRows, heldItemRows };
}

// ---------------------------------------------------------------------------
// Build per-pokemon archetype maps
// ---------------------------------------------------------------------------
function buildArchetypeMaps(abilityRows, moveRows) {
  const abilityMap = new Map();
  for (const { pokemon_id, ability_id } of abilityRows) {
    if (!abilityMap.has(pokemon_id)) abilityMap.set(pokemon_id, new Array(8).fill(0));
    const flags = abilityMap.get(pokemon_id);
    for (let i = 0; i < ABILITY_ARCHETYPES.length; i++) {
      if (ABILITY_ARCHETYPES[i].has(ability_id)) flags[i] = 1;
    }
  }

  const moveMap = new Map();
  for (const { pokemon_id, move_id } of moveRows) {
    if (!moveMap.has(pokemon_id)) moveMap.set(pokemon_id, new Array(8).fill(0));
    const flags = moveMap.get(pokemon_id);
    for (let i = 0; i < MOVE_ARCHETYPES.length; i++) {
      if (MOVE_ARCHETYPES[i].has(move_id)) flags[i] = 1;
    }
  }

  return { abilityMap, moveMap };
}

// ---------------------------------------------------------------------------
// Multi-component synergy label
// Mirrors the scoring logic of handleSynergySuggestions in bridge.ts
// ---------------------------------------------------------------------------
function computeSynergyLabel(a, b, typeChart) {
  const typesA = a.types;
  const typesB = b.types;
  const sa = a.stats;
  const sb = b.stats;
  const abA = a.abilities;
  const abB = b.abilities;
  const mvA = a.moves;
  const mvB = b.moves;
  const roleA = a.role;
  const roleB = b.role;

  // 1. Type coverage — fraction of 18 types that combined STAB covers at >=1.0x
  const covered = new Set();
  for (const atk of typesA) for (const def of ALL_TYPES) {
    if ((typeChart[atk]?.[def] ?? 1.0) >= 1.0) covered.add(def);
  }
  for (const atk of typesB) for (const def of ALL_TYPES) {
    if ((typeChart[atk]?.[def] ?? 1.0) >= 1.0) covered.add(def);
  }
  const typeCoverage = covered.size / ALL_TYPES.length;

  // 2. Weather synergy — setter + beneficiary pairing
  const aIsSetter = abA[0] === 1;
  const bIsSetter = abB[0] === 1;
  const aIsBeneficiary = abA[1] === 1;
  const bIsBeneficiary = abB[1] === 1;
  const weatherSynergy = ((aIsSetter && bIsBeneficiary) || (bIsSetter && aIsBeneficiary)) ? 1.0 : 0.0;

  // 3. Role synergy — sweeper + support/wall pairing
  const sweepers = new Set(['physical_sweeper', 'special_sweeper']);
  const walls = new Set(['physical_wall', 'special_wall', 'tank']);
  const supports = new Set(['support_utility', 'lead']);
  let roleSynergy = 0.0;
  if ((sweepers.has(roleA) && (supports.has(roleB) || walls.has(roleB))) ||
      (sweepers.has(roleB) && (supports.has(roleA) || walls.has(roleA)))) {
    roleSynergy = 1.0;
  } else if (sweepers.has(roleA) && sweepers.has(roleB) && typeCoverage >= 0.6) {
    roleSynergy = 0.4;
  }

  // 4. Support synergy — mirrors explicit bonuses in handleSynergySuggestions
  const speedA = sa ? sa.speed : 70;
  const speedB = sb ? sb.speed : 70;
  const mainOffA = sa ? Math.max(sa.attack, sa.special_attack) : 70;
  const mainOffB = sb ? Math.max(sb.attack, sb.special_attack) : 70;
  const hpA = sa ? sa.hp : 70;
  const hpB = sb ? sb.hp : 70;
  const needsTR_A = speedA <= 50;
  const needsTR_B = speedB <= 50;
  const inDeadZone_A = speedA > 50 && speedA <= 90;
  const inDeadZone_B = speedB > 50 && speedB <= 90;

  let supportScore = 0.0;
  // fake_out (mvA[0]) + strong attacker
  if (mvA[0] === 1 && mainOffB >= 110) supportScore += 0.8;
  if (mvB[0] === 1 && mainOffA >= 110) supportScore += 0.8;
  // trick_room setter (mvA[1]) + slow attacker
  if (mvA[1] === 1 && needsTR_B) supportScore += 0.8;
  if (mvB[1] === 1 && needsTR_A) supportScore += 0.8;
  // tailwind (mvA[2]) + dead-zone speed pokemon
  if (mvA[2] === 1 && inDeadZone_B) supportScore += 0.7;
  if (mvB[2] === 1 && inDeadZone_A) supportScore += 0.7;
  // redirect (mvA[3]) + frail strong attacker
  if (mvA[3] === 1 && mainOffB >= 110 && hpB < 80) supportScore += 0.9;
  if (mvB[3] === 1 && mainOffA >= 110 && hpA < 80) supportScore += 0.9;
  // helping_hand (mvA[4]) + high-offense attacker
  if (mvA[4] === 1 && mainOffB >= 110) supportScore += 0.5;
  if (mvB[4] === 1 && mainOffA >= 110) supportScore += 0.5;
  // earthquake (mvA[5]) + flying-type partner (safe from EQ)
  if (mvA[5] === 1 && typesB.includes('flying')) supportScore += 0.6;
  if (mvB[5] === 1 && typesA.includes('flying')) supportScore += 0.6;
  // intimidate (abA[2]) + physical attacker
  if (abA[2] === 1 && mainOffB >= 110 && (sb ? sb.attack : 70) >= 100) supportScore += 0.5;
  if (abB[2] === 1 && mainOffA >= 110 && (sa ? sa.attack : 70) >= 100) supportScore += 0.5;
  // prankster (abA[5]) + TR partner
  if (abA[5] === 1 && needsTR_B) supportScore += 0.4;
  if (abB[5] === 1 && needsTR_A) supportScore += 0.4;
  supportScore = Math.min(1.0, supportScore);

  // 5. Stat synergy — average BST normalized to 600
  const bstA = sa ? (sa.hp + sa.attack + sa.defense + sa.special_attack + sa.special_defense + sa.speed) : 300;
  const bstB = sb ? (sb.hp + sb.attack + sb.defense + sb.special_attack + sb.special_defense + sb.speed) : 300;
  const statSynergy = Math.min(1.0, (bstA + bstB) / 2 / 600);

  // 6. Shared weakness penalty
  let sharedWeaknesses = 0;
  for (const atkType of ALL_TYPES) {
    if (effectiveness(typeChart, atkType, typesA) > 1.0 &&
        effectiveness(typeChart, atkType, typesB) > 1.0) {
      sharedWeaknesses++;
    }
  }
  const weaknessPenalty = Math.min(1.0, sharedWeaknesses * 0.5);

  // Low BST penalty
  const lowBstPenalty = (bstA < 430 || bstB < 430) ? 1.0 : 0.0;

  const score = Math.max(0.0, Math.min(1.0,
    typeCoverage   * 0.35 +
    weatherSynergy * 0.15 +
    roleSynergy    * 0.15 +
    supportScore   * 0.20 +
    statSynergy    * 0.10 -
    weaknessPenalty * 0.04 -
    lowBstPenalty   * 0.01
  ));

  return Math.round(score * 1000) / 1000;
}

// ---------------------------------------------------------------------------
// doubles_synergy_training.jsonl — V2 with 94D features
// ---------------------------------------------------------------------------
function exportDoublesSynergy(pokemon, typeChart) {
  console.log('[doubles_synergy_v2] exportando...');
  const records = [];

  const byGen = {};
  for (const p of pokemon) {
    const gen = p.source_generation ?? 0;
    if (!byGen[gen]) byGen[gen] = [];
    byGen[gen].push(p);
  }

  for (const [, pool] of Object.entries(byGen)) {
    const shuffled = shuffle([...pool]);
    for (let i = 0; i < shuffled.length; i++) {
      const a = shuffled[i];
      if (a.types.length === 0 || !a.stats) continue;

      let count = 0;
      for (let j = 0; j < shuffled.length && count < MAX_PER_TARGET; j++) {
        if (i === j) continue;
        const b = shuffled[j];
        if (b.types.length === 0 || !b.stats) continue;

        const score = computeSynergyLabel(a, b, typeChart);

        records.push({
          input: {
            types_a: a.types,
            types_b: b.types,
            stats_a: [a.stats.hp, a.stats.attack, a.stats.defense,
                      a.stats.special_attack, a.stats.special_defense, a.stats.speed],
            stats_b: [b.stats.hp, b.stats.attack, b.stats.defense,
                      b.stats.special_attack, b.stats.special_defense, b.stats.speed],
            role_a: a.role,
            role_b: b.role,
            abilities_a: a.abilities,
            abilities_b: b.abilities,
            moves_a: a.moves,
            moves_b: b.moves,
          },
          output: { score },
          source_rule: 'doubles_synergy_v2',
        });
        count++;
      }
    }
  }

  return records;
}

// ---------------------------------------------------------------------------
// counter_training.jsonl — keeps existing type-pressure formula
// ---------------------------------------------------------------------------
function exportCounterPairs(pokemon, typeChart) {
  console.log('[counter_v2] exportando...');
  const records = [];

  const shuffled = shuffle([...pokemon]);
  for (let i = 0; i < shuffled.length; i++) {
    const target = shuffled[i];
    if (target.types.length === 0) continue;

    let count = 0;
    for (let j = 0; j < shuffled.length && count < MAX_PER_TARGET; j++) {
      if (i === j) continue;
      const candidate = shuffled[j];
      if (candidate.types.length === 0) continue;

      const attackPressure = Math.max(
        ...candidate.types.map((atk) => effectiveness(typeChart, atk, target.types))
      );
      const targetAttack = Math.max(
        ...target.types.map((atk) => effectiveness(typeChart, atk, candidate.types))
      );
      const defensePressure = Math.max(0, 1.0 - targetAttack / 4.0);
      const score = Math.min(1.0, attackPressure * 0.6 / 4.0 + defensePressure * 0.4);

      records.push({
        input: { target_types: target.types, candidate_types: candidate.types },
        output: {
          attack_pressure: Math.round(attackPressure * 1000) / 1000,
          defense_pressure: Math.round(defensePressure * 1000) / 1000,
          score: Math.round(score * 1000) / 1000,
        },
        source_rule: 'counter_ts',
      });
      count++;
    }
  }

  return records;
}

// ---------------------------------------------------------------------------
// held_item_training.jsonl — unchanged
// ---------------------------------------------------------------------------
function exportHeldItems(pokemon, heldItemRows) {
  console.log('[held_item] exportando...');
  const records = [];

  const pokemonByTypes = new Map();
  for (const p of pokemon) {
    if (p.types.length === 0) continue;
    const key = [...p.types].sort().join(',');
    if (!pokemonByTypes.has(key)) pokemonByTypes.set(key, p.types);
  }

  const typeGroups = [...pokemonByTypes.values()];
  for (const item of heldItemRows) {
    const confidence = item.confidence ?? 0.8;
    let count = 0;
    const shuffled = shuffle([...typeGroups]);
    for (const types of shuffled) {
      if (count >= MAX_PER_TARGET) break;
      records.push({
        input: { item_id: item.item_id, types },
        output: { score: Math.round(confidence * 1000) / 1000 },
        source_rule: 'held_item_ts',
      });
      count++;
    }
  }

  return records;
}

// ---------------------------------------------------------------------------
// role_training.jsonl — V2 with ability/move archetypes in input
// ---------------------------------------------------------------------------
function exportRoles(pokemon) {
  console.log('[role_v2] exportando...');
  const records = [];

  for (const p of pokemon) {
    if (!p.stats || p.types.length === 0) continue;
    const roleIdx = ALL_ROLES.indexOf(p.role);
    const normalizedRole = roleIdx >= 0 ? roleIdx / (ALL_ROLES.length - 1) : 1.0;

    records.push({
      input: {
        types: p.types,
        base_stats: {
          hp: p.stats.hp, attack: p.stats.attack, defense: p.stats.defense,
          special_attack: p.stats.special_attack, special_defense: p.stats.special_defense,
          speed: p.stats.speed,
        },
        abilities: p.abilities,
        moves: p.moves,
      },
      output: { role: p.role, score: Math.round(normalizedRole * 1000) / 1000 },
      source_rule: 'role_v2',
    });
  }

  return records;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
function main() {
  ensureDir(OUTPUT_DIR);

  const db = openDb();
  const { pokemonRows, statsRows, typeChartRows, abilityRows, moveRows, heldItemRows } = loadData(db);
  db.close();

  if (pokemonRows.length === 0) {
    console.error('[export] Nenhum Pokémon no banco — rode o pipeline generate_*.js primeiro.');
    process.exitCode = 1;
    return;
  }
  if (typeChartRows.length === 0) {
    console.error('[export] type_chart está vazia — rode generate_type_chart.js primeiro.');
    process.exitCode = 1;
    return;
  }

  console.log(`[export] Pokémon carregados: ${pokemonRows.length}`);
  console.log(`[export] Entradas na type_chart: ${typeChartRows.length}`);
  console.log(`[export] Registros de abilities: ${abilityRows.length}`);
  console.log(`[export] Registros de moves: ${moveRows.length}`);

  const typeChart = buildTypeChart(typeChartRows);
  const statsMap = new Map(statsRows.map((s) => [s.pokemon_id, s]));
  const { abilityMap, moveMap } = buildArchetypeMaps(abilityRows, moveRows);

  // Enrich pokemon with computed fields
  const pokemon = pokemonRows.map((p) => {
    const stats = statsMap.get(p.id) ?? null;
    const types = p.types ? p.types.split(',') : [];
    const role = stats ? classifyRole(stats) : 'support_utility';
    const abilities = abilityMap.get(p.id) ?? new Array(8).fill(0);
    const moves = moveMap.get(p.id) ?? new Array(8).fill(0);
    return { ...p, types, stats, role, abilities, moves };
  });

  const synergyRecords = exportDoublesSynergy(pokemon, typeChart);
  writeJsonl(path.join(OUTPUT_DIR, 'doubles_synergy_training.jsonl'), synergyRecords);

  const counterRecords = exportCounterPairs(pokemon, typeChart);
  writeJsonl(path.join(OUTPUT_DIR, 'counter_training.jsonl'), counterRecords);

  const heldItemRecords = exportHeldItems(pokemon, heldItemRows);
  writeJsonl(path.join(OUTPUT_DIR, 'held_item_training.jsonl'), heldItemRecords);

  const roleRecords = exportRoles(pokemon);
  writeJsonl(path.join(OUTPUT_DIR, 'role_training.jsonl'), roleRecords);

  const total = synergyRecords.length + counterRecords.length + heldItemRecords.length + roleRecords.length;
  console.log(`[export] total de registros de treinamento: ${total}`);
}

try {
  main();
} catch (err) {
  console.error(`[export] erro: ${err.message}`);
  process.exitCode = 1;
}
