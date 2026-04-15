const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const MARKERS_INPUT = path.join(ROOT, 'db', 'generated', 'ability_markers.pl');
const CATALOG_INPUT = path.join(ROOT, 'db', 'catalogs', 'abilities_catalog.pl');
const OUTPUT_PATH = path.join(ROOT, 'db', 'generated', 'ability_data_auto.pl');

function sanitizeAtom(value) {
  return String(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '') || 'unknown';
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

  throw new Error('Unterminated quoted string.');
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
    throw new Error('Expected comma while parsing ability_entry.');
  }
  return {
    value: text.slice(startIndex, idx).trim(),
    nextIndex: idx + 1
  };
}

function parseAbilityEntryLine(line) {
  const trimmed = line.trim();
  if (!trimmed.startsWith('ability_entry(') || !trimmed.endsWith(').')) {
    return null;
  }

  const body = trimmed.slice('ability_entry('.length, -2);

  let idx = 0;
  const abilityToken = parseUntilComma(body, idx);
  const ability = sanitizeAtom(abilityToken.value);

  idx = skipWhitespace(body, abilityToken.nextIndex);
  const generationToken = parseUntilComma(body, idx);
  const generation = sanitizeAtom(generationToken.value);

  idx = skipWhitespace(body, generationToken.nextIndex);
  const isMainSeriesToken = parseUntilComma(body, idx);
  const isMainSeries = sanitizeAtom(isMainSeriesToken.value) === 'true';

  idx = skipWhitespace(body, isMainSeriesToken.nextIndex);
  const shortEffectParsed = parsePrologQuoted(body, idx);

  idx = skipWhitespace(body, shortEffectParsed.nextIndex);
  if (body[idx] !== ',') {
    throw new Error('Expected comma between short effect and effect text.');
  }

  idx = skipWhitespace(body, idx + 1);
  const effectParsed = parsePrologQuoted(body, idx);

  return {
    ability,
    generation,
    isMainSeries,
    shortEffect: shortEffectParsed.value,
    effect: effectParsed.value
  };
}

function parseCatalog(content) {
  const rows = content.split(/\r?\n/);
  const map = new Map();
  for (const row of rows) {
    const parsed = parseAbilityEntryLine(row);
    if (parsed) {
      map.set(parsed.ability, parsed);
    }
  }
  return map;
}

function parseMarkerValue(token) {
  const trimmed = token.trim();
  if (/^-?[0-9]+(?:\.[0-9]+)?$/.test(trimmed)) {
    return numberToStable(Number(trimmed));
  }
  if (trimmed === 'true') {
    return true;
  }
  if (trimmed === 'false') {
    return false;
  }
  return sanitizeAtom(trimmed);
}

function parseMarkers(content) {
  const markerMap = new Map();

  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('ability_marker(') || !trimmed.endsWith(').')) {
      continue;
    }

    const match = trimmed.match(/^ability_marker\(([^,]+),\s*([^,]+),\s*([^)]+)\)\.$/);
    if (!match) {
      continue;
    }

    const ability = sanitizeAtom(match[1]);
    const marker = sanitizeAtom(match[2]);
    const value = parseMarkerValue(match[3]);

    if (!markerMap.has(ability)) {
      markerMap.set(ability, new Map());
    }

    const abilityMarkers = markerMap.get(ability);
    if (!abilityMarkers.has(marker)) {
      abilityMarkers.set(marker, new Set());
    }

    abilityMarkers.get(marker).add(String(value));
  }

  return markerMap;
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

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function inferCategory(markerSet) {
  const empowerValues = getMarkerValues(markerSet, 'empower');
  const statTargets = getMarkerValues(markerSet, 'stat_target');
  const classes = getMarkerValues(markerSet, 'class');
  const domains = getMarkerValues(markerSet, 'domain');

  if (empowerValues.includes('move')) {
    return 'offensive';
  }

  if (empowerValues.includes('stat')) {
    if (statTargets.includes('attack') || statTargets.includes('special_attack') || statTargets.includes('speed')) {
      return 'offensive';
    }
    if (statTargets.includes('defense') || statTargets.includes('special_defense')) {
      return 'defensive';
    }
  }

  if (classes.includes('immunity_control') || classes.includes('sustain') || classes.includes('mitigation_or_debuff')) {
    return 'defensive';
  }

  if (domains.includes('status')) {
    return 'status';
  }

  if (domains.includes('weather')) {
    return 'weather';
  }

  if (domains.includes('trap')) {
    return 'trap';
  }

  return 'utility';
}

function inferTrigger(markerSet) {
  const triggers = getMarkerValues(markerSet, 'trigger');
  if (triggers.includes('on_switch_in')) {
    return 'on_switch';
  }
  if (triggers.includes('on_hit') || triggers.includes('on_contact')) {
    return 'on_hit';
  }
  if (triggers.includes('end_turn')) {
    return 'passive';
  }
  return 'passive';
}

function inferConfidence(markerSet) {
  let score = 0.45;

  const empowerValues = getMarkerValues(markerSet, 'empower');
  const multipliers = getMarkerValues(markerSet, 'multiplier');
  const deltas = getMarkerValues(markerSet, 'delta_percent');
  const reductions = getMarkerValues(markerSet, 'reduction_percent');
  const statTargets = getMarkerValues(markerSet, 'stat_target');
  const triggers = getMarkerValues(markerSet, 'trigger');
  const conditions = getMarkerValues(markerSet, 'condition');
  const combatRelevance = getMarkerValues(markerSet, 'combat_relevance');

  if (empowerValues.length > 0) {
    score += 0.2;
  }

  if (multipliers.length > 0 || deltas.length > 0 || reductions.length > 0) {
    score += 0.15;
  }

  if (statTargets.length > 0) {
    score += 0.1;
  }

  if (triggers.length > 0) {
    score += 0.1;
  }

  if (conditions.length > 0) {
    score += 0.05;
  }

  if (combatRelevance.includes('non_combat')) {
    score -= 0.25;
  }

  return numberToStable(clamp(score, 0.2, 0.95));
}

function inferDescription(markerSet, catalogRow) {
  const empowerValues = getMarkerValues(markerSet, 'empower');
  const statTargets = getMarkerValues(markerSet, 'stat_target');
  const multipliers = getMarkerValues(markerSet, 'multiplier');
  const combatRelevance = getMarkerValues(markerSet, 'combat_relevance');

  if (combatRelevance.includes('non_combat')) {
    return 'Modelagem automatica por marcadores: efeito principal em overworld (sem impacto competitivo direto em combate).';
  }

  const parts = [];
  if (empowerValues.includes('move')) {
    parts.push('foco em fortalecimento de golpes');
  }
  if (empowerValues.includes('stat')) {
    if (statTargets.length > 0) {
      parts.push(`foco em stats (${statTargets.join(', ')})`);
    } else {
      parts.push('foco em fortalecimento de stats');
    }
  }
  if (multipliers.length > 0) {
    parts.push(`multiplicador detectado: ${multipliers.join(', ')}`);
  }

  if (parts.length > 0) {
    return `Modelagem automatica por marcadores: ${parts.join('; ')}.`;
  }

  if (catalogRow && catalogRow.shortEffect && !/sem descri/.test(catalogRow.shortEffect.toLowerCase())) {
    return `Modelagem automatica por marcadores: ${catalogRow.shortEffect}`;
  }

  return 'Modelagem automatica por marcadores para suporte de analise competitiva.';
}

function inferCombatModel(markerSet) {
  const model = new Set();

  model.add(modelTerm('source', 'auto_marker'));

  const combatRelevance = getMarkerValues(markerSet, 'combat_relevance');
  const relevance = combatRelevance[0] || 'combat';
  model.add(modelTerm('combat_relevance', relevance));

  const impactScopes = getMarkerValues(markerSet, 'impact_scope');
  if (impactScopes.includes('overworld')) {
    model.add(modelTerm('has_overworld_component', true));
  }
  if (relevance === 'non_combat') {
    model.add(modelTerm('overworld_only', true));
  }

  const empowerValues = getMarkerValues(markerSet, 'empower');
  if (empowerValues.includes('move')) {
    model.add(modelTerm('empower_move', true));
  }
  if (empowerValues.includes('stat')) {
    model.add(modelTerm('empower_stat', true));
  }
  if (empowerValues.includes('state')) {
    model.add(modelTerm('empower_state', true));
  }

  for (const statTarget of getMarkerValues(markerSet, 'stat_target')) {
    model.add(modelTerm('stat_target', statTarget));
  }

  for (const markerName of ['multiplier', 'delta_percent', 'reduction_percent', 'chance_percent', 'hp_gain_fraction', 'hp_loss_fraction', 'threshold_fraction']) {
    for (const value of getMarkerValues(markerSet, markerName)) {
      model.add(modelTerm(markerName, value));
    }
  }

  for (const value of getMarkerValues(markerSet, 'condition')) {
    model.add(modelTerm('condition', value));
  }

  for (const value of getMarkerValues(markerSet, 'domain')) {
    model.add(modelTerm('domain', value));
  }

  for (const value of getMarkerValues(markerSet, 'type_hint')) {
    model.add(modelTerm('type_hint', value));
  }

  for (const value of getMarkerValues(markerSet, 'trigger')) {
    model.add(modelTerm('trigger', value));
  }

  for (const value of getMarkerValues(markerSet, 'modifier_kind')) {
    model.add(modelTerm('modifier_kind', value));
  }

  model.add(modelTerm('confidence', inferConfidence(markerSet)));

  return [...model].sort((a, b) => a.localeCompare(b));
}

function buildAutoRows(markerMap, catalogMap) {
  const rows = [];

  const abilities = [...markerMap.keys()].sort((a, b) => a.localeCompare(b));
  for (const ability of abilities) {
    const markers = markerMap.get(ability);

    const category = inferCategory(markers);
    const trigger = inferTrigger(markers);
    const combatModel = inferCombatModel(markers);
    const description = inferDescription(markers, catalogMap.get(ability));

    rows.push({
      ability,
      category,
      trigger,
      combatModel,
      description
    });
  }

  return rows;
}

function renderAutoData(rows) {
  const header = [
    ':- encoding(utf8).',
    '',
    ':- multifile ability_effect/5.',
    '',
    '% Arquivo gerado automaticamente por tools/generate_ability_data_auto.js',
    '% Fonte: ability_markers.pl + abilities_catalog.pl',
    '% Curadoria automatica para todas as abilities catalogadas.',
    '% ability_effect(Ability, Category, Trigger, CombatModel, Description).',
    ''
  ].join('\n');

  const body = rows
    .sort((a, b) => a.ability.localeCompare(b.ability))
    .map((row) => {
      const modelText = row.combatModel.join(', ');
      return `ability_effect(${row.ability}, ${row.category}, ${row.trigger}, [${modelText}], ${prologQuotedText(row.description)}).`;
    })
    .join('\n');

  return `${header}${body}\n`;
}

function main() {
  for (const filePath of [MARKERS_INPUT, CATALOG_INPUT]) {
    if (!fs.existsSync(filePath)) {
      throw new Error(`Arquivo de entrada nao encontrado: ${filePath}`);
    }
  }

  const markersContent = fs.readFileSync(MARKERS_INPUT, 'utf8');
  const catalogContent = fs.readFileSync(CATALOG_INPUT, 'utf8');

  const markerMap = parseMarkers(markersContent);
  const catalogMap = parseCatalog(catalogContent);

  const autoRows = buildAutoRows(markerMap, catalogMap);
  const output = renderAutoData(autoRows);
  fs.writeFileSync(OUTPUT_PATH, output, 'utf8');

  console.log(`[auto-ability] abilities no catalogo: ${catalogMap.size}`);
  console.log(`[auto-ability] auto geradas: ${autoRows.length}`);
  console.log(`[auto-ability] arquivo gerado: ${OUTPUT_PATH}`);
}

try {
  main();
} catch (err) {
  console.error(`[auto-ability] erro: ${err.message}`);
  process.exitCode = 1;
}
