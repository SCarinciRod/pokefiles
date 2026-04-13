:- encoding(utf8).
:- ensure_loaded('../pokedex_bot.pl').

:- dynamic confusion_count/3.
:- dynamic mismatch_case/4.

main :-
    load_database,
    set_default_generation,
    retractall(confusion_count(_, _, _)),
    retractall(mismatch_case(_, _, _, _)),
    findall(Expected-Text, sample_prompt(Expected, Text), Cases),
    length(Cases, Total),
    forall(member(Expected-Text, Cases), evaluate_case(Expected, Text)),
    findall(1, confusion_count(Class, Class, Count), _),
    findall(Count, confusion_count(Class, Class, Count), CorrectCounts),
    sum_list(CorrectCounts, Correct),
    Accuracy is (Correct * 100.0) / max(1, Total),
    format('intent_confusion_total_cases=~w~n', [Total]),
    format('intent_confusion_correct=~w~n', [Correct]),
    format('intent_confusion_accuracy_pct=~2f~n', [Accuracy]),
    writeln(''),
    writeln('intent_confusion_matrix_entries:'),
    forall(confusion_count(Expected, Predicted, Count),
        format('  expected=~w predicted=~w count=~w~n', [Expected, Predicted, Count])
    ),
    writeln(''),
    writeln('intent_confusion_mismatches:'),
    ( mismatch_case(_, _, _, _) ->
        forall(mismatch_case(Expected, Predicted, Text, Goal),
            format('  expected=~w predicted=~w text="~w" goal=~w~n', [Expected, Predicted, Text, Goal])
        )
    ; writeln('  none')
    ),
    halt.

evaluate_case(Expected, Text) :-
    tokenize_for_match(Text, Tokens),
    ( resolve_intent(guarded, Text, Tokens, Goal) ->
        goal_class(Goal, Predicted),
        increment_confusion(Expected, Predicted),
        ( Expected == Predicted ->
            true
        ; assertz(mismatch_case(Expected, Predicted, Text, Goal))
        )
    ; increment_confusion(Expected, unresolved),
      assertz(mismatch_case(Expected, unresolved, Text, no_goal))
    ).

increment_confusion(Expected, Predicted) :-
    retract(confusion_count(Expected, Predicted, Count)),
    !,
    NewCount is Count + 1,
    assertz(confusion_count(Expected, Predicted, NewCount)).
increment_confusion(Expected, Predicted) :-
    assertz(confusion_count(Expected, Predicted, 1)).

goal_class(answer_tournament_rules_query(_), rules).
goal_class(answer_doubles_strategy_query(_), strategy).
goal_class(answer_pair_synergy_query(_, _), strategy).
goal_class(answer_compatible_partners_query(_, _), strategy).
goal_class(answer_held_item_recommendation_query(_, _), held_item_recommendation).
goal_class(answer_specific_item_query(_), specific_item_detail).
goal_class(answer_specific_move_query(_), specific_move_detail).
goal_class(answer_pokemon_movelist_query(_), pokemon_movelist).
goal_class(answer_global_move_list_query, global_movelist).
goal_class(answer_pokemon_ability_details_query(_), ability_details).
goal_class(answer_ability_query(_), ability_catalog).
goal_class(_, other).

sample_prompt(rules, "regras vgc de tempo de movimento").
sample_prompt(rules, "manual vgc sobre bo3 e topcut").
sample_prompt(rules, "penalidades no torneio vgc").
sample_prompt(rules, "como funciona team list no vgc").
sample_prompt(rules, "o que e morte subita no vgc").
sample_prompt(rules, "juiz pode desclassificar no vgc").

sample_prompt(strategy, "qual estrategia de speed control no vgc doubles").
sample_prompt(strategy, "como lidar com trick room em dupla").
sample_prompt(strategy, "sinergia entre tyranitar e garchomp").
sample_prompt(strategy, "parceiros para tyranitar").
sample_prompt(strategy, "plano de jogo para doubles com chuva").
sample_prompt(strategy, "ajuste de bo3 no vgc doubles").

sample_prompt(held_item_recommendation, "melhor item para hawlucha").
sample_prompt(held_item_recommendation, "quais itens para cobrir fraqueza do dragonite").
sample_prompt(held_item_recommendation, "melhor black sludge para toxapex").
sample_prompt(held_item_recommendation, "qual held item combina com pelipper").
sample_prompt(held_item_recommendation, "item para ferrothorn segurar melhor").
sample_prompt(held_item_recommendation, "quero item para fortalecer o charizard").

sample_prompt(specific_item_detail, "o que faz black sludge").
sample_prompt(specific_item_detail, "efeito de focus sash").
sample_prompt(specific_item_detail, "como funciona choice scarf").
sample_prompt(specific_item_detail, "detalhes do assault vest").
sample_prompt(specific_item_detail, "descricao de leftovers").
sample_prompt(specific_item_detail, "info sobre air balloon").

sample_prompt(specific_move_detail, "qual o efeito de thunder wave").
sample_prompt(specific_move_detail, "o que faz trick room").
sample_prompt(specific_move_detail, "poder e precisao de hydro pump").
sample_prompt(specific_move_detail, "detalhes do move u turn").
sample_prompt(specific_move_detail, "como funciona protect").
sample_prompt(specific_move_detail, "informacoes de stealth rock").

sample_prompt(pokemon_movelist, "moves do charizard").
sample_prompt(pokemon_movelist, "golpes do garchomp").
sample_prompt(pokemon_movelist, "movelist do pelipper").
sample_prompt(pokemon_movelist, "moveset do tyranitar").
sample_prompt(pokemon_movelist, "quais moves do ferrothorn").
sample_prompt(pokemon_movelist, "lista de golpes do toxapex").

sample_prompt(global_movelist, "lista de moves").
sample_prompt(global_movelist, "listar todos os golpes do jogo").
sample_prompt(global_movelist, "moves presentes no jogo").
sample_prompt(global_movelist, "lista geral de golpes").
sample_prompt(global_movelist, "mostrar lista de moves").
sample_prompt(global_movelist, "quais sao os moves catalogados").

sample_prompt(ability_details, "o que faz a passiva do tyranitar").
sample_prompt(ability_details, "clear body do metagross faz o que").
sample_prompt(ability_details, "efeito da habilidade do ferrothorn").
sample_prompt(ability_details, "como funciona drizzle do pelipper").
sample_prompt(ability_details, "o que faz iron barbs do ferrothorn").
sample_prompt(ability_details, "habilidades do toxapex e o que fazem").

sample_prompt(ability_catalog, "ability intimidate").
sample_prompt(ability_catalog, "habilidade levitate").
sample_prompt(ability_catalog, "efeito da ability clear body").
sample_prompt(ability_catalog, "o que faz unburden").
sample_prompt(ability_catalog, "info sobre rough skin").
sample_prompt(ability_catalog, "detalhes da habilidade drought").

:- initialization(main, main).
