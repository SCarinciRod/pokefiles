% ============================================================
% ENGINE DE ROTEAMENTO
% Mantem apenas o fluxo de resolucao e delega regras/guards.
% ============================================================

:- ensure_loaded('intents_catalog.pl').
:- ensure_loaded('intents_guards.pl').

:- dynamic debug_intent_trace/1.

resolve_intent(Mode, Text, Tokens, Goal) :-
    resolve_intent_rule(Text, Tokens, Goal, Mode),
    ( debug_intent_trace(true) ->
        collect_candidate_traces(Text, Tokens, CandidatesTrace),
        format('DEBUG_RESOLVE_INTENT_GOAL: ~w~n', [Goal]),
        format('DEBUG_CANDIDATE_TRACES: ~w~n', [CandidatesTrace])
    ; true
    ),
    !.

allow_guard(guarded, GuardPred, Tokens) :-
    call(GuardPred, Tokens).
allow_guard(unguarded, _GuardPred, _Tokens).

collect_candidate_traces(Text, Tokens, RevSorted) :-
    findall(Score-item_move_ability-Goal,
        item_move_ability_candidate_goal(Text, Tokens, Score, Goal),
        IMACands),
    findall(Score-strategy_rules-Goal,
        strategy_rules_candidate_goal(Text, Tokens, Score, Goal),
        StrCands),
    append(IMACands, StrCands, All),
    ( All = [] ->
        RevSorted = []
    ;
        keysort(All, Sorted),
        reverse(Sorted, RevSorted)
    ).
