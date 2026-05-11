:- encoding(utf8).
:- ensure_loaded('pokedex_bot.pl').

main :-
    with_project_root(
      ( load_database_from_root,
        set_active_generation(all),
        findall(T, pokemon_in_scope(T,_,_,_,_,_,_), Targets),
        length(Targets, NT),
        format('DIAG: pokemon_in_scope count=~w~n', [NT]),
        ( Targets = [First|_] ->
            ( pokemon_info(First, pokemon(_, Name, _, _, Types, _, _)),
              format('DIAG: first target=~w (~w) types=~w~n', [First, Name, Types]),
              findall(C, ( pokemon_in_scope(C,_,_,_,CTypes,_,_), C =\= First, counter_has_super_effective_coverage(C, CTypes, First, Types) ), Candidates),
              length(Candidates, NC),
              format('DIAG: candidate count for first target=~w~n', [NC])
            )
        ; true
        )
      )
    ),
    halt.
