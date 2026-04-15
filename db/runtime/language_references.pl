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
:- multifile evolution_detail_token/1.
:- multifile immunity_intent_token/1.
:- multifile coverage_intent_token/1.
:- multifile weak_intent_token/1.
:- multifile number_word_value/2.
:- multifile generation_number_word/2.
:- multifile ranking_signal_token/1.
:- multifile metric_token/2.
:- multifile metric_phrase/2.
:- multifile rank_role_token/2.
:- multifile focus_choice_token/2.
:- multifile move_intent_token/1.
:- multifile item_intent_token/1.
:- multifile item_intent_phrase/1.
:- multifile level_upper_bound_token/1.
:- multifile level_lower_bound_token/1.
:- multifile level_upper_bound_phrase/1.
:- multifile level_lower_bound_phrase/1.
:- multifile best_switch_intent_phrase/1.
:- multifile context_reference_token/1.
:- multifile team_compare_signal_token/1.
:- multifile tournament_rules_token/1.
:- multifile strategy_intent_token/1.
:- multifile doubles_format_token/1.
:- multifile speed_control_token/1.
:- multifile trick_room_token/1.
:- multifile weather_plan_token/1.
:- multifile bo3_adaptation_token/1.
:- multifile positioning_token/1.
:- multifile synergy_intent_token/1.

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
counter_intent_token("ganharia").
counter_intent_token("venceria").
counter_intent_token("counterpickar").
counter_intent_token("counterpicka").
counter_intent_token("counterpickam").
counter_intent_token("sola").
counter_intent_token("amassa").
counter_intent_token("stompa").
counter_intent_token("deita").
counter_intent_token("janta").
counter_intent_token("surra").
counter_intent_token("responde").
counter_intent_token("respondem").
counter_intent_token("responder").
counter_intent_token("lida").
counter_intent_token("lidar").
counter_intent_token("bate").
counter_intent_token("punir").
counter_intent_token("pune").
counter_intent_token("punem").
counter_intent_token("punicao").
counter_intent_token("resposta").
counter_intent_token("answer").
counter_intent_token("anti").
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
counter_intent_phrase(["quem", "ganha", "de"]).
counter_intent_phrase(["quem", "vence", "contra"]).
counter_intent_phrase(["qual", "vai", "bem", "contra"]).
counter_intent_phrase(["quem", "segura", "melhor"]).
counter_intent_phrase(["quem", "lida", "melhor", "com"]).
counter_intent_phrase(["quem", "vai", "bem", "contra"]).
counter_intent_phrase(["quem", "responde", "melhor", "a"]).
counter_intent_phrase(["qual", "responde", "melhor", "a"]).
counter_intent_phrase(["quem", "lida", "bem", "contra"]).
counter_intent_phrase(["quem", "segura", "bem", "contra"]).
counter_intent_phrase(["qual", "segura", "bem", "contra"]).
counter_intent_phrase(["resposta", "contra"]).
counter_intent_phrase(["resposta", "para"]).
counter_intent_phrase(["counter", "de"]).

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
battle_intent_token("simulacao").
battle_intent_token("simulação").
battle_intent_token("simulado").
battle_intent_token("simulada").
battle_intent_token("mirror").
battle_intent_token("1x1real").
battle_intent_token("1v1real").

battle_intent_phrase(["quem", "ganha"]).
battle_intent_phrase(["quem", "vence"]).
battle_intent_phrase(["quem", "leva"]).
battle_intent_phrase(["qual", "ganha"]).
battle_intent_phrase(["qual", "vence"]).
battle_intent_phrase(["qual", "leva"]).
battle_intent_phrase(["quem", "passa", "por"]).
battle_intent_phrase(["quem", "leva", "a", "melhor"]).
battle_intent_phrase(["simulacao", "rapida"]).
battle_intent_phrase(["simulação", "rápida"]).
battle_intent_phrase(["x1", "real"]).
battle_intent_phrase(["1v1", "real"]).

legendary_request_token(Token) :- legendary_token(Token).
legendary_request_token(Token) :- mythical_token(Token).

generation_keyword_token("geracao").
generation_keyword_token("geração").
generation_keyword_token("gen").
generation_keyword_token("gera").
generation_keyword_token("ger").

generation_prefix("g").
generation_prefix("gen").
generation_prefix("geracao").
generation_prefix("geração").
generation_prefix("ger").

quantity_intent_token("quantos").
quantity_intent_token("quantas").
quantity_intent_token("qtd").
quantity_intent_token("qtos").
quantity_intent_token("qts").
quantity_intent_token("qntos").
quantity_intent_token("qntas").
quantity_intent_token("qnt").
quantity_intent_token("qt").
quantity_intent_token("qto").
quantity_intent_token("qtas").
quantity_intent_token("quantis").
quantity_intent_token("quant").
quantity_intent_token("quanto").
quantity_intent_token("qtde").
quantity_intent_token("numero").
quantity_intent_token("número").
quantity_intent_token("quantidade").
quantity_intent_token("contagem").
quantity_intent_token("total").
quantity_intent_token("totais").

list_intent_token("quais").
list_intent_token("lista").
list_intent_token("mostra").
list_intent_token("liste").
list_intent_token("tem").
list_intent_token("existem").
list_intent_token("quero").
list_intent_token("ver").
list_intent_token("listar").
list_intent_token("mostre").
list_intent_token("quaiss").
list_intent_token("exiba").
list_intent_token("exibir").
list_intent_token("exibe").
list_intent_token("mostrar").
list_intent_token("traga").
list_intent_token("traz").
list_intent_token("manda").
list_intent_token("solta").
list_intent_token("puxa").
list_intent_token("retorna").
list_intent_token("retorne").

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
level_cap_indicator_token("nvl").
level_cap_indicator_token("lvlmax").

level_upper_bound_token("ate").
level_upper_bound_token("até").
level_upper_bound_token("abaixo").
level_upper_bound_token("maximo").
level_upper_bound_token("máximo").
level_upper_bound_token("max").
level_upper_bound_token("cap").
level_upper_bound_token("limite").
level_upper_bound_token("ateh").
level_upper_bound_token("teto").

level_lower_bound_token("acima").
level_lower_bound_token("maior").
level_lower_bound_token("minimo").
level_lower_bound_token("mínimo").
level_lower_bound_token("min").
level_lower_bound_token("desde").
level_lower_bound_token("apartir").
level_lower_bound_token("apartirde").

level_upper_bound_phrase(["abaixo", "de"]).
level_upper_bound_phrase(["no", "maximo"]).
level_upper_bound_phrase(["no", "máximo"]).
level_upper_bound_phrase(["no", "max"]).
level_upper_bound_phrase(["ate", "o"]).
level_upper_bound_phrase(["ate", "o", "nivel"]).
level_upper_bound_phrase(["no", "teto"]).

level_lower_bound_phrase(["acima", "de"]).
level_lower_bound_phrase(["a", "partir", "de"]).
level_lower_bound_phrase(["a", "partir"]).
level_lower_bound_phrase(["depois", "de"]).
level_lower_bound_phrase(["mais", "de"]).
level_lower_bound_phrase(["no", "minimo"]).
level_lower_bound_phrase(["no", "mínimo"]).
level_lower_bound_phrase(["pelo", "menos"]).

counter_relation_token("de").
counter_relation_token("do").
counter_relation_token("da").
counter_relation_token("pro").
counter_relation_token("para").
counter_relation_token("ao").

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

best_switch_intent_phrase(["quem", "entra", "melhor", "contra"]).
best_switch_intent_phrase(["qual", "entra", "melhor", "contra"]).
best_switch_intent_phrase(["quem", "segura", "melhor", "contra"]).
best_switch_intent_phrase(["qual", "segura", "melhor", "contra"]).
best_switch_intent_phrase(["segura", "melhor", "contra"]).

context_reference_token("desses").
context_reference_token("desse").
context_reference_token("deles").
context_reference_token("dessas").
context_reference_token("esse").
context_reference_token("essa").
context_reference_token("isso").
context_reference_token("ele").
context_reference_token("ela").
context_reference_token("mesmo").

team_compare_signal_token("melhor").
team_compare_signal_token("vale").
team_compare_signal_token("forte").
team_compare_signal_token("encaixa").
team_compare_signal_token("funciona").

cancel_token("cancelar").
cancel_token("cancela").
cancel_token("pare").
cancel_token("parar").
cancel_token("desistir").
cancel_token("cancele").
cancel_token("stop").

default_choice_token("padrao").
default_choice_token("padrão").
default_choice_token("qualquer").
default_choice_token("tanto").
default_choice_token("normal").
default_choice_token("default").
default_choice_token("livre").
default_choice_token("semfiltro").
default_choice_token("semfiltros").

yes_response_token("sim").
yes_response_token("s").
yes_response_token("ok").
yes_response_token("okay").
yes_response_token("confirmo").
yes_response_token("yes").
yes_response_token("y").
yes_response_token("claro").
yes_response_token("bora").
yes_response_token("pode").
yes_response_token("manda").

no_response_token("nao").
no_response_token("não").
no_response_token("n").
no_response_token("no").
no_response_token("negativo").
no_response_token("nah").
no_response_token("nem").

level_word_token("lv").
level_word_token("lvl").
level_word_token("level").
level_word_token("nivel").
level_word_token("nível").
level_word_token("nvl").

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
ranking_intent_token("classificar").
ranking_intent_token("classifica").

top_intent_token("top").
top_intent_token("melhores").
top_intent_token("maiores").
top_intent_token("mais").
top_intent_token("piores").

team_intent_token("time").
team_intent_token("times").
team_intent_token("elenco").
team_intent_token("roster").
team_intent_token("squad").
team_intent_token("meu").
team_intent_token("lineup").
team_intent_token("comp").

compare_intent_token("compare").
compare_intent_token("comparar").
compare_intent_token("comparacao").
compare_intent_token("comparação").
compare_intent_token("comparativo").
compare_intent_token("comparativa").
compare_intent_token("comparando").
compare_intent_token("diferenca").
compare_intent_token("diferença").
compare_intent_token("diferencas").
compare_intent_token("diferenças").

evolution_structure_token("estagio").
evolution_structure_token("estágio").
evolution_structure_token("cadeia").
evolution_structure_token("final").
evolution_structure_token("inicial").
evolution_structure_token("base").
evolution_structure_token("estagios").
evolution_structure_token("estágios").
evolution_structure_token("ramo").
evolution_structure_token("ramos").

evolution_chain_token("cadeia").
evolution_chain_token("linha").
evolution_chain_token("arvore").
evolution_chain_token("árvore").
evolution_chain_token("completa").
evolution_chain_token("completo").
evolution_chain_token("linhagem").
evolution_chain_token("cadeias").
evolution_chain_token("linhas").

evolution_detail_token("como").
evolution_detail_token("quando").
evolution_detail_token("metodo").
evolution_detail_token("método").
evolution_detail_token("metodos").
evolution_detail_token("métodos").
evolution_detail_token("requisito").
evolution_detail_token("requisitos").
evolution_detail_token("condicao").
evolution_detail_token("condição").
evolution_detail_token("item").
evolution_detail_token("itens").
evolution_detail_token("felicidade").
evolution_detail_token("amizade").
evolution_detail_token("requer").
evolution_detail_token("exige").
evolution_detail_token("precisa").

immunity_intent_token("imunidade").
immunity_intent_token("imunidades").
immunity_intent_token("imune").
immunity_intent_token("imunes").
immunity_intent_token("imun").
immunity_intent_token("immune").
immunity_intent_token("invulneravel").
immunity_intent_token("invulnerável").
immunity_intent_token("anula").

weak_intent_token("fraco").
weak_intent_token("fraca").
weak_intent_token("fracos").
weak_intent_token("fracas").
weak_intent_token("fraqueza").
weak_intent_token("fraquezas").
weak_intent_token("vulneravel").
weak_intent_token("vulnerável").
weak_intent_token("vulneraveis").
weak_intent_token("vulneráveis").
weak_intent_token("vuln").
weak_intent_token("apanha").

coverage_intent_token("cobertura").
coverage_intent_token("cobre").
coverage_intent_token("cobrem").
coverage_intent_token("cobrir").
coverage_intent_token("coberturaofensiva").

% Sinalizadores de ranking
ranking_signal_token("top").
ranking_signal_token("ranking").
ranking_signal_token("rank").
ranking_signal_token("rankeie").
ranking_signal_token("rankear").
ranking_signal_token("ordene").
ranking_signal_token("ordenar").
ranking_signal_token("classifica").
ranking_signal_token("classificar").
ranking_signal_token("mais").
ranking_signal_token("maior").
ranking_signal_token("maiores").
ranking_signal_token("melhor").
ranking_signal_token("melhores").

% Tokens por métrica de ranking
metric_token(speed, "rapido").
metric_token(speed, "rápido").
metric_token(speed, "rapidos").
metric_token(speed, "rápidos").
metric_token(speed, "veloz").
metric_token(speed, "velocidade").
metric_token(speed, "speed").

metric_token(defensive_bulk, "bulk").
metric_token(defensive_bulk, "tanque").
metric_token(defensive_bulk, "tanques").
metric_token(defensive_bulk, "resistente").
metric_token(defensive_bulk, "resistentes").

metric_token(physical_attack, "attack").
metric_token(physical_attack, "atk").
metric_phrase(physical_attack, ["ataque", "fisico"]).
metric_phrase(physical_attack, ["ataque", "físico"]).
metric_phrase(physical_attack, ["atk", "fisico"]).
metric_phrase(physical_attack, ["atk", "físico"]).
metric_phrase(physical_attack, ["atacante", "fisico"]).
metric_phrase(physical_attack, ["atacante", "físico"]).
metric_phrase(physical_attack, ["atacantes", "fisicos"]).
metric_phrase(physical_attack, ["atacantes", "físicos"]).

metric_token(special_attack, "spatk").
metric_phrase(special_attack, ["ataque", "especial"]).
metric_phrase(special_attack, ["atk", "especial"]).
metric_phrase(special_attack, ["sp", "atk"]).
metric_phrase(special_attack, ["sp", "attack"]).
metric_phrase(special_attack, ["special", "attack"]).
metric_phrase(special_attack, ["atacante", "especial"]).
metric_phrase(special_attack, ["atacantes", "especiais"]).

metric_phrase(physical_defense, ["defesa", "fisica"]).
metric_phrase(physical_defense, ["defesa", "física"]).
metric_phrase(physical_defense, ["defensor", "fisico"]).
metric_phrase(physical_defense, ["defensor", "físico"]).
metric_phrase(physical_defense, ["defensores", "fisicos"]).
metric_phrase(physical_defense, ["defensores", "físicos"]).

metric_token(special_defense, "spdef").
metric_phrase(special_defense, ["defesa", "especial"]).
metric_phrase(special_defense, ["especial", "defesa"]).
metric_phrase(special_defense, ["sp", "def"]).
metric_phrase(special_defense, ["special", "defense"]).
metric_phrase(special_defense, ["especial", "defense"]).
metric_phrase(special_defense, ["defense", "especial"]).
metric_phrase(special_defense, ["defensor", "especial"]).
metric_phrase(special_defense, ["defensores", "especiais"]).
metric_phrase(special_defense, ["defesa", "epecial"]).
metric_phrase(special_defense, ["epecial", "defesa"]).
metric_token(special_defense, "especialdefense").
metric_token(special_defense, "specialdefense").

metric_token(bst, "bst").
metric_phrase(bst, ["soma", "stats"]).
metric_phrase(bst, ["total", "stats"]).

metric_token(tallest, "altura").
metric_token(shortest, "altura").
metric_token(heaviest, "peso").
metric_token(lightest, "peso").
metric_phrase(tallest, ["altura", "maior"]).
metric_phrase(tallest, ["altura", "altos"]).
metric_phrase(tallest, ["altura", "alto"]).
metric_phrase(shortest, ["altura", "menor"]).
metric_phrase(shortest, ["altura", "baixo"]).
metric_phrase(shortest, ["altura", "baixos"]).
metric_phrase(heaviest, ["peso", "maior"]).
metric_phrase(heaviest, ["peso", "pesado"]).
metric_phrase(heaviest, ["peso", "pesados"]).
metric_phrase(lightest, ["peso", "menor"]).
metric_phrase(lightest, ["peso", "leve"]).
metric_phrase(lightest, ["peso", "leves"]).

% Papéis que exigem foco (físico/especial)
rank_role_token(attacker, "atacante").
rank_role_token(attacker, "atacantes").
rank_role_token(attacker, "ofensivo").
rank_role_token(attacker, "ofensivos").

rank_role_token(defender, "defensor").
rank_role_token(defender, "defensores").
rank_role_token(defender, "defenseores").
rank_role_token(defender, "defensivo").
rank_role_token(defender, "defensivos").

% Escolha de foco para ranking por papel
focus_choice_token(physical, "fisico").
focus_choice_token(physical, "físico").
focus_choice_token(physical, "fisica").
focus_choice_token(physical, "física").
focus_choice_token(physical, "atk").
focus_choice_token(physical, "attack").

focus_choice_token(special, "especial").
focus_choice_token(special, "sp").
focus_choice_token(special, "spatk").
focus_choice_token(special, "spdef").
focus_choice_token(special, "especialdefense").

move_intent_token("move").
move_intent_token("moves").
move_intent_token("movelist").
move_intent_token("moveset").
move_intent_token("golpe").
move_intent_token("golpes").
move_intent_token("skill").
move_intent_token("skills").
move_intent_token("movimentos").
move_intent_token("ataques").

item_intent_token("item").
item_intent_token("itens").
item_intent_token("held").
item_intent_token("segura").
item_intent_token("segurar").
item_intent_token("segurando").
item_intent_token("equipa").
item_intent_token("equipar").
item_intent_token("equipado").
item_intent_token("focus").
item_intent_token("sash").
item_intent_token("orb").
item_intent_token("boots").
item_intent_token("choice").
item_intent_token("vest").

tournament_rules_token("vgc").
tournament_rules_token("torneio").
tournament_rules_token("torneios").
tournament_rules_token("campeonato").
tournament_rules_token("campeonatos").
tournament_rules_token("regulamento").
tournament_rules_token("manual").
tournament_rules_token("handbook").
tournament_rules_token("rk9").
tournament_rules_token("teamlist").
tournament_rules_token("teamid").
tournament_rules_token("juiz").
tournament_rules_token("juizes").
tournament_rules_token("penalidade").
tournament_rules_token("penalidades").
tournament_rules_token("swiss").
tournament_rules_token("suica").
tournament_rules_token("suicas").
tournament_rules_token("eliminacao").
tournament_rules_token("bo1").
tournament_rules_token("bo3").
tournament_rules_token("bo5").
tournament_rules_token("rodada").
tournament_rules_token("rodadas").
tournament_rules_token("topcut").
tournament_rules_token("judge").
tournament_rules_token("penalty").
tournament_rules_token("playpokemon").
tournament_rules_token("timer").
tournament_rules_token("suddendeath").
tournament_rules_token("mortesubita").

strategy_intent_token("estrategia").
strategy_intent_token("estrategico").
strategy_intent_token("estrategica").
strategy_intent_token("plano").
strategy_intent_token("macro").
strategy_intent_token("conselho").
strategy_intent_token("aconselhar").
strategy_intent_token("guia").
strategy_intent_token("gameplan").
strategy_intent_token("macrogame").
strategy_intent_token("planodejogo").
strategy_intent_token("pilotagem").

synergy_intent_token("sinergia").
synergy_intent_token("compativel").
synergy_intent_token("compativeis").
synergy_intent_token("compatibilidade").
synergy_intent_token("parceiro").
synergy_intent_token("parceiros").
synergy_intent_token("combina").
synergy_intent_token("combinar").
synergy_intent_token("combo").
synergy_intent_token("core").
synergy_intent_token("encaixa").
synergy_intent_token("encaixam").

doubles_format_token("doubles").
doubles_format_token("dupla").
doubles_format_token("duplas").
doubles_format_token("2x2").
doubles_format_token("vgc").
doubles_format_token("double").
doubles_format_token("2v2").

speed_control_token("velocidade").
speed_control_token("speed").
speed_control_token("rapidez").
speed_control_token("tailwind").
speed_control_token("icy_wind").
speed_control_token("thunder_wave").
speed_control_token("prioridade").
speed_control_token("priority").
speed_control_token("scarf").
speed_control_token("speedcontrol").

trick_room_token("trick_room").
trick_room_token("trick").
trick_room_token("room").
trick_room_token("inversao").
trick_room_token("inverter").
trick_room_token("lento").
trick_room_token("lentos").
trick_room_token("tr").

weather_plan_token("clima").
weather_plan_token("climas").
weather_plan_token("weather").
weather_plan_token("sol").
weather_plan_token("chuva").
weather_plan_token("areia").
weather_plan_token("neve").
weather_plan_token("sun").
weather_plan_token("rain").
weather_plan_token("sand").
weather_plan_token("snow").
weather_plan_token("climatico").
weather_plan_token("climatica").

bo3_adaptation_token("adaptacao").
bo3_adaptation_token("adaptar").
bo3_adaptation_token("ajuste").
bo3_adaptation_token("ajustar").
bo3_adaptation_token("game1").
bo3_adaptation_token("game2").
bo3_adaptation_token("game3").
bo3_adaptation_token("serie").
bo3_adaptation_token("bo5").

positioning_token("lead").
positioning_token("leads").
positioning_token("abertura").
positioning_token("posicionamento").
positioning_token("pivot").
positioning_token("pivotar").
positioning_token("protect").
positioning_token("detect").
positioning_token("follow_me").
positioning_token("rage_powder").
positioning_token("foco").
positioning_token("alvo").
positioning_token("troca").
positioning_token("switch").
positioning_token("reposicionamento").
positioning_token("reposition").
positioning_token("reposiciona").

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
