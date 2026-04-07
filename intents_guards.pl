% ============================================================
% GUARDS E SINAIS DE DOMINIO
% Contem fallback gate e predicados de sinalizacao de intent.
% ============================================================

should_run_intent_fallback(Tokens) :-
    token_member_pred(Tokens, fallback_signal_token),
    !.
should_run_intent_fallback(Tokens) :-
    member(Token, Tokens),
    string_number(Token, Number),
    integer(Number),
    !.

token_member_pred(Tokens, PredicateName) :-
    member(Token, Tokens),
    Goal =.. [PredicateName, Token],
    call(Goal),
    !.

token_member_any(Tokens, Candidates) :-
    member(Token, Tokens),
    member(Token, Candidates),
    !.

fallback_signal_token(Token) :- pokemon_noun_token(Token).
fallback_signal_token(Token) :- counter_intent_token(Token).
fallback_signal_token(Token) :- battle_intent_token(Token).
fallback_signal_token(Token) :- compare_intent_token(Token).
fallback_signal_token(Token) :- generation_keyword_token(Token).
fallback_signal_token(Token) :- level_word_token(Token).
fallback_signal_token(Token) :- level_upper_bound_token(Token).
fallback_signal_token(Token) :- level_lower_bound_token(Token).
fallback_signal_token(Token) :- quantity_intent_token(Token).
fallback_signal_token(Token) :- list_intent_token(Token).
fallback_signal_token(Token) :- weak_intent_token(Token).
fallback_signal_token(Token) :- immunity_intent_token(Token).
fallback_signal_token(Token) :- move_intent_token(Token).
fallback_signal_token(Token) :- item_intent_token(Token).
fallback_signal_token(Token) :- evolution_intent_token(Token).
fallback_signal_token(Token) :- evolution_chain_token(Token).
fallback_signal_token(Token) :- ranking_signal_token(Token).
fallback_signal_token(Token) :- team_intent_token(Token).
fallback_signal_token(Token) :- legendary_request_token(Token).
fallback_signal_token(Token) :- mega_token(Token).
fallback_signal_token("info").
fallback_signal_token("nome").
fallback_signal_token("numero").
fallback_signal_token("pokedex").
fallback_signal_token("tipo").
fallback_signal_token("tipos").
fallback_signal_token("elemento").
fallback_signal_token("elementos").
fallback_signal_token("ability").
fallback_signal_token("abilities").
fallback_signal_token("habilidade").
fallback_signal_token("habilidades").
fallback_signal_token("item").
fallback_signal_token("itens").
fallback_signal_token("held").
fallback_signal_token("status").
fallback_signal_token("stat").
fallback_signal_token("stats").
fallback_signal_token("switch").
fallback_signal_token("entra").
fallback_signal_token("segura").
fallback_signal_token("contra").
fallback_signal_token("check").
fallback_signal_token("chain").
fallback_signal_token("versus").
fallback_signal_token("vs").
fallback_signal_token("entre").
fallback_signal_token("equipe").
fallback_signal_token("legendary").

modifier_domain_signal(Tokens) :-
    level_word_tokens(Tokens),
    !.
modifier_domain_signal(Tokens) :-
    token_member_pred(Tokens, level_upper_bound_token),
    !.
modifier_domain_signal(Tokens) :-
    token_member_pred(Tokens, level_lower_bound_token),
    !.
modifier_domain_signal(Tokens) :-
    token_member_pred(Tokens, generation_keyword_token),
    !.
modifier_domain_signal(Tokens) :-
    token_member_any(Tokens, ["tipo", "tipos", "elemento", "elementos"]),
    !.
modifier_domain_signal(Tokens) :-
    has_token_with_prefix(Tokens, "lv"),
    !.
modifier_domain_signal(Tokens) :-
    has_token_with_prefix(Tokens, "nivel"),
    !.
modifier_domain_signal(Tokens) :-
    has_token_with_prefix(Tokens, "gen"),
    !.
modifier_domain_signal(Tokens) :-
    has_token_with_prefix(Tokens, "ger"),
    !.

level_domain_signal(Tokens) :-
    level_word_tokens(Tokens),
    !.
level_domain_signal(Tokens) :-
    token_member_pred(Tokens, level_upper_bound_token),
    !.
level_domain_signal(Tokens) :-
    token_member_pred(Tokens, level_lower_bound_token),
    !.
level_domain_signal(Tokens) :-
    has_token_with_prefix(Tokens, "lv"),
    !.
level_domain_signal(Tokens) :-
    has_token_with_prefix(Tokens, "nivel"),
    !.

counter_domain_signal(Tokens) :-
    counter_intent_tokens(Tokens),
    !.
counter_domain_signal(Tokens) :-
    token_member_any(Tokens, ["contra", "check", "counter", "counters", "bate"]),
    !.

generation_domain_signal(Tokens) :-
    token_member_pred(Tokens, generation_keyword_token),
    !.
generation_domain_signal(Tokens) :-
    has_token_with_prefix(Tokens, "gen"),
    !.
generation_domain_signal(Tokens) :-
    has_token_with_prefix(Tokens, "ger"),
    !.

ranking_domain_signal(Tokens) :-
    has_ranking_signal(Tokens),
    !.
ranking_domain_signal(Tokens) :-
    ranked_metric_from_tokens(Tokens, _),
    !.

type_domain_signal(Tokens) :-
    token_member_pred(Tokens, weak_intent_token),
    !.
type_domain_signal(Tokens) :-
    token_member_pred(Tokens, immunity_intent_token),
    !.
type_domain_signal(Tokens) :-
    token_member_any(Tokens, ["tipo", "tipos", "elemento", "elementos", "entra", "segura", "switch"]),
    !.

move_or_ability_domain_signal(Tokens) :-
    token_member_pred(Tokens, move_intent_token),
    !.
move_or_ability_domain_signal(Tokens) :-
    token_member_any(Tokens, ["habilidade", "habilidades", "ability", "abilities"]),
    !.

item_domain_signal(Tokens) :-
    token_member_pred(Tokens, item_intent_token),
    !.
item_domain_signal(Tokens) :-
    token_member_any(Tokens, ["item", "itens", "held", "focus", "sash", "orb", "boots", "choice", "vest"]),
    !.

status_domain_signal(Tokens) :-
    token_member_any(Tokens, ["status", "stat", "stats", "atributo", "atributos"]),
    !.

evolution_domain_signal(Tokens) :-
    token_member_pred(Tokens, evolution_intent_token),
    !.
evolution_domain_signal(Tokens) :-
    token_member_pred(Tokens, evolution_chain_token),
    !.
evolution_domain_signal(Tokens) :-
    token_member_pred(Tokens, evolution_structure_token),
    !.
evolution_domain_signal(Tokens) :-
    token_member_any(Tokens, ["evolution", "chain"]),
    !.

compare_or_battle_domain_signal(Tokens) :-
    battle_intent_tokens(Tokens),
    !.
compare_or_battle_domain_signal(Tokens) :-
    token_member_pred(Tokens, compare_intent_token),
    !.
compare_or_battle_domain_signal(Tokens) :-
    token_member_pred(Tokens, team_intent_token),
    !.
compare_or_battle_domain_signal(Tokens) :-
    token_member_any(Tokens, ["versus", "vs", "entre", "contra", "equipe"]),
    !.
