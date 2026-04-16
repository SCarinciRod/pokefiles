const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const MOVES_CATALOG_PATH = path.join(ROOT, 'db', 'catalogs', 'moves_catalog.pl');
const MOVE_MARKERS_PATH = path.join(ROOT, 'db', 'generated', 'move_markers.pl');
const MOVE_TACTICAL_CATALOG_PATH = path.join(ROOT, 'db', 'catalogs', 'move_tactical_catalog.pl');
const OUTPUT_PATH = path.join(ROOT, 'db', 'generated', 'move_data_auto.pl');

const CONTROL_ROLES = new Set([
  'control',
  'speed_control',
  'trick_room',
  'pivot',
  'redirection',
  'protection',
  'hazard',
  'hazard_clear',
  'terrain_control',
  'weather_control',
  'screen_control',
  'fake_out'
]);

const BUFF_ROLES = new Set(['buff', 'setup_buff', 'ally_boost']);
const DEBUFF_ROLES = new Set(['debuff', 'disruption', 'status_spread']);

const STATUS_HINT_PRIORITY = [
  'burn',
  'poison',
  'paralysis',
  'sleep',
  'freeze',
  'confusion',
  'infatuation',
  'trap',
  'flinch'
];

const CONDITION_TAG_WHITELIST = new Set([
  'punch_moves',
  'kick_moves',
  'sound_moves',
  'pulse_moves',
  'biting_moves',
  'bite_moves',
  'slicing_moves',
  'slice_moves',
  'priority_positive',
  'delayed_action',
  'critical_hit',
  'contact',
  'trick_room',
  'weather_rain',
  'weather_sun',
  'weather_sand',
  'weather_snow',
  'guaranteed_hit',
  'flinch_chance'
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

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function prologQuotedText(value) {
  return `'${String(value || '').replace(/'/g, "''")}'`;
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

  throw new Error('Unterminated quoted string while parsing move entry.');
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
    throw new Error('Expected comma while parsing move entry.');
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

  throw new Error('Unterminated list block while parsing move entry.');
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
    throw new Error('Expected comma after tags list while parsing move entry.');
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
    description: String(descriptionParsed.value || '').trim()
  };
}

function parseMovesCatalog(content) {
  const rows = [];

  for (const line of content.split(/\r?\n/)) {
    const parsed = parseMoveEntryLine(line);
    if (parsed) {
      rows.push(parsed);
    }
  }

  return rows;
}

function parseMarkerValue(token) {
  const trimmed = String(token || '').trim();

  if (trimmed === 'true') {
    return true;
  }

  if (trimmed === 'false') {
    return false;
  }

  if (/^-?[0-9]+(?:\.[0-9]+)?$/.test(trimmed)) {
    return numberToStable(Number(trimmed));
  }

  return sanitizeAtom(trimmed);
}

function parseMoveMarkers(content) {
  const markerMap = new Map();

  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('move_marker(') || !trimmed.endsWith(').')) {
      continue;
    }

    const match = trimmed.match(/^move_marker\(([^,]+),\s*([^,]+),\s*([^)]+)\)\.$/);
    if (!match) {
      continue;
    }

    const move = sanitizeAtom(match[1]);
    const marker = sanitizeAtom(match[2]);
    const value = parseMarkerValue(match[3]);

    if (!markerMap.has(move)) {
      markerMap.set(move, new Map());
    }

    const markers = markerMap.get(move);
    if (!markers.has(marker)) {
      markers.set(marker, new Set());
    }

    markers.get(marker).add(String(value));
  }

  return markerMap;
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
    return { seedRolesByMove, expandRoleMap };
  }

  const content = fs.readFileSync(filePath, 'utf8');
  for (const line of content.split(/\r?\n/)) {
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

  return { seedRolesByMove, expandRoleMap };
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

function getMarkerValues(markerSet, marker) {
  if (!markerSet || !markerSet.has(marker)) {
    return [];
  }

  const values = [];
  for (const raw of markerSet.get(marker)) {
    if (raw === 'true') {
      values.push(true);
      continue;
    }

    if (raw === 'false') {
      values.push(false);
      continue;
    }

    if (/^-?[0-9]+(?:\.[0-9]+)?$/.test(raw)) {
      values.push(numberToStable(Number(raw)));
      continue;
    }

    values.push(sanitizeAtom(raw));
  }

  return values;
}

function getMarkerNumberValues(markerSet, marker) {
  return getMarkerValues(markerSet, marker).filter((value) => Number.isFinite(value));
}

function hasRoleIntersection(roles, expectedRoles) {
  for (const role of roles) {
    if (expectedRoles.has(role)) {
      return true;
    }
  }
  return false;
}

function fallbackRolesFromEntry(entry, tacticalContext) {
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

  return [...expandedRoles].sort((a, b) => a.localeCompare(b));
}

function inferRoles(entry, markerSet, tacticalContext) {
  const markerRoles = getMarkerValues(markerSet, 'tactical_role').filter((value) => typeof value === 'string');
  if (markerRoles.length > 0) {
    return [...new Set(markerRoles)].sort((a, b) => a.localeCompare(b));
  }

  return fallbackRolesFromEntry(entry, tacticalContext);
}

function isMissingDescriptionText(value) {
  const normalized = normalizeSearchText(value);
  if (!normalized.trim()) {
    return true;
  }

  return /sem descricao curta disponivel|sem descricao/.test(normalized);
}

function inferEffectChance(entry, markerSet) {
  if (Number.isFinite(entry.effectChance)) {
    return Math.round(entry.effectChance);
  }

  const markerChances = getMarkerNumberValues(markerSet, 'chance_percent')
    .map((value) => Math.round(value))
    .filter((value) => value >= 1 && value <= 100)
    .sort((a, b) => b - a);

  if (markerChances.length === 0) {
    return null;
  }

  return markerChances[0];
}

function inferAilment(entry, markerSet) {
  const rowAilment = sanitizeAtom(entry.ailment);
  if (rowAilment !== 'none' && rowAilment !== 'unknown') {
    return rowAilment;
  }

  const statusHints = getMarkerValues(markerSet, 'status_hint')
    .filter((value) => typeof value === 'string')
    .map((value) => sanitizeAtom(value));

  for (const preferred of STATUS_HINT_PRIORITY) {
    if (statusHints.includes(preferred)) {
      return preferred;
    }
  }

  if (statusHints.length > 0) {
    return statusHints[0];
  }

  return 'none';
}

function inferEffectCategory(entry, markerSet, ailment, roles) {
  const rowEffectCategory = sanitizeAtom(entry.effectCategory);
  if (rowEffectCategory !== 'unknown') {
    return rowEffectCategory;
  }

  const classes = getMarkerValues(markerSet, 'class').filter((value) => typeof value === 'string');
  const domains = getMarkerValues(markerSet, 'domain').filter((value) => typeof value === 'string');

  if (entry.category === 'status') {
    if (ailment !== 'none') {
      return 'ailment';
    }

    if (roles.includes('recovery') || classes.includes('sustain')) {
      return 'heal';
    }

    if (hasRoleIntersection(roles, BUFF_ROLES) || classes.includes('empower')) {
      return 'net_good_stats';
    }

    if (
      hasRoleIntersection(roles, CONTROL_ROLES) ||
      classes.includes('control') ||
      domains.includes('field_control') ||
      domains.includes('terrain') ||
      domains.includes('weather')
    ) {
      return 'field_effect';
    }

    return 'unknown';
  }

  if (ailment !== 'none') {
    return 'damage_ailment';
  }

  if (roles.includes('recovery') || classes.includes('sustain')) {
    return 'damage_heal';
  }

  if (hasRoleIntersection(roles, BUFF_ROLES) || classes.includes('empower')) {
    return 'damage_raise';
  }

  if (hasRoleIntersection(roles, DEBUFF_ROLES) || classes.includes('disruption')) {
    return 'damage_lower';
  }

  return 'damage';
}

function mergeTags(entry, markerSet, roles, ailment) {
  const merged = new Set((entry.tags || []).map((tag) => sanitizeAtom(tag)).filter(Boolean));

  for (const priority of getMarkerNumberValues(markerSet, 'priority')) {
    merged.add(`priority_${Math.round(priority)}`);
  }

  const conditions = getMarkerValues(markerSet, 'condition')
    .filter((value) => typeof value === 'string')
    .map((value) => sanitizeAtom(value));

  if (conditions.includes('critical_hit')) {
    merged.add('high_crit');
  }

  for (const condition of conditions) {
    if (CONDITION_TAG_WHITELIST.has(condition)) {
      merged.add(condition);
    }
  }

  const moveStyles = getMarkerValues(markerSet, 'move_style').filter((value) => typeof value === 'string');
  for (const moveStyle of moveStyles) {
    merged.add(`style_${sanitizeAtom(moveStyle)}`);
  }

  for (const role of roles) {
    merged.add(`role_${sanitizeAtom(role)}`);
  }

  const relationHooks = getMarkerValues(markerSet, 'relation_hook').filter((value) => typeof value === 'string');
  for (const hook of relationHooks) {
    merged.add(`hook_${sanitizeAtom(hook)}`);
  }

  const domains = getMarkerValues(markerSet, 'domain').filter((value) => typeof value === 'string');
  for (const domain of domains) {
    merged.add(`domain_${sanitizeAtom(domain)}`);
  }

  const statusHints = getMarkerValues(markerSet, 'status_hint').filter((value) => typeof value === 'string');
  for (const hint of statusHints) {
    merged.add(`ailment_${sanitizeAtom(hint)}`);
  }

  if (ailment !== 'none' && ailment !== 'unknown') {
    merged.add(`ailment_${sanitizeAtom(ailment)}`);
  }

  return [...merged]
    .map((tag) => sanitizeAtom(tag))
    .filter((tag) => tag && tag !== 'unknown' && tag !== 'none')
    .sort((a, b) => a.localeCompare(b));
}

function inferDescription(entry, markerSet, roles, ailment, effectChance, hasCatalogDescription) {
  if (hasCatalogDescription) {
    return entry.description;
  }

  const styles = getMarkerValues(markerSet, 'move_style')
    .filter((value) => typeof value === 'string')
    .map((value) => sanitizeAtom(value));

  const meaningfulConditions = getMarkerValues(markerSet, 'condition')
    .filter((value) => typeof value === 'string')
    .map((value) => sanitizeAtom(value))
    .filter((value) => value !== 'always_active')
    .slice(0, 4);

  const roleSummary = roles.filter((role) => role !== 'damage').slice(0, 4);

  const parts = [`golpe ${entry.category}`, `tipo ${entry.type}`];

  if (styles.length > 0) {
    parts.push(`estilo ${styles.join(', ')}`);
  }

  if (roleSummary.length > 0) {
    parts.push(`papeis taticos ${roleSummary.join(', ')}`);
  }

  if (ailment !== 'none' && ailment !== 'unknown') {
    parts.push(`aplica ${ailment}`);
  }

  if (Number.isFinite(effectChance)) {
    parts.push(`chance adicional ${effectChance}%`);
  }

  if (meaningfulConditions.length > 0) {
    parts.push(`condicoes ${meaningfulConditions.join(', ')}`);
  }

  return `Curadoria automatica de move: ${parts.join('; ')}.`;
}

function inferTrigger(markerSet) {
  const triggers = getMarkerValues(markerSet, 'trigger').filter((value) => typeof value === 'string');
  if (triggers.includes('on_move_use')) {
    return 'on_move_use';
  }
  if (triggers.length > 0) {
    return sanitizeAtom(triggers[0]);
  }
  return 'on_move_use';
}

function inferMoveSemanticCategory(entry, markerSet, roles, ailment) {
  if (entry.category === 'physical' || entry.category === 'special') {
    return 'offensive';
  }

  const classes = getMarkerValues(markerSet, 'class').filter((value) => typeof value === 'string');

  if (ailment !== 'none' || classes.includes('disruption') || hasRoleIntersection(roles, DEBUFF_ROLES)) {
    return 'status';
  }

  if (classes.includes('sustain') || roles.includes('recovery')) {
    return 'sustain';
  }

  if (classes.includes('control') || hasRoleIntersection(roles, CONTROL_ROLES)) {
    return 'control';
  }

  if (classes.includes('empower') || hasRoleIntersection(roles, BUFF_ROLES)) {
    return 'empower';
  }

  return 'utility';
}

function countMarkerSignals(markerSet) {
  if (!markerSet) {
    return 0;
  }

  let count = 0;
  for (const values of markerSet.values()) {
    count += values.size;
  }

  return count;
}

function inferConfidence(markerSet, hasCatalogDescription, roles, ailment, effectChance) {
  let score = 0.72;

  if (hasCatalogDescription) {
    score += 0.1;
  } else {
    score -= 0.03;
  }

  const markerSignals = countMarkerSignals(markerSet);
  if (markerSignals >= 16) {
    score += 0.09;
  } else if (markerSignals >= 8) {
    score += 0.06;
  } else if (markerSignals >= 4) {
    score += 0.03;
  }

  if (roles.length > 0) {
    score += 0.04;
  }

  const styles = getMarkerValues(markerSet, 'move_style').filter((value) => typeof value === 'string');
  if (styles.length > 0) {
    score += 0.03;
  }

  const conditions = getMarkerValues(markerSet, 'condition')
    .filter((value) => typeof value === 'string')
    .map((value) => sanitizeAtom(value))
    .filter((value) => value !== 'always_active');
  if (conditions.length > 0) {
    score += 0.02;
  }

  if (ailment !== 'none' && ailment !== 'unknown') {
    score += 0.03;
  }

  if (Number.isFinite(effectChance)) {
    score += 0.02;
  }

  const tags = getMarkerValues(markerSet, 'tag').filter((value) => typeof value === 'string');
  if (tags.includes('missing_description')) {
    score -= 0.05;
  }

  return numberToStable(clamp(score, 0.75, 0.97));
}

function formatModelValue(value) {
  if (typeof value === 'number') {
    return String(numberToStable(value));
  }

  if (typeof value === 'boolean') {
    return value ? 'true' : 'false';
  }

  return sanitizeAtom(value);
}

function modelTerm(key, value) {
  return `${sanitizeAtom(key)}-${formatModelValue(value)}`;
}

function inferCombatModel(entry, markerSet, roles, ailment, effectChance, effectCategory, trigger, confidence, hasCatalogDescription) {
  const model = new Set();

  model.add(modelTerm('source', 'auto_marker'));
  model.add(modelTerm('combat_relevance', 'combat'));
  model.add(modelTerm('trigger', trigger));
  model.add(modelTerm('category', entry.category));
  model.add(modelTerm('type_hint', entry.type));
  model.add(modelTerm('effect_category', effectCategory));
  model.add(modelTerm('has_catalog_description', hasCatalogDescription));
  model.add(modelTerm('confidence', confidence));

  if (ailment !== 'none' && ailment !== 'unknown') {
    model.add(modelTerm('status_hint', ailment));
    model.add(modelTerm('ailment', ailment));
  }

  if (Number.isFinite(effectChance)) {
    model.add(modelTerm('chance_percent', effectChance));
  }

  for (const role of roles) {
    model.add(modelTerm('tactical_role', role));
  }

  for (const markerName of [
    'class',
    'condition',
    'move_style',
    'relation_hook',
    'domain',
    'modifier_kind',
    'status_hint',
    'power_band',
    'accuracy_band',
    'pp_band',
    'priority',
    'base_power',
    'accuracy',
    'pp'
  ]) {
    for (const value of getMarkerValues(markerSet, markerName)) {
      model.add(modelTerm(markerName, value));
    }
  }

  return [...model].sort((a, b) => a.localeCompare(b));
}

function buildAutoRows(moveRows, markerMap, tacticalContext) {
  const rows = [];

  for (const entry of moveRows) {
    const markerSet = markerMap.get(entry.move) || new Map();

    const roles = inferRoles(entry, markerSet, tacticalContext);
    const effectChance = inferEffectChance(entry, markerSet);
    const ailment = inferAilment(entry, markerSet);
    const effectCategory = inferEffectCategory(entry, markerSet, ailment, roles);
    const tags = mergeTags(entry, markerSet, roles, ailment);
    const hasCatalogDescription = !isMissingDescriptionText(entry.description);
    const description = inferDescription(entry, markerSet, roles, ailment, effectChance, hasCatalogDescription);
    const trigger = inferTrigger(markerSet);
    const semanticCategory = inferMoveSemanticCategory(entry, markerSet, roles, ailment);
    const confidence = inferConfidence(markerSet, hasCatalogDescription, roles, ailment, effectChance);
    const combatModel = inferCombatModel(
      entry,
      markerSet,
      roles,
      ailment,
      effectChance,
      effectCategory,
      trigger,
      confidence,
      hasCatalogDescription
    );

    rows.push({
      move: entry.move,
      type: entry.type,
      category: entry.category,
      basePower: entry.basePower,
      accuracy: entry.accuracy,
      pp: entry.pp,
      tags,
      effectChance,
      ailment,
      effectCategory,
      description,
      semanticCategory,
      trigger,
      confidence,
      combatModel
    });
  }

  return rows;
}

function renderAutoData(rows) {
  const header = [
    ':- encoding(utf8).',
    '',
    ':- multifile move_data_auto/11.',
    ':- multifile move_effect/6.',
    '',
    '% Arquivo gerado automaticamente por tools/generate_move_data_auto.js',
    '% Fonte: db/catalogs/moves_catalog.pl + db/generated/move_markers.pl + db/catalogs/move_tactical_catalog.pl',
    '% move_data_auto(Move, Type, Category, BasePower, Accuracy, PP, Tags, EffectChance, Ailment, EffectCategory, Description).',
    '% move_effect(Move, Category, Trigger, CombatModel, Description, Confidence).',
    ''
  ].join('\n');

  const sortedRows = [...rows].sort((a, b) => a.move.localeCompare(b.move));
  const facts = [];

  for (const row of sortedRows) {
    const tagsText = row.tags.join(', ');
    const effectChanceText = Number.isFinite(row.effectChance) ? String(Math.round(row.effectChance)) : 'null';

    facts.push(
      `move_data_auto(${row.move}, ${row.type}, ${row.category}, ${row.basePower}, ${row.accuracy}, ${row.pp}, [${tagsText}], ${effectChanceText}, ${row.ailment}, ${row.effectCategory}, ${prologQuotedText(row.description)}).`
    );

    facts.push(
      `move_effect(${row.move}, ${row.semanticCategory}, ${row.trigger}, [${row.combatModel.join(', ')}], ${prologQuotedText(row.description)}, ${row.confidence}).`
    );
  }

  return `${header}${facts.join('\n')}\n`;
}

function main() {
  for (const filePath of [MOVES_CATALOG_PATH, MOVE_MARKERS_PATH]) {
    if (!fs.existsSync(filePath)) {
      throw new Error(`Arquivo de entrada nao encontrado: ${filePath}`);
    }
  }

  const movesCatalogContent = fs.readFileSync(MOVES_CATALOG_PATH, 'utf8');
  const moveMarkersContent = fs.readFileSync(MOVE_MARKERS_PATH, 'utf8');

  const moveRows = parseMovesCatalog(movesCatalogContent);
  if (moveRows.length === 0) {
    throw new Error('Nenhum move_entry foi encontrado para gerar move_data_auto.');
  }

  const markerMap = parseMoveMarkers(moveMarkersContent);
  const tacticalContext = loadTacticalCatalog(MOVE_TACTICAL_CATALOG_PATH);

  const autoRows = buildAutoRows(moveRows, markerMap, tacticalContext);
  const output = renderAutoData(autoRows);

  fs.writeFileSync(OUTPUT_PATH, output, 'utf8');

  const missingDescriptionCount = autoRows.filter((row) => isMissingDescriptionText(row.description)).length;

  console.log(`[auto-move] moves no catalogo: ${moveRows.length}`);
  console.log(`[auto-move] moves com marcadores: ${markerMap.size}`);
  console.log(`[auto-move] move_data_auto gerados: ${autoRows.length}`);
  console.log(`[auto-move] descricoes ainda ausentes: ${missingDescriptionCount}`);
  console.log(`[auto-move] arquivo gerado: ${OUTPUT_PATH}`);
}

try {
  main();
} catch (err) {
  console.error(`[auto-move] erro: ${err.message}`);
  process.exitCode = 1;
}
