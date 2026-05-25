'use strict';
/**
 * Comprehensive bridge quality test — covers all 21 intents in PT-BR and EN,
 * NN integration checks, typo tolerance, and edge cases.
 *
 * Run:  node tools/nn/test_bridge_responses.js
 * Out:  .local_cache/test_responses.txt  (full responses)
 *       .local_cache/test_summary.txt    (PASS/FAIL table)
 */

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT        = path.resolve(__dirname, '../..');
const OUTPUT_FILE = path.join(ROOT, '.local_cache', 'test_responses.txt');
const SUMMARY_FILE = path.join(ROOT, '.local_cache', 'test_summary.txt');
const BRIDGE_PATH = path.join(__dirname, 'bridge.ts');
const BEGIN = '[[BOT_RESPONSE_BEGIN]]';
const END   = '[[BOT_RESPONSE_END]]';

// ---------------------------------------------------------------------------
// Test case format:
//   query   : string sent to bridge
//   intent  : expected intent label (for grouping)
//   note    : human-readable description
//   checks  : [{ contains?, notContains?, minLength? }] — ALL must pass
// ---------------------------------------------------------------------------
const TEST_CASES = [

  // ══════════════════════════════════════════════════════════════════
  // 1. COMPETITIVE PROFILE
  // ══════════════════════════════════════════════════════════════════
  {
    query: 'me fala do garchomp',
    intent: 'competitive_profile',
    note: 'PT: profile via "me fala do" — Garchomp',
    checks: [
      { contains: 'Perfil Competitivo', desc: 'has profile header' },
      { contains: 'Garchomp',           desc: 'correct pokemon name' },
      { contains: 'Stats base',         desc: 'has base stats' },
      { contains: 'Habilidades',        desc: 'has abilities section' },
      { notContains: 'não encontrado',  desc: 'no not-found error' },
    ],
  },
  {
    query: 'perfil competitivo do togekiss',
    intent: 'competitive_profile',
    note: 'PT: profile via "perfil competitivo do"',
    checks: [
      { contains: 'Perfil Competitivo', desc: 'has profile header' },
      { contains: 'Togekiss',           desc: 'correct pokemon name' },
      { contains: 'Serene Grace',       desc: 'has signature ability' },
    ],
  },
  {
    query: 'como usar o incineroar no vgc',
    intent: 'competitive_profile',
    note: 'PT: profile via "como usar"',
    checks: [
      { contains: 'Incineroar',         desc: 'correct pokemon' },
      { contains: 'Intimidate',         desc: 'has Intimidate ability' },
    ],
  },
  {
    query: 'tell me about charizard',
    intent: 'competitive_profile',
    note: 'EN: "tell me about" — expect profile or disambiguation',
    checks: [
      { contains: 'Bot:',               desc: 'has bot response prefix' },
      { contains: 'Charizard',          desc: 'pokemon mentioned' },
    ],
  },

  // ══════════════════════════════════════════════════════════════════
  // 2. SYNERGY SUGGESTIONS (NN active check)
  // ══════════════════════════════════════════════════════════════════
  {
    query: 'sinergias para torkoal',
    intent: 'synergy',
    note: 'PT: synergy list — Torkoal (weather setter, expect sun beneficiaries)',
    checks: [
      { contains: 'Parceiros',          desc: 'has synergy header' },
      { contains: 'Torkoal',            desc: 'correct pokemon' },
      { minLength: 200,                 desc: 'substantial response' },
      { notContains: 'não encontrado',  desc: 'no error' },
    ],
  },
  {
    query: 'quem combina com charizard',
    intent: 'synergy',
    note: 'PT: synergy via "quem combina com"',
    checks: [
      { contains: 'Bot:',               desc: 'has bot prefix' },
      { contains: 'Charizard',          desc: 'pokemon mentioned' },
      { minLength: 100,                 desc: 'has candidates' },
    ],
  },
  {
    query: 'parceiros para togekiss',
    intent: 'synergy',
    note: 'PT: synergy via "parceiros para"',
    checks: [
      { contains: 'Bot:',               desc: 'has bot prefix' },
      { contains: 'Togekiss',           desc: 'pokemon mentioned' },
    ],
  },
  {
    query: 'who pairs well with garchomp',
    intent: 'synergy',
    note: 'EN: synergy — "who pairs well with" (tests EN coverage)',
    checks: [
      { contains: 'Bot:',               desc: 'has bot prefix' },
    ],
  },

  // ══════════════════════════════════════════════════════════════════
  // 3. PAIR SYNERGY — NN LINE REQUIRED
  // ══════════════════════════════════════════════════════════════════
  {
    query: 'dupla torkoal e charizard',
    intent: 'pair_synergy',
    note: 'PT: pair synergy — known high-synergy pair (sun team core)',
    checks: [
      { contains: 'Torkoal',            desc: 'pokemon A in response' },
      { contains: 'Charizard',          desc: 'pokemon B in response' },
      { contains: 'Sinergia NN:',       desc: 'NN score line present (NN active)' },
      { notContains: 'não encontrado',  desc: 'no error' },
    ],
  },
  {
    query: 'togekiss e garchomp juntos',
    intent: 'pair_synergy',
    note: 'PT: pair synergy via "juntos" — classic VGC duo',
    checks: [
      { contains: 'Togekiss',           desc: 'pokemon A' },
      { contains: 'Garchomp',           desc: 'pokemon B' },
      { contains: 'Sinergia NN:',       desc: 'NN score present' },
    ],
  },
  {
    query: 'dupla incineroar e rillaboom',
    intent: 'pair_synergy',
    note: 'PT: pair — both have high usage in competitive (Intimidate + Grassy Surge)',
    checks: [
      { contains: 'Incineroar',         desc: 'pokemon A' },
      { contains: 'Rillaboom',          desc: 'pokemon B' },
      { contains: 'Sinergia NN:',       desc: 'NN score present' },
    ],
  },

  // ══════════════════════════════════════════════════════════════════
  // 4. BAD MATCHUPS
  // ══════════════════════════════════════════════════════════════════
  {
    query: 'contra quem eu teria dificuldade de ganhar usando um gyarados',
    intent: 'bad_matchup',
    note: 'PT: bad matchup via "dificuldade usando"',
    checks: [
      { contains: 'Bad Matchups',       desc: 'has bad matchup header' },
      { contains: 'Gyarados',           desc: 'correct pokemon' },
      { contains: 'Elétrico',           desc: 'electric weakness listed' },
    ],
  },
  {
    query: 'fraquezas do incineroar',
    intent: 'bad_matchup',
    note: 'PT: bad matchup via "fraquezas do"',
    checks: [
      { contains: 'Incineroar',         desc: 'correct pokemon' },
      { contains: 'Água',               desc: 'water weakness' },
    ],
  },
  {
    query: 'o que ameaça o togekiss',
    intent: 'bad_matchup',
    note: 'PT: threats via "o que ameaça"',
    checks: [
      { contains: 'Togekiss',           desc: 'correct pokemon' },
      { contains: 'Bad Matchups',       desc: 'has section header' },
    ],
  },
  {
    query: 'quem countera o tornadus',
    intent: 'bad_matchup',
    note: 'PT: bad matchup via "quem countera"',
    checks: [
      { contains: 'Tornadus',           desc: 'correct pokemon' },
    ],
  },

  // ══════════════════════════════════════════════════════════════════
  // 5. COUNTER QUERY
  // ══════════════════════════════════════════════════════════════════
  {
    query: 'quem bate o garchomp',
    intent: 'counter',
    note: 'PT: counter via "quem bate"',
    checks: [
      { contains: 'Counters para',      desc: 'has counter header' },
      { contains: 'Garchomp',           desc: 'correct pokemon' },
      { contains: 'Gelo',               desc: 'ice weakness listed' },
    ],
  },
  {
    query: 'como derrotar um togekiss',
    intent: 'counter',
    note: 'PT: counter via "como derrotar"',
    checks: [
      { contains: 'Togekiss',           desc: 'correct pokemon' },
      { contains: 'Bot:',               desc: 'has bot prefix' },
    ],
  },
  {
    query: 'who beats charizard',
    intent: 'counter',
    note: 'EN: counter — "who beats"',
    checks: [
      { contains: 'Bot:',               desc: 'has bot prefix' },
    ],
  },

  // ══════════════════════════════════════════════════════════════════
  // 6. COMPARE
  // ══════════════════════════════════════════════════════════════════
  {
    query: 'charizard vs garchomp',
    intent: 'compare',
    note: 'PT/EN: compare via "vs"',
    checks: [
      { contains: 'Comparação:',        desc: 'has compare header' },
      { contains: 'Charizard',          desc: 'pokemon A' },
      { contains: 'Garchomp',           desc: 'pokemon B' },
      { contains: 'BST',                desc: 'has BST comparison' },
    ],
  },
  {
    query: 'comparar togekiss e incineroar',
    intent: 'compare',
    note: 'PT: compare via "comparar"',
    checks: [
      { contains: 'Comparação:',        desc: 'has compare header' },
      { contains: 'Togekiss',           desc: 'pokemon A' },
      { contains: 'Incineroar',         desc: 'pokemon B' },
    ],
  },

  // ══════════════════════════════════════════════════════════════════
  // 7. EVOLUTION
  // ══════════════════════════════════════════════════════════════════
  {
    query: 'como evolui o eevee',
    intent: 'evolution',
    note: 'PT: evolution chain — Eevee (branching evolution)',
    checks: [
      { contains: 'Cadeia de evolução', desc: 'has evolution header' },
      { contains: 'Eevee',              desc: 'correct pokemon' },
      { minLength: 100,                 desc: 'has multiple branches' },
    ],
  },
  {
    query: 'cadeia de evolução do garchomp',
    intent: 'evolution',
    note: 'PT: evolution via "cadeia de evolução"',
    checks: [
      { contains: 'Garchomp',           desc: 'correct pokemon' },
      { contains: 'Gible',              desc: 'first stage present' },
    ],
  },
  {
    query: 'evolution chain of togekiss',
    intent: 'evolution',
    note: 'EN: evolution — "evolution chain of"',
    checks: [
      { contains: 'Bot:',               desc: 'has bot prefix' },
    ],
  },

  // ══════════════════════════════════════════════════════════════════
  // 8. HELD ITEMS
  // ══════════════════════════════════════════════════════════════════
  {
    query: 'item para togekiss',
    intent: 'held_item',
    note: 'PT: held item via "item para"',
    checks: [
      { contains: 'Togekiss',           desc: 'correct pokemon' },
      { contains: 'Bot:',               desc: 'has response' },
    ],
  },
  {
    query: 'melhor held item para garchomp',
    intent: 'held_item',
    note: 'EN/PT: held item via "held item"',
    checks: [
      { contains: 'Garchomp',           desc: 'correct pokemon' },
      { contains: 'Bot:',               desc: 'has response' },
    ],
  },

  // ══════════════════════════════════════════════════════════════════
  // 9. MOVELIST
  // ══════════════════════════════════════════════════════════════════
  {
    query: 'que golpes o garchomp aprende',
    intent: 'movelist',
    note: 'PT: movelist via "que golpes aprende"',
    checks: [
      { contains: 'Golpes competitivos de', desc: 'has movelist header' },
      { contains: 'Garchomp',             desc: 'correct pokemon' },
    ],
  },
  {
    query: 'moveset do togekiss',
    intent: 'movelist',
    note: 'PT: movelist via "moveset do"',
    checks: [
      { contains: 'Togekiss',           desc: 'correct pokemon' },
      { contains: 'Golpes',             desc: 'has moves' },
    ],
  },

  // ══════════════════════════════════════════════════════════════════
  // 10. ABILITY INFO
  // ══════════════════════════════════════════════════════════════════
  {
    query: 'habilidades do incineroar',
    intent: 'ability_info_pokemon',
    note: 'PT: ability info for pokemon via "habilidades do"',
    checks: [
      { contains: 'Habilidades de Incineroar', desc: 'has ability header' },
      { contains: 'Intimidate',               desc: 'lists Intimidate' },
    ],
  },
  {
    query: 'o que faz a habilidade intimidate',
    intent: 'ability_info',
    note: 'PT: ability info via "o que faz"',
    checks: [
      { contains: 'Intimidate',         desc: 'correct ability' },
      { contains: 'Bot:',               desc: 'has response' },
    ],
  },
  {
    query: 'o que é o speed boost',
    intent: 'ability_info',
    note: 'PT: ability info via "o que é"',
    checks: [
      { contains: 'Speed Boost',        desc: 'correct ability' },
    ],
  },

  // ══════════════════════════════════════════════════════════════════
  // 11. MOVE INFO
  // ══════════════════════════════════════════════════════════════════
  {
    query: 'o que é o earthquake',
    intent: 'move_info',
    note: 'EN: move info via "o que é"',
    checks: [
      { contains: 'Earthquake',         desc: 'correct move' },
      { contains: 'Terra',              desc: 'ground type listed' },
    ],
  },
  {
    query: 'como funciona o golpe fake out',
    intent: 'move_info',
    note: 'PT: move info via "como funciona"',
    checks: [
      { contains: 'Fake Out',           desc: 'correct move' },
      { contains: 'Bot:',               desc: 'has response' },
    ],
  },

  // ══════════════════════════════════════════════════════════════════
  // 12. TYPE QUERY
  // ══════════════════════════════════════════════════════════════════
  {
    query: 'pokemon do tipo fogo',
    intent: 'type_query',
    note: 'PT: type query — fire type',
    checks: [
      { contains: 'Pokémon do tipo Fogo', desc: 'has type query header' },
      { contains: 'Charizard',            desc: 'Charizard is fire type' },
    ],
  },
  {
    query: 'pokemon do tipo dragao da geracao 4',
    intent: 'type_query',
    note: 'PT: type + generation filter',
    checks: [
      { contains: 'Dragão',             desc: 'dragon type listed' },
      { contains: 'Geração 4',          desc: 'gen 4 filter applied' },
    ],
  },
  {
    query: 'water type pokemon',
    intent: 'type_query',
    note: 'EN: type query — water',
    checks: [
      { contains: 'Bot:',               desc: 'has response' },
    ],
  },

  // ══════════════════════════════════════════════════════════════════
  // 13. WEAK TO TYPE
  // ══════════════════════════════════════════════════════════════════
  {
    query: 'quem é fraco contra gelo',
    intent: 'weak_to_type',
    note: 'PT: weak to ice type',
    checks: [
      { contains: 'fracos contra Gelo', desc: 'correct header' },
      { contains: 'Dragão',             desc: 'dragon type listed as weak to ice' },
      { contains: '×4',                 desc: 'quadruple weakness listed' },
    ],
  },
  {
    query: 'pokemon fracos a fogo',
    intent: 'weak_to_type',
    note: 'PT: weak to fire',
    checks: [
      { contains: 'Bot:',               desc: 'has response' },
      { contains: 'Fogo',               desc: 'fire type mentioned' },
    ],
  },

  // ══════════════════════════════════════════════════════════════════
  // 14. TYPE COVERAGE
  // ══════════════════════════════════════════════════════════════════
  {
    query: 'o que bate o tipo pedra',
    intent: 'type_coverage',
    note: 'PT: coverage against rock type',
    checks: [
      { contains: 'Cobertura contra o tipo Pedra', desc: 'correct header' },
      { contains: 'Água',               desc: 'water beats rock' },
      { contains: 'Planta',             desc: 'grass beats rock' },
    ],
  },
  {
    query: 'cobertura de tipo contra fantasma',
    intent: 'type_coverage',
    note: 'PT: coverage against ghost type',
    checks: [
      { contains: 'Fantasma',           desc: 'ghost mentioned' },
      { contains: 'Bot:',               desc: 'has response' },
    ],
  },

  // ══════════════════════════════════════════════════════════════════
  // 15. SPEED RANKING
  // ══════════════════════════════════════════════════════════════════
  {
    query: 'quem são os mais velozes sem lendários',
    intent: 'ranking_speed',
    note: 'PT: speed ranking without legendaries',
    checks: [
      { contains: 'Top',                desc: 'has ranking header' },
      { contains: 'Velocidade',         desc: 'speed stat listed' },
    ],
  },
  {
    query: 'top 10 mais rápidos',
    intent: 'ranking_speed',
    note: 'PT: top 10 speed',
    checks: [
      { contains: 'Top 10',             desc: 'limit 10 applied' },
    ],
  },

  // ══════════════════════════════════════════════════════════════════
  // 16. STAT RANKING
  // ══════════════════════════════════════════════════════════════════
  {
    query: 'ranking de maior ataque',
    intent: 'ranking_stat',
    note: 'PT: attack ranking',
    checks: [
      { contains: 'Top',                desc: 'has ranking' },
      { contains: 'Ataque',             desc: 'attack stat' },
    ],
  },
  {
    query: 'top 10 em hp',
    intent: 'ranking_stat',
    note: 'PT: HP ranking top 10',
    checks: [
      { contains: 'Top 10',             desc: 'limit applied' },
      { contains: 'HP',                 desc: 'HP listed' },
    ],
  },

  // ══════════════════════════════════════════════════════════════════
  // 17. BST THRESHOLD
  // ══════════════════════════════════════════════════════════════════
  {
    query: 'pokemon com bst acima de 600',
    intent: 'bst_threshold',
    note: 'PT: BST above 600',
    checks: [
      { contains: 'BST acima de 600',   desc: 'threshold in header' },
      { contains: 'Bot:',               desc: 'has response' },
    ],
  },
  {
    query: 'pokemon com bst abaixo de 300',
    intent: 'bst_threshold',
    note: 'PT: BST below 300',
    checks: [
      { contains: 'BST abaixo de 300',  desc: 'threshold in header' },
    ],
  },

  // ══════════════════════════════════════════════════════════════════
  // 18. LEGENDARY QUERY
  // ══════════════════════════════════════════════════════════════════
  {
    query: 'lendários da geração 1',
    intent: 'legendary_query',
    note: 'PT: legendaries of gen 1',
    checks: [
      { contains: 'Lendários/Míticos',  desc: 'has legendary header' },
      { contains: 'Mewtwo',             desc: 'Mewtwo is gen 1 legendary' },
    ],
  },
  {
    query: 'miticos do tipo psiquico',
    intent: 'legendary_query',
    note: 'PT: psychic mythicals',
    checks: [
      { contains: 'Lendários',          desc: 'legendary header' },
      { contains: 'Bot:',               desc: 'has response' },
    ],
  },

  // ══════════════════════════════════════════════════════════════════
  // 19. GENERATION QUERY
  // ══════════════════════════════════════════════════════════════════
  {
    query: 'pokemon da geracao 3',
    intent: 'generation_query',
    note: 'PT: generation 3 pokemon',
    checks: [
      { contains: 'Pokémon da Geração 3', desc: 'has gen header' },
      { contains: 'Swampert',            desc: 'Swampert is gen 3' },
    ],
  },
  {
    query: 'quais pokemon são da geração 8',
    intent: 'generation_query',
    note: 'PT: gen 8 pokemon list',
    checks: [
      { contains: 'Geração 8',          desc: 'correct generation' },
    ],
  },

  // ══════════════════════════════════════════════════════════════════
  // 20. DETAIL / INFO
  // ══════════════════════════════════════════════════════════════════
  {
    query: 'informações do garchomp',
    intent: 'detail',
    note: 'PT: detail via "informações do" — falls back to competitive profile',
    checks: [
      { contains: 'Garchomp',           desc: 'correct pokemon' },
      { contains: 'Bot:',               desc: 'has response' },
    ],
  },
  {
    query: 'stats do charizard',
    intent: 'detail',
    note: 'PT: stats via "stats do"',
    checks: [
      { contains: 'Charizard',          desc: 'correct pokemon' },
      { contains: 'Bot:',               desc: 'has response' },
    ],
  },

  // ══════════════════════════════════════════════════════════════════
  // 21. UNKNOWN / HELP FALLBACK
  // ══════════════════════════════════════════════════════════════════
  {
    query: 'olá tudo bem',
    intent: 'unknown',
    note: 'Unknown intent — should return help menu',
    checks: [
      { contains: 'Bot:',               desc: 'has bot prefix' },
    ],
  },
  {
    query: 'what is the best pokemon ever',
    intent: 'unknown',
    note: 'EN: unrecognized query — graceful fallback',
    checks: [
      { contains: 'Bot:',               desc: 'has bot prefix' },
      { notContains: 'Error',           desc: 'no crash' },
    ],
  },

  // ══════════════════════════════════════════════════════════════════
  // 22. TYPO TOLERANCE
  // ══════════════════════════════════════════════════════════════════
  { query: 'me fala do garcomp',           intent: 'typo_N1', note: '[TYPO] "garcomp" → garchomp (1 edit)', checks: [{ contains: 'Garchomp', desc: 'fuzzy match resolved' }] },
  { query: 'perfil do togekis',            intent: 'typo_N1', note: '[TYPO] "togekis" → togekiss (1 edit)', checks: [{ contains: 'Togekiss', desc: 'fuzzy match resolved' }] },
  { query: 'sinergias pra torkol',         intent: 'typo_N1', note: '[TYPO] "torkol" → torkoal (1 edit)',  checks: [{ contains: 'Torkoal',  desc: 'fuzzy match resolved' }] },
  { query: 'me fala do charizerd',         intent: 'typo_N2', note: '[TYPO] "charizerd" → charizard (1 sub)', checks: [{ contains: 'Charizard', desc: 'fuzzy match resolved' }] },
  { query: 'sinergias para insineroar',    intent: 'typo_N2', note: '[TYPO] "insineroar" → incineroar (1 sub)', checks: [{ contains: 'Incineroar', desc: 'fuzzy match resolved' }] },
  { query: 'como usar o urshfiu',          intent: 'typo_N2', note: '[TYPO] "urshfiu" → urshifu (transposition)', checks: [{ contains: 'Urshifu', desc: 'fuzzy match resolved' }] },
  { query: 'dupla charizrd e torkol',      intent: 'typo_N3', note: '[TYPO] double-typo pair synergy', checks: [{ contains: 'Sinergia NN:', desc: 'NN active in pair synergy' }] },

  // ══════════════════════════════════════════════════════════════════
  // 23. EDGE CASES
  // ══════════════════════════════════════════════════════════════════
  {
    query: '',
    intent: 'edge_empty',
    note: 'Empty input — should respond gracefully',
    checks: [
      { contains: 'Bot:',               desc: 'graceful response' },
      { notContains: 'Error',           desc: 'no crash' },
    ],
  },
  {
    query: '!@#$%^&*()',
    intent: 'edge_garbage',
    note: 'Garbage characters — should not crash',
    checks: [
      { contains: 'Bot:',               desc: 'graceful response' },
    ],
  },
  {
    query: 'sinergias para xyznonexistentpokemon123',
    intent: 'edge_unknown_pokemon',
    note: 'Unknown pokemon name — graceful error message',
    checks: [
      { contains: 'Bot:',               desc: 'has response' },
      { notContains: 'TypeError',       desc: 'no JS error' },
      { notContains: 'undefined',       desc: 'no undefined in output' },
    ],
  },
  {
    query: 'dupla pikachu e raichu',
    intent: 'edge_nfe_pair',
    note: 'NFE pair — raichu is fully evolved, pikachu may be filtered; response expected',
    checks: [
      { contains: 'Bot:',               desc: 'has response' },
    ],
  },
  {
    query: '__PING__',
    intent: 'edge_command',
    note: 'Direct PING command',
    checks: [
      { contains: 'pong',               desc: 'correct pong response' },
    ],
  },
  {
    query: '__RESET__',
    intent: 'edge_command',
    note: 'RESET command',
    checks: [
      { contains: 'reiniciado',         desc: 'reset confirmed' },
    ],
  },

  // ══════════════════════════════════════════════════════════════════
  // 24. QUIZ — LOBBY + DIFFICULTY + EXPANDED TYPES + SPEED CONTROL
  // ══════════════════════════════════════════════════════════════════
  {
    query: 'quiz',
    intent: 'quiz_lobby',
    note: 'Bare "quiz" → lobby menu with 4 type buttons',
    checks: [
      { contains: '[[QUIZ_MENU]]',      desc: 'menu block present' },
      { contains: 'quiz tipos',         desc: 'types option present' },
      { contains: 'quiz velocidade',    desc: 'speed option present' },
    ],
  },
  {
    query: 'quiz de tipos',
    intent: 'quiz_difficulty_select',
    note: 'quiz tipos → difficulty select menu',
    checks: [
      { contains: '[[QUIZ_MENU]]',      desc: 'menu block present' },
      { contains: 'fácil',              desc: 'easy option present' },
      { contains: 'difícil',            desc: 'hard option present' },
    ],
  },
  {
    query: 'quiz de tipos fácil',
    intent: 'quiz_expanded_types',
    note: 'PT: type quiz easy — must emit [[QUIZ_CHOICES]] block with 4 options',
    checks: [
      { contains: '[[QUIZ_CHOICES]]',   desc: 'choices block present' },
      { contains: 'A)',                 desc: 'option A present' },
      { contains: 'D)',                 desc: 'option D present' },
      { contains: 'Quiz Tipos',         desc: 'correct header' },
      { contains: '[Fácil]',            desc: 'difficulty label present' },
    ],
  },
  {
    query: 'quiz de tipos difícil',
    intent: 'quiz_types_hard',
    note: 'PT: type quiz hard — must emit [[QUIZ_CHOICES]] with [Difícil] header',
    checks: [
      { contains: '[[QUIZ_CHOICES]]',   desc: 'choices block present' },
      { contains: 'Quiz Tipos',         desc: 'correct header' },
      { contains: '[Difícil]',          desc: 'difficulty label present' },
    ],
  },
  {
    query: 'quiz de velocidade fácil',
    intent: 'quiz_speed',
    note: 'PT: speed control quiz — must emit [[QUIZ_CHOICES]] with Speed Control header',
    checks: [
      { contains: '[[QUIZ_CHOICES]]',   desc: 'choices block present' },
      { contains: 'Quiz Speed Control', desc: 'correct header' },
      { contains: 'A)',                 desc: 'option A present' },
      { contains: 'D)',                 desc: 'option D present' },
    ],
  },
  {
    query: 'quiz de prioridade fácil',
    intent: 'quiz_speed',
    note: 'PT: speed control quiz via "prioridade" keyword',
    checks: [
      { contains: '[[QUIZ_CHOICES]]',   desc: 'choices block present' },
      { contains: 'Quiz Speed Control', desc: 'correct header' },
    ],
  },
  {
    query: 'quiz de tailwind fácil',
    intent: 'quiz_speed',
    note: 'PT: speed control quiz via "tailwind" keyword',
    checks: [
      { contains: '[[QUIZ_CHOICES]]',   desc: 'choices block present' },
      { contains: 'Quiz Speed Control', desc: 'correct header' },
    ],
  },
];

// ---------------------------------------------------------------------------
// Assertion runner
// ---------------------------------------------------------------------------
function runChecks(response, checks) {
  const results = [];
  let allPass = true;
  for (const check of checks) {
    let pass;
    let label = check.desc || '';
    if (check.contains !== undefined) {
      pass = response.includes(check.contains);
      label = label || `contains "${check.contains}"`;
    } else if (check.notContains !== undefined) {
      pass = !response.includes(check.notContains);
      label = label || `not contains "${check.notContains}"`;
    } else if (check.minLength !== undefined) {
      pass = response.length >= check.minLength;
      label = label || `length >= ${check.minLength} (got ${response.length})`;
    } else if (check.matches !== undefined) {
      pass = check.matches.test(response);
      label = label || `matches ${check.matches}`;
    } else {
      pass = true;
      label = '(unknown check)';
    }
    results.push({ pass, label });
    if (!pass) allPass = false;
  }
  return { pass: allPass, results };
}

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
  console.log('[bridge] Starting process...');

  const bridge = spawn(
    nodeCmd,
    ['-r', 'ts-node/register', BRIDGE_PATH],
    { cwd: __dirname, stdio: ['pipe', 'pipe', 'pipe'] }
  );

  bridge.stderr.on('data', (d) => {
    const msg = d.toString().trim();
    if (msg) process.stderr.write('[bridge-err] ' + msg + '\n');
  });

  bridge.on('error', (err) => { console.error('[bridge] Failed to start:', err.message); process.exit(1); });

  // Wait for bridge to be ready
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Bridge startup timeout (60s)')), 60000);
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

  console.log('[bridge] Ready. Running', TEST_CASES.length, 'test cases...\n');

  const SEP_THICK = '═'.repeat(70);
  const SEP_THIN  = '─'.repeat(70);

  const fullLines = [
    `POKEFILES-NN — Comprehensive Quality Test`,
    `Generated: ${new Date().toISOString()}`,
    `Tests: ${TEST_CASES.length}`,
    '',
  ];

  const summaryRows = [];
  let totalPass = 0, totalFail = 0, totalTimeout = 0;
  const byIntent = {};

  for (let i = 0; i < TEST_CASES.length; i++) {
    const { query, intent, note, checks } = TEST_CASES[i];
    const label = `[${String(i + 1).padStart(2, '0')}/${TEST_CASES.length}]`;
    process.stdout.write(`${label} ${query.slice(0, 55).padEnd(55)} `);

    let response;
    let timedOut = false;
    const t0 = Date.now();
    try {
      response = await sendQuery(bridge, query);
    } catch (err) {
      response = `[TIMEOUT/ERROR: ${err.message}]`;
      timedOut = true;
    }
    const ms = Date.now() - t0;

    const { pass: allPass, results: checkResults } = timedOut
      ? { pass: false, results: [{ pass: false, label: 'Timeout' }] }
      : runChecks(response, checks || []);

    const status = timedOut ? 'TIMEOUT' : allPass ? 'PASS' : 'FAIL';
    const icon   = status === 'PASS' ? '✓' : status === 'FAIL' ? '✗' : '⏱';
    process.stdout.write(`${icon} ${status.padEnd(7)} ${ms}ms\n`);

    if (status === 'PASS') totalPass++;
    else if (status === 'FAIL') totalFail++;
    else totalTimeout++;

    if (!byIntent[intent]) byIntent[intent] = { pass: 0, fail: 0 };
    if (allPass && !timedOut) byIntent[intent].pass++;
    else byIntent[intent].fail++;

    const failedChecks = checkResults.filter((r) => !r.pass);

    fullLines.push(SEP_THICK);
    fullLines.push(`[${i + 1}] ${status} | ${intent.toUpperCase()} | ${ms}ms`);
    fullLines.push(`  Query: ${query}`);
    fullLines.push(`  Note:  ${note}`);
    if (failedChecks.length) {
      fullLines.push(`  FAILED CHECKS:`);
      failedChecks.forEach((r) => fullLines.push(`    ✗ ${r.label}`));
    }
    fullLines.push(SEP_THIN);
    fullLines.push(response);
    fullLines.push('');

    summaryRows.push({ i: i + 1, status, intent, ms, note: note.slice(0, 60) });
  }

  bridge.stdin.end();
  bridge.kill();

  // ── Summary ──────────────────────────────────────────────────────────────
  const summaryLines = [
    `POKEFILES-NN — Test Summary`,
    `Generated: ${new Date().toISOString()}`,
    '',
    `Total: ${TEST_CASES.length}  PASS: ${totalPass}  FAIL: ${totalFail}  TIMEOUT: ${totalTimeout}`,
    `Pass rate: ${((totalPass / TEST_CASES.length) * 100).toFixed(1)}%`,
    '',
    'Results by intent:',
  ];

  for (const [intent, stats] of Object.entries(byIntent).sort()) {
    const total = stats.pass + stats.fail;
    const pct   = ((stats.pass / total) * 100).toFixed(0);
    summaryLines.push(
      `  ${intent.padEnd(25)} ${stats.pass}/${total}  ${pct}%  ${stats.fail > 0 ? '← FAILURES' : ''}`
    );
  }

  summaryLines.push('');
  summaryLines.push('Detailed results:');
  for (const r of summaryRows) {
    const icon = r.status === 'PASS' ? '✓' : r.status === 'FAIL' ? '✗' : '⏱';
    summaryLines.push(
      `  ${String(r.i).padStart(2)}. ${icon} ${r.status.padEnd(7)} ${r.intent.padEnd(25)} ${r.ms}ms  ${r.note}`
    );
  }

  console.log('\n' + '═'.repeat(70));
  summaryLines.forEach((l) => console.log(l));
  console.log('═'.repeat(70));

  fs.writeFileSync(OUTPUT_FILE,  fullLines.join('\n'),   'utf8');
  fs.writeFileSync(SUMMARY_FILE, summaryLines.join('\n'), 'utf8');
  console.log(`\n[done] Full responses:  ${OUTPUT_FILE}`);
  console.log(`[done] Summary table:   ${SUMMARY_FILE}`);

  process.exitCode = totalFail + totalTimeout > 0 ? 1 : 0;
}

main().catch((err) => {
  console.error('[fatal]', err.message);
  process.exitCode = 1;
});
