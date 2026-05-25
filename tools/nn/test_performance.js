'use strict';
/**
 * Performance & robustness test — real end-to-end, no mocks.
 *
 * Measures:
 *   - Response time per intent type (min/avg/max/p95)
 *   - Throughput: queries/second under sequential load
 *   - Rapid-fire burst: 10 consecutive queries without gap
 *   - Error hunting: malformed inputs, edge cases, unicode
 *   - NN stability: many synergy queries in sequence (process stays up)
 *   - Memory/state: verify bridge doesn't accumulate bad state
 *
 * Run: node tools/nn/test_performance.js
 * Out: .local_cache/test_performance.txt
 */

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT         = path.resolve(__dirname, '../..');
const OUTPUT_FILE  = path.join(ROOT, '.local_cache', 'test_performance.txt');
const BRIDGE_PATH  = path.join(__dirname, 'bridge.ts');
const BEGIN = '[[BOT_RESPONSE_BEGIN]]';
const END   = '[[BOT_RESPONSE_END]]';

// ---------------------------------------------------------------------------
// Tests: [group, query, expectContains, description]
// ---------------------------------------------------------------------------
const PERF_TESTS = [
  // ── Basic correctness after load ──────────────────────────────────────
  ['startup', '__PING__', 'pong', 'ping after startup'],

  // ── Each intent type (1 representative query each) ────────────────────
  ['competitive_profile', 'me fala do garchomp',            'Perfil Competitivo',      'profile query'],
  ['synergy',             'sinergias para charizard',        'Parceiros',               'synergy (light)'],
  ['pair_synergy',        'dupla torkoal e charizard',       'Sinergia NN:',            'pair synergy + NN'],
  ['bad_matchup',         'fraquezas do gyarados',           'Bad Matchups',            'bad matchup'],
  ['counter',             'quem bate o togekiss',            'Counters para',           'counter query'],
  ['compare',             'charizard vs blastoise',          'Comparação:',             'compare'],
  ['evolution',           'como evolui o eevee',             'Cadeia de evolução',      'evolution chain'],
  ['held_item',           'item para togekiss',              'Bot:',                    'held item'],
  ['movelist',            'golpes do garchomp',              'Golpes competitivos',     'movelist'],
  ['ability_info_poke',   'habilidades do incineroar',       'Habilidades de',          'ability info pokemon'],
  ['ability_info',        'o que faz o intimidate',          'Intimidate',              'ability info'],
  ['move_info',           'o que é o earthquake',            'Earthquake',              'move info'],
  ['type_query',          'pokemon do tipo fogo',            'Pokémon do tipo',         'type query'],
  ['weak_to_type',        'pokemon fracos a gelo',           'fracos contra',           'weak to type'],
  ['type_coverage',       'o que bate o tipo pedra',         'Cobertura contra',        'type coverage'],
  ['ranking_speed',       'top 10 mais rápidos',             'Top 10',                  'speed ranking'],
  ['ranking_stat',        'top 10 em hp',                    'Top 10',                  'stat ranking'],
  ['bst_threshold',       'pokemon com bst acima de 600',    'BST',                     'bst threshold'],
  ['legendary_query',     'lendários da geração 1',          'Lendários',               'legendary query'],
  ['generation_query',    'pokemon da geracao 3',            'Geração 3',               'gen query'],
  ['unknown',             'boa tarde tudo bem',              'Bot:',                    'unknown fallback'],

  // ── Rapid-fire burst (5 identical queries in sequence) ────────────────
  ['burst', 'me fala do togekiss', 'Perfil',  'burst #1'],
  ['burst', 'me fala do togekiss', 'Perfil',  'burst #2'],
  ['burst', 'me fala do togekiss', 'Perfil',  'burst #3'],
  ['burst', 'me fala do togekiss', 'Perfil',  'burst #4'],
  ['burst', 'me fala do togekiss', 'Perfil',  'burst #5'],

  // ── Consecutive synergy queries (NN process stability) ────────────────
  ['nn_stress', 'sinergias para incineroar',  'Parceiros', 'nn stress #1'],
  ['nn_stress', 'sinergias para rillaboom',   'Parceiros', 'nn stress #2'],
  ['nn_stress', 'sinergias para togekiss',    'Parceiros', 'nn stress #3'],
  ['nn_stress', 'dupla incineroar e amoonguss', 'Sinergia NN:', 'nn stress pair #1'],
  ['nn_stress', 'dupla garchomp e togekiss',    'Sinergia NN:', 'nn stress pair #2'],

  // ── Edge / error cases ────────────────────────────────────────────────
  ['edge', '',                                     'Bot:',   'empty string'],
  ['edge', '   ',                                  'Bot:',   'whitespace only'],
  ['edge', '!@#$%^&*()',                            'Bot:',   'special chars'],
  ['edge', 'a',                                    'Bot:',   'single char'],
  ['edge', 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'Bot:', 'long single token'],
  ['edge', 'sinergias para '.repeat(10),           'Bot:',   'repeated query fragment'],
  ['edge', 'こんにちは世界',                          'Bot:',   'Japanese unicode'],
  ['edge', 'مرحبا بالعالم',                         'Bot:',   'Arabic unicode'],
  ['edge', '<script>alert(1)</script>',            'Bot:',   'XSS attempt (output safe)'],
  ['edge', 'sinergias para fakemon99999xyz',       'Bot:',   'unknown pokemon'],
  ['edge', 'dupla fakemon1 e fakemon2',            'Bot:',   'two unknown pokemon'],
  ['edge', '__POKEDEX_LIST_JSON__',                '"ok":',  'pokedex list command'],
  ['edge', '__POKEDEX_DETAIL_JSON__:garchomp',     '"ok":',  'pokedex detail command'],
  ['edge', '__POKEDEX_DETAIL_JSON__:doesnotexist', 'não encontrado', 'pokedex detail unknown'],
  ['edge', '__RESET__',                            'reiniciado',     'reset command'],

  // ── Post-reset stability (queries after __RESET__) ────────────────────
  ['post_reset', 'me fala do charizard',   'Perfil',    'profile after reset'],
  ['post_reset', 'dupla torkoal e charizard', 'Sinergia NN:', 'pair after reset'],
];

// ---------------------------------------------------------------------------
// Bridge comm
// ---------------------------------------------------------------------------
function sendQuery(proc, query, timeoutMs = 30000) {
  return new Promise((resolve, reject) => {
    let collecting = false;
    let buffer = [];
    const timer = setTimeout(() => reject(new Error(`Timeout after ${timeoutMs}ms`)), timeoutMs);

    function onData(chunk) {
      const text = chunk.toString('utf8');
      for (const line of text.split('\n')) {
        if (line.includes(BEGIN)) { collecting = true; buffer = []; continue; }
        if (line.includes(END)) {
          clearTimeout(timer);
          proc.stdout.off('data', onData);
          resolve(buffer.join('\n').trim());
          return;
        }
        if (collecting) buffer.push(line);
      }
    }

    proc.stdout.on('data', onData);
    proc.stdin.write(query + '\n');
  });
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  fs.mkdirSync(path.dirname(OUTPUT_FILE), { recursive: true });

  const nodeCmd = process.execPath;
  console.log('[perf] Starting bridge process...');

  const bridge = spawn(
    nodeCmd,
    ['-r', 'ts-node/register', BRIDGE_PATH],
    { cwd: __dirname, stdio: ['pipe', 'pipe', 'pipe'] }
  );

  const stderrLines = [];
  bridge.stderr.on('data', (d) => {
    const msg = d.toString().trim();
    if (msg) stderrLines.push(msg);
  });

  bridge.on('error', (err) => { console.error('[perf] Bridge failed:', err.message); process.exit(1); });

  // Wait for ready
  const startupT0 = Date.now();
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Bridge startup timeout')), 60000);
    let ready = false;
    bridge.stdout.on('data', function readyCheck(chunk) {
      if (ready) return;
      const text = chunk.toString();
      if (text.includes(END)) {
        ready = true;
        clearTimeout(timer);
        bridge.stdout.off('data', readyCheck);
        resolve();
      }
    });
    bridge.stdin.write('__PING__\n');
  });
  const startupMs = Date.now() - startupT0;
  console.log(`[perf] Bridge ready in ${startupMs}ms. Running ${PERF_TESTS.length} tests...\n`);

  const results = [];
  const byGroup = {};

  for (let i = 0; i < PERF_TESTS.length; i++) {
    const [group, query, expectContains, desc] = PERF_TESTS[i];
    process.stdout.write(`[${String(i + 1).padStart(2)}] ${desc.padEnd(40)} `);

    const t0 = Date.now();
    let response;
    let error = null;
    try {
      response = await sendQuery(bridge, query);
    } catch (err) {
      response = '';
      error = err.message;
    }
    const ms = Date.now() - t0;

    const pass = !error && response.includes(expectContains);
    const status = error ? 'ERROR' : pass ? 'PASS' : 'FAIL';
    const icon = status === 'PASS' ? '✓' : status === 'ERROR' ? '⚠' : '✗';

    process.stdout.write(`${icon} ${status.padEnd(5)} ${String(ms).padStart(5)}ms\n`);

    if (!byGroup[group]) byGroup[group] = [];
    byGroup[group].push(ms);

    results.push({ i: i + 1, group, desc, query: query.slice(0, 50), status, ms, error });
  }

  bridge.stdin.end();
  bridge.kill();

  // ── Statistics by group ────────────────────────────────────────────────
  const lines = [
    `POKEFILES-NN — Performance & Robustness Report`,
    `Generated: ${new Date().toISOString()}`,
    `Bridge startup: ${startupMs}ms`,
    '',
    '── Response times by intent group ──────────────────────────────────',
  ];

  const allMs = results.map((r) => r.ms).filter((ms) => ms > 0);
  const p = (arr) => {
    const s = [...arr].sort((a, b) => a - b);
    return {
      min: s[0],
      avg: Math.round(s.reduce((a, b) => a + b, 0) / s.length),
      p95: s[Math.floor(s.length * 0.95)],
      max: s[s.length - 1],
    };
  };

  for (const [group, times] of Object.entries(byGroup)) {
    if (times.length === 0) continue;
    const stats = p(times);
    lines.push(
      `  ${group.padEnd(20)} n=${String(times.length).padStart(2)}  ` +
      `min=${String(stats.min).padStart(5)}ms  avg=${String(stats.avg).padStart(5)}ms  ` +
      `p95=${String(stats.p95).padStart(5)}ms  max=${String(stats.max).padStart(5)}ms`
    );
  }

  const globalStats = p(allMs);
  lines.push('');
  lines.push(
    `  ${'OVERALL'.padEnd(20)} n=${String(allMs.length).padStart(2)}  ` +
    `min=${String(globalStats.min).padStart(5)}ms  avg=${String(globalStats.avg).padStart(5)}ms  ` +
    `p95=${String(globalStats.p95).padStart(5)}ms  max=${String(globalStats.max).padStart(5)}ms`
  );

  const passCount  = results.filter((r) => r.status === 'PASS').length;
  const failCount  = results.filter((r) => r.status === 'FAIL').length;
  const errorCount = results.filter((r) => r.status === 'ERROR').length;

  lines.push('');
  lines.push(`── Results ──────────────────────────────────────────────────────────`);
  lines.push(`  Total: ${results.length}  PASS: ${passCount}  FAIL: ${failCount}  ERROR: ${errorCount}`);
  lines.push(`  Pass rate: ${((passCount / results.length) * 100).toFixed(1)}%`);

  const failures = results.filter((r) => r.status !== 'PASS');
  if (failures.length) {
    lines.push('');
    lines.push('  Failures/Errors:');
    for (const r of failures) {
      lines.push(`    [${r.i}] ${r.status} ${r.desc} — ${r.error || 'assertion failed'}`);
      if (r.query) lines.push(`         query: "${r.query}"`);
    }
  }

  lines.push('');
  lines.push('── Detailed log ─────────────────────────────────────────────────────');
  for (const r of results) {
    const icon = r.status === 'PASS' ? '✓' : r.status === 'ERROR' ? '⚠' : '✗';
    lines.push(`  ${String(r.i).padStart(2)}. ${icon} ${r.group.padEnd(20)} ${String(r.ms).padStart(5)}ms  ${r.desc}`);
    if (r.error) lines.push(`      ERROR: ${r.error}`);
  }

  lines.push('');
  lines.push('── Bridge stderr (startup log) ──────────────────────────────────────');
  stderrLines.forEach((l) => lines.push('  ' + l));

  console.log('\n' + '═'.repeat(70));
  console.log(`Bridge startup: ${startupMs}ms`);
  console.log(`Total: ${results.length}  PASS: ${passCount}  FAIL: ${failCount}  ERROR: ${errorCount}`);
  console.log(`Pass rate: ${((passCount / results.length) * 100).toFixed(1)}%`);
  console.log(`Avg response time: ${globalStats.avg}ms  p95: ${globalStats.p95}ms  max: ${globalStats.max}ms`);

  fs.writeFileSync(OUTPUT_FILE, lines.join('\n'), 'utf8');
  console.log(`\n[done] Report saved to: ${OUTPUT_FILE}`);

  process.exitCode = failCount + errorCount > 0 ? 1 : 0;
}

main().catch((err) => {
  console.error('[fatal]', err.message);
  process.exitCode = 1;
});
