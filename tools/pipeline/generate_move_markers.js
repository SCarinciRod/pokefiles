'use strict';
const { openDb, normalizeMarkerValue, parseStoredMarkerValue } = require('./sqlite_writer');
const { seeds: TACTICAL_SEEDS, expands: TACTICAL_EXPANDS } = require('../../db/catalogs/moveTacticalCatalog');

const PUNCH_MOVE_SET = new Set([
  'bullet_punch','comet_punch','dizzy_punch','double_iron_bash','drain_punch','dynamic_punch',
  'fire_punch','focus_punch','hammer_arm','headlong_rush','ice_hammer','ice_punch','jet_punch',
  'mach_punch','mega_punch','meteor_mash','plasma_fists','power_up_punch','rage_fist',
  'shadow_punch','sky_uppercut','surging_strikes','thunder_punch','wicked_blow'
]);

const KICK_MOVE_SET = new Set([
  'blaze_kick','double_kick','high_jump_kick','low_kick','mega_kick','rolling_kick',
  'triple_kick','triple_axel','trop_kick','thunderous_kick','low_sweep'
]);

const SOUND_MOVE_SET = new Set([
  'growl','roar','sing','supersonic','screech','snore','perish_song','heal_bell','uproar',
  'hyper_voice','metal_sound','grass_whistle','howl','bug_buzz','chatter','round',
  'echoed_voice','relic_song','snarl','noble_roar','disarming_voice','parting_shot',
  'boomburst','confide','sparkling_aria','clanging_scales','clangorous_soulblaze',
  'clangorous_soul','overdrive','eerie_spell','torch_song','dragon_cheer','alluring_voice',
  'psychic_noise'
]);

const PULSE_MOVE_SET = new Set([
  'aura_sphere','dark_pulse','dragon_pulse','heal_pulse','origin_pulse','terrain_pulse','water_pulse'
]);

const BITING_MOVE_SET = new Set([
  'bite','hyper_fang','crunch','poison_fang','thunder_fang','ice_fang','fire_fang',
  'psychic_fangs','jaw_lock','fishious_rend'
]);

const SLICING_MOVE_SET = new Set([
  'cut','razor_leaf','slash','fury_cutter','metal_claw','crush_claw','air_cutter',
  'aerial_ace','dragon_claw','leaf_blade','night_slash','air_slash','x_scissor',
  'shadow_claw','psycho_cut','cross_poison','sacred_sword','razor_shell','secret_sword',
  'solar_blade','behemoth_blade','dire_claw','stone_axe','ceaseless_edge','population_bomb',
  'kowtow_cleave','psyblade','bitter_blade','aqua_cutter','mighty_cleave','tachyon_cutter'
]);

const PUNCH_MOVE_EXCLUSIONS = new Set(['sucker_punch']);

function sanitizeAtom(value) {
  const atom = String(value || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  return atom || 'unknown';
}

function normalizeSearchText(value) {
  return String(value || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

function numberToStable(value) {
  if (!Number.isFinite(value)) return null;
  const rounded = Math.round(value * 1000) / 1000;
  return Number.isInteger(rounded) ? rounded : rounded;
}

function addToMultiMap(map, key, value) {
  if (!map.has(key)) map.set(key, new Set());
  map.get(key).add(value);
}

function loadTacticalCatalog() {
  const seedRolesByMove = new Map();
  const expandRoleMap = new Map();
  for (const [move, roles] of Object.entries(TACTICAL_SEEDS)) {
    for (const role of roles) addToMultiMap(seedRolesByMove, sanitizeAtom(move), sanitizeAtom(role));
  }
  for (const [parent, children] of Object.entries(TACTICAL_EXPANDS)) {
    const p = sanitizeAtom(parent);
    for (const child of children) addToMultiMap(expandRoleMap, p, sanitizeAtom(child));
  }
  return { seedRolesByMove, expandRoleMap };
}

function expandTacticalRoles(seedRoles, expandRoleMap) {
  const expanded = new Set();
  const queue = [...seedRoles];
  while (queue.length > 0) {
    const role = queue.shift();
    if (expanded.has(role)) continue;
    expanded.add(role);
    const children = expandRoleMap.get(role);
    if (children) for (const child of children) if (!expanded.has(child)) queue.push(child);
  }
  return expanded;
}

function inferPowerBand(bp) {
  if (!Number.isFinite(bp) || bp <= 0) return 'no_direct_power';
  if (bp <= 60) return 'low_power';
  if (bp <= 90) return 'mid_power';
  if (bp <= 120) return 'high_power';
  return 'very_high_power';
}

function inferAccuracyBand(acc) {
  if (!Number.isFinite(acc) || acc <= 0) return 'no_accuracy_check';
  if (acc <= 75) return 'low_accuracy';
  if (acc <= 90) return 'mid_accuracy';
  return 'high_accuracy';
}

function inferPpBand(pp) {
  if (!Number.isFinite(pp) || pp <= 0) return 'unknown_pp';
  if (pp <= 5) return 'low_pp';
  if (pp <= 10) return 'mid_low_pp';
  if (pp <= 20) return 'mid_pp';
  return 'high_pp';
}

function moveIdHasToken(moveId, token) {
  return new RegExp(`(?:^|_)${token}(?:_|$)`).test(moveId);
}

function isPunchBasedMove(moveId, desc) {
  if (PUNCH_MOVE_EXCLUSIONS.has(moveId)) return false;
  if (PUNCH_MOVE_SET.has(moveId)) return true;
  if (moveIdHasToken(moveId, 'punch')) return true;
  return /\bpunch(?:es|ing)?\b|\bfist(?:s)?\b|\buppercut\b/.test(desc);
}

function isKickBasedMove(moveId, desc) {
  if (KICK_MOVE_SET.has(moveId)) return true;
  if (moveIdHasToken(moveId, 'kick')) return true;
  return /\bkick(?:s|ing)?\b/.test(desc);
}

function isSoundBasedMove(moveId, desc) {
  if (SOUND_MOVE_SET.has(moveId)) return true;
  return /\bsound(?:\s|-)?based\b|\bsonic\b|\bvoice\b/.test(desc);
}

function isPulseBasedMove(moveId, desc) {
  if (PULSE_MOVE_SET.has(moveId)) return true;
  return moveIdHasToken(moveId, 'pulse') || /\bpulse(?:\s|-)?based\b|\baura\b/.test(desc);
}

function isBitingMove(moveId, desc) {
  if (BITING_MOVE_SET.has(moveId)) return true;
  return /\bbit(?:e|es|ing)?\b|\bfang(?:s)?\b|\bjaw(?:s)?\b/.test(desc);
}

function isSlicingMove(moveId) {
  return SLICING_MOVE_SET.has(moveId);
}

function addMarker(markerMap, marker, value) {
  if (value === null || value === undefined || value === '') return;
  const markerKey = sanitizeAtom(marker);
  let normalizedValue = value;
  if (typeof value === 'string') normalizedValue = sanitizeAtom(value);
  else if (typeof value === 'number') normalizedValue = numberToStable(value);
  else if (typeof value !== 'boolean') normalizedValue = sanitizeAtom(String(value));
  if (normalizedValue === null || normalizedValue === undefined || normalizedValue === '') return;
  if (!markerMap.has(markerKey)) markerMap.set(markerKey, new Set());
  markerMap.get(markerKey).add(String(normalizedValue));
}

function parsePriorityFromTag(tag) {
  const match = tag.match(/^priority_(-?[0-9]+)$/);
  if (!match) return null;
  const value = Number.parseInt(match[1], 10);
  return Number.isFinite(value) ? value : null;
}

function inferTacticalRoles(entry, tacticalContext) {
  const seedRoles = tacticalContext.seedRolesByMove.get(entry.move) || new Set();
  const expandedRoles = expandTacticalRoles(seedRoles, tacticalContext.expandRoleMap);
  if (entry.category !== 'status') expandedRoles.add('damage');
  if (entry.effectCategory === 'heal' || entry.effectCategory === 'damage_heal') expandedRoles.add('recovery');
  if (['net_good_stats', 'damage_raise', 'swagger'].includes(entry.effectCategory)) expandedRoles.add('buff');
  if (['damage_lower', 'ailment', 'damage_ailment'].includes(entry.effectCategory)) expandedRoles.add('debuff');
  if (['field_effect', 'whole_field_effect', 'force_switch'].includes(entry.effectCategory)) expandedRoles.add('control');
  const hasPosPriority = entry.tags.map(parsePriorityFromTag).filter((v) => v !== null).some((v) => v > 0);
  if (hasPosPriority) { expandedRoles.add('speed_control'); expandedRoles.add('control'); }
  return expandedRoles;
}

function applyMinimumSemanticMarkers(markerMap) {
  if (!markerMap.has('class')) addMarker(markerMap, 'class', 'utility');
  if (!markerMap.has('empower')) addMarker(markerMap, 'empower', 'state');
  if (!markerMap.has('trigger')) addMarker(markerMap, 'trigger', 'on_move_use');
  if (!markerMap.has('condition')) addMarker(markerMap, 'condition', 'always_active');
}

function inferMarkers(entry, tacticalContext) {
  const markerMap = new Map();
  const description = normalizeSearchText(entry.description);
  const punch = isPunchBasedMove(entry.move, description);
  const kick = isKickBasedMove(entry.move, description);
  const sound = isSoundBasedMove(entry.move, description);
  const pulse = isPulseBasedMove(entry.move, description);
  const biting = isBitingMove(entry.move, description);
  const slicing = isSlicingMove(entry.move);

  addMarker(markerMap, 'combat_relevance', 'combat');
  addMarker(markerMap, 'type_hint', entry.type);
  addMarker(markerMap, 'category', entry.category);
  addMarker(markerMap, 'effect_category', entry.effectCategory);
  addMarker(markerMap, 'trigger', 'on_move_use');
  addMarker(markerMap, 'power_band', inferPowerBand(entry.basePower));
  addMarker(markerMap, 'accuracy_band', inferAccuracyBand(entry.accuracy));
  addMarker(markerMap, 'pp_band', inferPpBand(entry.pp));
  if (!Number.isFinite(entry.accuracy) || entry.accuracy <= 0) addMarker(markerMap, 'condition', 'no_accuracy_check');
  if (Number.isFinite(entry.effectChance)) addMarker(markerMap, 'chance_percent', entry.effectChance);

  if (punch) { addMarker(markerMap, 'condition', 'punch_moves'); addMarker(markerMap, 'move_style', 'punch'); addMarker(markerMap, 'domain', 'contact_style'); }
  if (kick) { addMarker(markerMap, 'condition', 'kick_moves'); addMarker(markerMap, 'move_style', 'kick'); addMarker(markerMap, 'domain', 'contact_style'); }
  if (sound) { addMarker(markerMap, 'condition', 'sound_moves'); addMarker(markerMap, 'move_style', 'sound'); addMarker(markerMap, 'domain', 'sound'); }
  if (pulse) { addMarker(markerMap, 'condition', 'pulse_moves'); addMarker(markerMap, 'move_style', 'pulse'); addMarker(markerMap, 'domain', 'pulse'); }
  if (biting) { addMarker(markerMap, 'condition', 'biting_moves'); addMarker(markerMap, 'condition', 'bite_moves'); addMarker(markerMap, 'move_style', 'biting'); addMarker(markerMap, 'domain', 'contact_style'); }
  if (slicing) { addMarker(markerMap, 'condition', 'slicing_moves'); addMarker(markerMap, 'condition', 'slice_moves'); addMarker(markerMap, 'move_style', 'slicing'); addMarker(markerMap, 'domain', 'contact_style'); }

  if (entry.ailment && entry.ailment !== 'none' && entry.ailment !== 'unknown') {
    addMarker(markerMap, 'status_hint', entry.ailment);
    addMarker(markerMap, 'domain', 'status');
    addMarker(markerMap, 'class', 'disruption');
    addMarker(markerMap, 'empower', 'status');
    addMarker(markerMap, 'modifier_kind', 'status_application_modifier');
  }

  if (entry.category === 'physical' || entry.category === 'special') {
    addMarker(markerMap, 'class', 'offense');
    addMarker(markerMap, 'empower', 'move');
    addMarker(markerMap, 'modifier_kind', 'move_power_modifier');
  }
  if (entry.category === 'status') addMarker(markerMap, 'class', 'utility');

  switch (entry.effectCategory) {
    case 'heal': case 'damage_heal':
      addMarker(markerMap, 'class', 'sustain'); addMarker(markerMap, 'domain', 'recovery'); addMarker(markerMap, 'empower', 'state'); addMarker(markerMap, 'modifier_kind', 'hp_recovery_modifier'); break;
    case 'damage_raise': case 'net_good_stats': case 'swagger':
      addMarker(markerMap, 'class', 'empower'); addMarker(markerMap, 'domain', 'stat_stage'); addMarker(markerMap, 'empower', 'stat'); addMarker(markerMap, 'modifier_kind', 'stat_stage_modifier'); break;
    case 'damage_lower':
      addMarker(markerMap, 'class', 'disruption'); addMarker(markerMap, 'domain', 'stat_stage'); addMarker(markerMap, 'empower', 'stat'); addMarker(markerMap, 'modifier_kind', 'stat_stage_modifier'); break;
    case 'damage_ailment': case 'ailment':
      addMarker(markerMap, 'class', 'disruption'); addMarker(markerMap, 'domain', 'status'); addMarker(markerMap, 'empower', 'status'); addMarker(markerMap, 'modifier_kind', 'status_application_modifier'); break;
    case 'field_effect': case 'whole_field_effect':
      addMarker(markerMap, 'class', 'control'); addMarker(markerMap, 'domain', 'field_control'); addMarker(markerMap, 'empower', 'state'); addMarker(markerMap, 'modifier_kind', 'field_state_modifier'); break;
    case 'force_switch':
      addMarker(markerMap, 'class', 'control'); addMarker(markerMap, 'domain', 'switching'); addMarker(markerMap, 'empower', 'state'); addMarker(markerMap, 'modifier_kind', 'forced_switch_modifier'); break;
    case 'ohko':
      addMarker(markerMap, 'class', 'offense'); addMarker(markerMap, 'condition', 'one_hit_ko'); addMarker(markerMap, 'modifier_kind', 'move_power_modifier'); break;
    default: break;
  }

  for (const tag of entry.tags) {
    const priorityValue = parsePriorityFromTag(tag);
    if (priorityValue !== null) {
      addMarker(markerMap, 'priority', priorityValue);
      addMarker(markerMap, 'domain', 'priority');
      addMarker(markerMap, 'modifier_kind', 'turn_order_modifier');
      if (priorityValue > 0) addMarker(markerMap, 'condition', 'priority_positive');
      else if (priorityValue < 0) addMarker(markerMap, 'condition', 'delayed_action');
      continue;
    }
    if (tag === 'high_crit') { addMarker(markerMap, 'condition', 'critical_hit'); continue; }
    if (tag === 'flinch_chance') { addMarker(markerMap, 'condition', 'flinch_chance'); addMarker(markerMap, 'domain', 'status'); addMarker(markerMap, 'status_hint', 'flinch'); continue; }
    const ailmentTag = tag.match(/^ailment_(.+)$/);
    if (ailmentTag) { addMarker(markerMap, 'status_hint', ailmentTag[1]); addMarker(markerMap, 'domain', 'status'); }
  }

  if (/never misses|nunca erra/.test(description)) addMarker(markerMap, 'condition', 'guaranteed_hit');
  if (/\bweather\b|\brain\b|\bsunlight\b|\bsun\b|\bsandstorm\b|\bhail\b|\bsnow\b/.test(description)) addMarker(markerMap, 'domain', 'weather');
  if (/\brain\b/.test(description)) addMarker(markerMap, 'condition', 'weather_rain');
  if (/sunlight|\bsun\b/.test(description)) addMarker(markerMap, 'condition', 'weather_sun');
  if (/\bsandstorm\b/.test(description)) addMarker(markerMap, 'condition', 'weather_sand');
  if (/\bhail\b|\bsnow\b/.test(description)) addMarker(markerMap, 'condition', 'weather_snow');
  if (/terrain|electric terrain|grassy terrain|misty terrain|psychic terrain/.test(description)) addMarker(markerMap, 'domain', 'terrain');
  if (/trick room/.test(description)) { addMarker(markerMap, 'domain', 'speed_control'); addMarker(markerMap, 'condition', 'trick_room'); }
  if (/switch|switches out|leave battle|flee/.test(description)) addMarker(markerMap, 'domain', 'switching');
  if (/trap|cannot flee|cannot switch/.test(description) || entry.ailment === 'trap') addMarker(markerMap, 'domain', 'trap');
  if (/contact|makes contact/.test(description)) addMarker(markerMap, 'condition', 'contact');
  if (/critical hit/.test(description)) addMarker(markerMap, 'condition', 'critical_hit');

  const tacticalRoles = inferTacticalRoles(entry, tacticalContext);
  for (const role of tacticalRoles) {
    addMarker(markerMap, 'tactical_role', role);
    if (['control','speed_control','trick_room','pivot','redirection','protection','hazard','hazard_clear','terrain_control','weather_control','screen_control','fake_out'].includes(role)) addMarker(markerMap, 'class', 'control');
    if (role === 'recovery') addMarker(markerMap, 'class', 'sustain');
    if (['buff','setup_buff','ally_boost'].includes(role)) addMarker(markerMap, 'class', 'empower');
    if (['debuff','disruption','status_spread'].includes(role)) addMarker(markerMap, 'class', 'disruption');
  }

  applyMinimumSemanticMarkers(markerMap);
  return markerMap;
}

function main() {
  const db = openDb();

  const moveRows = db.prepare(
    'SELECT id, type_id, category, base_power, accuracy, pp, effect_chance, ailment, effect_category, description FROM moves ORDER BY id'
  ).all();

  if (moveRows.length === 0) throw new Error('Nenhum move encontrado no SQLite — execute generate_moves_db.js primeiro.');

  const tagsByMove = new Map();
  for (const { move_id, tag } of db.prepare('SELECT move_id, tag FROM move_tags ORDER BY move_id, tag').all()) {
    if (!tagsByMove.has(move_id)) tagsByMove.set(move_id, []);
    tagsByMove.get(move_id).push(tag);
  }

  const entries = moveRows.map((row) => ({
    move: row.id,
    type: row.type_id,
    category: row.category,
    basePower: row.base_power,
    accuracy: row.accuracy,
    pp: row.pp,
    tags: tagsByMove.get(row.id) || [],
    effectChance: row.effect_chance,
    ailment: row.ailment || 'none',
    effectCategory: row.effect_category || 'unknown',
    description: row.description,
  }));

  const tacticalContext = loadTacticalCatalog();

  const stmtMarker = db.prepare(
    'INSERT OR REPLACE INTO move_markers (move_id, marker, value_type, value_text, value_number, value_bool) VALUES (@move_id, @marker, @value_type, @value_text, @value_number, @value_bool)'
  );

  let totalMarkerRows = 0;
  db.transaction(() => {
    db.prepare('DELETE FROM move_markers').run();
    for (const entry of entries) {
      const markerMap = inferMarkers(entry, tacticalContext);
      for (const [marker, valuesSet] of markerMap.entries()) {
        for (const rawStr of valuesSet) {
          const norm = normalizeMarkerValue(parseStoredMarkerValue(rawStr));
          stmtMarker.run({ move_id: entry.move, marker, ...norm });
          totalMarkerRows++;
        }
      }
    }
  })();

  db.close();
  console.log(`[move-markers] moves processados: ${entries.length}`);
  console.log(`[move-markers] linhas de marcadores gravadas: ${totalMarkerRows}`);
}

try {
  main();
} catch (err) {
  console.error(`[move-markers] erro: ${err.message}`);
  process.exitCode = 1;
}
