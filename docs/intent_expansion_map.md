# Mapa de expansão de intents

Este documento separa intenções em dois grupos:
1) dá para implementar com o banco atual;
2) precisa expandir dados.

## Base já disponível no projeto

- `pokemon/7`: id, nome, altura, peso, tipos, habilidades, stats base.
- `pokemon_evolution/5`: cadeia e gatilho de evolução.
- `pokemon_lore/2`: lore textual.
- formas especiais: mega/form base.
- tabela de efetividade de tipos local.
- filtros por geração e filtros contextuais (mega/lendário/evoluído).

## Intents novos possíveis SEM expandir base

### 1) Rankings e consultas por atributo
- top N mais rápidos (speed)
- top N mais defensivos (defense + special_defense + hp)
- top N mais ofensivos físicos/especiais
- maior/menor altura e peso por geração
- top N por soma de stats base (BST)

### 2) Intents de estrutura evolutiva
- "quais têm 3 estágios evolutivos na gen X"
- "quais evoluem por troca/item/felicidade"
- "quais não evoluem"
- "quais já estão no estágio final"
- "cadeia evolutiva completa do <pokemon>"

### 3) Intents de tipos e cobertura (teórico)
- "quais tipos cobrem melhor tipo X" (por efetividade)
- "quais têm dupla fraqueza a tipo X"
- "quais têm imunidade a mais tipos"
- "time de 6 para cobrir o máximo de tipos" (heurístico)

### 4) Intents de comparação multi-pokémon
- "compare estes 3/4 pokémon"
- "rankeie meu elenco por matchup contra X"
- "quem entra melhor contra X no meu time"

## Intents que pedem EXPANSÃO DE BASE

### 1) Batalha realista (competitivo)
Precisa de: moveset, poder/acurácia/tipo/category dos golpes, prioridade, status, itens, abilities com efeito, clima/terrain, EV/IV/nature.
- simulação real de combate (não só aproximação por stats)
- melhor moveset contra X
- cálculo de dano por golpe

### 2) Progressão in-game
Precisa de: learnset por nível/TM/egg/event, jogos por geração e disponibilidade.
- "que golpe aprende no nível 36"
- "quando aprende Earthquake"
- "vale a pena evoluir agora ou esperar golpe"

### 3) Mundo/coleção
Precisa de: localização, taxa de captura, habitat, egg group, gender ratio, base exp, friendship, hidden ability.
- "onde pegar"
- "mais fáceis de capturar"
- "pokémon para breed"

### 4) Metagame
Precisa de: tiers (OU/UU/...), usage stats, banlist por formato.
- "melhores no meta atual"
- "quem é viável em OU"

## Prioridade sugerida de expansão

1. `base_stats_derived` (BST, bulk, speed tier) — baixo esforço, alto valor.
2. `evolution_chain_materialized` (estágio, final stage, chain length).
3. `move_db` + `learnset` por geração.
4. `ability_effects` + `item_effects`.
5. metagame/usage (fonte externa versionada).

## Próximos intents MVP recomendados

- "top 10 mais rápidos da gen 4"
- "quais têm BST acima de 550 na gen 3"
- "quais evoluem por troca na gen 2"
- "quais já estão no estágio final e não são lendários"
- "cadeia evolutiva completa de <pokemon>"
