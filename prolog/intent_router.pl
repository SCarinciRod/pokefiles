% ============================================================
% ENGINE DE ROTEAMENTO
% Mantem apenas o fluxo de resolucao e delega regras/guards.
% ============================================================

:- ensure_loaded('intents_catalog.pl').
:- ensure_loaded('intents_guards.pl').

resolve_intent(Mode, Text, Tokens, Goal) :-
    resolve_intent_rule(Text, Tokens, Goal, Mode),
    !.

allow_guard(guarded, GuardPred, Tokens) :-
    call(GuardPred, Tokens).
allow_guard(unguarded, _GuardPred, _Tokens).
