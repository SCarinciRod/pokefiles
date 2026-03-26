:- encoding(utf8).
:- use_module(library(plunit)).
:- ensure_loaded('../pokedex_bot.pl').

:- dynamic test_db_ready/0.

ensure_test_db_ready :-
    ( test_db_ready ->
        true
    ; load_database,
      set_default_generation,
      assertz(test_db_ready)
    ).

:- begin_tests(nlp_token_heuristics).

test(token_typos_are_normalized, [setup(ensure_test_db_ready)]) :-
    once(tokenize_for_match("qunatos pokemom do tipo fogo", Tokens)),
    memberchk("quantos", Tokens),
    memberchk("pokemon", Tokens).

test(parse_info_name_with_typo_keyword, [setup(ensure_test_db_ready)]) :-
    once(parse_info_by_name("pokemom nome pikachu", Name)),
    assertion(Name == pikachu).

test(parse_counter_query_with_typo_verb, [setup(ensure_test_db_ready)]) :-
    once(parse_counter_query("quem vense contra charizard", Name)),
    assertion(Name == charizard).

test(parse_level2_with_typo_tokens, [setup(ensure_test_db_ready)]) :-
    once(parse_level2_only_composed_query(
        "qunatos pokemom do tipo fogo ate nivle 40",
        Mode,
        modifiers(Generation, MaxLevel, TypeFilters, _)
    )),
    assertion(Mode == count),
    assertion(Generation == none),
    assertion(MaxLevel == 40),
    assertion(member(fire, TypeFilters)).

test(parse_count_without_type_with_short_quantity_token, [setup(ensure_test_db_ready)]) :-
    once(parse_count_without_type_query("qntos pokemons sem tipo agua", TypeFilters)),
    assertion(member(water, TypeFilters)).

test(parse_natural_type_query_with_list_synonym, [setup(ensure_test_db_ready)]) :-
    once(parse_natural_type_query("exiba pokemons tipo fogo", TypeFilters)),
    assertion(member(fire, TypeFilters)).

test(parse_weak_query_with_short_token, [setup(ensure_test_db_ready)]) :-
    once(parse_weak_against_type_query("quais sao vuln contra agua", TypeFilters)),
    assertion(member(water, TypeFilters)).

test(parse_compare_query_comparativo_entre, [setup(ensure_test_db_ready)]) :-
    once(parse_compare_query("comparativo entre pikachu e raichu", NameA, NameB)),
    assertion(NameA == pikachu),
    assertion(NameB == raichu).

test(infer_identifier_small_typo_pikachu, [setup(ensure_test_db_ready)]) :-
    once(infer_identifier("pikchu", Resolved, Status)),
    assertion(Resolved == pikachu),
    assertion(Status \= exact).

test(infer_identifier_small_typo_charizard, [setup(ensure_test_db_ready)]) :-
    once(infer_identifier("charzard", Resolved, Status)),
    assertion(Resolved == charizard),
    assertion(Status \= exact).

:- end_tests(nlp_token_heuristics).
