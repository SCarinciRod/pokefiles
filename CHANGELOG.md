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
