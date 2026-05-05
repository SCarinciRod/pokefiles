/**
 * bridge.ts — Node.js stdin/stdout bridge replacing gui/prolog_bridge.pl
 *
 * Protocol (identical to prolog_bridge.pl):
 *   stdin  line  → process → stdout wrapped in markers
 *
 * Markers:
 *   [[BOT_RESPONSE_BEGIN]]
 *   <response text>
 *   [[BOT_RESPONSE_END]]
 *
 * Commands:
 *   __PING__                       → "pong"
 *   __RESET__                      → reset state + confirm message
 *   __POKEDEX_LIST_JSON__           → {"ok":true,"pokemon":[...]}
 *   __POKEDEX_DETAIL_JSON__:<id>    → {"ok":true,"detail":{...}}
 *   <plain text>                    → NLU → intent handler → "Bot: ..."
 *
 * Usage:
 *   npx ts-node bridge.ts [--db=<path>]
 *   echo "__PING__" | npx ts-node bridge.ts
 */
import * as readline from 'readline';
import * as path from 'path';
import * as fs from 'fs';
import { DeterministicEngine, PokemonContext } from './engine';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
const args = Object.fromEntries(
  process.argv.slice(2)
    .filter((a) => a.startsWith('--'))
    .map((a) => {
      const [k, v] = a.slice(2).split('=');
      return [k, v ?? 'true'];
    })
);

const DEFAULT_DB = path.resolve(__dirname, '../../.local_cache/nn_export/pokefiles_nn.sqlite3');
const DB_PATH = process.env['BRIDGE_DB'] ?? args['db'] ?? DEFAULT_DB;

// ---------------------------------------------------------------------------
// Protocol helpers
// ---------------------------------------------------------------------------
function writeResponse(text: string): void {
  process.stdout.write('[[BOT_RESPONSE_BEGIN]]\n');
  process.stdout.write(text + '\n');
  process.stdout.write('[[BOT_RESPONSE_END]]\n');
}

// ---------------------------------------------------------------------------
// Pokedex builders (mirrors prolog_bridge.pl pokedex_list_entry + pokemon_detail_dict)
// ---------------------------------------------------------------------------
const TYPE_LABELS: Record<string, string> = {
  normal: 'Normal', fire: 'Fogo', water: 'Água', electric: 'Elétrico',
  grass: 'Planta', ice: 'Gelo', fighting: 'Lutador', poison: 'Veneno',
  ground: 'Terra', flying: 'Voador', psychic: 'Psíquico', bug: 'Inseto',
  rock: 'Pedra', ghost: 'Fantasma', dragon: 'Dragão', dark: 'Sombrio',
  steel: 'Aço', fairy: 'Fada',
};

function typeLabel(t: string): string {
  return TYPE_LABELS[t] ?? t;
}

function displayName(identifier: string): string {
  return identifier
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function buildListEntry(p: PokemonContext) {
  return {
    id: p.id,
    identifier: p.identifier,
    display_name: displayName(p.identifier),
    types: p.types,
    type_labels: p.types.map(typeLabel),
  };
}

function buildDetailEntry(p: PokemonContext, typeChart: Map<string, Map<string, number>>) {
  const stats = p.baseStats;
  const statEntries = [
    { key: 'hp',              label: 'HP',           value: stats.hp },
    { key: 'attack',          label: 'Ataque',        value: stats.attack },
    { key: 'defense',         label: 'Defesa',        value: stats.defense },
    { key: 'special_attack',  label: 'Ataque Esp.',   value: stats.special_attack },
    { key: 'special_defense', label: 'Defesa Esp.',   value: stats.special_defense },
    { key: 'speed',           label: 'Velocidade',    value: stats.speed },
  ];
  const maxStat = Math.max(...statEntries.map((s) => s.value));

  // Type effectiveness
  const ALL_ATTACK_TYPES = Object.keys(TYPE_LABELS);
  const weaknesses: { type: string; type_label: string; multiplier: string; multiplier_value: number }[] = [];
  const resistances: typeof weaknesses = [];
  const immunities: { type: string; type_label: string }[] = [];

  for (const atkType of ALL_ATTACK_TYPES) {
    const byAtk = typeChart.get(atkType);
    let mult = 1.0;
    for (const defType of p.types) {
      const v = byAtk?.get(defType);
      if (v !== undefined) mult *= v;
    }
    if (mult > 1.0) {
      weaknesses.push({ type: atkType, type_label: typeLabel(atkType), multiplier: `×${mult}`, multiplier_value: mult });
    } else if (mult === 0.0) {
      immunities.push({ type: atkType, type_label: typeLabel(atkType) });
    } else if (mult < 1.0) {
      resistances.push({ type: atkType, type_label: typeLabel(atkType), multiplier: `×${mult}`, multiplier_value: mult });
    }
  }

  return {
    id: p.id,
    identifier: p.identifier,
    display_name: displayName(p.identifier),
    height_dm: p.height_dm,
    height_m: p.height_dm / 10,
    weight_hg: p.weight_hg,
    weight_kg: p.weight_hg / 10,
    types: p.types,
    type_labels: p.types.map(typeLabel),
    abilities: p.abilities.map(displayName),
    ability_identifiers: p.abilities,
    selected_ability: p.abilities[0] ?? '',
    source_generation: p.source_generation,
    stats: statEntries,
    max_stat: maxStat,
    type_relations: { weaknesses, resistances, immunities },
  };
}

// ---------------------------------------------------------------------------
// NLU stub — returns a helpful message until the model is trained
// ---------------------------------------------------------------------------
function handleNLText(text: string): string {
  const t = text.toLowerCase().trim();

  // Simple keyword routing as pre-model stub
  if (/\bping\b/.test(t)) return 'Bot: pong';
  if (/info|dados|detalhe|ficha/.test(t)) {
    return 'Bot: Para detalhes de um Pokémon, use o painel de Pokédex ou envie __POKEDEX_DETAIL_JSON__:<identifier>.';
  }
  if (/counter|contra|puni|resposta|bate/.test(t)) {
    return 'Bot: Análise de counters disponível em breve (modelo NN em treinamento).';
  }
  if (/item|held/.test(t)) {
    return 'Bot: Recomendação de itens disponível em breve (modelo NN em treinamento).';
  }
  if (/dupla|parceiro|double|sinergia/.test(t)) {
    return 'Bot: Análise de duplas disponível em breve (modelo NN em treinamento).';
  }
  if (/evolui|evolução|evolucao/.test(t)) {
    return 'Bot: Para ver a evolução de um Pokémon, consulte seus detalhes na Pokédex.';
  }

  return `Bot: Entendido — essa função estará disponível após o treino do modelo NLU. (Consulta: "${text}")`;
}

// ---------------------------------------------------------------------------
// Command handlers
// ---------------------------------------------------------------------------
function handleCommand(input: string, engine: DeterministicEngine): string {
  const raw = input.trim();

  if (raw === '__PING__') return 'pong';

  if (raw === '__RESET__') return 'Bot: Estado da conversa reiniciado.';

  if (raw === '__POKEDEX_LIST_JSON__') {
    try {
      const allPokemon = engine.getAllPokemon();
      const entries = allPokemon.map(buildListEntry);
      return JSON.stringify({ ok: true, pokemon: entries });
    } catch (e) {
      return JSON.stringify({ ok: false, error: String(e) });
    }
  }

  if (raw.startsWith('__POKEDEX_DETAIL_JSON__:')) {
    const identifierRaw = raw.slice('__POKEDEX_DETAIL_JSON__:'.length).trim();
    const identifier = identifierRaw.toLowerCase().replace(/\s+/g, '_');
    try {
      const p = engine.getPokemonContext(identifier, { includeMoves: true });
      if (!p) return JSON.stringify({ ok: false, error: 'Pokémon não encontrado.' });
      const detail = buildDetailEntry(p, engine.getTypeChart());
      return JSON.stringify({ ok: true, detail });
    } catch (e) {
      return JSON.stringify({ ok: false, error: String(e) });
    }
  }

  // Natural language
  if (raw === '') return 'Bot: Digite uma pergunta para continuar.';
  return handleNLText(raw);
}

// ---------------------------------------------------------------------------
// Main loop
// ---------------------------------------------------------------------------
function main(): void {
  if (!fs.existsSync(DB_PATH)) {
    process.stderr.write(
      `[bridge] ERROR: SQLite not found at ${DB_PATH}\n` +
      `[bridge] Run: node tools/nn/export_nn_data.js first\n`
    );
    process.exit(1);
  }

  let engine: DeterministicEngine;
  try {
    engine = new DeterministicEngine(DB_PATH);
  } catch (e) {
    process.stderr.write(`[bridge] ERROR opening DB: ${e}\n`);
    process.exit(1);
  }

  process.stderr.write(`[bridge] ready  db=${DB_PATH}\n`);

  const rl = readline.createInterface({ input: process.stdin, terminal: false });

  rl.on('line', (line) => {
    try {
      const response = handleCommand(line, engine);
      writeResponse(response);
    } catch (e) {
      writeResponse(`Bot: Ocorreu um erro interno (${e}).`);
    }
  });

  rl.on('close', () => {
    engine.close();
    process.exit(0);
  });
}

main();
