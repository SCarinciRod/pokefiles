# Documentacao do Projeto Pokefiles

Atualizado em: 2026-04-15

## 1. Visao Geral

O projeto **pokefiles** implementa um chatbot Pokedex com base de conhecimento local em Prolog e interface desktop em Electron.

Objetivos principais:

- responder consultas sobre Pokemon por nome, numero, tipo, habilidade, status e estrategias;
- funcionar de forma local (offline para consultas, com internet usada no setup/atualizacoes);
- oferecer fluxo simples para usuario final via executaveis (`setup.exe` e `run_gui.exe`);
- manter a pasta de trabalho leve por meio de limpeza automatica e controle de artefatos.

## 2. Stack Tecnica

- **Prolog (SWI-Prolog)**: motor de inferencia e NLP baseado em regras.
- **Node.js**: scripts de geracao de base, sincronizacao de sprites e automacao.
- **Electron**: aplicacao desktop com renderer + processo principal.
- **PowerShell**: orquestracao de setup, build e limpeza.
- **C# launchers**: wrappers compilados para experiencia sem terminal.

## 3. Arquitetura de Alto Nivel

### 3.1 Core Prolog

O core Prolog esta em `prolog/`.

Principais arquivos:

- `prolog/pokedex_bot.pl`: entrypoint principal, bootstrap, carga de base e orquestracao de intents.
- `prolog/intent_router.pl`: engine de roteamento de intents.
- `prolog/intents_catalog.pl`: catalogo de regras de intent.
- `prolog/intents_guards.pl`: guards/sinais de dominio e fallback.
- `prolog/pokemon_db.pl`: base minima/fallback local para consultas.

### 3.2 Engines Especializadas

A pasta `engines/` contem motores de dominio isolados, por exemplo:

- `counter_engine.pl`
- `matchup_engine.pl`
- `generation_engine.pl`
- `ranking_engine.pl`
- `evolution_engine.pl`
- `held_item_engine.pl`
- `doubles_strategy_engine.pl`
- `tournament_rules_engine.pl`
- `role_engine.pl`

### 3.3 Base de Dados

A pasta `db/` foi organizada por responsabilidade para melhorar manutencao e visibilidade:

- `db/catalogs/`: catalogos base (`abilities_catalog.pl`, `items_catalog.pl`, `moves_catalog.pl`, `move_tactical_catalog.pl`, `pokemon_movelists.pl`)
- `db/generated/`: artefatos gerados (`ability_markers.pl`, `item_markers.pl`, `ability_data_auto.pl`, `held_item_data_auto.pl`)
- `db/generations/core/`: especies por geracao (`generation_1.pl` ... `generation_9.pl`)
- `db/generations/lore/`: lore por geracao
- `db/generations/evolution/`: fatos de evolucao por geracao
- `db/forms/`: formas especiais/mega e lore correspondente
- `db/runtime/`: textos e lexicos usados no parser/runtime
- `db/references/`: referencias auxiliares (ex.: fallback de descricao de itens)
- `db/manual/`: dados manuais de fallback/compatibilidade

### 3.4 GUI Desktop

A pasta `gui/` contem a aplicacao Electron.

Destaques:

- `gui/main.js`: processo principal Electron, inicializacao, bridge com Prolog, cache de sprites, hardening de seguranca.
- `gui/prolog_bridge.pl`: ponte entre GUI e core Prolog.
- `gui/boot_preload.js` + `gui/public/boot.*`: tela de inicializacao com status de boot.
- `gui/public/index.html`: interface principal do app.
- `gui/package.json`: scripts de build e configuracao do electron-builder.

### 3.5 Orquestracao e Ferramentas

A pasta `tools/` concentra scripts operacionais:

- `tools/setup.ps1`: setup completo, dependencias, build, sincronizacao e limpeza.
- `tools/clean_gui_workspace.ps1`: limpeza de artefatos GUI com tratamento de lock.
- `tools/generate_generation_db.js`: geracao de dados de geracao/lore/evolucao.
- `tools/generate_moves_db.js`: geracao de catalogos de moves/movelists.
- `tools/generate_abilities_items_db.js`: geracao de catalogos de abilities e itens.
- `tools/sync_home_sprites.js`: sincronizacao de sprites local.
- `tools/validate_and_benchmark.ps1`: validacao rapida e benchmark.
- `tools/build_launchers.ps1`: compilacao de `setup.exe` e `run_gui.exe` a partir de C#.

## 4. Estrutura Atual (resumo)

```text
pokefiles/
  prolog/
  engines/
  db/
    catalogs/
    generated/
    generations/
      core/
      lore/
      evolution/
    forms/
    runtime/
    references/
    manual/
  gui/
  tests/
  tools/
  vendor/
  setup.exe
  run_gui.exe
  README.md
  CHANGELOG.md
```

## 5. Fluxo de Setup e Execucao

## 5.1 Setup Principal

Comando:

```powershell
.\setup.exe
```

O launcher `setup.exe` chama `tools/setup.ps1`.

Etapas principais:

1. valida/provisiona dependencias (Node, npm, SWI-Prolog);
2. aplica baseline de versao de Node (`>= 22.12.0`);
3. empacota GUI quando necessario;
4. gera bases de dados quando necessario;
5. sincroniza sprites (full ou incremental) quando necessario;
6. executa limpeza automatica da GUI ao final.

## 5.2 Execucao da GUI

Comando:

```powershell
.\run_gui.exe
```

Comportamento:

- inicia app instalado em `%LOCALAPPDATA%\PokedexChatbot\app\win-unpacked\Pokedex Desktop.exe`;
- evita abrir terminal para uso diario;
- registra log em `%LOCALAPPDATA%\PokedexChatbot\logs\run_gui.log` em caso de falha.

## 5.3 Execucao via Prolog (CLI)

```prolog
['prolog/pokedex_bot.pl'].
start.
```

## 6. Automacoes Importantes no Setup

### 6.1 Reempacotamento Inteligente da GUI

O setup compara timestamps das fontes e do executavel instalado para decidir se precisa empacotar de novo.

### 6.2 Geracao Incremental de Base

A etapa de geracao de base (`db/`) e pulada quando os artefatos obrigatorios ja estao atualizados.

### 6.3 Sincronizacao de Sprites por Modo

A sincronizacao de sprites pode operar em:

- `full`: quando manifesto esta ausente/invalido ou execucao forcada;
- `incremental`: quando script mudou e cache existe;
- `skip`: quando cache esta consistente.

Destino padrao do cache:

- `%LOCALAPPDATA%\PokedexChatbot\sprites`

Fallback:

- `.local_cache/sprites`

### 6.4 Limpeza Automatica de GUI

Ao final do setup:

- remove artefatos `gui/dist*`;
- remove `gui/node_modules` por padrao (pode ser preservado via flag).

Tratamento de locks de arquivo:

- tenta remover com retry;
- tenta agendar exclusao no reboot (`MoveFileEx`);
- fallback para `HKCU\Software\Microsoft\Windows\CurrentVersion\RunOnce` no proximo logon quando necessario.

## 7. Parametros Operacionais Relevantes

### 7.1 setup.ps1

Principais switches:

- `-SkipGenerationBuild`
- `-SkipSpriteSync`
- `-SkipGuiDependencies`
- `-SkipGuiPackaging`
- `-PreserveGuiBuildArtifacts`
- `-PreserveGuiNodeModules`
- `-ForceGenerationBuild`
- `-ForceSpriteSync`

### 7.2 clean_gui_workspace.ps1

Principais switches:

- `-RemoveNodeModules`
- `-SkipBuildArtifacts`
- `-MaxRemoveAttempts`
- `-RetryDelayMilliseconds`
- `-ScheduleLockedDeletionOnReboot`

## 8. Empacotamento da GUI

Scripts de build em `gui/package.json`:

- `npm run pack:dir` (diretorio `win-unpacked`)
- `npm run pack:win` (portable)

Componentes copiados para runtime da GUI (extraResources):

- Prolog core em `runtime/prolog/`
- `db/` em `runtime/db/`
- `engines/` em `runtime/engines/`
- utilitario de sprites em `runtime/tools/`

Isso evita dependencia direta de arquivos dentro de `app.asar` para o runtime Prolog.

## 9. Seguranca e UX

Medidas relevantes no app desktop:

- CSP no renderer principal;
- bloqueio de popup e navegacao externa nao autorizada;
- bloqueio de attach de `webview`;
- politica de permissao default deny-all;
- splash de boot com mensagens de progresso para inicializacao.

## 10. Validacao e Testes

Fluxo recomendado:

```powershell
.\tools\validate_and_benchmark.ps1
```

Testes em `tests/` cobrem heuristicas de NLP e regressao de engines.

## 11. Evolucao Recente (ate aqui)

Baseado no changelog:

- **0.92a (2026-04-15)**
  - reorganizacao completa da pasta `db/` em subdiretorios por dominio;
  - ajuste de runtime e geradores para os novos paths;
  - fallback de descricoes de held items consolidado em `db/references/item_description_fallbacks.json`;
  - melhoria no resumo de descricao curada para evitar frases genericas;
  - forca de Mega Stone no slot de held item para formas Mega.

- **0.90a (2026-04-14)**
  - consolidacao do fluxo desktop (`setup.exe` + `run_gui.exe`);
  - setup unificado para dependencias + empacotamento + instalacao;
  - hardening de seguranca e melhoria de startup.

- **0.91a (2026-04-14)**
  - migracao dos arquivos Prolog de entrada para `prolog/`;
  - ajustes de referencias em GUI, testes e scripts;
  - limpeza automatica de GUI para controle de espaco em disco.

## 12. Riscos, Limites e Observacoes

- Projeto focado em ambiente Windows (PowerShell + caminhos/registro do Windows).
- Redes restritas podem impactar downloads externos; modo offline via `vendor/` e suportado.
- Arquivos travados por processo externo podem impedir remocao imediata; fallback de limpeza cobre esse caso.
- Como o setup remove `node_modules` local por padrao, dev de GUI deve usar `-PreserveGuiNodeModules` quando quiser iteracao local constante.

## 13. Comandos Uteis (resumo rapido)

```powershell
# setup completo
.\setup.exe

# executar GUI
.\run_gui.exe

# limpeza manual de GUI + node_modules
.\tools\clean_gui_workspace.ps1 -RemoveNodeModules

# limpar node_modules sem mexer em dist*
.\tools\clean_gui_workspace.ps1 -RemoveNodeModules -SkipBuildArtifacts

# aumentar tolerancia para lock temporario
.\tools\clean_gui_workspace.ps1 -RemoveNodeModules -MaxRemoveAttempts 10 -RetryDelayMilliseconds 800

# validar e medir baseline
.\tools\validate_and_benchmark.ps1
```

## 14. Referencias

- `README.md`
- `CHANGELOG.md`
- `tools/setup.ps1`
- `tools/clean_gui_workspace.ps1`
- `gui/package.json`
- `prolog/pokedex_bot.pl`
