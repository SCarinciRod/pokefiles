'use strict';
const fs = require('fs');
const path = require('path');

const { openDb, loadMarkersFromDb } = require('./sqlite_writer');

const ROOT = path.resolve(__dirname, '..');
const FALLBACK_DESCRIPTIONS_PATH = path.join(ROOT, 'db', 'references', 'item_description_fallbacks.json');
const HELD_ITEM_CONFIDENCE_FLOOR = 0.8;

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

function clamp(value, min, max) { return Math.max(min, Math.min(max, value)); }

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

function splitSentences(text) {
  return String(text || '').replace(/\s+/g, ' ').trim().split(/(?<=[.!?])\s+/).map((v) => v.trim()).filter(Boolean);
}

function isGenericHeldIntroSentence(sentence) {
  return /^an item to be held by\b/.test(normalizeSearchText(sentence));
}

function pickBestDescriptionSentence(text) {
  const sentences = splitSentences(text);
  if (sentences.length === 0) return '';
  return sentences.find((s) => !isGenericHeldIntroSentence(s)) || sentences[0];
}

function ensureSentenceEnding(text) {
  const trimmed = String(text || '').trim();
  if (!trimmed) return '';
  return /[.!?]$/.test(trimmed) ? trimmed : `${trimmed}.`;
}

function hasHeldItemSlot(markerSet) {
  return getMarkerValues(markerSet, 'usage_mode').includes('held');
}

function inferCategory(markerSet) {
  const roles = getMarkerValues(markerSet, 'item_role');
  if (roles.includes('form_control')) return 'form_control';
  if (roles.includes('offense')) return 'offensive';
  if (roles.includes('defense') || roles.includes('sustain')) return 'defensive';
  if (roles.includes('status_control')) return 'status';
  return 'utility';
}

function inferTrigger(markerSet) {
  const triggers = getMarkerValues(markerSet, 'trigger');
  if (triggers.includes('on_contact') || triggers.includes('on_hit')) return 'on_hit';
  if (triggers.includes('on_low_hp')) return 'on_low_hp';
  if (triggers.includes('on_move_use')) return 'on_move_use';
  if (triggers.includes('end_turn')) return 'end_turn';
  if (triggers.includes('on_status')) return 'on_status';
  if (triggers.includes('on_use')) return 'on_use';
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
  const multiplierSignals = [...getMarkerValues(markerSet, 'multiplier'), ...getMarkerValues(markerSet, 'delta_percent'), ...getMarkerValues(markerSet, 'reduction_percent'), ...getMarkerValues(markerSet, 'hp_gain_fraction'), ...getMarkerValues(markerSet, 'hp_loss_fraction')];
  if (modifierKinds.length > 0) score += 0.12;
  if (conditions.length > 0) score += 0.08;
  if (triggers.length > 0 && !triggers.includes('passive')) score += 0.08;
  if (statTargets.length > 0 || typeHints.length > 0) score += 0.06;
  if (multiplierSignals.length > 0) score += 0.08;
  if (combatRelevance.includes('non_combat')) score -= 0.25;
  if (catalogRow && isMissingDescriptionText(catalogRow.description || '')) score -= 0.2;
  return numberToStable(clamp(score, HELD_ITEM_CONFIDENCE_FLOOR, 0.95));
}

function inferDescription(markerSet, catalogRow) {
  const rawDescription = catalogRow ? String(catalogRow.description || '').trim() : '';
  const hasDescription = rawDescription !== '' && !isMissingDescriptionText(rawDescription);
  const role = getMarkerValues(markerSet, 'item_role')[0] || 'utility';
  const modifierKinds = getMarkerValues(markerSet, 'modifier_kind');
  const conditions = getMarkerValues(markerSet, 'condition');
  const typeHints = getMarkerValues(markerSet, 'type_hint');
  if (hasDescription) return `Curadoria automatica de held item: ${ensureSentenceEnding(pickBestDescriptionSentence(rawDescription))}`;
  const parts = [`papel principal ${role}`];
  if (modifierKinds.length > 0) parts.push(`modificador ${modifierKinds.join(', ')}`);
  const semanticConditions = conditions.filter((v) => v !== 'always_active');
  if (semanticConditions.length > 0) parts.push(`condicoes ${semanticConditions.join(', ')}`);
  if (typeHints.length > 0) parts.push(`interacao com tipos ${typeHints.join(', ')}`);
  return `Curadoria automatica de held item: ${parts.join('; ')}.`;
}

function inferCombatModel(markerSet, confidence) {
  const model = new Set();
  model.add(modelTerm('source', 'auto_marker'));
  model.add(modelTerm('held_item_slot', true));
  const combatRelevance = getMarkerValues(markerSet, 'combat_relevance');
  model.add(modelTerm('combat_relevance', combatRelevance[0] || 'combat'));
  for (const mn of ['usage_mode','item_role','trigger','condition','modifier_kind','stat_target','type_hint','status_hint','domain','multiplier','delta_percent','reduction_percent','chance_percent','hp_gain_fraction','hp_loss_fraction','threshold_fraction']) {
    for (const v of getMarkerValues(markerSet, mn)) model.add(modelTerm(mn, v));
  }
  model.add(modelTerm('confidence', confidence));
  return [...model].sort((a, b) => a.localeCompare(b));
}

function buildAutoRows(markerMap, catalogMap) {
  const rows = [];
  for (const item of [...markerMap.keys()].sort((a, b) => a.localeCompare(b))) {
    const markers = markerMap.get(item);
    if (!hasHeldItemSlot(markers)) continue;
    const catalogRow = catalogMap.get(item);
    const category = inferCategory(markers);
    const trigger = inferTrigger(markers);
    const confidence = inferConfidence(markers, catalogRow);
    const combatModel = inferCombatModel(markers, confidence);
    const description = inferDescription(markers, catalogRow);
    rows.push({ item, category, trigger, combatModel, description, confidence });
  }
  return rows;
}

function main() {
  const db = openDb();

  const itemRows = db.prepare(
    'SELECT id, category, cost, fling_power, fling_effect, description FROM items ORDER BY id'
  ).all();
  if (itemRows.length === 0) throw new Error('Nenhum item encontrado no SQLite — execute generate_abilities_items_db.js primeiro.');

  const fallbackMap = loadFallbackDescriptions(FALLBACK_DESCRIPTIONS_PATH);
  let fallbackAppliedCount = 0;

  const catalogMap = new Map(itemRows.map((row) => {
    const desc = row.description || 'Sem descrição disponível.';
    const fallback = fallbackMap.get(row.id);
    const hasMissing = isMissingDescriptionText(desc);
    if (hasMissing && fallback) fallbackAppliedCount++;
    return [row.id, {
      item: row.id,
      category: row.category || 'unknown',
      cost: row.cost,
      flingPower: row.fling_power,
      flingEffect: row.fling_effect || 'none',
      description: hasMissing && fallback ? fallback : desc,
    }];
  }));

  const markerMap = loadMarkersFromDb(db, 'item_markers', 'item_id');
  const autoRows = buildAutoRows(markerMap, catalogMap);

  const stmtEffect = db.prepare(
    'INSERT OR REPLACE INTO held_item_effects (item_id, category, trigger, model_json, description, confidence) VALUES (@item_id, @category, @trigger, @model_json, @description, @confidence)'
  );

  db.transaction(() => {
    for (const row of autoRows) {
      stmtEffect.run({
        item_id: row.item,
        category: row.category,
        trigger: row.trigger,
        model_json: JSON.stringify(row.combatModel),
        description: row.description,
        confidence: row.confidence,
      });
    }
  })();

  db.close();
  console.log(`[auto-held-item] itens no catalogo: ${catalogMap.size}`);
  console.log(`[auto-held-item] fallbacks carregados: ${fallbackMap.size}`);
  console.log(`[auto-held-item] descricoes substituidas por fallback: ${fallbackAppliedCount}`);
  console.log(`[auto-held-item] held itens curados: ${autoRows.length}`);
}

try {
  main();
} catch (err) {
  console.error(`[auto-held-item] erro: ${err.message}`);
  process.exitCode = 1;
}
