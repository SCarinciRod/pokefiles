const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const INPUT_PATH = path.join(ROOT, 'db', 'catalogs', 'abilities_catalog.pl');
const OUTPUT_PATH = path.join(ROOT, 'db', 'generated', 'ability_markers.pl');

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
  { stat: 'attack', regex: /\battack\b(?!\s*bonus\b)|\batk\b/i },
  { stat: 'special_attack', regex: /special attack|sp\.?\s*atk/i },
  { stat: 'defense', regex: /\bdefense\b(?!\s*curl\b)|\bdef\b/i },
  { stat: 'special_defense', regex: /special defense|sp\.?\s*def/i },
  { stat: 'speed', regex: /\bspeed\b/i },
  { stat: 'accuracy', regex: /\baccuracy\b/i },
  { stat: 'evasion', regex: /\bevasion\b|evasiveness/i }
];

function sanitizeAtom(value) {
  return String(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '') || 'unknown';
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

  throw new Error('Unterminated quoted string while parsing ability_entry line.');
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
    throw new Error('Expected comma while parsing ability_entry line.');
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

function parseAbilitiesCatalog(content) {
  const lines = content.split(/\r?\n/);
  const parsed = [];
  for (const line of lines) {
    const row = parseAbilityEntryLine(line);
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

function collectChancePercents(text) {
  const values = [];
  const chancePattern = /([0-9]+(?:\.[0-9]+)?)\s*%/gi;
  let match = chancePattern.exec(text);
  while (match) {
    values.push(Number(match[1]));
    match = chancePattern.exec(text);
  }

  return Array.from(new Set(values.map((v) => numberToStable(v)))).filter((v) => v !== null);
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

  const thresholdPattern = /(below|half|full hp|at full|at or below|less than|threshold)[^.\n;:]*?([0-9]+\s*\/\s*[0-9]+)/gi;
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

function splitCombatAndOverworldTexts(fullText) {
  const index = fullText.search(/\boverworld\s*:/i);
  if (index < 0) {
    return {
      combatText: fullText,
      overworldText: ''
    };
  }

  return {
    combatText: fullText.slice(0, index),
    overworldText: fullText.slice(index)
  };
}

function extractStatTargets(text) {
  const targets = [];
  for (const pattern of STAT_PATTERNS) {
    if (pattern.regex.test(text)) {
      targets.push(pattern.stat);
    }
  }
  return Array.from(new Set(targets));
}

function applyMinimumSemanticMarkers(markerMap) {
  if (!markerMap.has('class')) {
    addMarker(markerMap, 'class', 'utility');
  }

  if (!markerMap.has('empower')) {
    addMarker(markerMap, 'empower', 'state');
  }

  if (!markerMap.has('trigger')) {
    addMarker(markerMap, 'trigger', 'passive');
  }

  if (!markerMap.has('condition')) {
    addMarker(markerMap, 'condition', 'always_active');
  }
}

function annotateModifierKinds(markerMap) {
  const empowerValues = markerMap.get('empower') || new Set();
  const conditionValues = markerMap.get('condition') || new Set();
  const hasMultiplierSignal =
    markerMap.has('multiplier') ||
    markerMap.has('delta_percent') ||
    markerMap.has('reduction_percent');

  if (empowerValues.has('move')) {
    addMarker(markerMap, 'modifier_kind', 'move_power_modifier');
  }

  if (!empowerValues.has('move') && hasMultiplierSignal && !markerMap.has('stat_target')) {
    addMarker(markerMap, 'modifier_kind', 'move_power_modifier');
  }

  if (empowerValues.has('stat')) {
    if (conditionValues.has('stat_stage_change') || conditionValues.has('stat_directional_change')) {
      addMarker(markerMap, 'modifier_kind', 'stat_stage_modifier');
    }
    if (hasMultiplierSignal) {
      addMarker(markerMap, 'modifier_kind', 'stat_scalar_modifier');
    }
    if (!conditionValues.has('stat_stage_change') && !conditionValues.has('stat_directional_change') && !hasMultiplierSignal) {
      addMarker(markerMap, 'modifier_kind', 'stat_stage_modifier');
    }
  }
}

function inferMarkers(entry) {
  const markerMap = new Map();
  const mergedText = `${entry.shortEffect} ${entry.effect}`.toLowerCase();
  const { combatText, overworldText } = splitCombatAndOverworldTexts(mergedText);

  addMarker(markerMap, 'source', 'catalog_heuristic');
  addMarker(markerMap, 'generation', entry.generation);
  if (!entry.isMainSeries) {
    addMarker(markerMap, 'tag', 'non_main_series');
  }

  if (combatText.trim()) {
    addMarker(markerMap, 'impact_scope', 'combat');
  }
  if (overworldText.trim()) {
    addMarker(markerMap, 'impact_scope', 'overworld');
  }

  if (/sem descricao|sem descricao/.test(mergedText)) {
    addMarker(markerMap, 'tag', 'missing_description');
    if (!combatText.trim() && overworldText.trim()) {
      addMarker(markerMap, 'combat_relevance', 'non_combat');
    } else {
      addMarker(markerMap, 'combat_relevance', 'combat');
    }

    applyMinimumSemanticMarkers(markerMap);
    return markerMap;
  }

  const hasStabContext =
    /(same[- ]type attack bonus|\bstab\b|moves? whose types match (its|their) own|types match (its|their) own)/.test(combatText);

  const hasMoveEmpower =
    /(strengthens?.*moves?|powers? up .* moves?|moves?[^.\n;:]*?(power|damage|base power)|increases the power of .* moves?)/.test(combatText) ||
    /(normal-type moves|water-type moves|fire-type moves|electric-type moves|dragon-type moves|rock-type moves|steel-type moves|fairy-type moves)/.test(combatText) ||
    hasStabContext;

  const statTokenRegex = /(attack(?!\s*bonus\b)|special attack(?!\s*bonus\b)|sp\.?\s*atk(?!\s*bonus\b)|defense(?!\s*curl\b)|special defense|sp\.?\s*def|speed|accuracy|evasiveness|evasion)/;
  const hasStatKeyword =
    statTokenRegex.test(combatText);
  const hasStageLanguage =
    /\b(one|two|three|four|five|six|1|2|3|4|5|6)\s+stages?\b|\bstage\b|\bstages\b|\bsharply\b|\bdrastically\b|\bharshly\b|\bseverely\b/.test(combatText);
  const hasStageVerb =
    /(raise|raises|boost|boosts|increase|increases|lower|lowers|decrease|decreases|drop|drops|rose|rises|fell)/.test(combatText);
  const hasStatStageEmpower = hasStatKeyword && hasStageLanguage && hasStageVerb;
  const hasDirectionalStatChange =
    /(raise|raises|boost|boosts|increase|increases|lower|lowers|decrease|decreases|drop|drops|rose|rises|fell|falls)[^.\n;:]{0,90}(attack(?!\s*bonus\b)|special attack(?!\s*bonus\b)|sp\.?\s*atk(?!\s*bonus\b)|defense(?!\s*curl\b)|special defense|sp\.?\s*def|speed|accuracy|evasiveness|evasion)/.test(combatText) ||
    /(attack(?!\s*bonus\b)|special attack(?!\s*bonus\b)|sp\.?\s*atk(?!\s*bonus\b)|defense(?!\s*curl\b)|special defense|sp\.?\s*def|speed|accuracy|evasiveness|evasion)[^.\n;:]{0,90}(raise|raises|boost|boosts|increase|increases|lower|lowers|decrease|decreases|drop|drops|rose|rises|fell|falls)/.test(combatText);

  const hasExplicitStatMultiplierContext =
    /(attack(?!\s*bonus\b)|special attack(?!\s*bonus\b)|sp\.?\s*atk(?!\s*bonus\b)|defense(?!\s*curl\b)|special defense|sp\.?\s*def|speed|accuracy|evasiveness|evasion)[^.\n;:]{0,80}(is|are|becomes|become|has|have|at)[^.\n;:]{0,40}(double|doubles|doubled|half|halved|halve|halves|[0-9]+(?:\.[0-9]+)?\s*[x×])/.test(combatText) ||
    /(double|doubles|doubled|halve|halves|halved)[^.\n;:]{0,80}(attack(?!\s*bonus\b)|special attack(?!\s*bonus\b)|sp\.?\s*atk(?!\s*bonus\b)|defense(?!\s*curl\b)|special defense|sp\.?\s*def|speed|accuracy|evasiveness|evasion)/.test(combatText);

  const hasStatEmpower =
    hasDirectionalStatChange || hasExplicitStatMultiplierContext;

  if (hasMoveEmpower || hasStatEmpower || /(increase|increases|raises|boost|boosts|strengthens|double|doubles)/.test(combatText)) {
    addMarker(markerMap, 'class', 'empower');
  }

  if (hasMoveEmpower) {
    addMarker(markerMap, 'empower', 'move');
  }

  let skipGenericMultiplierScan = false;
  if (hasStabContext) {
    addMarker(markerMap, 'condition', 'stab_moves');
    skipGenericMultiplierScan = true;

    const stabChangeMatch = combatText.match(
      /same[- ]type attack bonus[^.\n;:]*?from\s*([0-9]+(?:\.[0-9]+)?)\s*[x×]\s*to\s*([0-9]+(?:\.[0-9]+)?)/i
    );
    if (stabChangeMatch) {
      const fromBonus = Number(stabChangeMatch[1]);
      const toBonus = Number(stabChangeMatch[2]);
      if (fromBonus > 0 && toBonus > 0) {
        const relativeMultiplier = numberToStable(toBonus / fromBonus);
        if (relativeMultiplier && relativeMultiplier > 0) {
          addMarker(markerMap, 'multiplier', relativeMultiplier);
          if (relativeMultiplier > 1) {
            addMarker(markerMap, 'delta_percent', numberToStable((relativeMultiplier - 1) * 100));
          }
          if (relativeMultiplier < 1) {
            addMarker(markerMap, 'reduction_percent', numberToStable((1 - relativeMultiplier) * 100));
          }
        }
      }
    }
  }

  if (hasStatEmpower) {
    addMarker(markerMap, 'empower', 'stat');
    if (hasDirectionalStatChange) {
      addMarker(markerMap, 'condition', 'stat_directional_change');
    }
    if (hasStatStageEmpower) {
      addMarker(markerMap, 'condition', 'stat_stage_change');
    }
    const statTargets = extractStatTargets(combatText);
    for (const statTarget of statTargets) {
      addMarker(markerMap, 'stat_target', statTarget);
    }
  }

  if (/(lower|lowers|decrease|decreases|reduce|reduces|halve|halves)/.test(combatText)) {
    addMarker(markerMap, 'class', 'mitigation_or_debuff');
  }

  if (/(immune|immunity|cannot be|does not take damage|takes no damage|absorbs)/.test(combatText)) {
    addMarker(markerMap, 'class', 'immunity_control');
  }

  if (/(heal|heals|restore|restores|regains|recover|recovers)/.test(combatText)) {
    addMarker(markerMap, 'class', 'sustain');
  }

  if (/(status|burn|poison|paraly|sleep|confus|flinch)/.test(combatText)) {
    addMarker(markerMap, 'domain', 'status');
  }

  if (/(weather|rain|sunlight|sandstorm|hail|snow)/.test(combatText)) {
    addMarker(markerMap, 'domain', 'weather');
  }

  if (/\brain\b/.test(combatText)) {
    addMarker(markerMap, 'condition', 'weather_rain');
  }

  if (/sunlight|\bsun\b/.test(combatText)) {
    addMarker(markerMap, 'condition', 'weather_sun');
  }

  if (/(terrain|electric terrain|grassy terrain|misty terrain|psychic terrain)/.test(combatText)) {
    addMarker(markerMap, 'domain', 'terrain');
  }

  if (/(switch|switches out|enters battle|upon entering battle)/.test(combatText)) {
    addMarker(markerMap, 'domain', 'switching');
  }

  if (/(priority)/.test(combatText)) {
    addMarker(markerMap, 'domain', 'priority');
  }

  if (/(cannot flee|cannot switch out|prevents opponents from fleeing|trap)/.test(combatText)) {
    addMarker(markerMap, 'domain', 'trap');
  }

  if (/(upon entering battle|enters battle|when .* enters battle)/.test(combatText)) {
    addMarker(markerMap, 'trigger', 'on_switch_in');
  }

  if (/(after each turn|end of each turn)/.test(combatText)) {
    addMarker(markerMap, 'trigger', 'end_turn');
  }

  if (/(when hit|whenever .* hits|whenever .* takes damage|when this pokemon is hit)/.test(combatText)) {
    addMarker(markerMap, 'trigger', 'on_hit');
  }

  if (/(on contact|makes contact|contact move)/.test(combatText)) {
    addMarker(markerMap, 'trigger', 'on_contact');
    addMarker(markerMap, 'condition', 'contact');
  }

  if (/(below half|drops below half|at or below half|less than half|half hp|50% hp|hp[^.\n;:]{0,20}50%|1\/3|full hp|low hp)/.test(combatText)) {
    addMarker(markerMap, 'condition', 'hp_threshold');
  }

  if (/(punch-based|punch)/.test(combatText)) {
    addMarker(markerMap, 'condition', 'punch_moves');
  }

  if (/(kick-based|kick moves?|kicking moves?)/.test(combatText)) {
    addMarker(markerMap, 'condition', 'kick_moves');
  }

  if (/(sound[- ]based|sound moves?|sound move|voice[- ]based|sonic)/.test(combatText)) {
    addMarker(markerMap, 'condition', 'sound_moves');
    addMarker(markerMap, 'domain', 'sound');
  }

  if (/(pulse moves?|pulse move|aura and pulse)/.test(combatText)) {
    addMarker(markerMap, 'condition', 'pulse_moves');
  }

  if (/(biting moves?|biting move|bite moves?|bite move|jaw[- ]based|jaw moves?)/.test(combatText)) {
    addMarker(markerMap, 'condition', 'biting_moves');
    addMarker(markerMap, 'condition', 'bite_moves');
  }

  if (/(slicing moves?|slicing move|slice moves?|slice move|slashing moves?|cutting moves?|blade moves?|cleaving moves?)/.test(combatText)) {
    addMarker(markerMap, 'condition', 'slicing_moves');
    addMarker(markerMap, 'condition', 'slice_moves');
  }

  if (/(berry|berries)/.test(combatText)) {
    addMarker(markerMap, 'condition', 'berry_related');
  }

  if (/(critical hit|critical)/.test(combatText)) {
    addMarker(markerMap, 'condition', 'critical_hit');
  }

  if (/(for each .* (defeated|fainted)|allies in its party that have already been defeated)/.test(combatText)) {
    addMarker(markerMap, 'condition', 'fainted_allies');
  }

  if (/(electric-type|electric moves|electric move)/.test(combatText)) {
    addMarker(markerMap, 'condition', 'electric_interaction');
  }

  if (/(water-type|water moves|water move)/.test(combatText)) {
    addMarker(markerMap, 'condition', 'water_interaction');
  }

  if (!skipGenericMultiplierScan) {
    const multipliers = collectMultipliers(combatText);
    for (const multiplier of multipliers) {
      addMarker(markerMap, 'multiplier', multiplier);
      if (multiplier > 1) {
        addMarker(markerMap, 'delta_percent', numberToStable((multiplier - 1) * 100));
      }
      if (multiplier < 1) {
        addMarker(markerMap, 'reduction_percent', numberToStable((1 - multiplier) * 100));
      }
    }
  }

  const chances = collectChancePercents(combatText);
  for (const chancePercent of chances) {
    addMarker(markerMap, 'chance_percent', chancePercent);
  }

  const fractionByContext = collectFractionsByContext(combatText);
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

  for (const typeToken of TYPE_TOKENS) {
    if (new RegExp(`${typeToken}-type`, 'i').test(combatText)) {
      addMarker(markerMap, 'type_hint', typeToken);
    }
  }

  const hasCombatEvidence =
    markerMap.has('class') ||
    markerMap.has('domain') ||
    markerMap.has('trigger') ||
    markerMap.has('multiplier') ||
    markerMap.has('delta_percent') ||
    markerMap.has('reduction_percent') ||
    markerMap.has('chance_percent') ||
    markerMap.has('hp_gain_fraction') ||
    markerMap.has('hp_loss_fraction') ||
    markerMap.has('stat_target');

  const impactScopes = markerMap.get('impact_scope');
  const hasCombatScope = impactScopes ? impactScopes.has('combat') : false;
  const hasOverworldScope = impactScopes ? impactScopes.has('overworld') : false;
  const explicitNonCombatOnly =
    /outside of battle only|only outside battle|in the overworld only|overworld only/.test(mergedText) ||
    (/only affects encounter rate/.test(mergedText) && !hasCombatEvidence);

  if (hasOverworldScope && !hasCombatScope && !hasCombatEvidence && explicitNonCombatOnly) {
    addMarker(markerMap, 'combat_relevance', 'non_combat');
  } else if (hasOverworldScope && (hasCombatScope || hasCombatEvidence)) {
    addMarker(markerMap, 'combat_relevance', 'mixed');
  } else if (hasOverworldScope && !hasCombatScope && !hasCombatEvidence) {
    addMarker(markerMap, 'combat_relevance', 'mixed');
  } else {
    addMarker(markerMap, 'combat_relevance', 'combat');
  }

  annotateModifierKinds(markerMap);
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

function renderMarkers(rows) {
  const header = [
    ':- encoding(utf8).',
    '',
    '% Arquivo gerado automaticamente por tools/generate_ability_markers.js',
    '% Origem: db/catalogs/abilities_catalog.pl',
    '% ability_marker(Ability, Marker, Value).',
    ''
  ].join('\n');

  const facts = [];
  const sortedRows = [...rows].sort((a, b) => a.ability.localeCompare(b.ability));

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
        facts.push(`ability_marker(${row.ability}, ${marker}, ${formatPrologValue(parsedValue)}).`);
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
  const abilities = parseAbilitiesCatalog(content);

  if (abilities.length === 0) {
    throw new Error('Nenhuma ability_entry foi encontrada para gerar marcadores.');
  }

  const output = renderMarkers(abilities);
  fs.writeFileSync(OUTPUT_PATH, output, 'utf8');

  console.log(`[markers] abilities processadas: ${abilities.length}`);
  console.log(`[markers] arquivo gerado: ${OUTPUT_PATH}`);
}

try {
  main();
} catch (err) {
  console.error(`[markers] erro: ${err.message}`);
  process.exitCode = 1;
}
