/**
 * Natural language response preview — no pass/fail assertions, just read outputs.
 * Run: node tools/nn/test_natural.js
 */
'use strict';

const { spawn } = require('child_process');
const path = require('path');

const BRIDGE_PATH = path.join(__dirname, 'bridge.ts');
const BEGIN = '[[BOT_RESPONSE_BEGIN]]';
const END   = '[[BOT_RESPONSE_END]]';

const QUERIES = [
  // Perfil competitivo
  { q: 'me fala do torkoal',                        label: 'perfil PT' },
  { q: 'what role does flutter mane play in vgc?',  label: 'perfil EN' },
  { q: 'é o clefairy bom no doubles?',              label: 'perfil informal' },

  // Sinergia (lista)
  { q: 'sinergias para o kyogre',                   label: 'sinergia PT' },
  { q: 'who should I use with miraidon?',           label: 'sinergia EN' },

  // Par específico
  { q: 'torkoal e charizard juntos',                label: 'par PT (NN)' },
  { q: 'how good is pelipper with kyogre?',         label: 'par EN (NN)' },

  // Bad matchup / counter
  { q: 'o que ameaça o garchomp?',                  label: 'ameaças PT' },
  { q: 'how to beat trick room teams?',             label: 'counter EN' },

  // Comparação
  { q: 'togekiss ou clefairy no vgc?',              label: 'compare PT' },
  { q: 'miraidon vs calyrex shadow',                label: 'compare EN' },

  // Evolução
  { q: 'como o ralts evolui?',                      label: 'evolução PT' },
  { q: 'what does eevee evolve into?',              label: 'evolução EN' },

  // Moveset / item
  { q: 'que golpes o kingambit aprende?',            label: 'movelist PT' },
  { q: 'what item should togekiss hold?',           label: 'item EN' },

  // Habilidade / golpe
  { q: 'o que faz o protosynthesis?',               label: 'ability info PT' },
  { q: 'como funciona o fake out nas duplas?',      label: 'move info PT' },
  { q: 'what does helping hand do?',                label: 'move info EN' },

  // Tipo / fraqueza / cobertura
  { q: 'pokemon do tipo fantasma da geração 5',     label: 'type query PT' },
  { q: 'quem é fraco contra tipo fada?',            label: 'weak_to_type PT' },
  { q: 'what beats dragon type?',                   label: 'coverage EN' },

  // Rankings / BST / Lendários
  { q: 'top 10 mais rápidos sem lendários',         label: 'ranking speed PT' },
  { q: 'quem tem maior defesa especial?',           label: 'ranking stat PT' },
  { q: 'pokemon com bst acima de 700',              label: 'bst threshold PT' },
  { q: 'lendários da geração 9',                    label: 'legendary PT' },
  { q: 'pokemon de galar',                          label: 'generation PT' },

  // Unknown
  { q: 'qual é o seu pokemon favorito?',            label: 'unknown PT' },
  { q: 'can you help me build a team?',             label: 'unknown EN' },
];

// ── Bridge comm (same pattern as test_bridge_responses.js) ──────────────────
function sendQuery(proc, query, timeoutMs = 30000) {
  return new Promise((resolve, reject) => {
    let collecting = false;
    let buffer = [];
    const timer = setTimeout(() => reject(new Error(`Timeout ${timeoutMs}ms`)), timeoutMs);

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

// ── Main ────────────────────────────────────────────────────────────────────
const SEP  = '─'.repeat(72);
const SEP2 = '═'.repeat(72);

(async () => {
  const nodeCmd = process.execPath;
  process.stdout.write('Iniciando bridge...\n');

  const bridge = spawn(nodeCmd, ['-r', 'ts-node/register', BRIDGE_PATH], {
    cwd: __dirname,
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  bridge.stderr.on('data', () => {});
  bridge.on('error', (err) => { console.error('Bridge error:', err.message); process.exit(1); });

  // Wait for bridge ready via PING
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Startup timeout')), 60000);
    let ready = false;
    bridge.stdout.on('data', function readyCheck(chunk) {
      if (ready) return;
      if (chunk.toString().includes(END)) {
        ready = true;
        clearTimeout(timer);
        bridge.stdout.off('data', readyCheck);
        resolve();
      }
    });
    bridge.stdin.write('__PING__\n');
  });

  process.stdout.write(`Bridge pronto. Rodando ${QUERIES.length} queries...\n\n`);
  console.log(SEP2);
  console.log('POKEFILES-NN — Natural Language Preview');
  console.log(`${QUERIES.length} queries | ${new Date().toLocaleString('pt-BR')}`);
  console.log(SEP2);

  for (const { q, label } of QUERIES) {
    let response;
    try {
      response = await sendQuery(bridge, q, 45000);
    } catch (e) {
      response = `(timeout: ${e.message})`;
    }
    console.log(`\n${SEP}`);
    console.log(`[${label}]  ${q}`);
    console.log(SEP);
    console.log(response);
  }

  console.log(`\n${SEP2}`);
  console.log('Fim dos testes.');
  bridge.kill();
  process.exit(0);
})();
