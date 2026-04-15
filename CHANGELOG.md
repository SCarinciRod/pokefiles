# Changelog

## 0.91a - 2026-04-14

### Organização de código

- Arquivos Prolog de entrada/roteamento foram movidos da raiz para `prolog/`:
  - `prolog/pokedex_bot.pl`
  - `prolog/pokemon_db.pl`
  - `prolog/intent_router.pl`
  - `prolog/intents_catalog.pl`
  - `prolog/intents_guards.pl`
- Referências atualizadas em bridge da GUI, testes, scripts de setup/benchmark e documentação.

### Execução e launchers

- `run_gui.exe` passa a ser gerado na raiz do projeto (`pokefiles/run_gui.exe`) pelo `tools/build_launchers.ps1`.
- Removido launcher legado de CLI `run_chatbot.cmd` para manter fluxo `.exe` único e diretório mais limpo.
- Empacotamento Electron atualizado para copiar arquivos Prolog de `prolog/` para `resources/runtime/prolog/`.

### Pegada de disco da GUI

- `tools/setup.ps1` agora detecta se o app GUI instalado já está atualizado e evita reempacotamento desnecessário.
- `tools/setup.ps1` passou a limpar automaticamente artefatos locais de build (`gui/dist*`) para evitar crescimento da pasta `gui`.
- Novo utilitário `tools/clean_gui_workspace.ps1` para limpeza manual (incluindo opção de remover `gui/node_modules`).

## 0.90a - 2026-04-14

### Objetivo

- Consolidar o fluxo desktop em um setup único e um executor único.
- Remover fricção de UX no startup (sem terminal aparente no uso diário).
- Fortalecer baseline de segurança da GUI e reduzir overhead de inicialização.

### Setup e empacotamento unificados

- `setup.exe` (launcher) + `tools/setup.ps1` passou a executar o fluxo completo da GUI:
  - validação e provisionamento de Node/SWI-Prolog,
  - instalação de dependências GUI,
  - empacotamento Electron (`win-unpacked`),
  - instalação do app em `%LOCALAPPDATA%\PokedexChatbot\app\win-unpacked\`.
- Runtime Prolog da GUI foi movido para `resources/runtime/` via `extraResources`, evitando falha de inicialização ao tentar carregar `prolog_bridge.pl` dentro de `app.asar`.
- `setup.exe` virou o ponto único de setup/build para desktop.
- Mantido suporte a flags de skip para cenários específicos (`SkipGenerationBuild`, `SkipSpriteSync`, `SkipGuiDependencies`, `SkipGuiPackaging`).

### Executor único e UX de inicialização

- Novo launcher recomendado sem terminal: `run_gui.exe` na raiz do projeto.
- Removidos wrappers legados de execução (`run_gui.cmd`, `run_gui.vbs`, `run_gui_launcher.ps1`) para manter diretório limpo.
- Startup da Electron ganhou splash/patcher com status:
  - janela de boot dedicada,
  - mensagens de progresso para validação de sprites, init Prolog e carregamento da UI.

### Segurança (hardening)

- CSP adicionada na UI principal (`gui/public/index.html`).
- Bloqueio de `window.open` com abertura externa controlada via shell.
- Bloqueio de navegação para fora de `file://` no renderer.
- Bloqueio explícito de `webview` attach.
- Política default de permissões Electron: deny-all via `setPermissionRequestHandler`.

### Performance

- Cache em memória da lista de sprites no processo principal para reduzir leituras repetidas de disco.
- Invalidação de cache após sincronização de sprites.
- Launcher prioriza execução direta do binário Electron empacotado (reduzindo overhead de startup via npm).

### Dependências e toolchain

- Baseline atualizado para Node LTS moderno (Node `>= 22.12.0`; ambiente validado em `24.14.1`).
- GUI atualizada para `electron@^41.2.0` e `electron-builder@^26.8.1`.

### Validação

- `npm outdated --depth=0`: sem pendências.
- `npm audit`: sem vulnerabilidades reportadas.
- Build `pack:dir` validado com sucesso em saída limpa (`dist-runtime`).

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

## 0.88b - 2026-04-13

### Objetivo

- Padronizar o tipo de busca de entidades de catálogo (`ability`, `item`, `move`) para reduzir latência de extração em intents de detalhe.
- Preservar semântica atual com fallback para varredura completa quando não houver evidência indexada.

### Alterações

- Criada etapa única de bootstrap de índices com `rebuild_name_indexes/0` durante `load_database/0`.
- Mantido índice existente de Pokémon e adicionados índices de catálogo por token:
  - `ability_name_index_tokens/2`, `ability_name_index_token/2`
  - `item_name_index_tokens/2`, `item_name_index_token/2`
  - `move_name_index_tokens/2`, `move_name_index_token/2`
- Extração de melhor menção passou para pipeline index-first:
  - `extract_best_ability_mention_from_tokens/2`
  - `extract_best_item_mention_from_tokens/2`
  - `extract_best_move_mention_from_tokens/2`
- Novo funil de candidatos com desempate por melhor sequência contínua:
  - `indexed_catalog_candidates/3`
  - `catalog_best_mention_from_candidates/3`
- `catalog_atom_mentioned_in_tokens/3` agora reaproveita tokens já indexados via `catalog_atom_tokens_from_index/2` antes de recomputar.

### Impacto de complexidade (estrutural)

- Antes: extração por varredura de catálogo completo em cada consulta (`O(C * L)`).
- Depois: extração por índice + shortlist (`O(T * H + K * L)`), onde em geral `K << C`.
- Pior caso preservado por fallback: `O(C * L)` quando nenhum token indexado for elegível.

### Validação

- Suite NLP: `113/113` passando (`tests/nlp_token_heuristics_tests.pl`).
- Suite de regressão de engine: `7/7` passando (`tests/engine_regression_tests.pl`).

## 0.89a - 2026-04-13

### Objetivo

- Entregar interface gráfica desktop estilo Pokédex para uso sem navegador.
- Preparar empacotamento para executável Windows portátil.

### Adições

- Nova pasta `gui/` com app Electron integrado ao motor Prolog.
- Bridge dedicada `gui/prolog_bridge.pl` para troca de mensagens entre UI e bot.
- Runtime desktop:
  - `gui/main.js`
  - `gui/preload.js`
- Frontend Pokédex desktop:
  - `gui/public/index.html`
  - `gui/public/styles.css`
  - `gui/public/renderer.js`
- Layout em duas colunas:
  - painel visual de sprites à esquerda;
  - chat do bot à direita.
- Scripts utilitários:
  - `gui/run_gui.cmd` para execução local.
  - `gui/build_gui.cmd` para gerar `.exe` portátil.

### Empacotamento

- Configuração de build adicionada em `gui/package.json` com `electron-builder`.
- Target inicial: Windows `portable`.
- Adicionado modo `dir` (win-unpacked) para gerar executável local sem etapa NSIS em redes restritas.
- `build_gui.cmd` atualizado para executar build via `PowerShell -NoProfile -ExecutionPolicy Bypass` e produzir `gui/dist/win-unpacked/Pokedex Desktop.exe`.

### Observações

- O app desktop depende de `swipl` acessível no ambiente para iniciar o bridge Prolog.
- As sprites exibidas no painel esquerdo são lidas do cache local de sprites do usuário.

## 0.89b - 2026-04-13

### Objetivo

- Substituir grade de sprites por um navegador Pokédex mais funcional para consulta rápida.
- Separar claramente o uso de UI rápida (dados base) e chat estratégico (consultas complexas).

### Adições

- Painel esquerdo remodelado para lista clicável de Pokémon ordenada por número da Pokédex.
- Central de filtros no painel esquerdo:
  - busca por nome ou número;
  - filtro por tipo.
- Modal de detalhes ao clicar em um Pokémon da lista, com:
  - sprite (quando disponível no cache local de sprites);
  - nome, número, altura, peso, tipos e habilidades;
  - descrição e lore;
  - barras visuais para status base;
  - seção recolhível para relações de tipo;
  - seção recolhível para movelist.
- Movelist interativa no modal: clique em um golpe para abrir balão com tipo, categoria, poder, precisão, PP, prioridade e descrição do golpe.
- Tags de tipo com cor temática aplicadas nos golpes da movelist e nas caixas da seção de relações de tipo (fraquezas, resistências e imunidades).
- Navegador de evolução no modal com estágios e transições clicáveis para trocar rapidamente o Pokémon exibido.
- Mensagens do bot no chat agora reconhecem nomes de Pokémon e tornam esses nomes clicáveis para abrir o modal de detalhes.
- Botão no modal para enviar query básica ao chat (`pokemon <nome>`), usando a lista como gerador de consulta.

### Arquitetura técnica

- Bridge Prolog expandida com endpoints estruturados em JSON:
  - `__POKEDEX_LIST_JSON__`
  - `__POKEDEX_DETAIL_JSON__:<identifier>`
- IPC Electron expandido para dados estruturados:
  - `pokedex:list`
  - `pokedex:detail`

### Resultado de UX

- Consulta básica de dados ficou orientada por navegação visual e filtros rápidos.
- Chat permanece focado em análises avançadas (held items, sinergias, counters, etc.).
