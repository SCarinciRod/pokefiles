'use strict';
const path = require('path');

const { openDb, normalizeMarkerValue, parseStoredMarkerValue } = require('./sqlite_writer');

const TYPE_TOKENS = [
  'normal','fire','water','electric','grass','ice','fighting','poison',
  'ground','flying','psychic','bug','rock','ghost','dragon','dark','steel','fairy'
];

const STAT_PATTERNS = [
  { stat: 'attack', regex: /\battack\b(?!\s*bonus\b)|\batk\b/i },
  { stat: 'special_attack', regex: /special attack|sp\.?\s*atk/i },
  { stat: 'defense', regex: /\bdefense\b(?!\s*curl\b)|\bdef\b/i },
  { stat: 'special_defense', regex: /special defense|sp\.?\s*def/i },
  { stat: 'speed', regex: /\bspeed\b/i },
  { stat: 'accuracy', regex: /\baccuracy\b/i },
  { stat: 'evasion', regex: /\bevasion\b|evasiveness/i },
];

function sanitizeAtom(value) {
  return String(value).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'unknown';
}

function numberToStable(value) {
  if (!Number.isFinite(value)) return null;
  const rounded = Math.round(value * 1000) / 1000;
  return Number.isInteger(rounded) ? rounded : rounded;
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

function collectMultipliers(text) {
  const values = [];
  const mp = /([0-9]+(?:\.[0-9]+)?)\s*[x×]/gi;
  let m = mp.exec(text);
  while (m) { values.push(Number(m[1])); m = mp.exec(text); }
  if (/\b(double|doubles|doubled)\b[^.\n;:]{0,40}\b(power|damage|attack|special attack|defense|special defense|speed|accuracy|evasion|hp|recovery|healing)\b|\b(power|damage|attack|special attack|defense|special defense|speed|accuracy|evasion|hp|recovery|healing)\b[^.\n;:]{0,40}\b(double|doubles|doubled)\b/gi.test(text)) values.push(2.0);
  if (/\b(half|halve|halves|halved)\b[^.\n;:]{0,40}\b(power|damage|attack|special attack|defense|special defense|speed|accuracy|evasion|hp|recovery|healing)\b|\b(power|damage|attack|special attack|defense|special defense|speed|accuracy|evasion|hp|recovery|healing)\b[^.\n;:]{0,40}\b(half|halve|halves|halved)\b/gi.test(text)) values.push(0.5);
  return Array.from(new Set(values.map((v) => numberToStable(v)))).filter((v) => v !== null);
}

function collectChancePercents(text) {
  const values = [];
  const cp = /([0-9]+(?:\.[0-9]+)?)\s*%/gi;
  let m = cp.exec(text);
  while (m) { values.push(Number(m[1])); m = cp.exec(text); }
  return Array.from(new Set(values.map((v) => numberToStable(v)))).filter((v) => v !== null);
}

function collectFractions(text) {
  const values = [];
  const fp = /([0-9]+)\s*\/\s*([0-9]+)/g;
  let m = fp.exec(text);
  while (m) { const d = Number(m[2]); if (d > 0) values.push(numberToStable(Number(m[1]) / d)); m = fp.exec(text); }
  return Array.from(new Set(values)).filter((v) => v !== null);
}

function collectFractionsByContext(text) {
  const gain = new Set(); const loss = new Set(); const threshold = new Set();
  let m;
  const gp = /(heal|heals|restore|restores|regain|regains|recover|recovers)[^.\n;:]*?([0-9]+\s*\/\s*[0-9]+)/gi;
  m = gp.exec(text); while (m) { collectFractions(m[2]).forEach((v) => gain.add(v)); m = gp.exec(text); }
  const lp = /(lose|loses|damage|damages|takes|take|hp loss)[^.\n;:]*?([0-9]+\s*\/\s*[0-9]+)/gi;
  m = lp.exec(text); while (m) { collectFractions(m[2]).forEach((v) => loss.add(v)); m = lp.exec(text); }
  const tp = /(below|half|full hp|at full|at or below|less than|threshold)[^.\n;:]*?([0-9]+\s*\/\s*[0-9]+)/gi;
  m = tp.exec(text); while (m) { collectFractions(m[2]).forEach((v) => threshold.add(v)); m = tp.exec(text); }
  const all = collectFractions(text);
  const contextual = new Set([...gain, ...loss, ...threshold]);
  return { gain: [...gain], loss: [...loss], threshold: [...threshold], generic: all.filter((v) => !contextual.has(v)) };
}

function splitCombatAndOverworldTexts(fullText) {
  const index = fullText.search(/\boverworld\s*:/i);
  if (index < 0) return { combatText: fullText, overworldText: '' };
  return { combatText: fullText.slice(0, index), overworldText: fullText.slice(index) };
}

function extractStatTargets(text) {
  return Array.from(new Set(STAT_PATTERNS.filter((p) => p.regex.test(text)).map((p) => p.stat)));
}

function applyMinimumSemanticMarkers(markerMap) {
  if (!markerMap.has('class')) addMarker(markerMap, 'class', 'utility');
  if (!markerMap.has('empower')) addMarker(markerMap, 'empower', 'state');
  if (!markerMap.has('trigger')) addMarker(markerMap, 'trigger', 'passive');
  if (!markerMap.has('condition')) addMarker(markerMap, 'condition', 'always_active');
}

function annotateModifierKinds(markerMap) {
  const emp = markerMap.get('empower') || new Set();
  const cond = markerMap.get('condition') || new Set();
  const hasMultiplier = markerMap.has('multiplier') || markerMap.has('delta_percent') || markerMap.has('reduction_percent');
  if (emp.has('move')) addMarker(markerMap, 'modifier_kind', 'move_power_modifier');
  if (!emp.has('move') && hasMultiplier && !markerMap.has('stat_target')) addMarker(markerMap, 'modifier_kind', 'move_power_modifier');
  if (emp.has('stat')) {
    if (cond.has('stat_stage_change') || cond.has('stat_directional_change')) addMarker(markerMap, 'modifier_kind', 'stat_stage_modifier');
    if (hasMultiplier) addMarker(markerMap, 'modifier_kind', 'stat_scalar_modifier');
    if (!cond.has('stat_stage_change') && !cond.has('stat_directional_change') && !hasMultiplier) addMarker(markerMap, 'modifier_kind', 'stat_stage_modifier');
  }
}

function inferMarkers(entry) {
  const markerMap = new Map();
  const mergedText = `${entry.shortEffect} ${entry.effect}`.toLowerCase();
  const { combatText, overworldText } = splitCombatAndOverworldTexts(mergedText);

  if (combatText.trim()) addMarker(markerMap, 'impact_scope', 'combat');
  if (overworldText.trim()) addMarker(markerMap, 'impact_scope', 'overworld');

  if (/sem descricao|sem descricao/.test(mergedText)) {
    addMarker(markerMap, 'combat_relevance', (!combatText.trim() && overworldText.trim()) ? 'non_combat' : 'combat');
    applyMinimumSemanticMarkers(markerMap);
    return markerMap;
  }

  const hasStabContext = /(same[- ]type attack bonus|\bstab\b|moves? whose types match (its|their) own|types match (its|their) own)/.test(combatText);
  const hasMoveEmpower = /(strengthens?.*moves?|powers? up .* moves?|moves?[^.\n;:]*?(power|damage|base power)|increases the power of .* moves?)/.test(combatText) || /(normal-type moves|water-type moves|fire-type moves|electric-type moves|dragon-type moves|rock-type moves|steel-type moves|fairy-type moves)/.test(combatText) || hasStabContext;
  const hasStatKeyword = /(attack(?!\s*bonus\b)|special attack(?!\s*bonus\b)|sp\.?\s*atk(?!\s*bonus\b)|defense(?!\s*curl\b)|special defense|sp\.?\s*def|speed|accuracy|evasiveness|evasion)/.test(combatText);
  const hasStageLanguage = /\b(one|two|three|four|five|six|1|2|3|4|5|6)\s+stages?\b|\bstage\b|\bstages\b|\bsharply\b|\bdrastically\b|\bharshly\b|\bseverely\b/.test(combatText);
  const hasStageVerb = /(raise|raises|boost|boosts|increase|increases|lower|lowers|decrease|decreases|drop|drops|rose|rises|fell)/.test(combatText);
  const hasStatStageEmpower = hasStatKeyword && hasStageLanguage && hasStageVerb;
  const hasDirectionalStatChange = /(raise|raises|boost|boosts|increase|increases|lower|lowers|decrease|decreases|drop|drops|rose|rises|fell|falls)[^.\n;:]{0,90}(attack(?!\s*bonus\b)|special attack(?!\s*bonus\b)|sp\.?\s*atk(?!\s*bonus\b)|defense(?!\s*curl\b)|special defense|sp\.?\s*def|speed|accuracy|evasiveness|evasion)/.test(combatText) || /(attack(?!\s*bonus\b)|special attack(?!\s*bonus\b)|sp\.?\s*atk(?!\s*bonus\b)|defense(?!\s*curl\b)|special defense|sp\.?\s*def|speed|accuracy|evasiveness|evasion)[^.\n;:]{0,90}(raise|raises|boost|boosts|increase|increases|lower|lowers|decrease|decreases|drop|drops|rose|rises|fell|falls)/.test(combatText);
  const hasExplicitStatMultiplierContext = /(attack(?!\s*bonus\b)|special attack(?!\s*bonus\b)|sp\.?\s*atk(?!\s*bonus\b)|defense(?!\s*curl\b)|special defense|sp\.?\s*def|speed|accuracy|evasiveness|evasion)[^.\n;:]{0,80}(is|are|becomes|become|has|have|at)[^.\n;:]{0,40}(double|doubles|doubled|half|halved|halve|halves|[0-9]+(?:\.[0-9]+)?\s*[x×])/.test(combatText) || /(double|doubles|doubled|halve|halves|halved)[^.\n;:]{0,80}(attack(?!\s*bonus\b)|special attack(?!\s*bonus\b)|sp\.?\s*atk(?!\s*bonus\b)|defense(?!\s*curl\b)|special defense|sp\.?\s*def|speed|accuracy|evasiveness|evasion)/.test(combatText);
  const hasStatEmpower = hasDirectionalStatChange || hasExplicitStatMultiplierContext;

  if (hasMoveEmpower || hasStatEmpower || /(increase|increases|raises|boost|boosts|strengthens|double|doubles)/.test(combatText)) addMarker(markerMap, 'class', 'empower');
  if (hasMoveEmpower) addMarker(markerMap, 'empower', 'move');

  let skipGenericMultiplierScan = false;
  if (hasStabContext) {
    addMarker(markerMap, 'condition', 'stab_moves');
    skipGenericMultiplierScan = true;
    const sm = combatText.match(/same[- ]type attack bonus[^.\n;:]*?from\s*([0-9]+(?:\.[0-9]+)?)\s*[x×]\s*to\s*([0-9]+(?:\.[0-9]+)?)/i);
    if (sm) {
      const from = Number(sm[1]); const to = Number(sm[2]);
      if (from > 0 && to > 0) {
        const rel = numberToStable(to / from);
        if (rel && rel > 0) {
          addMarker(markerMap, 'multiplier', rel);
          if (rel > 1) addMarker(markerMap, 'delta_percent', numberToStable((rel - 1) * 100));
          if (rel < 1) addMarker(markerMap, 'reduction_percent', numberToStable((1 - rel) * 100));
        }
      }
    }
  }

  if (hasStatEmpower) {
    addMarker(markerMap, 'empower', 'stat');
    if (hasDirectionalStatChange) addMarker(markerMap, 'condition', 'stat_directional_change');
    if (hasStatStageEmpower) addMarker(markerMap, 'condition', 'stat_stage_change');
    for (const st of extractStatTargets(combatText)) addMarker(markerMap, 'stat_target', st);
  }

  if (/(lower|lowers|decrease|decreases|reduce|reduces|halve|halves)/.test(combatText)) addMarker(markerMap, 'class', 'mitigation_or_debuff');
  if (/(immune|immunity|cannot be|does not take damage|takes no damage|absorbs)/.test(combatText)) addMarker(markerMap, 'class', 'immunity_control');
  if (/(heal|heals|restore|restores|regains|recover|recovers)/.test(combatText)) addMarker(markerMap, 'class', 'sustain');
  if (/(status|burn|poison|paraly|sleep|confus|flinch)/.test(combatText)) addMarker(markerMap, 'domain', 'status');
  if (/(weather|rain|sunlight|sandstorm|hail|snow)/.test(combatText)) addMarker(markerMap, 'domain', 'weather');
  if (/\brain\b/.test(combatText)) addMarker(markerMap, 'condition', 'weather_rain');
  if (/sunlight|\bsun\b/.test(combatText)) addMarker(markerMap, 'condition', 'weather_sun');
  if (/(terrain|electric terrain|grassy terrain|misty terrain|psychic terrain)/.test(combatText)) addMarker(markerMap, 'domain', 'terrain');
  if (/(switch|switches out|enters battle|upon entering battle)/.test(combatText)) addMarker(markerMap, 'domain', 'switching');
  if (/(priority)/.test(combatText)) addMarker(markerMap, 'domain', 'priority');
  if (/(cannot flee|cannot switch out|prevents opponents from fleeing|trap)/.test(combatText)) addMarker(markerMap, 'domain', 'trap');
  if (/(upon entering battle|enters battle|when .* enters battle)/.test(combatText)) addMarker(markerMap, 'trigger', 'on_switch_in');
  if (/(after each turn|end of each turn)/.test(combatText)) addMarker(markerMap, 'trigger', 'end_turn');
  if (/(when hit|whenever .* hits|whenever .* takes damage|when this pokemon is hit)/.test(combatText)) addMarker(markerMap, 'trigger', 'on_hit');
  if (/(on contact|makes contact|contact move)/.test(combatText)) { addMarker(markerMap, 'trigger', 'on_contact'); addMarker(markerMap, 'condition', 'contact'); }
  if (/(below half|drops below half|at or below half|less than half|half hp|50% hp|hp[^.\n;:]{0,20}50%|1\/3|full hp|low hp)/.test(combatText)) addMarker(markerMap, 'condition', 'hp_threshold');
  if (/(punch-based|punch)/.test(combatText)) addMarker(markerMap, 'condition', 'punch_moves');
  if (/(kick-based|kick moves?|kicking moves?)/.test(combatText)) addMarker(markerMap, 'condition', 'kick_moves');
  if (/(sound[- ]based|sound moves?|sound move|voice[- ]based|sonic)/.test(combatText)) { addMarker(markerMap, 'condition', 'sound_moves'); addMarker(markerMap, 'domain', 'sound'); }
  if (/(pulse moves?|pulse move|aura and pulse)/.test(combatText)) addMarker(markerMap, 'condition', 'pulse_moves');
  if (/(biting moves?|biting move|bite moves?|bite move|jaw[- ]based|jaw moves?)/.test(combatText)) { addMarker(markerMap, 'condition', 'biting_moves'); addMarker(markerMap, 'condition', 'bite_moves'); }
  if (/(slicing moves?|slicing move|slice moves?|slice move|slashing moves?|cutting moves?|blade moves?|cleaving moves?)/.test(combatText)) { addMarker(markerMap, 'condition', 'slicing_moves'); addMarker(markerMap, 'condition', 'slice_moves'); }
  if (/(berry|berries)/.test(combatText)) addMarker(markerMap, 'condition', 'berry_related');
  if (/(critical hit|critical)/.test(combatText)) addMarker(markerMap, 'condition', 'critical_hit');
  if (/(for each .* (defeated|fainted)|allies in its party that have already been defeated)/.test(combatText)) addMarker(markerMap, 'condition', 'fainted_allies');
  if (/(electric-type|electric moves|electric move)/.test(combatText)) addMarker(markerMap, 'condition', 'electric_interaction');
  if (/(water-type|water moves|water move)/.test(combatText)) addMarker(markerMap, 'condition', 'water_interaction');

  if (!skipGenericMultiplierScan) {
    for (const multiplier of collectMultipliers(combatText)) {
      addMarker(markerMap, 'multiplier', multiplier);
      if (multiplier > 1) addMarker(markerMap, 'delta_percent', numberToStable((multiplier - 1) * 100));
      if (multiplier < 1) addMarker(markerMap, 'reduction_percent', numberToStable((1 - multiplier) * 100));
    }
  }
  for (const c of collectChancePercents(combatText)) addMarker(markerMap, 'chance_percent', c);
  const fbc = collectFractionsByContext(combatText);
  for (const v of fbc.gain) addMarker(markerMap, 'hp_gain_fraction', v);
  for (const v of fbc.loss) addMarker(markerMap, 'hp_loss_fraction', v);
  for (const v of fbc.threshold) addMarker(markerMap, 'threshold_fraction', v);
  for (const typeToken of TYPE_TOKENS) {
    if (new RegExp(`${typeToken}-type`, 'i').test(combatText)) addMarker(markerMap, 'type_hint', typeToken);
  }

  const hasCombatEvidence = markerMap.has('class') || markerMap.has('domain') || markerMap.has('trigger') || markerMap.has('multiplier') || markerMap.has('delta_percent') || markerMap.has('reduction_percent') || markerMap.has('chance_percent') || markerMap.has('hp_gain_fraction') || markerMap.has('hp_loss_fraction') || markerMap.has('stat_target');
  const impactScopes = markerMap.get('impact_scope');
  const hasCombatScope = impactScopes ? impactScopes.has('combat') : false;
  const hasOverworldScope = impactScopes ? impactScopes.has('overworld') : false;
  const explicitNonCombatOnly = /outside of battle only|only outside battle|in the overworld only|overworld only/.test(mergedText) || (/only affects encounter rate/.test(mergedText) && !hasCombatEvidence);
  if (hasOverworldScope && !hasCombatScope && !hasCombatEvidence && explicitNonCombatOnly) addMarker(markerMap, 'combat_relevance', 'non_combat');
  else if (hasOverworldScope && (hasCombatScope || hasCombatEvidence)) addMarker(markerMap, 'combat_relevance', 'mixed');
  else if (hasOverworldScope && !hasCombatScope && !hasCombatEvidence) addMarker(markerMap, 'combat_relevance', 'mixed');
  else addMarker(markerMap, 'combat_relevance', 'combat');

  annotateModifierKinds(markerMap);
  applyMinimumSemanticMarkers(markerMap);
  return markerMap;
}

function main() {
  const db = openDb();

  const abilityRows = db.prepare(
    'SELECT id, generation, is_main_series, short_effect, effect FROM abilities ORDER BY id'
  ).all();

  if (abilityRows.length === 0) throw new Error('Nenhuma ability encontrada no SQLite — execute generate_abilities_items_db.js primeiro.');

  const entries = abilityRows.map((row) => ({
    ability: row.id,
    generation: row.generation || 'unknown',
    isMainSeries: row.is_main_series === 1,
    shortEffect: row.short_effect || '',
    effect: row.effect || '',
  }));

  const stmtMarker = db.prepare(
    'INSERT OR REPLACE INTO ability_markers (ability_id, marker, value_type, value_text, value_number, value_bool) VALUES (@ability_id, @marker, @value_type, @value_text, @value_number, @value_bool)'
  );

  let totalMarkerRows = 0;
  db.transaction(() => {
    db.prepare('DELETE FROM ability_markers').run();
    for (const entry of entries) {
      const markerMap = inferMarkers(entry);
      for (const [marker, valuesSet] of markerMap.entries()) {
        for (const rawStr of valuesSet) {
          const norm = normalizeMarkerValue(parseStoredMarkerValue(rawStr));
          stmtMarker.run({ ability_id: entry.ability, marker, ...norm });
          totalMarkerRows++;
        }
      }
    }
  })();

  db.close();
  console.log(`[markers] abilities processadas: ${entries.length}`);
  console.log(`[markers] linhas de marcadores gravadas: ${totalMarkerRows}`);
}

try {
  main();
} catch (err) {
  console.error(`[markers] erro: ${err.message}`);
  process.exitCode = 1;
}
