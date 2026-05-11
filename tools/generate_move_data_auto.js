'use strict';
const fs = require('fs');
const path = require('path');

const { openDb, loadMarkersFromDb } = require('./sqlite_writer');

const ROOT = path.resolve(__dirname, '..');
const MOVE_TACTICAL_CATALOG_PATH = path.join(ROOT, 'db', 'catalogs', 'move_tactical_catalog.pl');

const CONTROL_ROLES = new Set(['control','speed_control','trick_room','pivot','redirection','protection','hazard','hazard_clear','terrain_control','weather_control','screen_control','fake_out']);
const BUFF_ROLES = new Set(['buff','setup_buff','ally_boost']);
const DEBUFF_ROLES = new Set(['debuff','disruption','status_spread']);

const STATUS_HINT_PRIORITY = ['burn','poison','paralysis','sleep','freeze','confusion','infatuation','trap','flinch'];

const CONDITION_TAG_WHITELIST = new Set(['punch_moves','kick_moves','sound_moves','pulse_moves','biting_moves','bite_moves','slicing_moves','slice_moves','priority_positive','delayed_action','critical_hit','contact','trick_room','weather_rain','weather_sun','weather_sand','weather_snow','guaranteed_hit','flinch_chance']);

function sanitizeAtom(value) {
  const atom = String(value || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  return atom || 'unknown';
}

function normalizeSearchText(value) {
  return String(value || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

function numberToStable(value) {
  if (!Number.isFinite(value)) return null;
  const rounded = Math.round(value * 1000) / 1000;
  return Number.isInteger(rounded) ? rounded : rounded;
}

function clamp(value, min, max) { return Math.max(min, Math.min(max, value)); }

function addToMultiMap(map, key, value) {
  if (!map.has(key)) map.set(key, new Set());
  map.get(key).add(value);
}

function loadTacticalCatalog(filePath) {
  const seedRolesByMove = new Map();
  const expandRoleMap = new Map();
  if (!fs.existsSync(filePath)) return { seedRolesByMove, expandRoleMap };
  for (const line of fs.readFileSync(filePath, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    const sm = trimmed.match(/^move_tactical_role_seed\(([^,]+),\s*([a-z0-9_]+)\)\.$/);
    if (sm) { addToMultiMap(seedRolesByMove, sanitizeAtom(sm[1]), sanitizeAtom(sm[2])); continue; }
    const em = trimmed.match(/^move_tactical_role_expand\(([a-z0-9_]+),\s*([a-z0-9_]+)\)\.$/);
    if (em) { const p = sanitizeAtom(em[1]); const c = sanitizeAtom(em[2]); if (p !== 'role' && c !== 'role') addToMultiMap(expandRoleMap, p, c); }
  }
  return { seedRolesByMove, expandRoleMap };
}

function expandTacticalRoles(seedRoles, expandRoleMap) {
  const expanded = new Set(); const queue = [...seedRoles];
  while (queue.length > 0) {
    const role = queue.shift();
    if (expanded.has(role)) continue;
    expanded.add(role);
    const children = expandRoleMap.get(role);
    if (children) for (const child of children) if (!expanded.has(child)) queue.push(child);
  }
  return expanded;
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

function getMarkerNumberValues(markerSet, marker) {
  return getMarkerValues(markerSet, marker).filter((v) => Number.isFinite(v));
}

function hasRoleIntersection(roles, expectedRoles) {
  for (const role of roles) if (expectedRoles.has(role)) return true;
  return false;
}

function fallbackRolesFromEntry(entry, tacticalContext) {
  const seedRoles = tacticalContext.seedRolesByMove.get(entry.move) || new Set();
  const expandedRoles = expandTacticalRoles(seedRoles, tacticalContext.expandRoleMap);
  if (entry.category !== 'status') expandedRoles.add('damage');
  if (entry.effectCategory === 'heal' || entry.effectCategory === 'damage_heal') expandedRoles.add('recovery');
  if (['net_good_stats','damage_raise','swagger'].includes(entry.effectCategory)) expandedRoles.add('buff');
  if (['damage_lower','ailment','damage_ailment'].includes(entry.effectCategory)) expandedRoles.add('debuff');
  if (['field_effect','whole_field_effect','force_switch'].includes(entry.effectCategory)) expandedRoles.add('control');
  return [...expandedRoles].sort((a, b) => a.localeCompare(b));
}

function inferRoles(entry, markerSet, tacticalContext) {
  const markerRoles = getMarkerValues(markerSet, 'tactical_role').filter((v) => typeof v === 'string');
  if (markerRoles.length > 0) return [...new Set(markerRoles)].sort((a, b) => a.localeCompare(b));
  return fallbackRolesFromEntry(entry, tacticalContext);
}

function isMissingDescriptionText(value) {
  const n = normalizeSearchText(value);
  if (!n.trim()) return true;
  return /sem descricao curta disponivel|sem descricao/.test(n);
}

function inferEffectChance(entry, markerSet) {
  if (Number.isFinite(entry.effectChance)) return Math.round(entry.effectChance);
  const mc = getMarkerNumberValues(markerSet, 'chance_percent').map((v) => Math.round(v)).filter((v) => v >= 1 && v <= 100).sort((a, b) => b - a);
  return mc.length === 0 ? null : mc[0];
}

function inferAilment(entry, markerSet) {
  const rowAilment = sanitizeAtom(entry.ailment);
  if (rowAilment !== 'none' && rowAilment !== 'unknown') return rowAilment;
  const statusHints = getMarkerValues(markerSet, 'status_hint').filter((v) => typeof v === 'string').map((v) => sanitizeAtom(v));
  for (const preferred of STATUS_HINT_PRIORITY) if (statusHints.includes(preferred)) return preferred;
  return statusHints.length > 0 ? statusHints[0] : 'none';
}

function inferEffectCategory(entry, markerSet, ailment, roles) {
  const rowEc = sanitizeAtom(entry.effectCategory);
  if (rowEc !== 'unknown') return rowEc;
  const classes = getMarkerValues(markerSet, 'class').filter((v) => typeof v === 'string');
  const domains = getMarkerValues(markerSet, 'domain').filter((v) => typeof v === 'string');
  if (entry.category === 'status') {
    if (ailment !== 'none') return 'ailment';
    if (roles.includes('recovery') || classes.includes('sustain')) return 'heal';
    if (hasRoleIntersection(roles, BUFF_ROLES) || classes.includes('empower')) return 'net_good_stats';
    if (hasRoleIntersection(roles, CONTROL_ROLES) || classes.includes('control') || domains.includes('field_control') || domains.includes('terrain') || domains.includes('weather')) return 'field_effect';
    return 'unknown';
  }
  if (ailment !== 'none') return 'damage_ailment';
  if (roles.includes('recovery') || classes.includes('sustain')) return 'damage_heal';
  if (hasRoleIntersection(roles, BUFF_ROLES) || classes.includes('empower')) return 'damage_raise';
  if (hasRoleIntersection(roles, DEBUFF_ROLES) || classes.includes('disruption')) return 'damage_lower';
  return 'damage';
}

function mergeTags(entry, markerSet, roles, ailment) {
  const merged = new Set((entry.tags || []).map((t) => sanitizeAtom(t)).filter(Boolean));
  for (const priority of getMarkerNumberValues(markerSet, 'priority')) merged.add(`priority_${Math.round(priority)}`);
  const conditions = getMarkerValues(markerSet, 'condition').filter((v) => typeof v === 'string').map((v) => sanitizeAtom(v));
  if (conditions.includes('critical_hit')) merged.add('high_crit');
  for (const condition of conditions) if (CONDITION_TAG_WHITELIST.has(condition)) merged.add(condition);
  for (const ms of getMarkerValues(markerSet, 'move_style').filter((v) => typeof v === 'string')) merged.add(`style_${sanitizeAtom(ms)}`);
  for (const role of roles) merged.add(`role_${sanitizeAtom(role)}`);
  for (const domain of getMarkerValues(markerSet, 'domain').filter((v) => typeof v === 'string')) merged.add(`domain_${sanitizeAtom(domain)}`);
  for (const hint of getMarkerValues(markerSet, 'status_hint').filter((v) => typeof v === 'string')) merged.add(`ailment_${sanitizeAtom(hint)}`);
  if (ailment !== 'none' && ailment !== 'unknown') merged.add(`ailment_${sanitizeAtom(ailment)}`);
  return [...merged].map((t) => sanitizeAtom(t)).filter((t) => t && t !== 'unknown' && t !== 'none').sort((a, b) => a.localeCompare(b));
}

function inferDescription(entry, markerSet, roles, ailment, effectChance, hasCatalogDescription) {
  if (hasCatalogDescription) return entry.description;
  const styles = getMarkerValues(markerSet, 'move_style').filter((v) => typeof v === 'string').map((v) => sanitizeAtom(v));
  const meaningfulConditions = getMarkerValues(markerSet, 'condition').filter((v) => typeof v === 'string').map((v) => sanitizeAtom(v)).filter((v) => v !== 'always_active').slice(0, 4);
  const roleSummary = roles.filter((r) => r !== 'damage').slice(0, 4);
  const parts = [`golpe ${entry.category}`, `tipo ${entry.type}`];
  if (styles.length > 0) parts.push(`estilo ${styles.join(', ')}`);
  if (roleSummary.length > 0) parts.push(`papeis taticos ${roleSummary.join(', ')}`);
  if (ailment !== 'none' && ailment !== 'unknown') parts.push(`aplica ${ailment}`);
  if (Number.isFinite(effectChance)) parts.push(`chance adicional ${effectChance}%`);
  if (meaningfulConditions.length > 0) parts.push(`condicoes ${meaningfulConditions.join(', ')}`);
  return `Curadoria automatica de move: ${parts.join('; ')}.`;
}

function inferTrigger(markerSet) {
  const triggers = getMarkerValues(markerSet, 'trigger').filter((v) => typeof v === 'string');
  return triggers.includes('on_move_use') ? 'on_move_use' : (triggers.length > 0 ? sanitizeAtom(triggers[0]) : 'on_move_use');
}

function inferMoveSemanticCategory(entry, markerSet, roles, ailment) {
  if (entry.category === 'physical' || entry.category === 'special') return 'offensive';
  const classes = getMarkerValues(markerSet, 'class').filter((v) => typeof v === 'string');
  if (ailment !== 'none' || classes.includes('disruption') || hasRoleIntersection(roles, DEBUFF_ROLES)) return 'status';
  if (classes.includes('sustain') || roles.includes('recovery')) return 'sustain';
  if (classes.includes('control') || hasRoleIntersection(roles, CONTROL_ROLES)) return 'control';
  if (classes.includes('empower') || hasRoleIntersection(roles, BUFF_ROLES)) return 'empower';
  return 'utility';
}

function countMarkerSignals(markerSet) {
  if (!markerSet) return 0;
  let count = 0;
  for (const values of markerSet.values()) count += values.size;
  return count;
}

function inferConfidence(markerSet, hasCatalogDescription, roles, ailment, effectChance) {
  let score = 0.72;
  if (hasCatalogDescription) score += 0.1; else score -= 0.03;
  const signals = countMarkerSignals(markerSet);
  if (signals >= 16) score += 0.09; else if (signals >= 8) score += 0.06; else if (signals >= 4) score += 0.03;
  if (roles.length > 0) score += 0.04;
  if (getMarkerValues(markerSet, 'move_style').filter((v) => typeof v === 'string').length > 0) score += 0.03;
  if (getMarkerValues(markerSet, 'condition').filter((v) => typeof v === 'string').map((v) => sanitizeAtom(v)).filter((v) => v !== 'always_active').length > 0) score += 0.02;
  if (ailment !== 'none' && ailment !== 'unknown') score += 0.03;
  if (Number.isFinite(effectChance)) score += 0.02;
  return numberToStable(clamp(score, 0.75, 0.97));
}

function formatModelValue(value) {
  if (typeof value === 'number') return String(numberToStable(value));
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  return sanitizeAtom(value);
}

function modelTerm(key, value) { return `${sanitizeAtom(key)}-${formatModelValue(value)}`; }

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
  if (ailment !== 'none' && ailment !== 'unknown') { model.add(modelTerm('status_hint', ailment)); model.add(modelTerm('ailment', ailment)); }
  if (Number.isFinite(effectChance)) model.add(modelTerm('chance_percent', effectChance));
  for (const role of roles) model.add(modelTerm('tactical_role', role));
  for (const markerName of ['class','condition','move_style','domain','modifier_kind','status_hint','power_band','accuracy_band','pp_band','priority']) {
    for (const value of getMarkerValues(markerSet, markerName)) model.add(modelTerm(markerName, value));
  }
  return [...model].sort((a, b) => a.localeCompare(b));
}

function buildAutoRows(moveEntries, markerMap, tacticalContext) {
  const rows = [];
  for (const entry of moveEntries) {
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
    const combatModel = inferCombatModel(entry, markerSet, roles, ailment, effectChance, effectCategory, trigger, confidence, hasCatalogDescription);
    rows.push({ move: entry.move, type: entry.type, category: entry.category, basePower: entry.basePower, accuracy: entry.accuracy, pp: entry.pp, tags, effectChance, ailment, effectCategory, description, semanticCategory, trigger, confidence, combatModel });
  }
  return rows;
}

function main() {
  const db = openDb();

  const moveRows = db.prepare(
    'SELECT id, type_id, category, base_power, accuracy, pp, effect_chance, ailment, effect_category, description FROM moves ORDER BY id'
  ).all();
  if (moveRows.length === 0) throw new Error('Nenhum move encontrado no SQLite — execute generate_moves_db.js primeiro.');

  const tagsByMove = new Map();
  for (const { move_id, tag } of db.prepare('SELECT move_id, tag FROM move_tags ORDER BY move_id, tag').all()) {
    if (!tagsByMove.has(move_id)) tagsByMove.set(move_id, []);
    tagsByMove.get(move_id).push(tag);
  }

  const moveEntries = moveRows.map((row) => ({
    move: row.id,
    type: row.type_id,
    category: row.category,
    basePower: row.base_power,
    accuracy: row.accuracy,
    pp: row.pp,
    tags: tagsByMove.get(row.id) || [],
    effectChance: row.effect_chance,
    ailment: row.ailment || 'none',
    effectCategory: row.effect_category || 'unknown',
    description: row.description,
  }));

  const markerMap = loadMarkersFromDb(db, 'move_markers', 'move_id');
  const tacticalContext = loadTacticalCatalog(MOVE_TACTICAL_CATALOG_PATH);
  const autoRows = buildAutoRows(moveEntries, markerMap, tacticalContext);

  const stmtEffect = db.prepare(
    'INSERT OR REPLACE INTO move_effects (move_id, category, trigger, model_json, description, confidence) VALUES (@move_id, @category, @trigger, @model_json, @description, @confidence)'
  );
  const stmtTag = db.prepare('INSERT OR IGNORE INTO move_tags (move_id, tag) VALUES (?, ?)');

  db.transaction(() => {
    for (const row of autoRows) {
      stmtEffect.run({
        move_id: row.move,
        category: row.semanticCategory,
        trigger: row.trigger,
        model_json: JSON.stringify(row.combatModel),
        description: row.description,
        confidence: row.confidence,
      });
      for (const tag of row.tags) stmtTag.run(row.move, tag);
    }
  })();

  db.close();

  const missingCount = autoRows.filter((r) => isMissingDescriptionText(r.description)).length;
  console.log(`[auto-move] moves no catalogo: ${moveEntries.length}`);
  console.log(`[auto-move] moves com marcadores: ${markerMap.size}`);
  console.log(`[auto-move] move_effects gerados: ${autoRows.length}`);
  console.log(`[auto-move] descricoes ainda ausentes: ${missingCount}`);
}

try {
  main();
} catch (err) {
  console.error(`[auto-move] erro: ${err.message}`);
  process.exitCode = 1;
}
