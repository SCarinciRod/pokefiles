# Relatório de Expansão de Tokenização e Intents (2026-03-26)

## Objetivo

Expandir cobertura de linguagem natural com baixo risco de regressão, focando em:

1. tokenização robusta para erros comuns de digitação;
2. ampliação de tokens/frases de intents em léxico central;
3. validação automatizada por suíte de testes NLP e pipeline de execução.

## Arquivos atualizados

1. `pokedex_bot.pl`
2. `db/language_references.pl`
3. `tests/nlp_token_heuristics_tests.pl`

## Mudanças aplicadas

### 1) Tokenização e parsing

1. `parse_compare_query/3`
- Adicionada forma natural `comparativo entre ...`.

2. `parse_natural_type_query/2`
- Passou a aceitar sinais léxicos genéricos de lista e substantivo Pokémon via predicados (`list_intent_tokens/1` e `pokemon_noun_tokens/1`), reduzindo dependência de literais fixos.

3. `parse_count_without_type_query/2`
- Substituída exigência de `quantos` por `quantity_intent_tokens/1`, permitindo abreviações como `qntos`.

4. `parse_weak_against_type_query/2`
- Passou a usar `weak_intent_token/1` no lugar de lista literal fixa.

5. `parse_immunity_type_query/2`
- Passou a usar `immunity_intent_token/1` diretamente.

6. `common_typo_token/2`
- Expansão de correções conservadoras para termos de intenção (não nomes de Pokémon), incluindo:
- `pokemonss -> pokemons`
- `qnts -> qts`
- `comparacoa -> comparacao`
- `comparcao -> comparacao`
- `habilidae -> habilidade`
- variações adicionais de geração e nível.

### 2) Léxico de intents (baixo risco)

Novos tokens/frases em `db/language_references.pl`:

1. Counter:
- tokens: `counterpickar`
- frases: `quem ganha de`, `quem vence contra`, `qual vai bem contra`

2. Geração:
- keywords: `ger`

3. Quantidade/listagem:
- quantidade: `qnt`, `qntos`, `qntas`
- listagem: `exiba`, `exibir`, além de variações já existentes

4. Nível:
- cap: `lvlmax`
- word: `nvl`

5. Comparação:
- `comparativa`

6. Fraqueza/Imunidade:
- nova família `weak_intent_token/1` incluindo `vuln`
- imunidade ampliada com `imun`

## Casos de teste adicionados

Novos testes em `tests/nlp_token_heuristics_tests.pl`:

1. `parse_count_without_type_with_short_quantity_token`
- entrada: `qntos pokemons sem tipo agua`
- esperado: filtro `water`.

2. `parse_natural_type_query_with_list_synonym`
- entrada: `exiba pokemons tipo fogo`
- esperado: filtro `fire`.

3. `parse_weak_query_with_short_token`
- entrada: `quais sao vuln contra agua`
- esperado: filtro `water`.

4. `parse_compare_query_comparativo_entre`
- entrada: `comparativo entre pikachu e raichu`
- esperado: pares `pikachu` e `raichu`.

## Estratégia de segurança aplicada

1. Expansão concentrada no léxico (`db/language_references.pl`) e em pontos de parse sem alta ambiguidade.
2. Evitado alterar regras de resolução de nomes de Pokémon para não aumentar falso positivo em entidades.
3. Cobertura de regressão mantida via suíte NLP e pipeline de validação.

## Próximos passos sugeridos (para novo ciclo)

1. adicionar testes de intents compostos com geração + nível + tipo + contexto na suíte NLP;
2. criar um arquivo de frases reais anonimizadas para teste de regressão semântica;
3. separar testes por domínio (`counter`, `compare`, `type`, `rank`) para diagnóstico mais rápido em falhas.
