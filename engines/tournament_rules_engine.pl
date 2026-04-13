:- encoding(utf8).

parse_tournament_rules_query(Text, Topic) :-
    tokenize_for_match(Text, Tokens),
    tournament_rules_tokens(Tokens),
    tournament_rules_topic_from_tokens(Tokens, Topic),
    !.
parse_tournament_rules_query(Text, general) :-
    tokenize_for_match(Text, Tokens),
    tournament_rules_tokens(Tokens).

tournament_rules_tokens(Tokens) :-
    member(Token, Tokens),
    tournament_rules_token(Token),
    !.
tournament_rules_tokens(Tokens) :-
    contiguous_sublist(["morte", "subita"], Tokens),
    !.
tournament_rules_tokens(Tokens) :-
    contiguous_sublist(["sudden", "death"], Tokens),
    !.
tournament_rules_tokens(Tokens) :-
    contiguous_sublist(["team", "list"], Tokens),
    !.
tournament_rules_tokens(Tokens) :-
    contiguous_sublist(["team", "id"], Tokens),
    !.

tournament_rules_topic_from_tokens(Tokens, penalties) :-
    tokens_include_any(Tokens, ["penalidade", "penalidades", "precaucao", "aviso", "derrota", "mandatoria", "desqualificacao", "desclassificacao"]),
    !.
tournament_rules_topic_from_tokens(Tokens, checks_legality) :-
    tokens_include_any(Tokens, ["legalidade", "verificacao", "verificacoes", "teamlist", "teamid", "ilegal", "manipulado", "manipulacao", "battle", "stadium", "juiz", "juizes"]),
    !.
tournament_rules_topic_from_tokens(Tokens, resolution) :-
    tokens_include_any(Tokens, ["empate", "run", "desistencia", "desistir", "congelado", "morte", "subita", "suddendeath"]),
    !.
tournament_rules_topic_from_tokens(Tokens, timers) :-
    tokens_include_any(Tokens, ["tempo", "timer", "preview", "movimento", "jogador", "minuto", "minutos"]),
    !.
tournament_rules_topic_from_tokens(Tokens, match_format) :-
    tokens_include_any(Tokens, ["dupla", "duplas", "bo1", "bo3", "melhor", "suica", "suicas", "eliminacao", "topcut", "cut", "rodada", "rodadas"]),
    !.
tournament_rules_topic_from_tokens(Tokens, team_building) :-
    tokens_include_any(Tokens, ["item", "itens", "pokedex", "nacional", "nivel", "home", "scarlet", "violet", "champions"]),
    !.
tournament_rules_topic_from_tokens(Tokens, equipment_conduct) :-
    tokens_include_any(Tokens, ["anotacoes", "fones", "mesa", "comida", "bebida", "link", "code", "room", "id", "conectividade"]),
    !.
tournament_rules_topic_from_tokens(_, general).

tokens_include_any(Tokens, Candidates) :-
    member(Token, Tokens),
    member(Token, Candidates),
    !.

answer_tournament_rules_query(Topic) :-
    tournament_rules_topic_title(Topic, Title),
    tournament_rules_topic_lines(Topic, Lines),
    format('Bot: Regras de torneio VGC - ~w.~n', [Title]),
    writeln('Bot: Este conteudo e apenas regulamento de torneio e nao orientacao de estrategia de batalha.'),
    print_tournament_rules_lines(Lines).

tournament_rules_topic_title(team_building, 'montagem de equipe').
tournament_rules_topic_title(match_format, 'formato de partida').
tournament_rules_topic_title(timers, 'limites de tempo').
tournament_rules_topic_title(resolution, 'resolucao de partida').
tournament_rules_topic_title(checks_legality, 'verificacoes e legalidade').
tournament_rules_topic_title(penalties, 'penalidades').
tournament_rules_topic_title(equipment_conduct, 'equipamentos e conduta').
tournament_rules_topic_title(general, 'resumo geral').

tournament_rules_topic_lines(team_building, [
    "Cada Pokemon pode segurar 1 item, sem repeticao de item na mesma equipe.",
    "Nao pode haver dois Pokemon com o mesmo numero da Pokedex Nacional.",
    "Todos os Pokemon entram no jogo ajustados para nivel 50.",
    "So sao validos Pokemon obtidos por meios permitidos no regulamento ativo (jogo, HOME ou distribuicoes oficiais)."
]).

tournament_rules_topic_lines(match_format, [
    "As partidas sao em Batalha Dupla.",
    "Em cada jogo, cada jogador escolhe 4 Pokemon da sua Equipe de Batalha.",
    "Rodadas suicas podem ser BO1 ou BO3, conforme organizador.",
    "Top Cut deve ser disputado em BO3."
]).

tournament_rules_topic_lines(timers, [
    "Pre-visualizacao da equipe: 90 segundos.",
    "Escolha de movimento por turno: 45 segundos.",
    "Tempo total por jogador: 7 minutos.",
    "Tempo total de jogo: 20 minutos."
]).

tournament_rules_topic_lines(resolution, [
    "Empate intencional nao e permitido.",
    "Usar a opcao Run e a forma valida de desistir da partida.",
    "Se os dois lados desmaiam no ultimo turno, o proprio jogo determina o vencedor.",
    "Morte Subita: inicia nova partida e vence quem terminar um turno com mais Pokemon restantes."
]).

tournament_rules_topic_lines(checks_legality, [
    "Ha verificacao da lista de equipe e verificacao de legalidade.",
    "Juizes conferem se a equipe usada corresponde a lista enviada.",
    "Em Scarlet/Violet, a verificacao eletronica passa pelo Battle Stadium.",
    "Pokemon ou itens manipulados ilegalmente por software/dispositivo externo sao proibidos."
]).

tournament_rules_topic_lines(penalties, [
    "Escala resumida: Precaucao, Aviso e Derrota Mandatoria.",
    "Infractions graves ou repetidas podem levar a desclassificacao.",
    "A aplicacao detalhada segue o Guia de Penalidades do Play! Pokemon."
]).

tournament_rules_topic_lines(equipment_conduct, [
    "Anotacoes sao permitidas, mas cada rodada comeca com folha em branco.",
    "Materiais impressos de apoio (como tabela de tipos) nao sao permitidos na mesa.",
    "Fones so com fio e ligados diretamente ao console.",
    "Comidas e bebidas nao sao permitidas na mesa de jogo."
]).

tournament_rules_topic_lines(general, [
    "Esse bloco cobre apenas regulamento de torneio VGC, separado da estrategia de batalha.",
    "Voce pode pedir por tema: formato, tempo, montagem de equipe, resolucao, verificacao ou penalidades.",
    "Exemplos: 'regras vgc de tempo', 'penalidades no vgc', 'como funciona morte subita'."
]).

print_tournament_rules_lines([]).
print_tournament_rules_lines([Line | Rest]) :-
    format('  - ~w~n', [Line]),
    print_tournament_rules_lines(Rest).
