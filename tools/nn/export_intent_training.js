'use strict';
// Exports intent/NLU training examples as JSONL.
// Sources:
//   1. Static golden set from tests/nlp_token_heuristics_tests.pl (hand-curated)
//   2. Template expansion: cross pokemon names × query patterns per intent
//   3. Prolog execution: spawns swipl to verify examples against the live parser
//
// Output: .local_cache/nn_export/training/intent_training.jsonl
//
// Run: node export_intent_training.js [--output-dir=<path>] [--no-prolog-verify]

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// ---------------------------------------------------------------------------
// CLI args
// ---------------------------------------------------------------------------
const args = Object.fromEntries(
  process.argv.slice(2)
    .filter((a) => a.startsWith('--'))
    .map((a) => {
      const [k, v] = a.slice(2).split('=');
      return [k, v ?? 'true'];
    })
);

const OUTPUT_DIR = path.resolve(
  args['output-dir'] ?? path.join(__dirname, '../../.local_cache/nn_export/training')
);
const NO_PROLOG = args['no-prolog-verify'] === 'true';
const PROJECT_ROOT = path.resolve(__dirname, '../..');

// ---------------------------------------------------------------------------
// Golden set — hand-curated examples from nlp_token_heuristics_tests.pl
// Format: { text, intent, slots, confidence, source }
// ---------------------------------------------------------------------------
const GOLDEN_EXAMPLES = [
  // --- pokedex / info ---
  { text: 'pokemom nome pikachu', intent: 'pokemon_info', slots: { name: 'pikachu' }, confidence: 1.0 },
  { text: 'info pikachu', intent: 'pokemon_info', slots: { name: 'pikachu' }, confidence: 1.0 },
  { text: 'detalhes do charizard', intent: 'pokemon_info', slots: { name: 'charizard' }, confidence: 1.0 },
  { text: 'me fala do gardevoir', intent: 'pokemon_info', slots: { name: 'gardevoir' }, confidence: 1.0 },
  { text: 'qual o numero 94', intent: 'pokemon_info_by_number', slots: { number: 94 }, confidence: 1.0 },
  { text: 'pokedex 25', intent: 'pokemon_info_by_number', slots: { number: 25 }, confidence: 1.0 },

  // --- counter ---
  { text: 'quem vense contra charizard', intent: 'counter_query', slots: { target: 'charizard' }, confidence: 1.0 },
  { text: 'qual resposta para garchomp', intent: 'counter_query', slots: { target: 'garchomp' }, confidence: 1.0 },
  { text: 'como punir charizard', intent: 'counter_query', slots: { target: 'charizard' }, confidence: 1.0 },
  { text: 'quem responde melhor contra charizard', intent: 'counter_query', slots: { target: 'charizard' }, confidence: 1.0 },
  { text: 'melhores counters do tyranitar', intent: 'counter_query', slots: { target: 'tyranitar' }, confidence: 1.0 },
  { text: 'quem bate garchomp', intent: 'counter_query', slots: { target: 'garchomp' }, confidence: 1.0 },

  // --- type query ---
  { text: 'qunatos pokemom do tipo fogo', intent: 'type_query', slots: { types: ['fire'], mode: 'list' }, confidence: 1.0 },
  { text: 'exiba pokemons tipo fogo', intent: 'type_query', slots: { types: ['fire'], mode: 'list' }, confidence: 1.0 },
  { text: 'quantos eletrico e planta', intent: 'type_query', slots: { types: ['electric', 'grass'], mode: 'count' }, confidence: 1.0 },
  { text: 'manda pokemons tipo gelo', intent: 'type_query', slots: { types: ['ice'], mode: 'list' }, confidence: 1.0 },
  { text: 'traga pokemons elemento fogo', intent: 'type_query', slots: { types: ['fire'], mode: 'list' }, confidence: 1.0 },

  // --- level query ---
  { text: 'qunatos pokemom do tipo fogo ate nivle 40', intent: 'level_query', slots: { types: ['fire'], level_constraint: { op: 'at_most', value: 40 } }, confidence: 1.0 },
  { text: 'quais pokemons acima do nivel 40 tipo fogo', intent: 'level_query', slots: { types: ['fire'], level_constraint: { op: 'at_least', value: 40 } }, confidence: 1.0 },
  { text: 'quais pokemons abaixo do nivel 40 tipo fogo', intent: 'level_query', slots: { types: ['fire'], level_constraint: { op: 'at_most', value: 40 } }, confidence: 1.0 },

  // --- weakness query ---
  { text: 'quais sao vuln contra agua', intent: 'weakness_query', slots: { types: ['water'] }, confidence: 1.0 },
  { text: 'quais pokemon perdem para fogo', intent: 'weakness_query', slots: { types: ['fire'] }, confidence: 1.0 },

  // --- evolution ---
  { text: 'como o eevee evolui por felicidade', intent: 'evolution_query', slots: { name: 'eevee', condition_focus: 'happiness' }, confidence: 1.0 },
  { text: 'tenho um bulbasaur nivel 20 ele ja deveria ter evoluido', intent: 'evolution_should_have_query', slots: { name: 'bulbasaur', level: 20 }, confidence: 1.0 },
  { text: 'me mostra a arvore completa do eevee', intent: 'evolution_chain_query', slots: { name: 'eevee' }, confidence: 1.0 },
  { text: 'em que nivel charmander evolui', intent: 'evolution_query', slots: { name: 'charmander' }, confidence: 1.0 },
  { text: 'como evoluir slowpoke', intent: 'evolution_query', slots: { name: 'slowpoke' }, confidence: 1.0 },

  // --- compare / battle ---
  { text: 'comparativo entre pikachu e raichu', intent: 'compare_query', slots: { pokemon_a: 'pikachu', pokemon_b: 'raichu' }, confidence: 1.0 },
  { text: 'comparando pikachu e raichu', intent: 'compare_query', slots: { pokemon_a: 'pikachu', pokemon_b: 'raichu' }, confidence: 1.0 },
  { text: 'comparar pikachu e raichu e quem ganha', intent: 'compare_query', slots: { pokemon_a: 'pikachu', pokemon_b: 'raichu' }, confidence: 1.0 },
  { text: 'qual a diferenca entre pikachu e raichu', intent: 'compare_query', slots: { pokemon_a: 'pikachu', pokemon_b: 'raichu' }, confidence: 1.0 },
  { text: 'pikachu vs raichu', intent: 'compare_query', slots: { pokemon_a: 'pikachu', pokemon_b: 'raichu' }, confidence: 1.0 },

  // --- ability / move ---
  { text: 'o que faz a passiva do tyranitar', intent: 'ability_query', slots: { name: 'tyranitar' }, confidence: 1.0 },
  { text: 'o que faz clear body do metagross', intent: 'ability_query', slots: { name: 'metagross', ability: 'clear-body' }, confidence: 1.0 },
  { text: 'info sobre rough skin', intent: 'ability_info', slots: { ability: 'rough-skin' }, confidence: 1.0 },
  { text: 'skills do charizard', intent: 'move_query', slots: { name: 'charizard' }, confidence: 1.0 },

  // --- held item ---
  { text: 'qual held item combina com hawlucha', intent: 'held_item_query', slots: { name: 'hawlucha', strategy: 'general' }, confidence: 1.0 },
  { text: 'quais itens para cobrir fraqueza do dragonite', intent: 'held_item_query', slots: { name: 'dragonite', strategy: 'cover_weakness' }, confidence: 1.0 },
  { text: 'melhor black sludge para toxapex', intent: 'held_item_query', slots: { name: 'toxapex', item: 'black-sludge' }, confidence: 1.0 },
  { text: 'melhor held item para peliper', intent: 'held_item_query', slots: { name: 'pelipper', strategy: 'general' }, confidence: 1.0 },
  { text: 'melhor item para hawlucha', intent: 'held_item_query', slots: { name: 'hawlucha', strategy: 'general' }, confidence: 1.0 },

  // --- doubles / synergy ---
  { text: 'quem combina com togekiss no doubles', intent: 'doubles_partner_query', slots: { name: 'togekiss' }, confidence: 1.0 },
  { text: 'parceiro ideal para incineroar', intent: 'doubles_partner_query', slots: { name: 'incineroar' }, confidence: 1.0 },
  { text: 'sinergia de garchomp e togekiss', intent: 'doubles_synergy_query', slots: { pokemon_a: 'garchomp', pokemon_b: 'togekiss' }, confidence: 1.0 },
  { text: 'como funciona follow me no doubles', intent: 'doubles_strategy_query', slots: { topic: 'follow_me' }, confidence: 1.0 },

  // --- ranking ---
  { text: 'quais os mais rapidos', intent: 'ranking_query', slots: { stat: 'speed', mode: 'top' }, confidence: 1.0 },
  { text: 'top 10 ataque especial', intent: 'ranking_query', slots: { stat: 'special_attack', mode: 'top', limit: 10 }, confidence: 1.0 },
  { text: 'os mais bulk', intent: 'ranking_query', slots: { stat: 'bulk', mode: 'top' }, confidence: 1.0 },

  // --- generation ---
  { text: 'quais pokemon da geracao 1', intent: 'generation_query', slots: { generation: 1 }, confidence: 1.0 },
  { text: 'mostra gen 3', intent: 'generation_query', slots: { generation: 3 }, confidence: 1.0 },

  // --- system ---
  { text: '__PING__', intent: 'system_ping', slots: {}, confidence: 1.0 },
  { text: '__RESET__', intent: 'system_reset', slots: {}, confidence: 1.0 },
];

// ---------------------------------------------------------------------------
// Confusion study set — 54 examples from tests/intent_confusion_study.pl
// Intent class mapping: rules→tournament_rules_query, strategy→doubles_strategy_query,
//   held_item_recommendation→held_item_query, specific_item_detail→item_info_query,
//   specific_move_detail→move_info_query, pokemon_movelist→move_query,
//   global_movelist→move_list_query, ability_details→ability_query, ability_catalog→ability_info
// ---------------------------------------------------------------------------
const CONFUSION_STUDY_EXAMPLES = [
  // rules
  { text: 'regras vgc de tempo de movimento',          intent: 'tournament_rules_query', slots: { topic: 'time_limit' } },
  { text: 'manual vgc sobre bo3 e topcut',             intent: 'tournament_rules_query', slots: { topic: 'bo3' } },
  { text: 'penalidades no torneio vgc',                intent: 'tournament_rules_query', slots: { topic: 'penalties' } },
  { text: 'como funciona team list no vgc',            intent: 'tournament_rules_query', slots: { topic: 'team_list' } },
  { text: 'o que e morte subita no vgc',               intent: 'tournament_rules_query', slots: { topic: 'sudden_death' } },
  { text: 'juiz pode desclassificar no vgc',           intent: 'tournament_rules_query', slots: { topic: 'disqualification' } },
  // strategy
  { text: 'qual estrategia de speed control no vgc doubles', intent: 'doubles_strategy_query', slots: { topic: 'speed_control' } },
  { text: 'como lidar com trick room em dupla',        intent: 'doubles_strategy_query', slots: { topic: 'trick_room' } },
  { text: 'sinergia entre tyranitar e garchomp',       intent: 'doubles_synergy_query',  slots: { pokemon_a: 'tyranitar', pokemon_b: 'garchomp' } },
  { text: 'parceiros para tyranitar',                  intent: 'doubles_partner_query',  slots: { name: 'tyranitar' } },
  { text: 'plano de jogo para doubles com chuva',      intent: 'doubles_strategy_query', slots: { topic: 'rain_team' } },
  { text: 'ajuste de bo3 no vgc doubles',              intent: 'doubles_strategy_query', slots: { topic: 'bo3' } },
  // held item recommendation
  { text: 'melhor item para hawlucha',                 intent: 'held_item_query', slots: { name: 'hawlucha', strategy: 'general' } },
  { text: 'quais itens para cobrir fraqueza do dragonite', intent: 'held_item_query', slots: { name: 'dragonite', strategy: 'cover_weakness' } },
  { text: 'melhor black sludge para toxapex',          intent: 'held_item_query', slots: { name: 'toxapex', item: 'black_sludge' } },
  { text: 'qual held item combina com pelipper',       intent: 'held_item_query', slots: { name: 'pelipper', strategy: 'general' } },
  { text: 'item para ferrothorn segurar melhor',       intent: 'held_item_query', slots: { name: 'ferrothorn', strategy: 'general' } },
  { text: 'quero item para fortalecer o charizard',    intent: 'held_item_query', slots: { name: 'charizard', strategy: 'offensive' } },
  // specific item detail
  { text: 'o que faz black sludge',                   intent: 'item_info_query', slots: { item: 'black_sludge' } },
  { text: 'efeito de focus sash',                     intent: 'item_info_query', slots: { item: 'focus_sash' } },
  { text: 'como funciona choice scarf',               intent: 'item_info_query', slots: { item: 'choice_scarf' } },
  { text: 'detalhes do assault vest',                 intent: 'item_info_query', slots: { item: 'assault_vest' } },
  { text: 'descricao de leftovers',                   intent: 'item_info_query', slots: { item: 'leftovers' } },
  { text: 'info sobre air balloon',                   intent: 'item_info_query', slots: { item: 'air_balloon' } },
  // specific move detail
  { text: 'qual o efeito de thunder wave',            intent: 'move_info_query', slots: { move: 'thunder_wave' } },
  { text: 'o que faz trick room',                     intent: 'move_info_query', slots: { move: 'trick_room' } },
  { text: 'poder e precisao de hydro pump',           intent: 'move_info_query', slots: { move: 'hydro_pump' } },
  { text: 'detalhes do move u turn',                  intent: 'move_info_query', slots: { move: 'u_turn' } },
  { text: 'como funciona protect',                    intent: 'move_info_query', slots: { move: 'protect' } },
  { text: 'informacoes de stealth rock',              intent: 'move_info_query', slots: { move: 'stealth_rock' } },
  // pokemon movelist
  { text: 'moves do charizard',                       intent: 'move_query', slots: { name: 'charizard' } },
  { text: 'golpes do garchomp',                       intent: 'move_query', slots: { name: 'garchomp' } },
  { text: 'movelist do pelipper',                     intent: 'move_query', slots: { name: 'pelipper' } },
  { text: 'moveset do tyranitar',                     intent: 'move_query', slots: { name: 'tyranitar' } },
  { text: 'quais moves do ferrothorn',                intent: 'move_query', slots: { name: 'ferrothorn' } },
  { text: 'lista de golpes do toxapex',               intent: 'move_query', slots: { name: 'toxapex' } },
  // global movelist
  { text: 'lista de moves',                           intent: 'move_list_query', slots: {} },
  { text: 'listar todos os golpes do jogo',           intent: 'move_list_query', slots: {} },
  { text: 'moves presentes no jogo',                  intent: 'move_list_query', slots: {} },
  { text: 'lista geral de golpes',                    intent: 'move_list_query', slots: {} },
  { text: 'mostrar lista de moves',                   intent: 'move_list_query', slots: {} },
  { text: 'quais sao os moves catalogados',           intent: 'move_list_query', slots: {} },
  // ability details (pokemon-specific)
  { text: 'o que faz a passiva do tyranitar',         intent: 'ability_query', slots: { name: 'tyranitar' } },
  { text: 'clear body do metagross faz o que',        intent: 'ability_query', slots: { name: 'metagross', ability: 'clear_body' } },
  { text: 'efeito da habilidade do ferrothorn',       intent: 'ability_query', slots: { name: 'ferrothorn' } },
  { text: 'como funciona drizzle do pelipper',        intent: 'ability_query', slots: { name: 'pelipper', ability: 'drizzle' } },
  { text: 'o que faz iron barbs do ferrothorn',       intent: 'ability_query', slots: { name: 'ferrothorn', ability: 'iron_barbs' } },
  { text: 'habilidades do toxapex e o que fazem',     intent: 'ability_query', slots: { name: 'toxapex' } },
  // ability catalog (move-catalog style queries)
  { text: 'ability intimidate',                       intent: 'ability_info', slots: { ability: 'intimidate' } },
  { text: 'habilidade levitate',                      intent: 'ability_info', slots: { ability: 'levitate' } },
  { text: 'efeito da ability clear body',             intent: 'ability_info', slots: { ability: 'clear_body' } },
  { text: 'o que faz unburden',                       intent: 'ability_info', slots: { ability: 'unburden' } },
  { text: 'info sobre rough skin',                    intent: 'ability_info', slots: { ability: 'rough_skin' } },
  { text: 'detalhes da habilidade drought',           intent: 'ability_info', slots: { ability: 'drought' } },
];

// ---------------------------------------------------------------------------
// Template expansion — generates variations for core intents
// ---------------------------------------------------------------------------
const POKEMON_SAMPLE = [
  'pikachu', 'charizard', 'garchomp', 'togekiss', 'tyranitar',
  'dragonite', 'metagross', 'gardevoir', 'incineroar', 'urshifu_single_strike',
  'rillaboom', 'ferrothorn', 'pelipper', 'toxapex', 'flutter_mane',
  'hawlucha', 'kyogre', 'groudon', 'zacian', 'calyrex_shadow',
];

const ITEM_SAMPLE = [
  'choice_scarf', 'choice_band', 'choice_specs', 'assault_vest', 'focus_sash',
  'leftovers', 'rocky_helmet', 'life_orb', 'air_balloon', 'lum_berry',
];

const MOVE_SAMPLE = [
  'protect', 'trick_room', 'tailwind', 'thunder_wave', 'earthquake',
  'flamethrower', 'hydro_pump', 'moonblast', 'close_combat', 'u_turn',
];

const ABILITY_SAMPLE = [
  'intimidate', 'levitate', 'drought', 'drizzle', 'sand_stream',
  'clear_body', 'iron_barbs', 'regenerator', 'speed_boost', 'unburden',
];

const TEMPLATE_RULES = [
  {
    intent: 'counter_query',
    patterns: [
      (p) => `quem bate ${p}`,
      (p) => `melhores counters de ${p}`,
      (p) => `qual pokemon responde ${p}`,
      (p) => `como parar ${p}`,
      (p) => `respostas para ${p}`,
      (p) => `${p} fraco contra quem`,
    ],
    slots: (p) => ({ target: p }),
  },
  {
    intent: 'pokemon_info',
    patterns: [
      (p) => `info ${p}`,
      (p) => `dados do ${p}`,
      (p) => `me fala do ${p}`,
      (p) => `ficha do ${p}`,
      (p) => `detalhes de ${p}`,
    ],
    slots: (p) => ({ name: p }),
  },
  {
    intent: 'held_item_query',
    patterns: [
      (p) => `melhor item para ${p}`,
      (p) => `qual held item para ${p}`,
      (p) => `item recomendado para ${p}`,
      (p) => `que item usar com ${p}`,
    ],
    slots: (p) => ({ name: p, strategy: 'general' }),
  },
  {
    intent: 'doubles_partner_query',
    patterns: [
      (p) => `quem combina com ${p}`,
      (p) => `parceiro para ${p} em doubles`,
      (p) => `melhor duo com ${p}`,
      (p) => `quem faz dupla com ${p}`,
    ],
    slots: (p) => ({ name: p }),
  },
  {
    intent: 'evolution_query',
    patterns: [
      (p) => `como ${p} evolui`,
      (p) => `em que nivel ${p} evolui`,
      (p) => `evolucao de ${p}`,
    ],
    slots: (p) => ({ name: p }),
  },
  {
    intent: 'ability_query',
    patterns: [
      (p) => `passiva do ${p}`,
      (p) => `o que faz a habilidade do ${p}`,
      (p) => `qual a ability do ${p}`,
    ],
    slots: (p) => ({ name: p }),
  },
];

// Templates for intents that expand over items / moves / abilities (not pokemon names)
const ITEM_TEMPLATE_RULES = [
  {
    intent: 'item_info_query',
    patterns: [
      (i) => `o que faz ${i.replace(/_/g, ' ')}`,
      (i) => `efeito de ${i.replace(/_/g, ' ')}`,
      (i) => `como funciona ${i.replace(/_/g, ' ')}`,
      (i) => `detalhes do item ${i.replace(/_/g, ' ')}`,
      (i) => `info sobre ${i.replace(/_/g, ' ')}`,
    ],
    slots: (i) => ({ item: i }),
  },
];

const MOVE_TEMPLATE_RULES = [
  {
    intent: 'move_info_query',
    patterns: [
      (m) => `o que faz ${m.replace(/_/g, ' ')}`,
      (m) => `efeito do move ${m.replace(/_/g, ' ')}`,
      (m) => `como funciona ${m.replace(/_/g, ' ')}`,
      (m) => `poder e precisao de ${m.replace(/_/g, ' ')}`,
      (m) => `detalhes do golpe ${m.replace(/_/g, ' ')}`,
    ],
    slots: (m) => ({ move: m }),
  },
  {
    intent: 'move_query',
    patterns: [
      (p) => `moves do ${p}`,
      (p) => `golpes do ${p}`,
      (p) => `movelist do ${p}`,
      (p) => `moveset do ${p}`,
      (p) => `quais golpes ${p} aprende`,
    ],
    slots: (p) => ({ name: p }),
  },
];

const ABILITY_TEMPLATE_RULES = [
  {
    intent: 'ability_info',
    patterns: [
      (a) => `ability ${a.replace(/_/g, ' ')}`,
      (a) => `habilidade ${a.replace(/_/g, ' ')}`,
      (a) => `o que faz ${a.replace(/_/g, ' ')}`,
      (a) => `efeito da ability ${a.replace(/_/g, ' ')}`,
      (a) => `info sobre ${a.replace(/_/g, ' ')}`,
    ],
    slots: (a) => ({ ability: a }),
  },
];

const VGC_TOPIC_EXAMPLES = [
  { text: 'como montar um time vgc doubles',          intent: 'doubles_strategy_query', slots: { topic: 'team_building' } },
  { text: 'o que e speed control em doubles',         intent: 'doubles_strategy_query', slots: { topic: 'speed_control' } },
  { text: 'como usar trick room no doubles vgc',      intent: 'doubles_strategy_query', slots: { topic: 'trick_room' } },
  { text: 'estrategia de tailwind no vgc',            intent: 'doubles_strategy_query', slots: { topic: 'tailwind' } },
  { text: 'como funciona follow me no doubles',       intent: 'doubles_strategy_query', slots: { topic: 'follow_me' } },
  { text: 'regras do formato vgc',                    intent: 'tournament_rules_query', slots: { topic: 'general' } },
  { text: 'como funciona time limit no vgc',          intent: 'tournament_rules_query', slots: { topic: 'time_limit' } },
  { text: 'regras do best of 3 vgc',                  intent: 'tournament_rules_query', slots: { topic: 'bo3' } },
  { text: 'lista de moves',                           intent: 'move_list_query', slots: {} },
  { text: 'todos os golpes do jogo',                  intent: 'move_list_query', slots: {} },
  { text: 'catalogo de moves',                        intent: 'move_list_query', slots: {} },
  { text: 'listar golpes disponiveis',                intent: 'move_list_query', slots: {} },
];

function expandTemplates() {
  const examples = [];

  // Pokemon-based templates
  for (const rule of TEMPLATE_RULES) {
    for (const pokemon of POKEMON_SAMPLE) {
      for (const pattern of rule.patterns) {
        examples.push({
          text: pattern(pokemon),
          intent: rule.intent,
          slots: rule.slots(pokemon),
          confidence: 0.9,
          source: 'template_expansion',
        });
      }
    }
  }

  // Move-query templates (pokemon names as subject)
  for (const rule of MOVE_TEMPLATE_RULES.filter((r) => r.intent === 'move_query')) {
    for (const pokemon of POKEMON_SAMPLE) {
      for (const pattern of rule.patterns) {
        examples.push({
          text: pattern(pokemon),
          intent: rule.intent,
          slots: rule.slots(pokemon),
          confidence: 0.9,
          source: 'template_expansion',
        });
      }
    }
  }

  // Item info templates
  for (const rule of ITEM_TEMPLATE_RULES) {
    for (const item of ITEM_SAMPLE) {
      for (const pattern of rule.patterns) {
        examples.push({
          text: pattern(item),
          intent: rule.intent,
          slots: rule.slots(item),
          confidence: 0.9,
          source: 'template_expansion',
        });
      }
    }
  }

  // Move info templates
  for (const rule of MOVE_TEMPLATE_RULES.filter((r) => r.intent === 'move_info_query')) {
    for (const move of MOVE_SAMPLE) {
      for (const pattern of rule.patterns) {
        examples.push({
          text: pattern(move),
          intent: rule.intent,
          slots: rule.slots(move),
          confidence: 0.9,
          source: 'template_expansion',
        });
      }
    }
  }

  // Ability info templates
  for (const rule of ABILITY_TEMPLATE_RULES) {
    for (const ability of ABILITY_SAMPLE) {
      for (const pattern of rule.patterns) {
        examples.push({
          text: pattern(ability),
          intent: rule.intent,
          slots: rule.slots(ability),
          confidence: 0.9,
          source: 'template_expansion',
        });
      }
    }
  }

  // VGC topic fixed examples
  for (const ex of VGC_TOPIC_EXAMPLES) {
    examples.push({ ...ex, confidence: 0.9, source: 'template_expansion' });
  }

  return examples;
}

// ---------------------------------------------------------------------------
// Prolog verification — verifies golden examples against the live parser
// ---------------------------------------------------------------------------
function buildVerifyGoal(text) {
  const escaped = text.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
  return `( resolve_intent_rule('${escaped}', _, _Goal, normal) -> write(ok) ; write(no_match) ), nl`;
}

function verifyExamplesWithProlog(examples) {
  console.log('[intent] verifying golden set via Prolog...');

  const queries = examples.map((ex) => buildVerifyGoal(ex.text)).join(',\n');
  const fullGoal = `ensure_test_db_ready, (${queries})`;

  const result = spawnSync(
    'swipl',
    ['-q', '-g', fullGoal, '-g', 'halt',
     path.join(PROJECT_ROOT, 'tests/nlp_token_heuristics_tests.pl')],
    {
      cwd: PROJECT_ROOT,
      encoding: 'utf8',
      timeout: 120_000,
      maxBuffer: 32 * 1024 * 1024,
    }
  );

  if (result.status !== 0 || result.error) {
    console.warn('[intent] Prolog verification skipped (error):', result.stderr?.slice(0, 200));
    return examples.map((ex) => ({ ...ex, prolog_verified: false }));
  }

  const outputs = result.stdout.trim().split('\n').map((l) => l.trim());
  return examples.map((ex, i) => ({
    ...ex,
    prolog_verified: outputs[i] === 'ok',
  }));
}

// ---------------------------------------------------------------------------
// Write JSONL
// ---------------------------------------------------------------------------
function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function deduplicateByText(examples) {
  const seen = new Set();
  return examples.filter((ex) => {
    const key = ex.text.toLowerCase().trim();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function main() {
  ensureDir(OUTPUT_DIR);

  const timestamp = new Date().toISOString();

  // 1. Collect all examples
  const golden = GOLDEN_EXAMPLES.map((ex) => ({
    ...ex,
    source: ex.source ?? 'golden_set',
    export_time: timestamp,
  }));

  const confusionStudy = CONFUSION_STUDY_EXAMPLES.map((ex) => ({
    ...ex,
    confidence: ex.confidence ?? 1.0,
    source: 'confusion_study',
    export_time: timestamp,
  }));

  const expanded = expandTemplates().map((ex) => ({
    ...ex,
    export_time: timestamp,
  }));

  let combined = deduplicateByText([...golden, ...confusionStudy, ...expanded]);

  // 2. Optional Prolog verification on golden set
  if (!NO_PROLOG) {
    const verifiedGolden = verifyExamplesWithProlog(
      golden.filter((ex) => ex.source === 'golden_set')
    );
    const goldenMap = new Map(verifiedGolden.map((ex) => [ex.text, ex]));
    combined = combined.map((ex) => goldenMap.get(ex.text) ?? ex);
  }

  // 3. Write JSONL
  const outPath = path.join(OUTPUT_DIR, 'intent_training.jsonl');
  const lines = combined.map((ex) => JSON.stringify(ex));
  fs.writeFileSync(outPath, lines.join('\n') + '\n', 'utf8');

  // 4. Manifest entry
  const manifest = {
    export_time: timestamp,
    output_file: outPath,
    total_examples: combined.length,
    intents: [...new Set(combined.map((ex) => ex.intent))].sort(),
    prolog_verified: !NO_PROLOG,
  };
  const manifestPath = path.join(OUTPUT_DIR, 'intent_manifest.json');
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');

  console.log(`[intent] written ${combined.length} examples to ${outPath}`);
  console.log(`[intent] intents: ${manifest.intents.join(', ')}`);
  console.log(`[intent] manifest: ${manifestPath}`);
}

main();
