const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const INPUT_PATH = path.join(ROOT, 'db', 'catalogs', 'items_catalog.pl');
const FALLBACK_DESCRIPTIONS_PATH = path.join(ROOT, 'db', 'references', 'item_description_fallbacks.json');
const OUTPUT_PATH = path.join(ROOT, 'db', 'generated', 'item_markers.pl');

const TYPE_TOKENS = [
  'normal',
  'fire',
  'water',
  'electric',
  'grass',
  'ice',
  'fighting',
  'poison',
  'ground',
  'flying',
  'psychic',
  'bug',
  'rock',
  'ghost',
  'dragon',
  'dark',
  'steel',
  'fairy'
];

const STAT_PATTERNS = [
  { stat: 'special_attack', regex: /special attack|sp\.?\s*atk/i },
  { stat: 'special_defense', regex: /special defense|sp\.?\s*def/i },
  { stat: 'speed', regex: /\bspeed\b/i },
  { stat: 'accuracy', regex: /\baccuracy\b/i },
  { stat: 'evasion', regex: /\bevasion\b|evasiveness/i }
];

const STATUS_PATTERNS = [
  { status: 'burn', regex: /\bburn(?:ed)?\b/ },
  { status: 'poison', regex: /\bpoison(?:ed)?\b/ },
  { status: 'sleep', regex: /\bsleep|asleep\b/ },
  { status: 'paralysis', regex: /\bparaly(?:zed|sis)?\b/ },
  { status: 'freeze', regex: /\bfrozen?|freeze\b/ },
  { status: 'confusion', regex: /\bconfus(?:ed|ion)?\b/ }
];

const HELD_CATEGORY_HINTS = new Set([
  'held_items',
  'choice',
  'type_enhancement',
  'type_protection',
  'in_a_pinch',
  'picky_healing',
  'jewels',
  'memories',
  'plates',
  'scarves',
  'mega_stones',
  'z_crystals',
  'species_specific'
]);

const CONSUMABLE_CATEGORY_HINTS = new Set([
  'status_cures',
  'healing',
  'medicine',
  'vitamins',
  'in_a_pinch',
  'picky_healing',
  'type_protection',
  'jewels',
  'mulch',
  'special_balls'
]);

const COMBAT_CATEGORY_HINTS = new Set([
  'held_items',
  'choice',
  'type_enhancement',
  'type_protection',
  'in_a_pinch',
  'picky_healing',
  'jewels',
  'memories',
  'plates',
  'mega_stones',
  'z_crystals',
  'species_specific',
  'status_cures',
  'healing',
  'medicine'
]);

const NON_COMBAT_CATEGORY_HINTS = new Set([
  'all_mail',
  'apricorn_box',
  'baking_only',
  'collectibles',
  'curry_ingredients',
  'dex_completion',
  'event_items',
  'gameplay',
  'loot',
  'nature_mints',
  'picnic',
  'plot_advancement',
  'sandwich_ingredients',
  'species_candies',
  'tera_shard',
  'tm_materials',
  'unused',
  'vitamins',
  'evolution'
]);

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

function applyFallbackDescriptions(rows, fallbackMap) {
  let fallbackAppliedCount = 0;

  const resolvedRows = rows.map((row) => {
    const originalDescription = String(row.description || '');

    if (!isMissingDescriptionText(originalDescription)) {
      return {
        ...row,
        originalDescription,
        fallbackDescriptionApplied: false
      };
    }

    const fallbackDescription = fallbackMap.get(row.item);
    if (fallbackDescription) {
      fallbackAppliedCount += 1;
      return {
        ...row,
        description: fallbackDescription,
        originalDescription,
        fallbackDescriptionApplied: true
      };
    }

    return {
      ...row,
      originalDescription,
      fallbackDescriptionApplied: false
    };
  });

  return {
    rows: resolvedRows,
    fallbackAppliedCount
  };
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

  throw new Error('Unterminated quoted string while parsing item_entry line.');
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
    throw new Error('Expected comma while parsing item_entry line.');
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
  const costParsed = Number.parseInt(costToken.value, 10);
  const cost = Number.isFinite(costParsed) ? costParsed : 0;

  idx = skipWhitespace(body, costToken.nextIndex);
  const flingPowerToken = parseUntilComma(body, idx);
  const flingPowerParsed = Number.parseInt(flingPowerToken.value, 10);
  const flingPower = Number.isFinite(flingPowerParsed) ? flingPowerParsed : 0;

  idx = skipWhitespace(body, flingPowerToken.nextIndex);
  const flingEffectToken = parseUntilComma(body, idx);
  const flingEffect = sanitizeAtom(flingEffectToken.value);

  idx = skipWhitespace(body, flingEffectToken.nextIndex);
  const descriptionParsed = parsePrologQuoted(body, idx);

  return {
    item,
    category,
    cost,
    flingPower,
    flingEffect,
    description: descriptionParsed.value
  };
}

function parseItemsCatalog(content) {
  const lines = content.split(/\r?\n/);
  const parsed = [];
  for (const line of lines) {
    const row = parseItemEntryLine(line);
    if (row) {
      parsed.push(row);
    }
  }
  return parsed;
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

function collectMultipliers(text) {
  const values = [];
  const multiplierPattern = /([0-9]+(?:\.[0-9]+)?)\s*[x×]/gi;
  let match = multiplierPattern.exec(text);
  while (match) {
    values.push(Number(match[1]));
    match = multiplierPattern.exec(text);
  }

  const doubledEffectPattern =
    /\b(double|doubles|doubled)\b[^.\n;:]{0,40}\b(power|damage|attack|special attack|defense|special defense|speed|accuracy|evasion|hp|recovery|healing)\b|\b(power|damage|attack|special attack|defense|special defense|speed|accuracy|evasion|hp|recovery|healing)\b[^.\n;:]{0,40}\b(double|doubles|doubled)\b/gi;
  if (doubledEffectPattern.test(text)) {
    values.push(2.0);
  }

  const halvedEffectPattern =
    /\b(half|halve|halves|halved)\b[^.\n;:]{0,40}\b(power|damage|attack|special attack|defense|special defense|speed|accuracy|evasion|hp|recovery|healing)\b|\b(power|damage|attack|special attack|defense|special defense|speed|accuracy|evasion|hp|recovery|healing)\b[^.\n;:]{0,40}\b(half|halve|halves|halved)\b/gi;
  if (halvedEffectPattern.test(text)) {
    values.push(0.5);
  }

  return Array.from(new Set(values.map((v) => numberToStable(v)))).filter((v) => v !== null);
}

function collectPercentsByContext(text) {
  const delta = new Set();
  const reduction = new Set();
  const chance = new Set();
  const generic = new Set();
  const chancePattern = /([0-9]+(?:\.[0-9]+)?)\s*%/gi;
  let match = chancePattern.exec(text);
  while (match) {
    const value = numberToStable(Number(match[1]));
    if (value === null) {
      match = chancePattern.exec(text);
      continue;
    }

    const contextStart = Math.max(0, match.index - 50);
    const contextEnd = Math.min(text.length, match.index + match[0].length + 50);
    const context = text.slice(contextStart, contextEnd);

    if (/chance|likely|probability|odds|critical hit chance/.test(context)) {
      chance.add(value);
    } else if (/halve|half|reduce|reduces|reduced|less damage|take[s]?[^.\n;:]{0,20}less|lower/.test(context)) {
      reduction.add(value);
    } else if (/boost|increase|increases|more damage|raises|power|recover|heals|restore/.test(context)) {
      delta.add(value);
    } else {
      generic.add(value);
    }

    match = chancePattern.exec(text);
  }

  return {
    delta: [...delta],
    reduction: [...reduction],
    chance: [...chance],
    generic: [...generic]
  };
}

function collectFractions(text) {
  const values = [];
  const fractionPattern = /([0-9]+)\s*\/\s*([0-9]+)/g;
  let match = fractionPattern.exec(text);
  while (match) {
    const numerator = Number(match[1]);
    const denominator = Number(match[2]);
    if (denominator > 0) {
      values.push(numberToStable(numerator / denominator));
    }
    match = fractionPattern.exec(text);
  }

  return Array.from(new Set(values)).filter((v) => v !== null);
}

function collectFractionsByContext(text) {
  const gain = new Set();
  const loss = new Set();
  const threshold = new Set();

  const gainPattern = /(heal|heals|restore|restores|regain|regains|recover|recovers)[^.\n;:]*?([0-9]+\s*\/\s*[0-9]+)/gi;
  let match = gainPattern.exec(text);
  while (match) {
    const fraction = collectFractions(match[2]);
    for (const value of fraction) {
      gain.add(value);
    }
    match = gainPattern.exec(text);
  }

  const lossPattern = /(lose|loses|damage|damages|takes|take|hp loss)[^.\n;:]*?([0-9]+\s*\/\s*[0-9]+)/gi;
  match = lossPattern.exec(text);
  while (match) {
    const fraction = collectFractions(match[2]);
    for (const value of fraction) {
      loss.add(value);
    }
    match = lossPattern.exec(text);
  }

  const thresholdPattern = /(below|half|full hp|at full|at or below|less than|threshold|consumed at)[^.\n;:]*?([0-9]+\s*\/\s*[0-9]+)/gi;
  match = thresholdPattern.exec(text);
  while (match) {
    const fraction = collectFractions(match[2]);
    for (const value of fraction) {
      threshold.add(value);
    }
    match = thresholdPattern.exec(text);
  }

  const all = collectFractions(text);
  const contextual = new Set([...gain, ...loss, ...threshold]);
  const generic = all.filter((v) => !contextual.has(v));

  return {
    gain: [...gain],
    loss: [...loss],
    threshold: [...threshold],
    generic
  };
}

function extractStatTargets(text) {
  const targets = [];

  const withoutSpecialAttack = text.replace(/special attack|sp\.?\s*atk/gi, ' ');
  const withoutSpecialDefense = text.replace(/special defense|sp\.?\s*def/gi, ' ');

  if (/\battack\b(?!\s*bonus\b)/i.test(withoutSpecialAttack)) {
    targets.push('attack');
  }

  if (/\bdefense\b(?!\s*curl\b)/i.test(withoutSpecialDefense)) {
    targets.push('defense');
  }

  for (const pattern of STAT_PATTERNS) {
    if (pattern.regex.test(text)) {
      targets.push(pattern.stat);
    }
  }
  return Array.from(new Set(targets));
}

function addTypeHints(markerMap, text) {
  for (const typeToken of TYPE_TOKENS) {
    const typePattern = new RegExp(`\\b${typeToken}-type\\b|\\b${typeToken}\\s+moves?\\b`, 'i');
    if (typePattern.test(text)) {
      addMarker(markerMap, 'type_hint', typeToken);
    }
  }
}

function addStatusHints(markerMap, text) {
  for (const statusPattern of STATUS_PATTERNS) {
    if (statusPattern.regex.test(text)) {
      addMarker(markerMap, 'status_hint', statusPattern.status);
    }
  }
}

function inferCostBand(cost) {
  if (!Number.isFinite(cost) || cost <= 0) {
    return 'no_shop_cost';
  }
  if (cost <= 500) {
    return 'low_cost';
  }
  if (cost <= 5000) {
    return 'mid_cost';
  }
  return 'high_cost';
}

function addRelationHooks(markerMap) {
  const conditions = markerMap.get('condition') || new Set();
  const roles = markerMap.get('item_role') || new Set();
  const types = markerMap.get('type_hint') || new Set();
  const statuses = markerMap.get('status_hint') || new Set();
  const modifierKinds = markerMap.get('modifier_kind') || new Set();

  if (markerMap.has('hold_required')) {
    addMarker(markerMap, 'relation_hook', 'held_item_slot');
  }

  if (markerMap.has('consumable')) {
    addMarker(markerMap, 'relation_hook', 'consumable_timing');
  }

  if (conditions.has('hp_threshold')) {
    addMarker(markerMap, 'relation_hook', 'low_hp_window');
  }
  if (conditions.has('contact')) {
    addMarker(markerMap, 'relation_hook', 'contact_window');
  }
  if (conditions.has('super_effective_hit')) {
    addMarker(markerMap, 'relation_hook', 'anti_super_effective');
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

  for (const role of roles) {
    addMarker(markerMap, 'relation_hook', `lane_${role}`);
  }

  for (const modifierKind of modifierKinds) {
    addMarker(markerMap, 'relation_hook', `modifier_${modifierKind}`);
  }

  for (const typeHint of types) {
    addMarker(markerMap, 'relation_hook', `type_${typeHint}`);
  }

  for (const statusHint of statuses) {
    addMarker(markerMap, 'relation_hook', `status_${statusHint}`);
  }
}

function applyMinimumSemanticMarkers(markerMap) {
  if (!markerMap.has('usage_mode')) {
    addMarker(markerMap, 'usage_mode', 'inventory');
  }

  if (!markerMap.has('item_role')) {
    addMarker(markerMap, 'item_role', 'utility');
  }

  if (!markerMap.has('trigger')) {
    addMarker(markerMap, 'trigger', 'passive');
  }

  if (!markerMap.has('condition')) {
    addMarker(markerMap, 'condition', 'always_active');
  }

  if (!markerMap.has('empower')) {
    addMarker(markerMap, 'empower', 'state');
  }
}

function inferMarkers(entry) {
  const markerMap = new Map();
  const text = normalizeSearchText(entry.description);

  addMarker(markerMap, 'source', 'catalog_heuristic');
  addMarker(markerMap, 'category', entry.category);
  addMarker(markerMap, 'fling_effect', entry.flingEffect);
  if (entry.flingPower > 0) {
    addMarker(markerMap, 'fling_power', entry.flingPower);
  }
  addMarker(markerMap, 'cost_band', inferCostBand(entry.cost));

  if (entry.fallbackDescriptionApplied === true) {
    addMarker(markerMap, 'description_source', 'fallback_reference');
  }

  const hasMissingDescription = isMissingDescriptionText(text);
  if (hasMissingDescription) {
    addMarker(markerMap, 'tag', 'missing_description');
  }

  const hasHeldSignal =
    HELD_CATEGORY_HINTS.has(entry.category) ||
    /(^|\b)held\s*:|\bholder\b|while held|held item/.test(text);

  const hasConsumableSignal =
    CONSUMABLE_CATEGORY_HINTS.has(entry.category) ||
    /consumed|consume|eaten|used up|one-time use|single-use/.test(text);

  if (hasHeldSignal) {
    addMarker(markerMap, 'usage_mode', 'held');
    addMarker(markerMap, 'hold_required', true);
  }

  if (hasConsumableSignal) {
    addMarker(markerMap, 'usage_mode', 'consumable');
    addMarker(markerMap, 'consumable', true);
  }

  const isCombatCategory = COMBAT_CATEGORY_HINTS.has(entry.category);
  const isNonCombatCategory = NON_COMBAT_CATEGORY_HINTS.has(entry.category);

  const hasBattleEvidence =
    /move|damage|attack(?!\s*bonus\b)|special attack|defense|special defense|speed|critical hit|hp|status ailment|burn|poison|paraly|sleep|freeze|confus|super-effective|turn|battle|holder|flinch|priority|switch out|accuracy|evasion|draining/.test(text) ||
    hasHeldSignal;

  const explicitNonCombatOnly =
    /allows access|contains basic gameplay|use for fast transit|sell to|can be traded|lets a trainer write|used to make|portable berry growing|holds berries|unreleased|summons|allows the player to ride|no effect/.test(text) ||
    /tries to catch a wild pokemon/.test(text);

  if (hasMissingDescription) {
    if (isCombatCategory && !isNonCombatCategory) {
      addMarker(markerMap, 'combat_relevance', 'combat');
    } else if (isCombatCategory && isNonCombatCategory) {
      addMarker(markerMap, 'combat_relevance', 'mixed');
    } else {
      addMarker(markerMap, 'combat_relevance', 'non_combat');
    }
  } else if (hasBattleEvidence && explicitNonCombatOnly) {
    addMarker(markerMap, 'combat_relevance', 'mixed');
  } else if (hasBattleEvidence || (isCombatCategory && !explicitNonCombatOnly)) {
    addMarker(markerMap, 'combat_relevance', 'combat');
  } else if (explicitNonCombatOnly || isNonCombatCategory) {
    addMarker(markerMap, 'combat_relevance', 'non_combat');
  } else {
    addMarker(markerMap, 'combat_relevance', 'mixed');
  }

  const hasMoveEmpower =
    /(move[^.\n;:]{0,80}(power|damage|stronger|more)|powers? up|boosts?[^.\n;:]{0,80}moves?|moves?[^.\n;:]{0,40}by\s*[0-9]+(?:\.[0-9]+)?\s*%|do\s*[0-9]+(?:\.[0-9]+)?\s*% more damage|base power|1\.5\s*[x×]\s*power)/.test(text);

  const hasStageLanguage =
    /\bone\s+stage\b|\btwo\s+stages\b|\bstage\b|\bstages\b|\bsharply\b|\bdrastically\b|\bharshly\b|\bseverely\b/.test(text);

  const hasDirectionalStatChange =
    /(raise|raises|boost|boosts|increase|increases|lower|lowers|decrease|decreases|drop|drops|rose|rises|fell|falls)[^.\n;:]{0,90}(attack(?!\s*bonus\b)|special attack(?!\s*bonus\b)|sp\.?\s*atk(?!\s*bonus\b)|defense(?!\s*curl\b)|special defense|sp\.?\s*def|speed|accuracy|evasiveness|evasion)/.test(text) ||
    /(attack(?!\s*bonus\b)|special attack(?!\s*bonus\b)|sp\.?\s*atk(?!\s*bonus\b)|defense(?!\s*curl\b)|special defense|sp\.?\s*def|speed|accuracy|evasiveness|evasion)[^.\n;:]{0,90}(raise|raises|boost|boosts|increase|increases|lower|lowers|decrease|decreases|drop|drops|rose|rises|fell|falls)/.test(text);

  const hasExplicitStatMultiplierContext =
    /(attack(?!\s*bonus\b)|special attack(?!\s*bonus\b)|sp\.?\s*atk(?!\s*bonus\b)|defense(?!\s*curl\b)|special defense|sp\.?\s*def|speed|accuracy|evasiveness|evasion)[^.\n;:]{0,80}(double|doubles|doubled|half|halved|halve|halves|[0-9]+(?:\.[0-9]+)?\s*[x×]|[0-9]+\s*%)/.test(text) ||
    /(double|doubles|doubled|halve|halves|halved)[^.\n;:]{0,80}(attack(?!\s*bonus\b)|special attack(?!\s*bonus\b)|sp\.?\s*atk(?!\s*bonus\b)|defense(?!\s*curl\b)|special defense|sp\.?\s*def|speed|accuracy|evasiveness|evasion)/.test(text);

  const hasDamageMitigation =
    /halve the damage|halves the damage|reduces damage|take[s]? no damage|immunit|prevents? .* damage/.test(text);

  const hasHealing =
    /heal|heals|restore|restores|recover|recovers|regain|regains|restores? [0-9]+ hp|hp each turn/.test(text);

  const hasStatusControl =
    /cures? (?:any|major)? status|status ailment|burn|poison|paraly|sleep|frozen|confus/.test(text);

  const hasFormControl =
    /mega evolve|z-move|changes? silvally|changes multi-attack|changes? .* form|techno blast/.test(text);

  if (hasMoveEmpower) {
    addMarker(markerMap, 'item_role', 'offense');
    addMarker(markerMap, 'modifier_kind', 'move_power_modifier');
    addMarker(markerMap, 'empower', 'move');
  }

  if (hasDirectionalStatChange && hasStageLanguage) {
    addMarker(markerMap, 'item_role', 'offense');
    addMarker(markerMap, 'modifier_kind', 'stat_stage_modifier');
    addMarker(markerMap, 'condition', 'stat_stage_change');
    addMarker(markerMap, 'empower', 'stat');
  }

  if (hasExplicitStatMultiplierContext) {
    addMarker(markerMap, 'modifier_kind', 'stat_scalar_modifier');
    addMarker(markerMap, 'empower', 'stat');
  }

  if (hasDamageMitigation) {
    addMarker(markerMap, 'item_role', 'defense');
    addMarker(markerMap, 'modifier_kind', 'damage_taken_modifier');
    addMarker(markerMap, 'empower', 'state');
  }

  if (hasHealing) {
    addMarker(markerMap, 'item_role', 'sustain');
    addMarker(markerMap, 'modifier_kind', 'hp_recovery_modifier');
    addMarker(markerMap, 'empower', 'state');
  }

  if (hasStatusControl) {
    addMarker(markerMap, 'item_role', 'status_control');
    addMarker(markerMap, 'modifier_kind', 'status_cure_modifier');
    addMarker(markerMap, 'domain', 'status');
    addMarker(markerMap, 'empower', 'state');
  }

  if (hasFormControl) {
    addMarker(markerMap, 'item_role', 'form_control');
    addMarker(markerMap, 'domain', 'form_change');
    addMarker(markerMap, 'empower', 'state');
  }

  if (/\bweather\b|\brain\b|\bsunlight\b|\bsun\b|\bsandstorm\b|\bhail\b|\bsnow\b/.test(text)) {
    addMarker(markerMap, 'domain', 'weather');
  }
  if (/\brain\b/.test(text)) {
    addMarker(markerMap, 'condition', 'weather_rain');
  }
  if (/sunlight|\bsun\b/.test(text)) {
    addMarker(markerMap, 'condition', 'weather_sun');
  }
  if (/sandstorm/.test(text)) {
    addMarker(markerMap, 'condition', 'weather_sand');
  }
  if (/hail|\bsnow\b/.test(text)) {
    addMarker(markerMap, 'condition', 'weather_snow');
  }

  if (/super-effective|super effective/.test(text)) {
    addMarker(markerMap, 'condition', 'super_effective_hit');
  }

  if (/on contact|contact move|makes contact/.test(text)) {
    addMarker(markerMap, 'condition', 'contact');
    addMarker(markerMap, 'trigger', 'on_contact');
  }

  if (/when hit|when .* takes damage|when it takes .* damage|when struck by|when affected by/.test(text)) {
    addMarker(markerMap, 'trigger', 'on_hit');
  }

  if (/after each turn|end of each turn|each turn/.test(text)) {
    addMarker(markerMap, 'trigger', 'end_turn');
  }

  if (/consumed at\s*1\/[24]\s*max hp|below half|at or below|drops below|low hp/.test(text)) {
    addMarker(markerMap, 'condition', 'hp_threshold');
    addMarker(markerMap, 'trigger', 'on_low_hp');
  }

  if (/when .* uses .* move|when the holder uses|upon using/.test(text)) {
    addMarker(markerMap, 'trigger', 'on_move_use');
  }

  if (/when (?:burned|poisoned|paralyzed|asleep|frozen)/.test(text)) {
    addMarker(markerMap, 'trigger', 'on_status');
  }

  const statTargets = extractStatTargets(text);
  for (const statTarget of statTargets) {
    addMarker(markerMap, 'stat_target', statTarget);
  }

  const multipliers = collectMultipliers(text);
  for (const multiplier of multipliers) {
    addMarker(markerMap, 'multiplier', multiplier);
    if (multiplier > 1) {
      addMarker(markerMap, 'delta_percent', numberToStable((multiplier - 1) * 100));
    }
    if (multiplier < 1) {
      addMarker(markerMap, 'reduction_percent', numberToStable((1 - multiplier) * 100));
    }
  }

  const percentByContext = collectPercentsByContext(text);
  for (const deltaPercent of percentByContext.delta) {
    addMarker(markerMap, 'delta_percent', deltaPercent);
  }
  for (const reductionPercent of percentByContext.reduction) {
    addMarker(markerMap, 'reduction_percent', reductionPercent);
  }
  for (const chancePercent of percentByContext.chance) {
    addMarker(markerMap, 'chance_percent', chancePercent);
  }
  for (const genericPercent of percentByContext.generic) {
    addMarker(markerMap, 'percent_value', genericPercent);
  }

  const fractionByContext = collectFractionsByContext(text);
  for (const fractionValue of fractionByContext.gain) {
    addMarker(markerMap, 'hp_gain_fraction', fractionValue);
  }
  for (const fractionValue of fractionByContext.loss) {
    addMarker(markerMap, 'hp_loss_fraction', fractionValue);
  }
  for (const fractionValue of fractionByContext.threshold) {
    addMarker(markerMap, 'threshold_fraction', fractionValue);
  }
  for (const fractionValue of fractionByContext.generic) {
    addMarker(markerMap, 'fraction_value', fractionValue);
  }

  addTypeHints(markerMap, text);
  addStatusHints(markerMap, text);

  if (markerMap.has('type_hint') && markerMap.has('modifier_kind')) {
    addMarker(markerMap, 'domain', 'type_interaction');
  }

  if (hasHeldSignal && !markerMap.has('trigger')) {
    addMarker(markerMap, 'trigger', 'passive');
  }

  if (!hasHeldSignal && hasConsumableSignal && !markerMap.has('trigger')) {
    addMarker(markerMap, 'trigger', 'on_use');
  }

  applyMinimumSemanticMarkers(markerMap);
  addRelationHooks(markerMap);

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

function renderMarkers(rows) {
  const header = [
    ':- encoding(utf8).',
    '',
    '% Arquivo gerado automaticamente por tools/generate_item_markers.js',
    '% Origem: db/catalogs/items_catalog.pl (+ fallback opcional em db/references/item_description_fallbacks.json)',
    '% item_marker(Item, Marker, Value).',
    ''
  ].join('\n');

  const facts = [];
  const sortedRows = [...rows].sort((a, b) => a.item.localeCompare(b.item));

  for (const row of sortedRows) {
    const markerMap = inferMarkers(row);
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
        facts.push(`item_marker(${row.item}, ${marker}, ${formatPrologValue(parsedValue)}).`);
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
  const parsedItems = parseItemsCatalog(content);
  const fallbackMap = loadFallbackDescriptions(FALLBACK_DESCRIPTIONS_PATH);
  const { rows: items, fallbackAppliedCount } = applyFallbackDescriptions(parsedItems, fallbackMap);

  if (items.length === 0) {
    throw new Error('Nenhum item_entry foi encontrado para gerar marcadores.');
  }

  const output = renderMarkers(items);
  fs.writeFileSync(OUTPUT_PATH, output, 'utf8');

  console.log(`[item-markers] itens processados: ${items.length}`);
  console.log(`[item-markers] fallbacks carregados: ${fallbackMap.size}`);
  console.log(`[item-markers] descricoes substituidas por fallback: ${fallbackAppliedCount}`);
  console.log(`[item-markers] arquivo gerado: ${OUTPUT_PATH}`);
}

try {
  main();
} catch (err) {
  console.error(`[item-markers] erro: ${err.message}`);
  process.exitCode = 1;
}
