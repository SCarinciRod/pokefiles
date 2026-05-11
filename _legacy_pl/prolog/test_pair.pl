:- encoding(utf8).
:- ensure_loaded('pokedex_bot.pl').

main :-
    with_project_root(
      ( load_database_from_root,
        set_active_generation(all),
        findall(T, pokemon_in_scope(T,_,_,_,_,_,_), Targets),
        length(Targets, NTargets),
        format('TEST: targets=~w~n', [NTargets]),
        Targets = [First|_],
        pokemon_info(First, pokemon(_, FirstName, _, _, FirstTypes, _, FirstStats)),
        format('TEST: first target ~w (~w) types=~w~n', [First, FirstName, FirstTypes]),
        findall(C, ( pokemon_in_scope(C,_,_,_,CTypes,_,_), C =\= First, counter_has_super_effective_coverage(C, CTypes, First, FirstTypes) ), Candidates),
        length(Candidates, NCand),
        format('TEST: candidates found for first target=~w~n', [NCand]),
        Candidates = [C1|_],
        pokemon_info(C1, pokemon(_, CName, _, _, CTypes, _, CStats)),
        format('TEST: first candidate ~w (~w) types=~w~n', [C1, CName, CTypes]),
        counter_metrics(C1, CTypes, CStats, First, FirstTypes, FirstStats, AttackMult, DefenseMult, AttackPressure, DefensePressure),
        format('METRICS: attack_mult=~w defense_mult=~w attack_pressure=~2f defense_pressure=~2f~n', [AttackMult, DefenseMult, AttackPressure, DefensePressure]),
        counter_score(C1, CStats, First, FirstStats, AttackPressure, DefensePressure, Score),
        format('SCORE: ~w~n', [Score])
      )
    ),
    halt.
