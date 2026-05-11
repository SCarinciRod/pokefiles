'use strict';
const fs = require('fs');
const path = require('path');

const { openDb, normalizeMarkerValue, parseStoredMarkerValue } = require('./sqlite_writer');

const ROOT = path.resolve(__dirname, '..');
const FALLBACK_DESCRIPTIONS_PATH = path.join(ROOT, 'db', 'references', 'item_description_fallbacks.json');

const TYPE_TOKENS = [
  'normal','fire','water','electric','grass','ice','fighting','poison',
  'ground','flying','psychic','bug','rock','ghost','dragon','dark','steel','fairy'
];

const STAT_PATTERNS = [
  { stat: 'special_attack', regex: /special attack|sp\.?\s*atk/i },
  { stat: 'special_defense', regex: /special defense|sp\.?\s*def/i },
  { stat: 'speed', regex: /\bspeed\b/i },
  { stat: 'accuracy', regex: /\baccuracy\b/i },
  { stat: 'evasion', regex: /\bevasion\b|evasiveness/i },
];

const STATUS_PATTERNS = [
  { status: 'burn', regex: /\bburn(?:ed)?\b/ },
  { status: 'poison', regex: /\bpoison(?:ed)?\b/ },
  { status: 'sleep', regex: /\bsleep|asleep\b/ },
  { status: 'paralysis', regex: /\bparaly(?:zed|sis)?\b/ },
  { status: 'freeze', regex: /\bfrozen?|freeze\b/ },
  { status: 'confusion', regex: /\bconfus(?:ed|ion)?\b/ },
];

const HELD_CATEGORY_HINTS = new Set(['held_items','choice','type_enhancement','type_protection','in_a_pinch','picky_healing','jewels','memories','plates','scarves','mega_stones','z_crystals','species_specific']);
const CONSUMABLE_CATEGORY_HINTS = new Set(['status_cures','healing','medicine','vitamins','in_a_pinch','picky_healing','type_protection','jewels','mulch','special_balls']);
const COMBAT_CATEGORY_HINTS = new Set(['held_items','choice','type_enhancement','type_protection','in_a_pinch','picky_healing','jewels','memories','plates','mega_stones','z_crystals','species_specific','status_cures','healing','medicine']);
const NON_COMBAT_CATEGORY_HINTS = new Set(['all_mail','apricorn_box','baking_only','collectibles','curry_ingredients','dex_completion','event_items','gameplay','loot','nature_mints','picnic','plot_advancement','sandwich_ingredients','species_candies','tera_shard','tm_materials','unused','vitamins','evolution']);

function sanitizeAtom(value) {
  return String(value).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'unknown';
}

function normalizeSearchText(value) {
  return String(value || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

function isMissingDescriptionText(value) {
  return /sem descricao disponivel/.test(normalizeSearchText(value));
}

function loadFallbackDescriptions(filePath) {
  if (!fs.existsSync(filePath)) return new Map();
  const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  const map = new Map();
  for (const [rawItem, rawDesc] of Object.entries(parsed)) {
    const item = sanitizeAtom(rawItem);
    const desc = String(rawDesc || '').trim();
    if (item && desc) map.set(item, desc);
  }
  return map;
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
  const mp = /([0-9]+(?:\.[0-9]+)?)\s*[x×]/gi; let m = mp.exec(text);
  while (m) { values.push(Number(m[1])); m = mp.exec(text); }
  if (/\b(double|doubles|doubled)\b[^.\n;:]{0,40}\b(power|damage|attack|special attack|defense|special defense|speed|accuracy|evasion|hp|recovery|healing)\b|\b(power|damage|attack|special attack|defense|special defense|speed|accuracy|evasion|hp|recovery|healing)\b[^.\n;:]{0,40}\b(double|doubles|doubled)\b/gi.test(text)) values.push(2.0);
  if (/\b(half|halve|halves|halved)\b[^.\n;:]{0,40}\b(power|damage|attack|special attack|defense|special defense|speed|accuracy|evasion|hp|recovery|healing)\b|\b(power|damage|attack|special attack|defense|special defense|speed|accuracy|evasion|hp|recovery|healing)\b[^.\n;:]{0,40}\b(half|halve|halves|halved)\b/gi.test(text)) values.push(0.5);
  return Array.from(new Set(values.map((v) => numberToStable(v)))).filter((v) => v !== null);
}

function collectPercentsByContext(text) {
  const delta = new Set(); const reduction = new Set(); const chance = new Set(); const generic = new Set();
  const cp = /([0-9]+(?:\.[0-9]+)?)\s*%/gi; let m = cp.exec(text);
  while (m) {
    const value = numberToStable(Number(m[1]));
    if (value !== null) {
      const ctx = text.slice(Math.max(0, m.index - 50), Math.min(text.length, m.index + m[0].length + 50));
      if (/chance|likely|probability|odds|critical hit chance/.test(ctx)) chance.add(value);
      else if (/halve|half|reduce|reduces|reduced|less damage|take[s]?[^.\n;:]{0,20}less|lower/.test(ctx)) reduction.add(value);
      else if (/boost|increase|increases|more damage|raises|power|recover|heals|restore/.test(ctx)) delta.add(value);
      else generic.add(value);
    }
    m = cp.exec(text);
  }
  return { delta: [...delta], reduction: [...reduction], chance: [...chance], generic: [...generic] };
}

function collectFractions(text) {
  const values = []; const fp = /([0-9]+)\s*\/\s*([0-9]+)/g; let m = fp.exec(text);
  while (m) { const d = Number(m[2]); if (d > 0) values.push(numberToStable(Number(m[1]) / d)); m = fp.exec(text); }
  return Array.from(new Set(values)).filter((v) => v !== null);
}

function collectFractionsByContext(text) {
  const gain = new Set(); const loss = new Set(); const threshold = new Set(); let m;
  const gp = /(heal|heals|restore|restores|regain|regains|recover|recovers)[^.\n;:]*?([0-9]+\s*\/\s*[0-9]+)/gi;
  m = gp.exec(text); while (m) { collectFractions(m[2]).forEach((v) => gain.add(v)); m = gp.exec(text); }
  const lp = /(lose|loses|damage|damages|takes|take|hp loss)[^.\n;:]*?([0-9]+\s*\/\s*[0-9]+)/gi;
  m = lp.exec(text); while (m) { collectFractions(m[2]).forEach((v) => loss.add(v)); m = lp.exec(text); }
  const tp = /(below|half|full hp|at full|at or below|less than|threshold|consumed at)[^.\n;:]*?([0-9]+\s*\/\s*[0-9]+)/gi;
  m = tp.exec(text); while (m) { collectFractions(m[2]).forEach((v) => threshold.add(v)); m = tp.exec(text); }
  const all = collectFractions(text); const contextual = new Set([...gain, ...loss, ...threshold]);
  return { gain: [...gain], loss: [...loss], threshold: [...threshold], generic: all.filter((v) => !contextual.has(v)) };
}

function extractStatTargets(text) {
  const targets = [];
  const withoutSpAtk = text.replace(/special attack|sp\.?\s*atk/gi, ' ');
  const withoutSpDef = text.replace(/special defense|sp\.?\s*def/gi, ' ');
  if (/\battack\b(?!\s*bonus\b)/i.test(withoutSpAtk)) targets.push('attack');
  if (/\bdefense\b(?!\s*curl\b)/i.test(withoutSpDef)) targets.push('defense');
  for (const p of STAT_PATTERNS) if (p.regex.test(text)) targets.push(p.stat);
  return Array.from(new Set(targets));
}

function addTypeHints(markerMap, text) {
  for (const t of TYPE_TOKENS) {
    if (new RegExp(`\\b${t}-type\\b|\\b${t}\\s+moves?\\b`, 'i').test(text)) addMarker(markerMap, 'type_hint', t);
  }
}

function addStatusHints(markerMap, text) {
  for (const p of STATUS_PATTERNS) if (p.regex.test(text)) addMarker(markerMap, 'status_hint', p.status);
}

function applyMinimumSemanticMarkers(markerMap) {
  if (!markerMap.has('usage_mode')) addMarker(markerMap, 'usage_mode', 'inventory');
  if (!markerMap.has('item_role')) addMarker(markerMap, 'item_role', 'utility');
  if (!markerMap.has('trigger')) addMarker(markerMap, 'trigger', 'passive');
  if (!markerMap.has('condition')) addMarker(markerMap, 'condition', 'always_active');
  if (!markerMap.has('empower')) addMarker(markerMap, 'empower', 'state');
}

function inferMarkers(entry) {
  const markerMap = new Map();
  const text = normalizeSearchText(entry.description);

  const hasMissingDescription = isMissingDescriptionText(text);

  const hasHeldSignal = HELD_CATEGORY_HINTS.has(entry.category) || /(^|\b)held\s*:|\bholder\b|while held|held item/.test(text);
  const hasConsumableSignal = CONSUMABLE_CATEGORY_HINTS.has(entry.category) || /consumed|consume|eaten|used up|one-time use|single-use/.test(text);
  if (hasHeldSignal) addMarker(markerMap, 'usage_mode', 'held');
  if (hasConsumableSignal) addMarker(markerMap, 'usage_mode', 'consumable');

  const isCombatCategory = COMBAT_CATEGORY_HINTS.has(entry.category);
  const isNonCombatCategory = NON_COMBAT_CATEGORY_HINTS.has(entry.category);
  const hasBattleEvidence = /move|damage|attack(?!\s*bonus\b)|special attack|defense|special defense|speed|critical hit|hp|status ailment|burn|poison|paraly|sleep|freeze|confus|super-effective|turn|battle|holder|flinch|priority|switch out|accuracy|evasion|draining/.test(text) || hasHeldSignal;
  const explicitNonCombatOnly = /allows access|contains basic gameplay|use for fast transit|sell to|can be traded|lets a trainer write|used to make|portable berry growing|holds berries|unreleased|summons|allows the player to ride|no effect/.test(text) || /tries to catch a wild pokemon/.test(text);

  if (hasMissingDescription) {
    if (isCombatCategory && !isNonCombatCategory) addMarker(markerMap, 'combat_relevance', 'combat');
    else if (isCombatCategory && isNonCombatCategory) addMarker(markerMap, 'combat_relevance', 'mixed');
    else addMarker(markerMap, 'combat_relevance', 'non_combat');
  } else if (hasBattleEvidence && explicitNonCombatOnly) addMarker(markerMap, 'combat_relevance', 'mixed');
  else if (hasBattleEvidence || (isCombatCategory && !explicitNonCombatOnly)) addMarker(markerMap, 'combat_relevance', 'combat');
  else if (explicitNonCombatOnly || isNonCombatCategory) addMarker(markerMap, 'combat_relevance', 'non_combat');
  else addMarker(markerMap, 'combat_relevance', 'mixed');

  const hasMoveEmpower = /(move[^.\n;:]{0,80}(power|damage|stronger|more)|powers? up|boosts?[^.\n;:]{0,80}moves?|moves?[^.\n;:]{0,40}by\s*[0-9]+(?:\.[0-9]+)?\s*%|do\s*[0-9]+(?:\.[0-9]+)?\s*% more damage|base power|1\.5\s*[x×]\s*power)/.test(text);
  const hasStageLanguage = /\bone\s+stage\b|\btwo\s+stages\b|\bstage\b|\bstages\b|\bsharply\b|\bdrastically\b|\bharshly\b|\bseverely\b/.test(text);
  const hasDirectionalStatChange = /(raise|raises|boost|boosts|increase|increases|lower|lowers|decrease|decreases|drop|drops|rose|rises|fell|falls)[^.\n;:]{0,90}(attack(?!\s*bonus\b)|special attack(?!\s*bonus\b)|sp\.?\s*atk(?!\s*bonus\b)|defense(?!\s*curl\b)|special defense|sp\.?\s*def|speed|accuracy|evasiveness|evasion)/.test(text) || /(attack(?!\s*bonus\b)|special attack(?!\s*bonus\b)|sp\.?\s*atk(?!\s*bonus\b)|defense(?!\s*curl\b)|special defense|sp\.?\s*def|speed|accuracy|evasiveness|evasion)[^.\n;:]{0,90}(raise|raises|boost|boosts|increase|increases|lower|lowers|decrease|decreases|drop|drops|rose|rises|fell|falls)/.test(text);
  const hasExplicitStatMultiplierContext = /(attack(?!\s*bonus\b)|special attack(?!\s*bonus\b)|sp\.?\s*atk(?!\s*bonus\b)|defense(?!\s*curl\b)|special defense|sp\.?\s*def|speed|accuracy|evasiveness|evasion)[^.\n;:]{0,80}(double|doubles|doubled|half|halved|halve|halves|[0-9]+(?:\.[0-9]+)?\s*[x×]|[0-9]+\s*%)/.test(text) || /(double|doubles|doubled|halve|halves|halved)[^.\n;:]{0,80}(attack(?!\s*bonus\b)|special attack(?!\s*bonus\b)|sp\.?\s*atk(?!\s*bonus\b)|defense(?!\s*curl\b)|special defense|sp\.?\s*def|speed|accuracy|evasiveness|evasion)/.test(text);
  const hasDamageMitigation = /halve the damage|halves the damage|reduces damage|take[s]? no damage|immunit|prevents? .* damage/.test(text);
  const hasHealing = /heal|heals|restore|restores|recover|recovers|regain|regains|restores? [0-9]+ hp|hp each turn/.test(text);
  const hasStatusControl = /cures? (?:any|major)? status|status ailment|burn|poison|paraly|sleep|frozen|confus/.test(text);
  const hasFormControl = /mega evolve|z-move|changes? silvally|changes multi-attack|changes? .* form|techno blast/.test(text);

  if (hasMoveEmpower) { addMarker(markerMap, 'item_role', 'offense'); addMarker(markerMap, 'modifier_kind', 'move_power_modifier'); addMarker(markerMap, 'empower', 'move'); }
  if (hasDirectionalStatChange && hasStageLanguage) { addMarker(markerMap, 'item_role', 'offense'); addMarker(markerMap, 'modifier_kind', 'stat_stage_modifier'); addMarker(markerMap, 'condition', 'stat_stage_change'); addMarker(markerMap, 'empower', 'stat'); }
  if (hasExplicitStatMultiplierContext) { addMarker(markerMap, 'modifier_kind', 'stat_scalar_modifier'); addMarker(markerMap, 'empower', 'stat'); }
  if (hasDamageMitigation) { addMarker(markerMap, 'item_role', 'defense'); addMarker(markerMap, 'modifier_kind', 'damage_taken_modifier'); addMarker(markerMap, 'empower', 'state'); }
  if (hasHealing) { addMarker(markerMap, 'item_role', 'sustain'); addMarker(markerMap, 'modifier_kind', 'hp_recovery_modifier'); addMarker(markerMap, 'empower', 'state'); }
  if (hasStatusControl) { addMarker(markerMap, 'item_role', 'status_control'); addMarker(markerMap, 'modifier_kind', 'status_cure_modifier'); addMarker(markerMap, 'domain', 'status'); addMarker(markerMap, 'empower', 'state'); }
  if (hasFormControl) { addMarker(markerMap, 'item_role', 'form_control'); addMarker(markerMap, 'domain', 'form_change'); addMarker(markerMap, 'empower', 'state'); }

  if (/\bweather\b|\brain\b|\bsunlight\b|\bsun\b|\bsandstorm\b|\bhail\b|\bsnow\b/.test(text)) addMarker(markerMap, 'domain', 'weather');
  if (/\brain\b/.test(text)) addMarker(markerMap, 'condition', 'weather_rain');
  if (/sunlight|\bsun\b/.test(text)) addMarker(markerMap, 'condition', 'weather_sun');
  if (/sandstorm/.test(text)) addMarker(markerMap, 'condition', 'weather_sand');
  if (/hail|\bsnow\b/.test(text)) addMarker(markerMap, 'condition', 'weather_snow');
  if (/super-effective|super effective/.test(text)) addMarker(markerMap, 'condition', 'super_effective_hit');
  if (/on contact|contact move|makes contact/.test(text)) { addMarker(markerMap, 'condition', 'contact'); addMarker(markerMap, 'trigger', 'on_contact'); }
  if (/when hit|when .* takes damage|when it takes .* damage|when struck by|when affected by/.test(text)) addMarker(markerMap, 'trigger', 'on_hit');
  if (/after each turn|end of each turn|each turn/.test(text)) addMarker(markerMap, 'trigger', 'end_turn');
  if (/consumed at\s*1\/[24]\s*max hp|below half|at or below|drops below|low hp/.test(text)) { addMarker(markerMap, 'condition', 'hp_threshold'); addMarker(markerMap, 'trigger', 'on_low_hp'); }
  if (/when .* uses .* move|when the holder uses|upon using/.test(text)) addMarker(markerMap, 'trigger', 'on_move_use');
  if (/when (?:burned|poisoned|paralyzed|asleep|frozen)/.test(text)) addMarker(markerMap, 'trigger', 'on_status');

  for (const st of extractStatTargets(text)) addMarker(markerMap, 'stat_target', st);
  for (const mul of collectMultipliers(text)) { addMarker(markerMap, 'multiplier', mul); if (mul > 1) addMarker(markerMap, 'delta_percent', numberToStable((mul - 1) * 100)); if (mul < 1) addMarker(markerMap, 'reduction_percent', numberToStable((1 - mul) * 100)); }
  const pbc = collectPercentsByContext(text);
  for (const v of pbc.delta) addMarker(markerMap, 'delta_percent', v);
  for (const v of pbc.reduction) addMarker(markerMap, 'reduction_percent', v);
  for (const v of pbc.chance) addMarker(markerMap, 'chance_percent', v);
  const fbc = collectFractionsByContext(text);
  for (const v of fbc.gain) addMarker(markerMap, 'hp_gain_fraction', v);
  for (const v of fbc.loss) addMarker(markerMap, 'hp_loss_fraction', v);
  for (const v of fbc.threshold) addMarker(markerMap, 'threshold_fraction', v);

  addTypeHints(markerMap, text);
  addStatusHints(markerMap, text);
  if (markerMap.has('type_hint') && markerMap.has('modifier_kind')) addMarker(markerMap, 'domain', 'type_interaction');
  if (hasHeldSignal && !markerMap.has('trigger')) addMarker(markerMap, 'trigger', 'passive');
  if (!hasHeldSignal && hasConsumableSignal && !markerMap.has('trigger')) addMarker(markerMap, 'trigger', 'on_use');

  applyMinimumSemanticMarkers(markerMap);
  return markerMap;
}

function main() {
  const db = openDb();

  const itemRows = db.prepare(
    'SELECT id, category, cost, fling_power, fling_effect, description FROM items ORDER BY id'
  ).all();

  if (itemRows.length === 0) throw new Error('Nenhum item encontrado no SQLite — execute generate_abilities_items_db.js primeiro.');

  const fallbackMap = loadFallbackDescriptions(FALLBACK_DESCRIPTIONS_PATH);

  const entries = itemRows.map((row) => {
    const desc = row.description || 'Sem descrição disponível.';
    const fallback = fallbackMap.get(row.id);
    const hasMissing = isMissingDescriptionText(desc);
    return {
      item: row.id,
      category: row.category || 'unknown',
      cost: row.cost,
      flingPower: row.fling_power,
      flingEffect: row.fling_effect || 'none',
      description: hasMissing && fallback ? fallback : desc,
      fallbackDescriptionApplied: hasMissing && Boolean(fallback),
    };
  });

  const stmtMarker = db.prepare(
    'INSERT OR REPLACE INTO item_markers (item_id, marker, value_type, value_text, value_number, value_bool) VALUES (@item_id, @marker, @value_type, @value_text, @value_number, @value_bool)'
  );

  let totalMarkerRows = 0;
  let fallbackAppliedCount = 0;
  db.transaction(() => {
    db.prepare('DELETE FROM item_markers').run();
    for (const entry of entries) {
      if (entry.fallbackDescriptionApplied) fallbackAppliedCount++;
      const markerMap = inferMarkers(entry);
      for (const [marker, valuesSet] of markerMap.entries()) {
        for (const rawStr of valuesSet) {
          const norm = normalizeMarkerValue(parseStoredMarkerValue(rawStr));
          stmtMarker.run({ item_id: entry.item, marker, ...norm });
          totalMarkerRows++;
        }
      }
    }
  })();

  db.close();
  console.log(`[item-markers] itens processados: ${entries.length}`);
  console.log(`[item-markers] fallbacks carregados: ${fallbackMap.size}`);
  console.log(`[item-markers] descricoes substituidas por fallback: ${fallbackAppliedCount}`);
  console.log(`[item-markers] linhas de marcadores gravadas: ${totalMarkerRows}`);
}

try {
  main();
} catch (err) {
  console.error(`[item-markers] erro: ${err.message}`);
  process.exitCode = 1;
}
