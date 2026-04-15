# Chatbot Pokédex em Prolog

Projeto de faculdade: chatbot Pokédex feito em Prolog, com suporte para:

- Buscar informações completas de um Pokémon por **nome** ou **número da Pokédex**.
- Informar quantos Pokémon diferentes existem de um determinado **tipo** (fogo, grama, inseto, etc.).

O projeto usa base local em Prolog (modo offline), separada por geração em `db/generations/core/generation_1.pl`, `db/generations/core/generation_2.pl`, etc.
Também possui base de golpes separada em:

- `db/catalogs/moves_catalog.pl` (catálogo global de moves)
- `db/catalogs/pokemon_movelists.pl` (movelist por Pokémon)

O catálogo global de moves inclui metadados de efeito secundário vindos da PokéAPI:

- `EffectChance` (campo `effect_chance` da PokéAPI)
- `Ailment` (campo `meta.ailment`)
- `EffectCategory` (campo `meta.category`)

Também possui catálogos completos de metadados competitivos:

- `db/catalogs/abilities_catalog.pl` (abilities completas da PokéAPI)
- `db/catalogs/items_catalog.pl` (itens completos da PokéAPI)

## Requisitos

- Windows + PowerShell
- Internet (somente no setup inicial para baixar dependências, montar as geracoes e sincronizar sprites)

## Como executar

### GUI desktop (executável)

Você pode rodar o bot como aplicativo desktop (sem abrir navegador), com layout estilo Pokédex:

1. Na raiz do projeto `pokefiles`, execute `setup.exe` uma vez para preparar dependências e instalar o executável GUI local.
2. Na raiz do projeto, execute `run_gui.exe` para abrir o app sem terminal.

Observação:

- O setup central (`setup.exe` + `tools/setup.ps1`) empacota a GUI e instala um executor único em `%LOCALAPPDATA%\PokedexChatbot\app\win-unpacked\Pokedex Desktop.exe`.
- O runtime Prolog do executável é instalado em `%LOCALAPPDATA%\PokedexChatbot\app\win-unpacked\resources\runtime\` para evitar dependência de arquivos dentro de `app.asar`.
- `run_gui.exe` é o executor recomendado para uso diário sem janela de terminal.
- O setup só reempacota a GUI quando detecta mudança nas fontes relevantes.
- O setup executa limpeza automática da GUI ao final (equivalente ao `clean_gui_workspace`), removendo artefatos `gui/dist*` para evitar crescimento excessivo da pasta.
- Se algum arquivo da GUI estiver bloqueado durante a limpeza (ex.: `app.asar`), o cleaner agenda a exclusão no próximo logon via `HKCU\\...\\RunOnce`.
- Por padrão, o setup também remove `gui/node_modules` ao final para manter o workspace leve; quando precisar preservar dependências locais de desenvolvimento, use `-PreserveGuiNodeModules`.
- A GUI mostra uma tela de inicialização (patcher/splash) enquanto valida cache de sprites e inicializa o bridge Prolog.
- Em caso de falha de boot da GUI, consulte o log em `%LOCALAPPDATA%\PokedexChatbot\logs\run_gui.log`.

Para limpeza manual da pasta GUI (artefatos locais e opcionalmente `node_modules`):

```powershell
.\tools\clean_gui_workspace.ps1 -RemoveNodeModules
```

Opções úteis da limpeza manual:

```powershell
# limpa apenas node_modules
.\tools\clean_gui_workspace.ps1 -RemoveNodeModules -SkipBuildArtifacts

# aumenta tentativas de remoção para arquivos temporariamente bloqueados
.\tools\clean_gui_workspace.ps1 -RemoveNodeModules -MaxRemoveAttempts 10 -RetryDelayMilliseconds 800
```

Para (re)gerar o executável portátil (`.exe`):

1. Na raiz `pokefiles`, execute `setup.exe`.
2. O setup gera a build em pasta temporária e instala a cópia executável em `%LOCALAPPDATA%\PokedexChatbot\app\win-unpacked/`.

Observação de rede restrita:

- O fluxo padrão do `setup.exe` gera o app em `win-unpacked` (sem NSIS), reduzindo dependências de downloads externos.
- Se quiser tentar o pacote portátil único, rode `npm run pack:win` dentro de `gui`.

Uso da GUI desktop:

- Painel esquerdo: lista Pokédex clicável com filtros por nome/número e tipo.
- Clique em um Pokémon para abrir modal com dados completos, barras de status, relações de tipo e movelist recolhível.
- Painel direito (chat): recomendado para consultas complexas (sinergia, counter, itemização, estratégia).

### 1) Setup automático (dependências + gerações 1..9)

No terminal, dentro da pasta `pokefiles`, execute:

```powershell
.\setup.exe
```

Esse setup:

- verifica se `node` e `swipl` já existem;
- se faltar algo, tenta primeiro arquivos portáteis locais em `vendor/`;
- se ainda faltar, instala via `scoop` (modo sem instalador gráfico);
- roda o gerador e cria `db/generations/core/generation_1.pl` até `db/generations/core/generation_9.pl`;
- gera também lore local por geração em `db/generations/lore/lore_generation_1.pl` até `db/generations/lore/lore_generation_9.pl`.
- gera dados de evolução por geração em `db/generations/evolution/evolution_generation_1.pl` até `db/generations/evolution/evolution_generation_9.pl`.
- sincroniza sprites da PokemonDB no cache local `%LOCALAPPDATA%\PokedexChatbot\sprites` (fallback: `.local_cache/sprites`) com preferencia por estilo Home (Gen 8), incluindo normal e shiny.
  - durante a sincronizacao, tambem expande slugs de formas (mega, gmax, etc.) lendo as paginas individuais de cada especie.
  - a etapa de setup aplica atualizacao forcada de sprites para substituir arquivos antigos/inconsistentes.
  - em execuções subsequentes, o setup usa modo incremental quando possível e só força refresh completo quando necessário (manifesto ausente/inválido ou execução forçada).
- pode gerar base completa de moves/movelists com script dedicado.

Local de instalação (somente usuário):

- `%LOCALAPPDATA%\PokedexChatbot\portable` (dependências portáteis)
- `%LOCALAPPDATA%\PokedexChatbot\vendor` (zips para modo offline)
- `%LOCALAPPDATA%\PokedexChatbot\sprites` (cache local de sprites usado pela GUI)
- `%LOCALAPPDATA%\scoop` (quando usar fallback Scoop)

Requisito de runtime para GUI build:

- Node.js `>= 22.12.0` (o setup tenta provisionar/atualizar automaticamente via Scoop quando necessário).

### Setup offline (sem internet)

- Coloque os zips portáteis em `%LOCALAPPDATA%\PokedexChatbot\vendor` conforme instruções em `vendor/README.md`.
- Execute `setup.exe` normalmente.

### 2) Iniciar o chatbot

No terminal, dentro da pasta `pokefiles`:

```bash
swipl
```

No prompt do Prolog:

```prolog
['prolog/pokedex_bot.pl'].
start.
```

## Exemplos de perguntas

- `info nome pikachu`
- `info numero 25`
- `pokemon charizard`
- `tipo fogo`
- `quantos pokemon existem do tipo grama`
- `geracao 1`
- `geracao todas`
- `tipo fogo/voador`
- `habilidade blaze`
- `o que as habilidades do charizard fazem`
- `status velocidade`

As respostas de Pokémon incluem:

- dados base (nome, número, altura, peso, tipos, habilidades, status)
- resumo de moveset (com contagem e amostra dos golpes)
- fraquezas, resistências e imunidades
- descrição estratégica
- lore local estilo Pokédex (texto oficial de flavor entries por espécie, gerado para todas as gerações)

Consultas por tipo, habilidade e status retornam contagem e uma lista amostral de Pokémon para facilitar entendimento.
Consultas de habilidades por Pokémon retornam os efeitos detalhados das habilidades (priorizando o campo `effect` do catálogo de abilities).

## Encerrar

- Digite: `sair`

## Validação rápida (processo recomendado)

Antes de seguir com novas mudanças de parser/heurística, execute:

```powershell
.\tools\validate_and_benchmark.ps1
```

Esse comando valida parse dos arquivos `.pl`, mede baseline de carga/consultas e roda testes de NLP.

## Observações

- O bot funciona sem internet.
- A GUI valida o cache local de sprites na inicialização e dispara sincronização automática quando detecta ausência ou inconsistência.
- A GUI aplica hardening de segurança no runtime (CSP no renderer, bloqueio de popup/webview, bloqueio de navegação externa e negação padrão de permissões).
- O launcher da GUI prioriza inicialização direta via `electron.exe` para reduzir overhead de bootstrap via `npm`.
- Tipos em português são aceitos (ex.: `fogo`, `grama`, `inseto`) e convertidos internamente para os tipos padrão.
- A consulta pode ser filtrada por geração com `geracao N` (de 1 a 9).
- Para voltar a consultar tudo que estiver carregado, use `geracao todas`.
- Para gerar novamente as gerações locais manualmente, use o script:

```bash
node tools/generate_generation_db.js all
```

- Para gerar novamente os dados completos de moves/movelists:

```bash
node tools/generate_moves_db.js
```

- Para sincronizar novamente sprites locais (PokemonDB Home normal/shiny):

```bash
node tools/sync_home_sprites.js
```

- Para forçar uma pasta de saída customizada na sincronização:

```bash
node tools/sync_home_sprites.js --output-dir=C:\\caminho\\sprites
```

- Opcional: para uma sincronizacao mais rapida sem varredura de formas embutidas:

```bash
node tools/sync_home_sprites.js --skip-form-scan
```

- Para gerar novamente catálogos completos de abilities e itens:

```bash
node tools/generate_abilities_items_db.js
```

- Para gerar marcadores automáticos de abilities a partir das descrições (heurístico):

```bash
node tools/generate_ability_markers.js
```

Isso gera `db/generated/ability_markers.pl` com fatos no formato:

```prolog
ability_marker(Ability, Marker, Value).
```

- Para gerar marcadores automáticos de itens com schema semântico próprio (uso, gatilho, condição, papel e ganchos de relação):

```bash
node tools/generate_item_markers.js
```

Isso gera `db/generated/item_markers.pl` com fatos no formato:

```prolog
item_marker(Item, Marker, Value).
```

Se o catálogo vier com `Sem descrição disponível.` em itens relevantes, o gerador também consulta `db/references/item_description_fallbacks.json` para preencher descrições de referência antes de inferir marcadores.

Exemplos de marcadores de itens gerados: `usage_mode`, `item_role`, `trigger`, `condition`, `modifier_kind`, `relation_hook`, `type_hint`, `status_hint`, `combat_relevance`.

- Para gerar automaticamente efeitos base de abilities (fallback competitivo) a partir dos marcadores:

```bash
node tools/generate_ability_data_auto.js
```

Isso gera `db/generated/ability_data_auto.pl` com fatos `ability_effect/5` para todas as abilities catalogadas.
No runtime, `ability_data_auto.pl` e a fonte principal; `db/manual/ability_data.pl` fica como fallback de compatibilidade quando o auto ainda nao foi gerado.

- Para gerar curadoria automatica de held items (somente itens com `relation_hook=held_item_slot`, foco competitivo):

```bash
node tools/generate_held_item_data_auto.js
```

Isso gera `db/generated/held_item_data_auto.pl` com fatos no formato:

```prolog
held_item_effect(Item, Category, Trigger, CombatModel, Description, Confidence).
```

Esse gerador também aplica fallback de descrição via `db/references/item_description_fallbacks.json` quando necessário.

No runtime, o engine de held item prioriza essa curadoria para descrever o efeito do item, com fallback para `db/catalogs/items_catalog.pl` quando necessario.

Se houver problema de certificado TLS na sua rede local:

```powershell
$env:POKEDEX_INSECURE_TLS='1'; node tools/generate_moves_db.js
```
