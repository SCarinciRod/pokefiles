const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const MARKERS_INPUT = path.join(ROOT, 'db', 'generated', 'item_markers.pl');
const CATALOG_INPUT = path.join(ROOT, 'db', 'catalogs', 'items_catalog.pl');
const FALLBACK_DESCRIPTIONS_PATH = path.join(ROOT, 'db', 'references', 'item_description_fallbacks.json');
const OUTPUT_PATH = path.join(ROOT, 'db', 'generated', 'held_item_data_auto.pl');

function sanitizeAtom(value) {
  return String(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '') || 'unknown';
}

function normalizeSearchText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function isMissingDescriptionText(value) {
  return /sem descricao disponivel/.test(normalizeSearchText(value));
}

function loadFallbackDescriptions(filePath) {
  if (!fs.existsSync(filePath)) {
    return new Map();
  }

  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (err) {
    throw new Error(`Falha ao ler fallback de descricoes (${filePath}): ${err.message}`);
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`Fallback de descricoes invalido em ${filePath}. Esperado objeto JSON item->descricao.`);
  }

  const map = new Map();
  for (const [rawItem, rawDescription] of Object.entries(parsed)) {
    const item = sanitizeAtom(rawItem);
    const description = String(rawDescription || '').trim();
    if (!item || !description) {
      continue;
    }
    map.set(item, description);
  }

  return map;
}

function applyFallbackToCatalog(catalogMap, fallbackMap) {
  let fallbackAppliedCount = 0;
  const resolvedMap = new Map();

  for (const [item, row] of catalogMap.entries()) {
    const originalDescription = String(row.description || '');
    const fallbackDescription = fallbackMap.get(item);

    if (isMissingDescriptionText(originalDescription) && fallbackDescription) {
      fallbackAppliedCount += 1;
      resolvedMap.set(item, {
        ...row,
        description: fallbackDescription,
        originalDescription,
        fallbackDescriptionApplied: true
      });
      continue;
    }

    resolvedMap.set(item, {
      ...row,
      originalDescription,
      fallbackDescriptionApplied: false
    });
  }

  return {
    catalogMap: resolvedMap,
    fallbackAppliedCount
  };
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
    throw new Error('Expected comma while parsing item_entry.');
  }
  return {
    value: text.slice(startIndex, idx).trim(),
    nextIndex: idx + 1
  };
}

function parseItemEntryLine(line) {
  const trimmed = line.trim();
  if (!trimmed.startsWith('item_entry(') || !trimmed.endsWith(').')) {
    return null;
  }

  const body = trimmed.slice('item_entry('.length, -2);

  let idx = 0;
  const itemToken = parseUntilComma(body, idx);
  const item = sanitizeAtom(itemToken.value);

  idx = skipWhitespace(body, itemToken.nextIndex);
  const categoryToken = parseUntilComma(body, idx);
  const category = sanitizeAtom(categoryToken.value);

  idx = skipWhitespace(body, categoryToken.nextIndex);
  const costToken = parseUntilComma(body, idx);
  const cost = Number.parseInt(costToken.value, 10);

  idx = skipWhitespace(body, costToken.nextIndex);
  const flingPowerToken = parseUntilComma(body, idx);
  const flingPower = Number.parseInt(flingPowerToken.value, 10);

  idx = skipWhitespace(body, flingPowerToken.nextIndex);
  const flingEffectToken = parseUntilComma(body, idx);
  const flingEffect = sanitizeAtom(flingEffectToken.value);

  idx = skipWhitespace(body, flingEffectToken.nextIndex);
  const descriptionParsed = parsePrologQuoted(body, idx);

  return {
    item,
    category,
    cost: Number.isFinite(cost) ? cost : 0,
    flingPower: Number.isFinite(flingPower) ? flingPower : 0,
    flingEffect,
    description: String(descriptionParsed.value || '').trim()
  };
}

function parseCatalog(content) {
  const rows = content.split(/\r?\n/);
  const map = new Map();
  for (const row of rows) {
    const parsed = parseItemEntryLine(row);
    if (parsed) {
      map.set(parsed.item, parsed);
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
    if (!trimmed.startsWith('item_marker(') || !trimmed.endsWith(').')) {
      continue;
    }

    const match = trimmed.match(/^item_marker\(([^,]+),\s*([^,]+),\s*([^)]+)\)\.$/);
    if (!match) {
      continue;
    }

    const item = sanitizeAtom(match[1]);
    const marker = sanitizeAtom(match[2]);
    const value = parseMarkerValue(match[3]);

    if (!markerMap.has(item)) {
      markerMap.set(item, new Map());
    }

    const itemMarkers = markerMap.get(item);
    if (!itemMarkers.has(marker)) {
      itemMarkers.set(marker, new Set());
    }

    itemMarkers.get(marker).add(String(value));
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

function splitSentences(text) {
  const normalized = String(text || '')
    .replace(/\s+/g, ' ')
    .trim();

  if (!normalized) {
    return [];
  }

  return normalized
    .split(/(?<=[.!?])\s+/)
    .map((value) => value.trim())
    .filter(Boolean);
}

function isGenericHeldIntroSentence(sentence) {
  const normalized = normalizeSearchText(sentence);
  return /^an item to be held by\b/.test(normalized);
}

function pickBestDescriptionSentence(text) {
  const sentences = splitSentences(text);
  if (sentences.length === 0) {
    return '';
  }

  const firstSpecific = sentences.find((sentence) => !isGenericHeldIntroSentence(sentence));
  return firstSpecific || sentences[0];
}

function ensureSentenceEnding(text) {
  const trimmed = String(text || '').trim();
  if (!trimmed) {
    return '';
  }

  if (/[.!?]$/.test(trimmed)) {
    return trimmed;
  }

  return `${trimmed}.`;
}

function hasHeldItemSlot(markerSet) {
  return getMarkerValues(markerSet, 'relation_hook').includes('held_item_slot');
}

function inferCategory(markerSet) {
  const roles = getMarkerValues(markerSet, 'item_role');

  if (roles.includes('form_control')) {
    return 'form_control';
  }
  if (roles.includes('offense')) {
    return 'offensive';
  }
  if (roles.includes('defense') || roles.includes('sustain')) {
    return 'defensive';
  }
  if (roles.includes('status_control')) {
    return 'status';
  }

  return 'utility';
}

function inferTrigger(markerSet) {
  const triggers = getMarkerValues(markerSet, 'trigger');

  if (triggers.includes('on_contact') || triggers.includes('on_hit')) {
    return 'on_hit';
  }
  if (triggers.includes('on_low_hp')) {
    return 'on_low_hp';
  }
  if (triggers.includes('on_move_use')) {
    return 'on_move_use';
  }
  if (triggers.includes('end_turn')) {
    return 'end_turn';
  }
  if (triggers.includes('on_status')) {
    return 'on_status';
  }
  if (triggers.includes('on_use')) {
    return 'on_use';
  }

  return 'passive';
}

function inferConfidence(markerSet, catalogRow) {
  let score = 0.55;

  const modifierKinds = getMarkerValues(markerSet, 'modifier_kind');
  const conditions = getMarkerValues(markerSet, 'condition');
  const triggers = getMarkerValues(markerSet, 'trigger');
  const combatRelevance = getMarkerValues(markerSet, 'combat_relevance');
  const statTargets = getMarkerValues(markerSet, 'stat_target');
  const typeHints = getMarkerValues(markerSet, 'type_hint');
  const multiplierSignals = [
    ...getMarkerValues(markerSet, 'multiplier'),
    ...getMarkerValues(markerSet, 'delta_percent'),
    ...getMarkerValues(markerSet, 'reduction_percent'),
    ...getMarkerValues(markerSet, 'hp_gain_fraction'),
    ...getMarkerValues(markerSet, 'hp_loss_fraction')
  ];

  if (modifierKinds.length > 0) {
    score += 0.12;
  }

  if (conditions.length > 0) {
    score += 0.08;
  }

  if (triggers.length > 0 && !triggers.includes('passive')) {
    score += 0.08;
  }

  if (statTargets.length > 0 || typeHints.length > 0) {
    score += 0.06;
  }

  if (multiplierSignals.length > 0) {
    score += 0.08;
  }

  if (combatRelevance.includes('non_combat')) {
    score -= 0.25;
  }

  if (getMarkerValues(markerSet, 'tag').includes('missing_description')) {
    score -= 0.2;
  }

  if (catalogRow && isMissingDescriptionText(catalogRow.description || '')) {
    score -= 0.1;
  }

  return numberToStable(clamp(score, 0.4, 0.95));
}

function inferDescription(markerSet, catalogRow) {
  const rawDescription = catalogRow ? String(catalogRow.description || '').trim() : '';
  const hasDescription = rawDescription !== '' && !isMissingDescriptionText(rawDescription);

  const role = getMarkerValues(markerSet, 'item_role')[0] || 'utility';
  const modifierKinds = getMarkerValues(markerSet, 'modifier_kind');
  const conditions = getMarkerValues(markerSet, 'condition');
  const typeHints = getMarkerValues(markerSet, 'type_hint');

  if (hasDescription) {
    const short = pickBestDescriptionSentence(rawDescription);
    return `Curadoria automatica de held item: ${ensureSentenceEnding(short)}`;
  }

  const parts = [`papel principal ${role}`];

  if (modifierKinds.length > 0) {
    parts.push(`modificador ${modifierKinds.join(', ')}`);
  }

  const semanticConditions = conditions.filter((value) => value !== 'always_active');
  if (semanticConditions.length > 0) {
    parts.push(`condicoes ${semanticConditions.join(', ')}`);
  }

  if (typeHints.length > 0) {
    parts.push(`interacao com tipos ${typeHints.join(', ')}`);
  }

  return `Curadoria automatica de held item: ${parts.join('; ')}.`;
}

function inferCombatModel(markerSet, confidence) {
  const model = new Set();

  model.add(modelTerm('source', 'auto_marker'));
  model.add(modelTerm('held_item_slot', true));

  const combatRelevance = getMarkerValues(markerSet, 'combat_relevance');
  model.add(modelTerm('combat_relevance', combatRelevance[0] || 'combat'));

  for (const markerName of [
    'usage_mode',
    'item_role',
    'trigger',
    'condition',
    'modifier_kind',
    'stat_target',
    'type_hint',
    'status_hint',
    'domain',
    'multiplier',
    'delta_percent',
    'reduction_percent',
    'chance_percent',
    'hp_gain_fraction',
    'hp_loss_fraction',
    'threshold_fraction'
  ]) {
    for (const value of getMarkerValues(markerSet, markerName)) {
      model.add(modelTerm(markerName, value));
    }
  }

  model.add(modelTerm('confidence', confidence));

  return [...model].sort((a, b) => a.localeCompare(b));
}

function buildAutoRows(markerMap, catalogMap) {
  const rows = [];

  const items = [...markerMap.keys()].sort((a, b) => a.localeCompare(b));
  for (const item of items) {
    const markers = markerMap.get(item);

    if (!hasHeldItemSlot(markers)) {
      continue;
    }

    const catalogRow = catalogMap.get(item);
    const category = inferCategory(markers);
    const trigger = inferTrigger(markers);
    const confidence = inferConfidence(markers, catalogRow);
    const combatModel = inferCombatModel(markers, confidence);
    const description = inferDescription(markers, catalogRow);

    rows.push({
      item,
      category,
      trigger,
      combatModel,
      description,
      confidence
    });
  }

  return rows;
}

function renderAutoData(rows) {
  const header = [
    ':- encoding(utf8).',
    '',
    ':- multifile held_item_effect/6.',
    '',
    '% Arquivo gerado automaticamente por tools/generate_held_item_data_auto.js',
    '% Fonte: db/generated/item_markers.pl + db/catalogs/items_catalog.pl (+ fallback opcional em db/references/item_description_fallbacks.json)',
    '% Curadoria automatica somente para itens com relation_hook=held_item_slot.',
    '% held_item_effect(Item, Category, Trigger, CombatModel, Description, Confidence).',
    ''
  ].join('\n');

  const body = rows
    .sort((a, b) => a.item.localeCompare(b.item))
    .map((row) => {
      const modelText = row.combatModel.join(', ');
      return `held_item_effect(${row.item}, ${row.category}, ${row.trigger}, [${modelText}], ${prologQuotedText(row.description)}, ${row.confidence}).`;
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
  const catalogMapRaw = parseCatalog(catalogContent);
  const fallbackMap = loadFallbackDescriptions(FALLBACK_DESCRIPTIONS_PATH);
  const { catalogMap, fallbackAppliedCount } = applyFallbackToCatalog(catalogMapRaw, fallbackMap);

  const autoRows = buildAutoRows(markerMap, catalogMap);
  const output = renderAutoData(autoRows);
  fs.writeFileSync(OUTPUT_PATH, output, 'utf8');

  console.log(`[auto-held-item] itens no catalogo: ${catalogMap.size}`);
  console.log(`[auto-held-item] fallbacks carregados: ${fallbackMap.size}`);
  console.log(`[auto-held-item] descricoes substituidas por fallback: ${fallbackAppliedCount}`);
  console.log(`[auto-held-item] held itens curados: ${autoRows.length}`);
  console.log(`[auto-held-item] arquivo gerado: ${OUTPUT_PATH}`);
}

try {
  main();
} catch (err) {
  console.error(`[auto-held-item] erro: ${err.message}`);
  process.exitCode = 1;
}
