# Catálogo de Frases por Intent

Este arquivo documenta frases de referência para treinar e validar o parser em linguagem natural.

## Nível 1 — Base da ação

### 1) `info_pokemon`
- `lucario`
- `pokemon lucario`
- `numero 448`
- `pokedex 448`

### 2) `counter`
- `quem ganha de charizard`
- `quem vence contra garchomp`
- `counter de blastoise`
- `bom contra tyranitar`
- `qual check de gengar`

### 3) `embate` / `simulação`
- `x contra y`
- `entre x e y quem vence`
- `faça um embate entre x e y`
- `simule um duelo entre x e y`
- `x ganha do y?`

## Nível 2 — Modificadores

### `generation`
- `na gen 3`
- `na geração 7`
- `gen8`
- `g9`

### `level_cap`
- `até o lv 25`
- `cap 40`
- `nível máximo 30`
- `limite 20`

### `type_filter`
- `tipo fogo`
- `tipo fogo voador`
- `de tipo elétrico`

### `context_filters`
- `sem mega`
- `sem lendários`
- `somente mega`
- `apenas míticos`
- `não evoluídos`
- `pokemons evoluídos`

### `evolution_language`
- `quais não evoluídos da gen 4`
- `lista pokemons nao evoluidos da quarta geração`
- `quero só evoluídos da geração 1`
- `me traz os evoluídos da gen2 sem lendários`
- `tem quantos que evoluem por level up`

## Composições recomendadas

### Nível 1 + Nível 2
- `quem vence o charizard na gen 7 sendo do tipo fogo e até o lv25`
- `counter de garchomp gen 4 sem lendários`
- `faça um embate entre lucario e blaziken na gen 6 até o level 50`

### Apenas Nível 2
- `quantos tipo raio não lendários e não megas até o lv 40`
- `lista de pokemons do tipo fogo na geração 3`
- `quantos lendários na gen 5`
- `megas do tipo dragão na geração 6`

## Casos ambíguos para monitorar

- `x contra y` (embate) vs `contra x` (counter)
- frases com `quem vence` sem segundo Pokémon
- frases sem verbo explícito (`garchomp gen 4 tipo dragão`) — inferência contextual

## Checklist de regressão rápida

- `lucario`
- `quem ganha de charizard`
- `charizard contra blastoise`
- `quantas megas evoluções existem`
- `megas por geração`
- `lendarios do tipo psíquico`
- `quantos tipo elétrico sem lendários até lv40`
- `liste todos os pokemons não evoluidos da quarta geração`
- `me mostra os pokemons nao evoluidos da gen4`
- `quero ver pokemon evoluídos da geração 1`
