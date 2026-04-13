# Changelog

## 0.85a - 2026-03-16

### Adições

- Catálogo completo de moves separado em `db/moves_catalog.pl`.
- Movelists completas por Pokémon em `db/pokemon_movelists.pl`.
- Catálogo completo de abilities em `db/abilities_catalog.pl`.
- Catálogo completo de itens em `db/items_catalog.pl`.
- Novo gerador de moves/movelists via PokéAPI em `tools/generate_moves_db.js`.
- Novo gerador de abilities/itens via PokéAPI em `tools/generate_abilities_items_db.js`.
- Inclusão de metadados de efeito secundário em `move_entry/11`:
  - `EffectChance` (`effect_chance` da PokéAPI)
  - `Ailment` (`meta.ailment`)
  - `EffectCategory` (`meta.category`)
- Novo intent para perguntas do tipo "o que as habilidades do Pokémon X fazem", com detalhamento por habilidade.
- Consulta direta por habilidade reforçada para retornar o efeito da habilidade e lista de Pokémon que podem possuí-la.

### Alterações

- `pokedex_bot.pl` atualizado para carregar os novos catálogos (`moves`, `movelists`, `abilities`, `items`).
- Fallback de descrição de habilidade aprimorado: prioriza `ability_effect/5` e usa `ability_entry/5` quando necessário.
- Compatibilidade mantida para leitura legada de `move_entry/8` no catálogo de moves.

### Observações

- Em moves de status primário, `effect_chance` pode vir `null` na PokéAPI; nesses casos, a aplicação do status depende da precisão/regra do golpe.

## 0.87a - 2026-04-13

### Objetivo

- Reduzir tempo de processamento e inferências do fluxo de parceiros compatíveis em doubles.
- Reduzir complexidade estrutural no pipeline de ranking de counters sem alterar comportamento.
- Garantir ciclo de vida correto de cache quando o escopo de geração muda.

### Fase 1 - Otimização de parceiros (doubles)

- Adicionado cache por geração para `pair_strategy_profile/6` (`cache_pair_strategy_profile/3`).
- Adicionado cache por geração para `pair_synergy_breakdown/12` (`cache_pair_synergy_breakdown/5`).
- Reescrito o fluxo de `answer_compatible_partners_query_with_preferences/3` para duas etapas:
  - Etapa rápida: pré-score barato por tipo/campo/role para todos os candidatos.
  - Etapa completa: avaliação de sinergia detalhada apenas no shortlist.
- Introduzido funil configurado por `partner_shortlist_size/2` para limitar avaliações completas.

### Fase 2 - Simplificação do pipeline de counters

- Centralizado o pipeline de ranking em helpers únicos:
  - `counter_rank_pairs/2`
  - `counter_limit_pairs/2`
  - `counter_rank_limit_pairs/2`
- Substituída repetição de blocos de `keysort/reverse/dedupe/limit` nos fluxos:
  - geração,
  - level cap,
  - level cap com filtros,
  - consulta composta,
  - recomendação base,
  - recomendação por candidatos.
- Mantido pré-filtro de cobertura super-efetiva para preservar custo computacional do counter path.

### Fase 3 - Governança de cache e validação

- `clear_query_caches/0` agora também invalida:
  - `cache_pair_strategy_profile/3`
  - `cache_pair_synergy_breakdown/5`
- Garantia de consistência quando `set_active_generation/1` ou `set_default_generation/0` muda o escopo.

### Complexidade (antes vs depois)

- Parceiros doubles:
  - Antes: avaliação completa para todos os candidatos elegíveis.
  - Depois: `O(N * C_rapido + K * C_completo)`, com `K << N`.
  - Medição estrutural (query padrão de parceiros para Tyranitar, top 8):
    - `N = 1174` candidatos elegíveis.
    - `K = 160` avaliações completas (cap do shortlist).
    - Redução direta de avaliações completas: ~86.37%.

- Counter pipeline:
  - Antes: blocos de ranking duplicados em múltiplos pontos.
  - Depois: 1 caminho central de ranking (`counter_rank_limit_pairs/2`).
  - Evidência estrutural: ocorrências de padrão (`keysort(PairsRaw, ...)` + `counter_recommendation_limit(Limit)`) reduzidas de 14 para 2.

### Indicadores de melhoria (benchmark)

#### Partners (query com preferências padrão; cold/warm na mesma sessão)

| Métrica | Antes | Depois | Variação |
|---|---:|---:|---:|
| Inferences (cold) | 889803754 | 23919916 | -97.31% |
| Inferences (warm) | 889793272 | 18859870 | -97.88% |
| CPU s (cold) | 52.563 | 0.828 | -98.42% |
| CPU s (warm) | 50.250 | 0.625 | -98.76% |

#### Counter (query padrão)

| Métrica | Antes | Depois | Leitura |
|---|---:|---:|---|
| Inferences (cold) | 15575115 | 15575118 | equivalente |
| Inferences (warm) | 304933 | 304936 | equivalente |

### Validação

- Suite de testes: `tests/nlp_token_heuristics_tests.pl` passou `94/94`.
- Carga do entrypoint principal (`pokedex_bot.pl`) validada sem erros.

## 0.88a - 2026-04-13

### Objetivo

- Escalar cobertura léxica para linguagem natural real sem perder estabilidade de roteamento.
- Reduzir colisões entre domínios (`item` vs `move`, `strategy` vs `rules`) com desambiguação por evidência.
- Introduzir intents específicos para detalhe de item e detalhe de move.
- Validar qualidade de roteamento com matriz de confusão sintética reproduzível.

### Fase 1 - Desambiguação por evidência

- Adicionados detectores de conflito entre domínios:
  - `item_move_ability_conflict_signal/1`
  - `strategy_rules_conflict_signal/1`
- Adicionado roteamento por score para conflitos mistos:
  - `resolve_item_move_ability_by_evidence/3`
  - `resolve_strategy_rules_by_evidence/3`
- Incluídas funções de evidência por domínio (`item`, `move`, `ability`, `rules`, `strategy`) e seleção do melhor candidato por pontuação.

### Fase 2 - Reformulação de intent de habilidade

- `parse_pokemon_ability_details_query/2` agora aceita menção explícita de habilidade mesmo sem keyword literal (`habilidade/ability`).
- Novo sinal de detalhe `ability_detail_request_signal/1` com cobertura para expressões naturais de explicação (`o que faz`, `como funciona`, `info`, etc.).
- Extração por melhor menção de habilidade no catálogo:
  - `extract_best_ability_mention_from_tokens/2`.

### Fase 3 - Novo intent para detalhe específico de item

- Novo parser: `parse_specific_item_query/2`.
- Novo handler: `answer_specific_item_query/1`.
- Novo roteamento dedicado no catálogo de intents.
- Saída estruturada com categoria, efeito, custo e metadados de fling.

### Fase 4 - Novo intent para detalhe específico de move

- Novo parser: `parse_specific_move_query/2`.
- Novo handler: `answer_specific_move_query/1`.
- Novo roteamento dedicado no catálogo de intents.
- Saída estruturada com tipo, categoria, poder, precisão, PP, prioridade e metadados de efeito.

### Fase 5 - Estudo de qualidade de roteamento

- Novo benchmark sintético: `tests/intent_confusion_study.pl`.
- Matriz de confusão por classe de intent com diagnóstico de mismatch.
- Documento técnico consolidado: `docs/intent_reformulation_study_2026-04-13.md`.

### Expansão léxica (última rodada)

- Carregamento modular por wildcard para referências de linguagem e léxico estático:
  - `db/language_references*.pl`
  - `db/bot_static_lexicon*.pl`
- Novos arquivos de expansão gerados:
  - `db/language_references_expanded_moves.pl`
  - `db/language_references_expanded_items.pl`
  - `db/bot_static_lexicon_expanded_abilities.pl`
- Cobertura consolidada após expansão:
  - `token_total`: `3634`
  - `phrase_total`: `479`
  - `token_unique`: `3565`
  - `phrase_unique`: `479`

### Indicadores de validação

- Suite NLP: `113/113` passando (`tests/nlp_token_heuristics_tests.pl`).
- Matriz de confusão sintética: `54/54` corretos (`100.00%`).
- Mismatches na matriz: `nenhum`.
- Carga do entrypoint principal (`pokedex_bot.pl`) validada sem erros.
