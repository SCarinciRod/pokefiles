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

:- begin_tests(engine_regression).

test(type_fire_count_positive, [setup(ensure_test_db_ready)]) :-
    once(type_pokemon_count(fire, Count)),
    assertion(Count > 0).

test(type_fire_list_contains_charizard, [setup(ensure_test_db_ready)]) :-
    once(type_pokemon_list([fire], Names)),
    assertion(member(charizard, Names)).

test(ability_blaze_has_known_pokemon, [setup(ensure_test_db_ready)]) :-
    once(ability_pokemon_list(blaze, Names)),
    assertion(member(charmander, Names)),
    assertion(member(charizard, Names)).

test(move_catalog_is_loaded, [setup(ensure_test_db_ready)]) :-
    once(move_catalog(Moves)),
    length(Moves, Count),
    assertion(Count > 500).

test(generation_switch_changes_scope, [setup(ensure_test_db_ready)]) :-
    once(set_active_generation(1)),
    once(type_pokemon_count(fire, Gen1Count)),
    once(set_active_generation(all)),
    once(type_pokemon_count(fire, AllCount)),
    once(set_default_generation),
    assertion(AllCount >= Gen1Count).

test(cache_reduces_inferences_type_count, [setup(ensure_test_db_ready)]) :-
    set_default_generation,
    statistics(inferences, I0),
    type_pokemon_count(fire, _),
    statistics(inferences, I1),
    type_pokemon_count(fire, _),
    statistics(inferences, I2),
    First is I1 - I0,
    Second is I2 - I1,
    assertion(First > 0),
    assertion(Second < First).

test(cache_reduces_inferences_ability_list, [setup(ensure_test_db_ready)]) :-
    set_default_generation,
    statistics(inferences, I0),
    ability_pokemon_list(blaze, _),
    statistics(inferences, I1),
    ability_pokemon_list(blaze, _),
    statistics(inferences, I2),
    First is I1 - I0,
    Second is I2 - I1,
    assertion(First > 0),
    assertion(Second < First).

:- end_tests(engine_regression).
