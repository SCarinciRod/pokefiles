const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const INPUT_PATH = path.join(ROOT, 'db', 'catalogs', 'moves_catalog.pl');
const TACTICAL_CATALOG_PATH = path.join(ROOT, 'db', 'catalogs', 'move_tactical_catalog.pl');
const OUTPUT_PATH = path.join(ROOT, 'db', 'generated', 'move_markers.pl');

const PUNCH_MOVE_SET = new Set([
  'bullet_punch',
  'comet_punch',
  'dizzy_punch',
  'double_iron_bash',
  'drain_punch',
  'dynamic_punch',
  'fire_punch',
  'focus_punch',
  'hammer_arm',
  'headlong_rush',
  'ice_hammer',
  'ice_punch',
  'jet_punch',
  'mach_punch',
  'mega_punch',
  'meteor_mash',
  'plasma_fists',
  'power_up_punch',
  'rage_fist',
  'shadow_punch',
  'sky_uppercut',
  'surging_strikes',
  'thunder_punch',
  'wicked_blow'
]);

const KICK_MOVE_SET = new Set([
  'blaze_kick',
  'double_kick',
  'high_jump_kick',
  'low_kick',
  'mega_kick',
  'rolling_kick',
  'triple_kick',
  'triple_axel',
  'trop_kick',
  'thunderous_kick',
  'low_sweep'
]);

const SOUND_MOVE_SET = new Set([
  'growl',
  'roar',
  'sing',
  'supersonic',
  'screech',
  'snore',
  'perish_song',
  'heal_bell',
  'uproar',
  'hyper_voice',
  'metal_sound',
  'grass_whistle',
  'howl',
  'bug_buzz',
  'chatter',
  'round',
  'echoed_voice',
  'relic_song',
  'snarl',
  'noble_roar',
  'disarming_voice',
  'parting_shot',
  'boomburst',
  'confide',
  'sparkling_aria',
  'clanging_scales',
  'clangorous_soulblaze',
  'clangorous_soul',
  'overdrive',
  'eerie_spell',
  'torch_song',
  'dragon_cheer',
  'alluring_voice',
  'psychic_noise'
]);

const PULSE_MOVE_SET = new Set([
  'aura_sphere',
  'dark_pulse',
  'dragon_pulse',
  'heal_pulse',
  'origin_pulse',
  'terrain_pulse',
  'water_pulse'
]);

const BITING_MOVE_SET = new Set([
  'bite',
  'hyper_fang',
  'crunch',
  'poison_fang',
  'thunder_fang',
  'ice_fang',
  'fire_fang',
  'psychic_fangs',
  'jaw_lock',
  'fishious_rend'
]);

const SLICING_MOVE_SET = new Set([
  'cut',
  'razor_leaf',
  'slash',
  'fury_cutter',
  'metal_claw',
  'crush_claw',
  'air_cutter',
  'aerial_ace',
  'dragon_claw',
  'leaf_blade',
  'night_slash',
  'air_slash',
  'x_scissor',
  'shadow_claw',
  'psycho_cut',
  'cross_poison',
  'sacred_sword',
  'razor_shell',
  'secret_sword',
  'solar_blade',
  'behemoth_blade',
  'dire_claw',
  'stone_axe',
  'ceaseless_edge',
  'population_bomb',
  'kowtow_cleave',
  'psyblade',
  'bitter_blade',
  'aqua_cutter',
  'mighty_cleave',
  'tachyon_cutter'
]);

const PUNCH_MOVE_EXCLUSIONS = new Set([
  'sucker_punch'
]);

function sanitizeAtom(value) {
  const atom = String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');

  if (!atom) {
    return 'unknown';
  }

  return atom;
}

function normalizeSearchText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function numberToStable(value) {
  if (!Number.isFinite(value)) {
    return null;
  }

  const rounded = Math.round(value * 1000) / 1000;
  if (Number.isInteger(rounded)) {
    return rounded;
  }
  return rounded;
}

function parsePrologQuoted(text, startIndex) {
  if (text[startIndex] !== "'") {
    throw new Error(`Expected quoted string at index ${startIndex}`);
  }

  let index = startIndex + 1;
  let out = '';

  while (index < text.length) {
    const ch = text[index];
    if (ch === "'") {
      if (text[index + 1] === "'") {
        out += "'";
        index += 2;
        continue;
      }

      return { value: out, nextIndex: index + 1 };
    }

    out += ch;
    index += 1;
  }

  throw new Error('Unterminated quoted string while parsing move_entry line.');
}

function skipWhitespace(text, startIndex) {
  let idx = startIndex;
  while (idx < text.length && /\s/.test(text[idx])) {
    idx += 1;
  }
  return idx;
}

function parseUntilComma(text, startIndex) {
  let idx = startIndex;
  while (idx < text.length && text[idx] !== ',') {
    idx += 1;
  }

  if (idx >= text.length) {
    throw new Error('Expected comma while parsing move_entry line.');
  }

  return {
    value: text.slice(startIndex, idx).trim(),
    nextIndex: idx + 1
  };
}

function parseBracketBlock(text, startIndex) {
  if (text[startIndex] !== '[') {
    throw new Error(`Expected list block at index ${startIndex}`);
  }

  let idx = startIndex + 1;
  let depth = 1;

  while (idx < text.length && depth > 0) {
    const ch = text[idx];
    if (ch === '[') {
      depth += 1;
      idx += 1;
      continue;
    }

    if (ch === ']') {
      depth -= 1;
      if (depth === 0) {
        return {
          value: text.slice(startIndex + 1, idx),
          nextIndex: idx + 1
        };
      }
      idx += 1;
      continue;
    }

    if (ch === "'") {
      const parsed = parsePrologQuoted(text, idx);
      idx = parsed.nextIndex;
      continue;
    }

    idx += 1;
  }

  throw new Error('Unterminated list block while parsing move_entry line.');
}

function parseTagList(rawTagBlock) {
  return rawTagBlock
    .split(',')
    .map((token) => sanitizeAtom(token.trim()))
    .filter((token) => token && token !== 'none');
}

function parseIntSafe(value, fallback = 0) {
  const parsed = Number.parseInt(String(value || '').trim(), 10);
  if (Number.isFinite(parsed)) {
    return parsed;
  }
  return fallback;
}

function parseEffectChance(value) {
  const raw = sanitizeAtom(value);
  if (raw === 'null' || raw === 'none' || raw === 'unknown') {
    return null;
  }

  const parsed = Number.parseInt(raw, 10);
  if (Number.isFinite(parsed)) {
    return parsed;
  }

  return null;
}

function parseMoveEntryLine(line) {
  const trimmed = line.trim();
  if (!trimmed.startsWith('move_entry(') || !trimmed.endsWith(').')) {
    return null;
  }

  const body = trimmed.slice('move_entry('.length, -2);

  let idx = 0;
  const moveToken = parseUntilComma(body, idx);
  const move = sanitizeAtom(moveToken.value);

  idx = skipWhitespace(body, moveToken.nextIndex);
  const typeToken = parseUntilComma(body, idx);
  const type = sanitizeAtom(typeToken.value);

  idx = skipWhitespace(body, typeToken.nextIndex);
  const categoryToken = parseUntilComma(body, idx);
  const category = sanitizeAtom(categoryToken.value);

  idx = skipWhitespace(body, categoryToken.nextIndex);
  const powerToken = parseUntilComma(body, idx);
  const basePower = parseIntSafe(powerToken.value, 0);

  idx = skipWhitespace(body, powerToken.nextIndex);
  const accuracyToken = parseUntilComma(body, idx);
  const accuracy = parseIntSafe(accuracyToken.value, 0);

  idx = skipWhitespace(body, accuracyToken.nextIndex);
  const ppToken = parseUntilComma(body, idx);
  const pp = parseIntSafe(ppToken.value, 0);

  idx = skipWhitespace(body, ppToken.nextIndex);
  const tagsBlock = parseBracketBlock(body, idx);
  const tags = parseTagList(tagsBlock.value);

  idx = skipWhitespace(body, tagsBlock.nextIndex);
  if (body[idx] !== ',') {
    throw new Error('Expected comma after tags list while parsing move_entry line.');
  }

  idx = skipWhitespace(body, idx + 1);
  const effectChanceToken = parseUntilComma(body, idx);
  const effectChance = parseEffectChance(effectChanceToken.value);

  idx = skipWhitespace(body, effectChanceToken.nextIndex);
  const ailmentToken = parseUntilComma(body, idx);
  const ailment = sanitizeAtom(ailmentToken.value);

  idx = skipWhitespace(body, ailmentToken.nextIndex);
  const effectCategoryToken = parseUntilComma(body, idx);
  const effectCategory = sanitizeAtom(effectCategoryToken.value);

  idx = skipWhitespace(body, effectCategoryToken.nextIndex);
  const descriptionParsed = parsePrologQuoted(body, idx);

  return {
    move,
    type,
    category,
    basePower,
    accuracy,
    pp,
    tags,
    effectChance,
    ailment,
    effectCategory,
    description: descriptionParsed.value
  };
}

function parseMovesCatalog(content) {
  const lines = content.split(/\r?\n/);
  const parsed = [];

  for (const line of lines) {
    const row = parseMoveEntryLine(line);
    if (row) {
      parsed.push(row);
    }
  }

  return parsed;
}

function addToMultiMap(map, key, value) {
  if (!map.has(key)) {
    map.set(key, new Set());
  }
  map.get(key).add(value);
}

function loadTacticalCatalog(filePath) {
  const seedRolesByMove = new Map();
  const expandRoleMap = new Map();

  if (!fs.existsSync(filePath)) {
    return {
      seedRolesByMove,
      expandRoleMap
    };
  }

  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content.split(/\r?\n/);

  for (const line of lines) {
    const trimmed = line.trim();

    const seedMatch = trimmed.match(/^move_tactical_role_seed\(([^,]+),\s*([a-z0-9_]+)\)\.$/);
    if (seedMatch) {
      const move = sanitizeAtom(seedMatch[1]);
      const role = sanitizeAtom(seedMatch[2]);
      addToMultiMap(seedRolesByMove, move, role);
      continue;
    }

    const expandMatch = trimmed.match(/^move_tactical_role_expand\(([a-z0-9_]+),\s*([a-z0-9_]+)\)\.$/);
    if (expandMatch) {
      const parent = sanitizeAtom(expandMatch[1]);
      const child = sanitizeAtom(expandMatch[2]);
      if (parent !== 'role' && child !== 'role') {
        addToMultiMap(expandRoleMap, parent, child);
      }
    }
  }

  return {
    seedRolesByMove,
    expandRoleMap
  };
}

function expandTacticalRoles(seedRoles, expandRoleMap) {
  const expanded = new Set();
  const queue = [...seedRoles];

  while (queue.length > 0) {
    const role = queue.shift();
    if (expanded.has(role)) {
      continue;
    }

    expanded.add(role);

    const children = expandRoleMap.get(role);
    if (!children) {
      continue;
    }

    for (const child of children) {
      if (!expanded.has(child)) {
        queue.push(child);
      }
    }
  }

  return expanded;
}

function inferPowerBand(basePower) {
  if (!Number.isFinite(basePower) || basePower <= 0) {
    return 'no_direct_power';
  }
  if (basePower <= 60) {
    return 'low_power';
  }
  if (basePower <= 90) {
    return 'mid_power';
  }
  if (basePower <= 120) {
    return 'high_power';
  }
  return 'very_high_power';
}

function inferAccuracyBand(accuracy) {
  if (!Number.isFinite(accuracy) || accuracy <= 0) {
    return 'no_accuracy_check';
  }
  if (accuracy <= 75) {
    return 'low_accuracy';
  }
  if (accuracy <= 90) {
    return 'mid_accuracy';
  }
  return 'high_accuracy';
}

function inferPpBand(pp) {
  if (!Number.isFinite(pp) || pp <= 0) {
    return 'unknown_pp';
  }
  if (pp <= 5) {
    return 'low_pp';
  }
  if (pp <= 10) {
    return 'mid_low_pp';
  }
  if (pp <= 20) {
    return 'mid_pp';
  }
  return 'high_pp';
}

function moveIdHasToken(moveId, token) {
  const pattern = new RegExp(`(?:^|_)${token}(?:_|$)`);
  return pattern.test(moveId);
}

function isPunchBasedMove(moveId, descriptionText) {
  if (PUNCH_MOVE_EXCLUSIONS.has(moveId)) {
    return false;
  }

  if (PUNCH_MOVE_SET.has(moveId)) {
    return true;
  }

  if (moveIdHasToken(moveId, 'punch')) {
    return true;
  }

  return /\bpunch(?:es|ing)?\b|\bfist(?:s)?\b|\buppercut\b/.test(descriptionText);
}

function isKickBasedMove(moveId, descriptionText) {
  if (KICK_MOVE_SET.has(moveId)) {
    return true;
  }

  if (moveIdHasToken(moveId, 'kick')) {
    return true;
  }

  return /\bkick(?:s|ing)?\b/.test(descriptionText);
}

function isSoundBasedMove(moveId, descriptionText) {
  if (SOUND_MOVE_SET.has(moveId)) {
    return true;
  }

  return /\bsound(?:\s|-)?based\b|\bsonic\b|\bvoice\b/.test(descriptionText);
}

function isPulseBasedMove(moveId, descriptionText) {
  if (PULSE_MOVE_SET.has(moveId)) {
    return true;
  }

  return moveIdHasToken(moveId, 'pulse') || /\bpulse(?:\s|-)?based\b|\baura\b/.test(descriptionText);
}

function isBitingMove(moveId, descriptionText) {
  if (BITING_MOVE_SET.has(moveId)) {
    return true;
  }

  return /\bbit(?:e|es|ing)?\b|\bfang(?:s)?\b|\bjaw(?:s)?\b/.test(descriptionText);
}

function isSlicingMove(moveId, descriptionText) {
  void descriptionText;
  return SLICING_MOVE_SET.has(moveId);
}

function addMarker(markerMap, marker, value) {
  if (value === null || value === undefined || value === '') {
    return;
  }

  const markerKey = sanitizeAtom(marker);
  let normalizedValue = value;

  if (typeof value === 'string') {
    normalizedValue = sanitizeAtom(value);
  } else if (typeof value === 'number') {
    normalizedValue = numberToStable(value);
  } else if (typeof value === 'boolean') {
    normalizedValue = value;
  } else {
    normalizedValue = sanitizeAtom(String(value));
  }

  if (normalizedValue === null || normalizedValue === undefined || normalizedValue === '') {
    return;
  }

  if (!markerMap.has(markerKey)) {
    markerMap.set(markerKey, new Set());
  }

  markerMap.get(markerKey).add(String(normalizedValue));
}

function parsePriorityFromTag(tag) {
  const match = tag.match(/^priority_(-?[0-9]+)$/);
  if (!match) {
    return null;
  }

  const value = Number.parseInt(match[1], 10);
  if (!Number.isFinite(value)) {
    return null;
  }

  return value;
}

function inferTacticalRoles(entry, tacticalContext) {
  const seedRoles = tacticalContext.seedRolesByMove.get(entry.move) || new Set();
  const expandedRoles = expandTacticalRoles(seedRoles, tacticalContext.expandRoleMap);

  if (entry.category !== 'status') {
    expandedRoles.add('damage');
  }

  if (entry.effectCategory === 'heal' || entry.effectCategory === 'damage_heal') {
    expandedRoles.add('recovery');
  }

  if (['net_good_stats', 'damage_raise', 'swagger'].includes(entry.effectCategory)) {
    expandedRoles.add('buff');
  }

  if (['damage_lower', 'ailment', 'damage_ailment'].includes(entry.effectCategory)) {
    expandedRoles.add('debuff');
  }

  if (['field_effect', 'whole_field_effect', 'force_switch'].includes(entry.effectCategory)) {
    expandedRoles.add('control');
  }

  const hasPositivePriority = entry.tags
    .map((tag) => parsePriorityFromTag(tag))
    .filter((value) => value !== null)
    .some((value) => value > 0);

  if (hasPositivePriority) {
    expandedRoles.add('speed_control');
    expandedRoles.add('control');
  }

  return expandedRoles;
}

function addRelationHooks(markerMap) {
  const typeHints = markerMap.get('type_hint') || new Set();
  const statusHints = markerMap.get('status_hint') || new Set();
  const tacticalRoles = markerMap.get('tactical_role') || new Set();
  const modifierKinds = markerMap.get('modifier_kind') || new Set();
  const conditions = markerMap.get('condition') || new Set();

  for (const typeHint of typeHints) {
    addMarker(markerMap, 'relation_hook', `type_${typeHint}`);
  }

  for (const statusHint of statusHints) {
    addMarker(markerMap, 'relation_hook', `status_${statusHint}`);
  }

  for (const tacticalRole of tacticalRoles) {
    addMarker(markerMap, 'relation_hook', `lane_${tacticalRole}`);
  }

  for (const modifierKind of modifierKinds) {
    addMarker(markerMap, 'relation_hook', `modifier_${modifierKind}`);
  }

  if (conditions.has('weather_rain')) {
    addMarker(markerMap, 'relation_hook', 'weather_rain');
  }
  if (conditions.has('weather_sun')) {
    addMarker(markerMap, 'relation_hook', 'weather_sun');
  }
  if (conditions.has('weather_sand')) {
    addMarker(markerMap, 'relation_hook', 'weather_sand');
  }
  if (conditions.has('weather_snow')) {
    addMarker(markerMap, 'relation_hook', 'weather_snow');
  }
  if (conditions.has('contact')) {
    addMarker(markerMap, 'relation_hook', 'contact_window');
  }
  if (conditions.has('priority_positive')) {
    addMarker(markerMap, 'relation_hook', 'priority_positive');
  }
  if (conditions.has('delayed_action')) {
    addMarker(markerMap, 'relation_hook', 'delayed_action');
  }
  if (conditions.has('critical_hit')) {
    addMarker(markerMap, 'relation_hook', 'critical_hit');
  }
  if (conditions.has('trick_room')) {
    addMarker(markerMap, 'relation_hook', 'speed_inversion');
  }
  if (conditions.has('punch_moves')) {
    addMarker(markerMap, 'relation_hook', 'punch_moves');
  }
  if (conditions.has('kick_moves')) {
    addMarker(markerMap, 'relation_hook', 'kick_moves');
  }
  if (conditions.has('sound_moves')) {
    addMarker(markerMap, 'relation_hook', 'sound_moves');
  }
  if (conditions.has('pulse_moves')) {
    addMarker(markerMap, 'relation_hook', 'pulse_moves');
  }
  if (conditions.has('biting_moves')) {
    addMarker(markerMap, 'relation_hook', 'biting_moves');
  }
  if (conditions.has('bite_moves')) {
    addMarker(markerMap, 'relation_hook', 'bite_moves');
  }
  if (conditions.has('slicing_moves')) {
    addMarker(markerMap, 'relation_hook', 'slicing_moves');
  }
  if (conditions.has('slice_moves')) {
    addMarker(markerMap, 'relation_hook', 'slice_moves');
  }
}

function applyMinimumSemanticMarkers(markerMap) {
  if (!markerMap.has('class')) {
    addMarker(markerMap, 'class', 'utility');
  }

  if (!markerMap.has('empower')) {
    addMarker(markerMap, 'empower', 'state');
  }

  if (!markerMap.has('trigger')) {
    addMarker(markerMap, 'trigger', 'on_move_use');
  }

  if (!markerMap.has('condition')) {
    addMarker(markerMap, 'condition', 'always_active');
  }
}

function inferMarkers(entry, tacticalContext) {
  const markerMap = new Map();
  const description = normalizeSearchText(entry.description);
  const punchBasedMove = isPunchBasedMove(entry.move, description);
  const kickBasedMove = isKickBasedMove(entry.move, description);
  const soundBasedMove = isSoundBasedMove(entry.move, description);
  const pulseBasedMove = isPulseBasedMove(entry.move, description);
  const bitingMove = isBitingMove(entry.move, description);
  const slicingMove = isSlicingMove(entry.move, description);

  addMarker(markerMap, 'source', 'catalog_heuristic');
  addMarker(markerMap, 'usage_mode', 'active');
  addMarker(markerMap, 'combat_relevance', 'combat');
  addMarker(markerMap, 'type_hint', entry.type);
  addMarker(markerMap, 'category', entry.category);
  addMarker(markerMap, 'effect_category', entry.effectCategory);
  addMarker(markerMap, 'trigger', 'on_move_use');
  addMarker(markerMap, 'power_band', inferPowerBand(entry.basePower));
  addMarker(markerMap, 'accuracy_band', inferAccuracyBand(entry.accuracy));
  addMarker(markerMap, 'pp_band', inferPpBand(entry.pp));

  if (Number.isFinite(entry.basePower) && entry.basePower > 0) {
    addMarker(markerMap, 'base_power', entry.basePower);
  }

  if (Number.isFinite(entry.accuracy) && entry.accuracy > 0) {
    addMarker(markerMap, 'accuracy', entry.accuracy);
  } else {
    addMarker(markerMap, 'condition', 'no_accuracy_check');
  }

  if (Number.isFinite(entry.pp) && entry.pp > 0) {
    addMarker(markerMap, 'pp', entry.pp);
  }

  if (Number.isFinite(entry.effectChance)) {
    addMarker(markerMap, 'chance_percent', entry.effectChance);
  }

  if (punchBasedMove) {
    addMarker(markerMap, 'condition', 'punch_moves');
    addMarker(markerMap, 'move_style', 'punch');
    addMarker(markerMap, 'domain', 'contact_style');
    addMarker(markerMap, 'tag', 'punch_based');
  }

  if (kickBasedMove) {
    addMarker(markerMap, 'condition', 'kick_moves');
    addMarker(markerMap, 'move_style', 'kick');
    addMarker(markerMap, 'domain', 'contact_style');
    addMarker(markerMap, 'tag', 'kick_based');
  }

  if (soundBasedMove) {
    addMarker(markerMap, 'condition', 'sound_moves');
    addMarker(markerMap, 'move_style', 'sound');
    addMarker(markerMap, 'domain', 'sound');
    addMarker(markerMap, 'tag', 'sound_based');
  }

  if (pulseBasedMove) {
    addMarker(markerMap, 'condition', 'pulse_moves');
    addMarker(markerMap, 'move_style', 'pulse');
    addMarker(markerMap, 'domain', 'pulse');
    addMarker(markerMap, 'tag', 'pulse_based');
  }

  if (bitingMove) {
    addMarker(markerMap, 'condition', 'biting_moves');
    addMarker(markerMap, 'condition', 'bite_moves');
    addMarker(markerMap, 'move_style', 'biting');
    addMarker(markerMap, 'domain', 'contact_style');
    addMarker(markerMap, 'tag', 'biting_based');
  }

  if (slicingMove) {
    addMarker(markerMap, 'condition', 'slicing_moves');
    addMarker(markerMap, 'condition', 'slice_moves');
    addMarker(markerMap, 'move_style', 'slicing');
    addMarker(markerMap, 'domain', 'contact_style');
    addMarker(markerMap, 'tag', 'slicing_based');
  }

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

  if (entry.category === 'status') {
    addMarker(markerMap, 'class', 'utility');
  }

  switch (entry.effectCategory) {
    case 'heal':
    case 'damage_heal':
      addMarker(markerMap, 'class', 'sustain');
      addMarker(markerMap, 'domain', 'recovery');
      addMarker(markerMap, 'empower', 'state');
      addMarker(markerMap, 'modifier_kind', 'hp_recovery_modifier');
      break;

    case 'damage_raise':
    case 'net_good_stats':
    case 'swagger':
      addMarker(markerMap, 'class', 'empower');
      addMarker(markerMap, 'domain', 'stat_stage');
      addMarker(markerMap, 'empower', 'stat');
      addMarker(markerMap, 'modifier_kind', 'stat_stage_modifier');
      break;

    case 'damage_lower':
      addMarker(markerMap, 'class', 'disruption');
      addMarker(markerMap, 'domain', 'stat_stage');
      addMarker(markerMap, 'empower', 'stat');
      addMarker(markerMap, 'modifier_kind', 'stat_stage_modifier');
      break;

    case 'damage_ailment':
    case 'ailment':
      addMarker(markerMap, 'class', 'disruption');
      addMarker(markerMap, 'domain', 'status');
      addMarker(markerMap, 'empower', 'status');
      addMarker(markerMap, 'modifier_kind', 'status_application_modifier');
      break;

    case 'field_effect':
    case 'whole_field_effect':
      addMarker(markerMap, 'class', 'control');
      addMarker(markerMap, 'domain', 'field_control');
      addMarker(markerMap, 'empower', 'state');
      addMarker(markerMap, 'modifier_kind', 'field_state_modifier');
      break;

    case 'force_switch':
      addMarker(markerMap, 'class', 'control');
      addMarker(markerMap, 'domain', 'switching');
      addMarker(markerMap, 'empower', 'state');
      addMarker(markerMap, 'modifier_kind', 'forced_switch_modifier');
      break;

    case 'ohko':
      addMarker(markerMap, 'class', 'offense');
      addMarker(markerMap, 'condition', 'one_hit_ko');
      addMarker(markerMap, 'modifier_kind', 'move_power_modifier');
      break;

    default:
      break;
  }

  for (const tag of entry.tags) {
    addMarker(markerMap, 'tag', tag);

    const priorityValue = parsePriorityFromTag(tag);
    if (priorityValue !== null) {
      addMarker(markerMap, 'priority', priorityValue);
      addMarker(markerMap, 'domain', 'priority');
      addMarker(markerMap, 'modifier_kind', 'turn_order_modifier');

      if (priorityValue > 0) {
        addMarker(markerMap, 'condition', 'priority_positive');
      } else if (priorityValue < 0) {
        addMarker(markerMap, 'condition', 'delayed_action');
      }
      continue;
    }

    if (tag === 'high_crit') {
      addMarker(markerMap, 'condition', 'critical_hit');
      continue;
    }

    if (tag === 'flinch_chance') {
      addMarker(markerMap, 'condition', 'flinch_chance');
      addMarker(markerMap, 'domain', 'status');
      addMarker(markerMap, 'status_hint', 'flinch');
      continue;
    }

    const ailmentTag = tag.match(/^ailment_(.+)$/);
    if (ailmentTag) {
      addMarker(markerMap, 'status_hint', ailmentTag[1]);
      addMarker(markerMap, 'domain', 'status');
    }
  }

  if (/sem descricao curta disponivel/.test(description)) {
    addMarker(markerMap, 'tag', 'missing_description');
  }

  if (/never misses|nunca erra/.test(description)) {
    addMarker(markerMap, 'condition', 'guaranteed_hit');
  }

  if (/\bweather\b|\brain\b|\bsunlight\b|\bsun\b|\bsandstorm\b|\bhail\b|\bsnow\b/.test(description)) {
    addMarker(markerMap, 'domain', 'weather');
  }

  if (/\brain\b/.test(description)) {
    addMarker(markerMap, 'condition', 'weather_rain');
  }

  if (/sunlight|\bsun\b/.test(description)) {
    addMarker(markerMap, 'condition', 'weather_sun');
  }

  if (/\bsandstorm\b/.test(description)) {
    addMarker(markerMap, 'condition', 'weather_sand');
  }

  if (/\bhail\b|\bsnow\b/.test(description)) {
    addMarker(markerMap, 'condition', 'weather_snow');
  }

  if (/terrain|electric terrain|grassy terrain|misty terrain|psychic terrain/.test(description)) {
    addMarker(markerMap, 'domain', 'terrain');
  }

  if (/trick room/.test(description)) {
    addMarker(markerMap, 'domain', 'speed_control');
    addMarker(markerMap, 'condition', 'trick_room');
  }

  if (/switch|switches out|leave battle|flee/.test(description)) {
    addMarker(markerMap, 'domain', 'switching');
  }

  if (/trap|cannot flee|cannot switch/.test(description) || entry.ailment === 'trap') {
    addMarker(markerMap, 'domain', 'trap');
  }

  if (/contact|makes contact/.test(description)) {
    addMarker(markerMap, 'condition', 'contact');
  }

  if (/critical hit/.test(description)) {
    addMarker(markerMap, 'condition', 'critical_hit');
  }

  const tacticalRoles = inferTacticalRoles(entry, tacticalContext);
  for (const tacticalRole of tacticalRoles) {
    addMarker(markerMap, 'tactical_role', tacticalRole);

    if (['control', 'speed_control', 'trick_room', 'pivot', 'redirection', 'protection', 'hazard', 'hazard_clear', 'terrain_control', 'weather_control', 'screen_control', 'fake_out'].includes(tacticalRole)) {
      addMarker(markerMap, 'class', 'control');
    }

    if (['recovery'].includes(tacticalRole)) {
      addMarker(markerMap, 'class', 'sustain');
    }

    if (['buff', 'setup_buff', 'ally_boost'].includes(tacticalRole)) {
      addMarker(markerMap, 'class', 'empower');
    }

    if (['debuff', 'disruption', 'status_spread'].includes(tacticalRole)) {
      addMarker(markerMap, 'class', 'disruption');
    }
  }

  addRelationHooks(markerMap);
  applyMinimumSemanticMarkers(markerMap);

  return markerMap;
}

function parseStoredValue(raw) {
  if (raw === 'true') {
    return true;
  }
  if (raw === 'false') {
    return false;
  }
  if (/^-?[0-9]+(?:\.[0-9]+)?$/.test(raw)) {
    return Number(raw);
  }
  return raw;
}

function formatPrologValue(value) {
  if (typeof value === 'number') {
    if (Number.isInteger(value)) {
      return String(value);
    }
    return String(value).replace(/\.0+$/, '');
  }

  if (typeof value === 'boolean') {
    return value ? 'true' : 'false';
  }

  return sanitizeAtom(value);
}

function renderMarkers(rows, tacticalContext) {
  const header = [
    ':- encoding(utf8).',
    '',
    '% Arquivo gerado automaticamente por tools/generate_move_markers.js',
    '% Origem: db/catalogs/moves_catalog.pl + db/catalogs/move_tactical_catalog.pl',
    '% move_marker(Move, Marker, Value).',
    ''
  ].join('\n');

  const facts = [];
  const sortedRows = [...rows].sort((a, b) => a.move.localeCompare(b.move));

  for (const row of sortedRows) {
    const markerMap = inferMarkers(row, tacticalContext);
    const markerEntries = [...markerMap.entries()].sort(([a], [b]) => a.localeCompare(b));

    for (const [marker, valuesSet] of markerEntries) {
      const sortedValues = [...valuesSet].sort((a, b) => {
        const parsedA = parseStoredValue(a);
        const parsedB = parseStoredValue(b);
        const strA = String(parsedA);
        const strB = String(parsedB);
        return strA.localeCompare(strB);
      });

      for (const rawValue of sortedValues) {
        const parsedValue = parseStoredValue(rawValue);
        facts.push(`move_marker(${row.move}, ${marker}, ${formatPrologValue(parsedValue)}).`);
      }
    }
  }

  return `${header}${facts.join('\n')}\n`;
}

function main() {
  if (!fs.existsSync(INPUT_PATH)) {
    throw new Error(`Arquivo de entrada nao encontrado: ${INPUT_PATH}`);
  }

  const content = fs.readFileSync(INPUT_PATH, 'utf8');
  const moves = parseMovesCatalog(content);

  if (moves.length === 0) {
    throw new Error('Nenhum move_entry foi encontrado para gerar marcadores.');
  }

  const tacticalContext = loadTacticalCatalog(TACTICAL_CATALOG_PATH);
  const output = renderMarkers(moves, tacticalContext);
  fs.writeFileSync(OUTPUT_PATH, output, 'utf8');

  console.log(`[move-markers] moves processados: ${moves.length}`);
  console.log(`[move-markers] arquivo gerado: ${OUTPUT_PATH}`);
}

try {
  main();
} catch (err) {
  console.error(`[move-markers] erro: ${err.message}`);
  process.exitCode = 1;
}
