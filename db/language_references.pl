:- encoding(utf8).

:- multifile context_filter_token/2.
:- multifile counter_intent_token/1.
:- multifile counter_intent_phrase/1.
:- multifile battle_intent_token/1.
:- multifile battle_intent_phrase/1.
:- multifile legendary_request_token/1.
:- multifile generation_keyword_token/1.
:- multifile generation_prefix/1.
:- multifile quantity_intent_token/1.
:- multifile list_intent_token/1.
:- multifile level_cap_indicator_token/1.
:- multifile counter_relation_token/1.
:- multifile compare_separator_token/1.
:- multifile battle_relation_phrase/1.
:- multifile negation_token/1.
:- multifile only_token/1.
:- multifile mega_token/1.
:- multifile pokemon_noun_token/1.
:- multifile legendary_token/1.
:- multifile mythical_token/1.
:- multifile cancel_token/1.
:- multifile default_choice_token/1.
:- multifile yes_response_token/1.
:- multifile no_response_token/1.
:- multifile level_word_token/1.
:- multifile evolution_intent_token/1.
:- multifile ranking_intent_token/1.
:- multifile top_intent_token/1.
:- multifile team_intent_token/1.
:- multifile compare_intent_token/1.
:- multifile evolution_structure_token/1.
:- multifile evolution_chain_token/1.
:- multifile immunity_intent_token/1.
:- multifile coverage_intent_token/1.
:- multifile number_word_value/2.
:- multifile generation_number_word/2.

negation_token("sem").

only_token("so").
only_token("só").
only_token("apenas").
only_token("somente").

pokemon_noun_token("pokemon").
pokemon_noun_token("pokemons").
pokemon_noun_token("pokémon").
pokemon_noun_token("pokémons").

mega_token("mega").
mega_token("megas").

legendary_token("lendario").
legendary_token("lendarios").
legendary_token("lendário").
legendary_token("lendários").

mythical_token("mitico").
mythical_token("miticos").
mythical_token("mítico").
mythical_token("míticos").

legendary_or_mythical_token(Token) :- legendary_token(Token).
legendary_or_mythical_token(Token) :- mythical_token(Token).

context_filter_token(no_mega, [Neg, Mega]) :-
	negation_token(Neg),
	mega_token(Mega).

context_filter_token(only_mega, [Only, Mega]) :-
	only_token(Only),
	mega_token(Mega).

context_filter_token(no_legendary, [Neg, LM]) :-
	negation_token(Neg),
	legendary_or_mythical_token(LM).

context_filter_token(no_legendary, [Neg, Poke, LM]) :-
	negation_token(Neg),
	pokemon_noun_token(Poke),
	legendary_or_mythical_token(LM).

context_filter_token(only_legendary, [Only, LM]) :-
	only_token(Only),
	legendary_or_mythical_token(LM).

context_filter_token(only_legendary, [Only, Poke, LM]) :-
	only_token(Only),
	pokemon_noun_token(Poke),
	legendary_or_mythical_token(LM).

context_filter_token(only_unevolved, [Neg, Evo]) :-
	negation_token(Neg),
	unevolved_state_token(Evo).

context_filter_token(only_unevolved, [Neg, Poke, Evo]) :-
	negation_token(Neg),
	pokemon_noun_token(Poke),
	unevolved_state_token(Evo).

context_filter_token(only_evolved, [Evo]) :-
	evolved_state_token(Evo).

context_filter_token(only_evolved, [Poke, Evo]) :-
	pokemon_noun_token(Poke),
	evolved_state_token(Evo).

counter_intent_token("counter").
counter_intent_token("counters").
counter_intent_token("countera").
counter_intent_token("counteram").
counter_intent_token("counterar").
counter_intent_token("counterando").
counter_intent_token("vence").
counter_intent_token("vencer").
counter_intent_token("vencem").
counter_intent_token("ganha").
counter_intent_token("ganhar").
counter_intent_token("ganham").
counter_intent_token("sola").
counter_intent_token("amassa").
counter_intent_token("stompa").
counter_intent_token("deita").
counter_intent_token("janta").
counter_intent_token("surra").
counter_intent_token("check").
counter_intent_token("checks").
counter_intent_token("counterpick").
counter_intent_token("counterar").

counter_intent_phrase(["bom", "contra"]).
counter_intent_phrase(["boa", "contra"]).
counter_intent_phrase(["forte", "contra"]).
counter_intent_phrase(["melhor", "contra"]).
counter_intent_phrase(["vantagem", "contra"]).
counter_intent_phrase(["como", "ganhar", "de"]).
counter_intent_phrase(["quem", "countera"]).
counter_intent_phrase(["quem", "segura", "melhor"]).
counter_intent_phrase(["quem", "lida", "melhor", "com"]).
counter_intent_phrase(["quem", "vai", "bem", "contra"]).

battle_intent_token("simule").
battle_intent_token("simular").
battle_intent_token("simula").
battle_intent_token("embate").
battle_intent_token("embates").
battle_intent_token("duelo").
battle_intent_token("duelos").
battle_intent_token("batalha").
battle_intent_token("batalhas").
battle_intent_token("luta").
battle_intent_token("lutas").
battle_intent_token("confronto").
battle_intent_token("confrontos").
battle_intent_token("1x1").
battle_intent_token("1v1").
battle_intent_token("x1").
battle_intent_token("manoamano").
battle_intent_token("mano").
battle_intent_token("x").
battle_intent_token("versus").
battle_intent_token("vs").

battle_intent_phrase(["quem", "ganha"]).
battle_intent_phrase(["quem", "vence"]).
battle_intent_phrase(["quem", "leva"]).
battle_intent_phrase(["qual", "ganha"]).
battle_intent_phrase(["qual", "vence"]).
battle_intent_phrase(["qual", "leva"]).
battle_intent_phrase(["quem", "passa", "por"]).
battle_intent_phrase(["quem", "leva", "a", "melhor"]).

legendary_request_token(Token) :- legendary_token(Token).
legendary_request_token(Token) :- mythical_token(Token).

generation_keyword_token("geracao").
generation_keyword_token("geração").
generation_keyword_token("gen").

generation_prefix("g").
generation_prefix("gen").
generation_prefix("geracao").
generation_prefix("geração").

quantity_intent_token("quantos").
quantity_intent_token("quantas").
quantity_intent_token("qtd").
quantity_intent_token("qtos").
quantity_intent_token("qts").
quantity_intent_token("quantis").
quantity_intent_token("quanto").
quantity_intent_token("qtde").
quantity_intent_token("numero").
quantity_intent_token("número").

list_intent_token("quais").
list_intent_token("lista").
list_intent_token("mostra").
list_intent_token("liste").
list_intent_token("tem").
list_intent_token("existem").
list_intent_token("quero").
list_intent_token("ver").
list_intent_token("listar").

level_cap_indicator_token("abaixo").
level_cap_indicator_token("ate").
level_cap_indicator_token("até").
level_cap_indicator_token("maximo").
level_cap_indicator_token("máximo").
level_cap_indicator_token("max").
level_cap_indicator_token("cap").
level_cap_indicator_token("limite").
level_cap_indicator_token("nivel").
level_cap_indicator_token("nível").
level_cap_indicator_token("ateh").
level_cap_indicator_token("lvl").
level_cap_indicator_token("level").

counter_relation_token("de").
counter_relation_token("do").
counter_relation_token("da").
counter_relation_token("pro").
counter_relation_token("para").

compare_separator_token("vs").
compare_separator_token("versus").
compare_separator_token("x").
compare_separator_token("ou").
compare_separator_token("e").
compare_separator_token("contra").

battle_relation_phrase(["ganha", "de"]).
battle_relation_phrase(["ganha", "do"]).
battle_relation_phrase(["ganha", "da"]).
battle_relation_phrase(["vence"]).
battle_relation_phrase(["contra"]).

cancel_token("cancelar").
cancel_token("cancela").
cancel_token("pare").
cancel_token("parar").
cancel_token("desistir").

default_choice_token("padrao").
default_choice_token("padrão").
default_choice_token("qualquer").
default_choice_token("tanto").
default_choice_token("normal").

yes_response_token("sim").
yes_response_token("s").
yes_response_token("ok").
yes_response_token("okay").
yes_response_token("confirmo").
yes_response_token("yes").
yes_response_token("y").

no_response_token("nao").
no_response_token("não").
no_response_token("n").
no_response_token("no").
no_response_token("negativo").

level_word_token("lv").
level_word_token("lvl").
level_word_token("level").
level_word_token("nivel").
level_word_token("nível").

evolution_intent_token("evolucao").
evolution_intent_token("evolução").
evolution_intent_token("evoluir").
evolution_intent_token("evolui").
evolution_intent_token("evoluem").
evolution_intent_token("evoluido").
evolution_intent_token("evoluida").
evolution_intent_token("evoluidos").
evolution_intent_token("evoluidas").
evolution_intent_token("evoluído").
evolution_intent_token("evoluída").
evolution_intent_token("evoluídos").
evolution_intent_token("evoluídas").
evolution_intent_token("evolutivo").
evolution_intent_token("evolutiva").
evolution_intent_token("estagio").
evolution_intent_token("estágio").

unevolved_state_token("evoluido").
unevolved_state_token("evoluida").
unevolved_state_token("evoluidos").
unevolved_state_token("evoluidas").
unevolved_state_token("evoluído").
unevolved_state_token("evoluída").
unevolved_state_token("evoluídos").
unevolved_state_token("evoluídas").
unevolved_state_token("evolutivo").
unevolved_state_token("evolutiva").

evolved_state_token("evoluido").
evolved_state_token("evoluida").
evolved_state_token("evoluidos").
evolved_state_token("evoluidas").
evolved_state_token("evoluído").
evolved_state_token("evoluída").
evolved_state_token("evoluídos").
evolved_state_token("evoluídas").

ranking_intent_token("ranking").
ranking_intent_token("rank").
ranking_intent_token("rankeie").
ranking_intent_token("rankear").
ranking_intent_token("ordene").
ranking_intent_token("ordenar").

top_intent_token("top").
top_intent_token("melhores").
top_intent_token("maiores").
top_intent_token("mais").

team_intent_token("time").
team_intent_token("times").
team_intent_token("elenco").
team_intent_token("roster").
team_intent_token("squad").
team_intent_token("meu").

compare_intent_token("compare").
compare_intent_token("comparar").
compare_intent_token("comparacao").
compare_intent_token("comparação").

evolution_structure_token("estagio").
evolution_structure_token("estágio").
evolution_structure_token("cadeia").
evolution_structure_token("final").
evolution_structure_token("inicial").
evolution_structure_token("base").

evolution_chain_token("cadeia").
evolution_chain_token("linha").
evolution_chain_token("arvore").
evolution_chain_token("árvore").
evolution_chain_token("completa").
evolution_chain_token("completo").

immunity_intent_token("imunidade").
immunity_intent_token("imunidades").
immunity_intent_token("imune").
immunity_intent_token("imunes").

coverage_intent_token("cobertura").
coverage_intent_token("cobre").
coverage_intent_token("cobrem").
coverage_intent_token("cobrir").

% Números por extenso (base para geração, nível e limites de ranking)
number_word_value("zero", 0).
number_word_value("um", 1).
number_word_value("uma", 1).
number_word_value("dois", 2).
number_word_value("duas", 2).
number_word_value("tres", 3).
number_word_value("três", 3).
number_word_value("quatro", 4).
number_word_value("cinco", 5).
number_word_value("seis", 6).
number_word_value("sete", 7).
number_word_value("oito", 8).
number_word_value("nove", 9).
number_word_value("dez", 10).
number_word_value("onze", 11).
number_word_value("doze", 12).
number_word_value("treze", 13).
number_word_value("catorze", 14).
number_word_value("quatorze", 14).
number_word_value("quinze", 15).
number_word_value("dezesseis", 16).
number_word_value("dezasseis", 16).
number_word_value("dezessete", 17).
number_word_value("dezassete", 17).
number_word_value("dezoito", 18).
number_word_value("dezenove", 19).
number_word_value("vinte", 20).
number_word_value("trinta", 30).
number_word_value("quarenta", 40).
number_word_value("cinquenta", 50).
number_word_value("sessenta", 60).
number_word_value("setenta", 70).
number_word_value("oitenta", 80).
number_word_value("noventa", 90).
number_word_value("cem", 100).
number_word_value("cento", 100).

% Ordinais/cardinais de geração (1..9)
generation_number_word(Token, Number) :-
	number_word_value(Token, Number),
	between(1, 9, Number).

generation_number_word("primeira", 1).
generation_number_word("primeiro", 1).
generation_number_word("segunda", 2).
generation_number_word("segundo", 2).
generation_number_word("terceira", 3).
generation_number_word("terceiro", 3).
generation_number_word("quarta", 4).
generation_number_word("quarto", 4).
generation_number_word("quinta", 5).
generation_number_word("quinto", 5).
generation_number_word("sexta", 6).
generation_number_word("sexto", 6).
generation_number_word("setima", 7).
generation_number_word("sétima", 7).
generation_number_word("setimo", 7).
generation_number_word("sétimo", 7).
generation_number_word("oitava", 8).
generation_number_word("oitavo", 8).
generation_number_word("nona", 9).
generation_number_word("nono", 9).
