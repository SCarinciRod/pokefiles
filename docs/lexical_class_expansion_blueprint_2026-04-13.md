# Blueprint de Expansao Lexical por Classes (Etapa 1)

Data: 2026-04-13
Escopo: somente desenho de expansao lexical e classificacao por grupos. Sem mudancas de codigo nesta etapa.

## 1. Objetivo desta etapa

1. Organizar o lexico atual em classes reutilizaveis.
2. Definir grupos de palavras por classe (incluindo variantes coloquiais).
3. Mapear tokens que podem cair em mais de um intent.
4. Criar regras de classificacao para reduzir ambiguidade antes de implementar qualquer alteracao no parser.

## 2. Snapshot atual do lexico

1. Fatos de token: 486.
2. Predicados de token: 54.
3. Fatos de phrase: 90.
4. Predicados de phrase: 7.
5. Tokens com sobreposicao entre classes: 46.

Leitura operacional:

1. O lexico ja e amplo para intents isolados.
2. O maior risco atual esta em tokens de fronteira (ex.: vs, x, contra, vgc, item, nivel, melhor).
3. Expansao sem classificacao por classe tende a aumentar conflito de roteamento.

## 3. Taxonomia de classes lexicais (proposta)

### Classe A - Dominio principal

Define sobre o que o usuario esta falando.

Subclasses:

1. A1 counter
2. A2 battle/simulacao
3. A3 compare
4. A4 strategy (doubles)
5. A5 tournament_rules
6. A6 type/coverage
7. A7 evolution
8. A8 move/ability
9. A9 item
10. A10 ranking
11. A11 generation
12. A12 status

### Classe B - Acao desejada

Define o que o usuario quer que o bot faca no dominio.

Subclasses:

1. B1 consultar info
2. B2 listar
3. B3 contar
4. B4 ranquear
5. B5 comparar
6. B6 simular
7. B7 explicar/detalhar
8. B8 recomendar

### Classe C - Entidades e alvos

Define objetos da consulta.

Subclasses:

1. C1 pokemon
2. C2 tipo
3. C3 habilidade
4. C4 golpe
5. C5 item
6. C6 geracao
7. C7 nivel
8. C8 forma (mega/especial)

### Classe D - Modificadores

Refina a consulta principal.

Subclasses:

1. D1 negacao (sem)
2. D2 exclusividade (apenas)
3. D3 filtro contextual (sem mega, sem lendarios)
4. D4 teto/piso de nivel
5. D5 filtro de tipo
6. D6 filtro de geracao

### Classe E - Relacao e composicao

Controla ligacao entre blocos da frase.

Subclasses:

1. E1 relacao alvo (contra, para, de)
2. E2 separador de pares (vs, x, e)
3. E3 conectores compostos (e tambem, alem disso, depois)
4. E4 operadores de comparacao (melhor, pior, mais, menos)

### Classe F - Controle dialogico

1. F1 confirmacao (sim, ok)
2. F2 negacao de fluxo (nao)
3. F3 cancelamento
4. F4 padrao/default
5. F5 referencia contextual (desse, desses, ele, esse)

## 4. Expansao lexical por classe (lista inicial)

Observacao: itens abaixo sao candidatos para avaliacao, nao aplicados no codigo.

### A1 counter (candidatos)

1. punish, punir, punicao
2. answer, answera
3. segurao, segura bem, tanka
4. matchup favoravel, favoravel contra
5. anti

### A2 battle/simulacao (candidatos)

1. trade, troca de KO
2. mirror
3. 1v1 real, x1 real
4. mini sim, simulacao rapida

### A3 compare (candidatos)

1. lado a lado
2. versus direto
3. diferenca pratica
4. comparativo rapido

### A4 strategy (candidatos)

1. macro game
2. plano A, plano B
3. turno de setup
4. lane de velocidade
5. reposicionamento

### A5 tournament_rules (candidatos)

1. regulamento oficial
2. guia de penalidade
3. check de legalidade
4. regra de rodada

### B2/B3/B4/B7 (acao)

1. listar: solta, manda lista, puxa
2. contar: total de, qtd de, numero de
3. ranquear: classifica, ordena por, topa
4. detalhar: aprofunda, explica melhor, quebra por partes

### D3 filtros contextuais (candidatos)

1. sem mitico, sem paradox
2. so base form, sem forma especial
3. sem repetido

### E3 conectores de multi-intent (prioridade alta)

1. e tambem
2. alem disso
3. depois
4. em seguida
5. junto com isso
6. por fim
7. ao mesmo tempo

### F5 referencia contextual (prioridade alta)

1. esse, essa, isso
2. ele, ela
3. o mesmo
4. aquele

## 5. Tokens multi-intent (matriz de sobreposicao)

### Tokens criticos ja observados

1. vs, versus, x
2. contra
3. vgc
4. item, itens
5. nivel, lv, lvl, nvl
6. melhor, mais, maior
7. e

### Classificacao recomendada para tokens sobrepostos

1. Tipo: hard-overlap
   Exemplo: vs, x, e
   Regra: so usar como separador quando houver 2 entidades validas em lados distintos.

2. Tipo: domain-overlap
   Exemplo: vgc (strategy x tournament_rules)
   Regra: decidir por co-ocorrencia de pistas de objetivo.

3. Tipo: action-overlap
   Exemplo: melhor (ranking x compare x recommendation)
   Regra: resolver por estrutura da frase e alvo explicito.

4. Tipo: modifier-overlap
   Exemplo: nivel (word x cap)
   Regra: olhar contexto numerico e operador (ate, acima, max, min).

## 6. Regras de classificacao lexical (proposta)

### Regra 1 - score por classe

Cada token recebe score em classes candidatas.

1. Score base por classe do token.
2. Bonus de co-ocorrencia (tokens vizinhos).
3. Bonus por padrao de frase (phrase match).
4. Penalidade por conflito sem evidencia.

### Regra 2 - janela local

A decisao usa janela local de 3 a 5 tokens para contexto.

1. Evita classificar token isolado fora de contexto.
2. Melhora tokens ambigos como e, contra, melhor.

### Regra 3 - multi-label controlado

Token pode pertencer a mais de uma classe, mas com prioridade por contexto.

1. Exemplo: vgc -> strategy ou tournament_rules.
2. Exemplo: item -> evolution_detail ou item_recommendation.

### Regra 4 - bloqueios semanticos

Conflitos com bloqueio explicito.

1. tournament_rules bloqueia strategy quando frase pede apenas regulamento.
2. compare_separator so vale com 2 entidades detectadas.

## 7. Modelo de dicionario lexical por entrada

Campos sugeridos para cada entrada lexical:

1. lemma
2. variantes
3. classe_primaria
4. classes_secundarias
5. nivel_ambiguidade (baixo/medio/alto)
6. sinais_fortes (tokens que reforcam)
7. sinais_bloqueio (tokens que invalidam)
8. exemplos_positivos
9. exemplos_negativos

## 8. Ordem recomendada de trabalho (somente fase lexical)

1. Consolidar classes A-F em um inventario unico.
2. Catalogar tokens sobrepostos (hard-overlap e domain-overlap).
3. Expandir conectores de composicao (E3) e referencias contextuais (F5).
4. Expandir acao (B2/B3/B4/B7) com sinonimos coloquiais.
5. Revisar tokens de fronteira strategy x tournament_rules.

## 9. Criterios de pronto para encerrar fase lexical

1. Toda palavra nova entra com classe primaria e secundaria (quando existir).
2. Todo token de sobreposicao tem regra de desambiguacao definida.
3. Existe lista de conectores para frase composta.
4. Existe lista de referencias anaforicas para continuidade de contexto.
5. Existe conjunto minimo de frases de validacao por classe.

## 10. Exemplos de classificacao (manual)

1. "regras vgc de timer"
   Classes: A5 + B1 + C6
   Observacao: vgc cai em A5 por co-ocorrencia com regras/timer.

2. "estrategia vgc de speed control"
   Classes: A4 + B7
   Observacao: vgc cai em A4 por co-ocorrencia com estrategia/speed control.

3. "compare pikachu e raichu e quem ganha"
   Classes candidatas: A3 + A2
   Observacao: frase composta; precisa separar em 2 blocos de acao.

4. "me mostra habilidades do tyranitar e tambem os moves"
   Classes candidatas: A8 (ability) + A8 (move)
   Observacao: multi-intent do mesmo dominio; idealmente duas saidas sequenciais.

## 11. Entregavel desta etapa

Este documento define a base para expansao lexical por classes e a matriz de ambiguidade de tokens.

Proxima etapa (quando aprovado): transformar este blueprint em backlog de implementacao lexical com testes por classe.
