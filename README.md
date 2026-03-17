# Chatbot Pokédex em Prolog

Projeto de faculdade: chatbot Pokédex feito em Prolog, com suporte para:

- Buscar informações completas de um Pokémon por **nome** ou **número da Pokédex**.
- Informar quantos Pokémon diferentes existem de um determinado **tipo** (fogo, grama, inseto, etc.).

O projeto usa base local em Prolog (modo offline), separada por geração em `db/generation_1.pl`, `db/generation_2.pl`, etc.
Também possui base de golpes separada em:

- `db/moves_catalog.pl` (catálogo global de moves)
- `db/pokemon_movelists.pl` (movelist por Pokémon)

O catálogo global de moves inclui metadados de efeito secundário vindos da PokéAPI:

- `EffectChance` (campo `effect_chance` da PokéAPI)
- `Ailment` (campo `meta.ailment`)
- `EffectCategory` (campo `meta.category`)

Também possui catálogos completos de metadados competitivos:

- `db/abilities_catalog.pl` (abilities completas da PokéAPI)
- `db/items_catalog.pl` (itens completos da PokéAPI)

## Requisitos

- Windows + PowerShell
- Internet (somente no setup inicial para baixar dependências e montar as gerações)

## Como executar

### 1) Setup automático (dependências + gerações 1..9)

No terminal, dentro da pasta `pokefiles`, execute:

```powershell
.\setup.cmd
```

Esse setup:

- verifica se `node` e `swipl` já existem;
- se faltar algo, tenta primeiro arquivos portáteis locais em `vendor/`;
- se ainda faltar, instala via `scoop` (modo sem instalador gráfico);
- roda o gerador e cria `db/generation_1.pl` até `db/generation_9.pl`;
- gera também lore local por geração em `db/lore_generation_1.pl` até `db/lore_generation_9.pl`.
- pode gerar base completa de moves/movelists com script dedicado.

Local de instalação (somente usuário):

- `%LOCALAPPDATA%\PokedexChatbot\portable` (dependências portáteis)
- `%LOCALAPPDATA%\PokedexChatbot\vendor` (zips para modo offline)
- `%LOCALAPPDATA%\scoop` (quando usar fallback Scoop)

### Setup offline (sem internet)

- Coloque os zips portáteis em `%LOCALAPPDATA%\PokedexChatbot\vendor` conforme instruções em `vendor/README.md`.
- Execute `setup.cmd` normalmente.

### 2) Iniciar o chatbot

No terminal, dentro da pasta `pokefiles`:

```bash
swipl
```

No prompt do Prolog:

```prolog
['pokedex_bot.pl'].
start.
```

Ou execute direto:

```cmd
run_chatbot.cmd
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

## Observações

- O bot funciona sem internet.
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

- Para gerar novamente catálogos completos de abilities e itens:

```bash
node tools/generate_abilities_items_db.js
```

Se houver problema de certificado TLS na sua rede local:

```powershell
$env:POKEDEX_INSECURE_TLS='1'; node tools/generate_moves_db.js
```
