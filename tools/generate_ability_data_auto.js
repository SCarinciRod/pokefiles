'use strict';
const path = require('path');

const { openDb, loadMarkersFromDb } = require('./sqlite_writer');

function sanitizeAtom(value) {
  return String(value).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'unknown';
}

function numberToStable(value) {
  if (!Number.isFinite(value)) return null;
  const rounded = Math.round(value * 1000) / 1000;
  return Number.isInteger(rounded) ? rounded : rounded;
}

function clamp(value, min, max) { return Math.max(min, Math.min(max, value)); }

function humanizeAtom(atom) {
  return String(atom || '').replace(/_/g, ' ').replace(/\s+/g, ' ').trim();
}

function getMarkerValues(markerSet, marker) {
  if (!markerSet || !markerSet.has(marker)) return [];
  const values = [];
  for (const raw of markerSet.get(marker)) {
    if (raw === 'true') { values.push(true); continue; }
    if (raw === 'false') { values.push(false); continue; }
    if (/^-?[0-9]+(?:\.[0-9]+)?$/.test(raw)) { values.push(numberToStable(Number(raw))); continue; }
    values.push(sanitizeAtom(raw));
  }
  return values;
}

function formatModelValue(value) {
  if (typeof value === 'number') return String(numberToStable(value));
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  return sanitizeAtom(value);
}

function modelTerm(key, value) { return `${sanitizeAtom(key)}-${formatModelValue(value)}`; }

function inferCategory(markerSet) {
  const empowerValues = getMarkerValues(markerSet, 'empower');
  const statTargets = getMarkerValues(markerSet, 'stat_target');
  const classes = getMarkerValues(markerSet, 'class');
  const domains = getMarkerValues(markerSet, 'domain');
  if (empowerValues.includes('move')) return 'offensive';
  if (empowerValues.includes('stat')) {
    if (statTargets.includes('attack') || statTargets.includes('special_attack') || statTargets.includes('speed')) return 'offensive';
    if (statTargets.includes('defense') || statTargets.includes('special_defense')) return 'defensive';
  }
  if (classes.includes('immunity_control') || classes.includes('sustain') || classes.includes('mitigation_or_debuff')) return 'defensive';
  if (domains.includes('status')) return 'status';
  if (domains.includes('weather')) return 'weather';
  if (domains.includes('trap')) return 'trap';
  return 'utility';
}

function inferTrigger(markerSet) {
  const triggers = getMarkerValues(markerSet, 'trigger');
  if (triggers.includes('on_switch_in')) return 'on_switch';
  if (triggers.includes('on_hit') || triggers.includes('on_contact')) return 'on_hit';
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
  if (empowerValues.length > 0) score += 0.2;
  if (multipliers.length > 0 || deltas.length > 0 || reductions.length > 0) score += 0.15;
  if (statTargets.length > 0) score += 0.1;
  if (triggers.length > 0) score += 0.1;
  if (conditions.length > 0) score += 0.05;
  if (combatRelevance.includes('non_combat')) score -= 0.25;
  return numberToStable(clamp(score, 0.2, 0.95));
}

function inferDescription(markerSet, catalogRow, ability) {
  const empowerValues = getMarkerValues(markerSet, 'empower');
  const statTargets = getMarkerValues(markerSet, 'stat_target');
  const multipliers = getMarkerValues(markerSet, 'multiplier');
  const combatRelevance = getMarkerValues(markerSet, 'combat_relevance');
  if (combatRelevance.includes('non_combat')) return 'Modelagem automatica por marcadores: efeito principal em overworld (sem impacto competitivo direto em combate).';
  const parts = [];
  if (empowerValues.includes('move')) parts.push('foco em fortalecimento de golpes');
  if (empowerValues.includes('stat')) parts.push(statTargets.length > 0 ? `foco em stats (${statTargets.join(', ')})` : 'foco em fortalecimento de stats');
  if (multipliers.length > 0) parts.push(`multiplicador detectado: ${multipliers.join(', ')}`);
  if (parts.length > 0) return `Modelagem automatica por marcadores: ${parts.join('; ')}.`;
  const isMeaningful = (text) => { const n = String(text || '').trim(); return n && !/sem descri/i.test(n); };
  if (catalogRow && isMeaningful(catalogRow.effect)) return `Modelagem automatica por marcadores: ${catalogRow.effect}`;
  if (catalogRow && isMeaningful(catalogRow.shortEffect)) return `Modelagem automatica por marcadores: ${catalogRow.shortEffect}`;
  const inferredCategory = inferCategory(markerSet);
  const inferredTrigger = inferTrigger(markerSet);
  const inferredConditions = getMarkerValues(markerSet, 'condition').slice(0, 3);
  const conditionText = inferredConditions.length > 0 ? `; condicoes detectadas: ${inferredConditions.join(', ')}` : '';
  return `Modelagem automatica por marcadores: descricao inferida para ${humanizeAtom(ability)}; categoria ${inferredCategory}; gatilho ${inferredTrigger}${conditionText}.`;
}

function inferCombatModel(markerSet) {
  const model = new Set();
  model.add(modelTerm('source', 'auto_marker'));
  const combatRelevance = getMarkerValues(markerSet, 'combat_relevance');
  const relevance = combatRelevance[0] || 'combat';
  model.add(modelTerm('combat_relevance', relevance));
  const impactScopes = getMarkerValues(markerSet, 'impact_scope');
  if (impactScopes.includes('overworld')) model.add(modelTerm('has_overworld_component', true));
  if (relevance === 'non_combat') model.add(modelTerm('overworld_only', true));
  const empowerValues = getMarkerValues(markerSet, 'empower');
  if (empowerValues.includes('move')) model.add(modelTerm('empower_move', true));
  if (empowerValues.includes('stat')) model.add(modelTerm('empower_stat', true));
  if (empowerValues.includes('state')) model.add(modelTerm('empower_state', true));
  for (const st of getMarkerValues(markerSet, 'stat_target')) model.add(modelTerm('stat_target', st));
  for (const mn of ['multiplier','delta_percent','reduction_percent','chance_percent','hp_gain_fraction','hp_loss_fraction','threshold_fraction']) {
    for (const v of getMarkerValues(markerSet, mn)) model.add(modelTerm(mn, v));
  }
  for (const v of getMarkerValues(markerSet, 'condition')) model.add(modelTerm('condition', v));
  for (const v of getMarkerValues(markerSet, 'domain')) model.add(modelTerm('domain', v));
  for (const v of getMarkerValues(markerSet, 'type_hint')) model.add(modelTerm('type_hint', v));
  for (const v of getMarkerValues(markerSet, 'trigger')) model.add(modelTerm('trigger', v));
  for (const v of getMarkerValues(markerSet, 'modifier_kind')) model.add(modelTerm('modifier_kind', v));
  model.add(modelTerm('confidence', inferConfidence(markerSet)));
  return [...model].sort((a, b) => a.localeCompare(b));
}

function buildAutoRows(markerMap, catalogMap) {
  const rows = [];
  for (const ability of [...markerMap.keys()].sort((a, b) => a.localeCompare(b))) {
    const markers = markerMap.get(ability);
    const category = inferCategory(markers);
    const trigger = inferTrigger(markers);
    const combatModel = inferCombatModel(markers);
    const description = inferDescription(markers, catalogMap.get(ability), ability);
    rows.push({ ability, category, trigger, combatModel, description });
  }
  return rows;
}

function main() {
  const db = openDb();

  const abilityRows = db.prepare('SELECT id, generation, is_main_series, short_effect, effect FROM abilities ORDER BY id').all();
  if (abilityRows.length === 0) throw new Error('Nenhuma ability encontrada no SQLite — execute generate_abilities_items_db.js primeiro.');

  const catalogMap = new Map(abilityRows.map((row) => [row.id, {
    ability: row.id,
    generation: row.generation,
    isMainSeries: row.is_main_series === 1,
    shortEffect: row.short_effect || '',
    effect: row.effect || '',
  }]));

  const markerMap = loadMarkersFromDb(db, 'ability_markers', 'ability_id');

  const autoRows = buildAutoRows(markerMap, catalogMap);

  const stmtEffect = db.prepare(
    'INSERT OR REPLACE INTO ability_effects (ability_id, category, trigger, model_json, description) VALUES (@ability_id, @category, @trigger, @model_json, @description)'
  );

  db.transaction(() => {
    for (const row of autoRows) {
      stmtEffect.run({
        ability_id: row.ability,
        category: row.category,
        trigger: row.trigger,
        model_json: JSON.stringify(row.combatModel),
        description: row.description,
      });
    }
  })();

  db.close();
  console.log(`[auto-ability] abilities no catalogo: ${catalogMap.size}`);
  console.log(`[auto-ability] ability_effects gerados: ${autoRows.length}`);
}

try {
  main();
} catch (err) {
  console.error(`[auto-ability] erro: ${err.message}`);
  process.exitCode = 1;
}
