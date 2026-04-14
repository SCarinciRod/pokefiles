:- encoding(utf8).

handle_pending_counter_preferences(Text) :-
    pending_counter_preferences(TargetName),
    !,
    tokenize_for_match(Text, Tokens),
    ( has_cancel_token(Tokens) ->
        retractall(pending_counter_preferences(_)),
        say_response(pending_counter_cancel)
    ; counter_preferences_from_text(Text, TypeFilters, ContextFilters) ->
        retractall(pending_counter_preferences(_)),
        answer_counter_with_all_filters(TargetName, TypeFilters, ContextFilters)
    ; counter_preferences_default_text(Tokens) ->
        retractall(pending_counter_preferences(_)),
        answer_counter_query(TargetName)
    ; say_response(pending_counter_help)
    ).

handle_pending_counter_preferences(Text) :-
    pending_counter_level_preferences(TargetName, MaxLevel),
    !,
    tokenize_for_match(Text, Tokens),
    ( has_cancel_token(Tokens) ->
        retractall(pending_counter_level_preferences(_, _)),
        say_response(pending_counter_level_cancel)
    ; counter_preferences_from_text(Text, TypeFilters, ContextFilters) ->
        retractall(pending_counter_level_preferences(_, _)),
        answer_counter_level_cap_query_with_filters(TargetName, MaxLevel, TypeFilters, ContextFilters)
    ; counter_preferences_default_text(Tokens) ->
        retractall(pending_counter_level_preferences(_, _)),
        answer_counter_level_cap_query(TargetName, MaxLevel)
    ; say_response(pending_counter_help)
    ).

parse_counter_level_cap_query(Text, TargetName, LevelConstraint) :-
    tokenize_for_match(Text, Tokens),
    counter_intent_tokens(Tokens),
    extract_modifier_level_constraint(Tokens, LevelConstraint),
    ( extract_target_name_after_relation(Text, TargetName)
    ; parse_counter_query(Text, TargetName)
    ).

parse_counter_composed_query(Text, TargetName, Generation, TypeFilters, ContextFilters, LevelConstraint) :-
    tokenize_for_match(Text, Tokens),
    counter_intent_tokens(Tokens),
    ( extract_target_name_after_relation(Text, TargetName)
    ; parse_counter_query(Text, TargetName)
    ),
    parse_generation_from_tokens(Tokens, Generation),
    extract_modifier_level_constraint(Tokens, LevelConstraint),
    ( extract_type_filters(Tokens, TypeFilters) ; TypeFilters = [] ),
    extract_context_filters(Tokens, ContextFilters).

parse_counter_query(Text, TargetName) :-
    tokenize_for_match(Text, Tokens),
    \+ parse_battle_pair_from_tokens(Tokens, _, _),
    append(_, ["contra" | Tail], Tokens),
    ( find_best_pokemon_mention_in_tokens(Tail, TargetName)
    ; extract_name_from_tokens(Tail, TargetName)
    ).
parse_counter_query(Text, TargetName) :-
    tokenize_for_match(Text, Tokens),
    counter_intent_tokens(Tokens),
    ( member(RelToken, Tokens),
      counter_relation_token(RelToken),
      append(_, [RelToken | Tail], Tokens)
    ),
    find_best_pokemon_mention_in_tokens(Tail, TargetName).
parse_counter_query(Text, TargetName) :-
    tokenize_for_match(Text, Tokens),
    \+ parse_battle_pair_from_tokens(Tokens, _, _),
    counter_intent_tokens(Tokens),
    parse_natural_pokemon_query(Text, TargetName).

parse_counter_compound_query(Text, TargetName, TypeFilters, ContextFilters) :-
    tokenize_for_match(Text, Tokens),
    \+ parse_battle_pair_from_tokens(Tokens, _, _),
    counter_intent_tokens(Tokens),
    parse_counter_query(Text, TargetName),
    ( extract_type_filters(Tokens, TypeFilters) ; TypeFilters = [] ),
    extract_context_filters(Tokens, ContextFilters),
    ( TypeFilters \= [] ; ContextFilters \= [] ).

counter_intent_tokens(Tokens) :-
    ( member(Token, Tokens), counter_intent_token(Token)
    ; counter_intent_phrase(Phrase), contiguous_sublist(Phrase, Tokens)
    ),
    !.

parse_counter_with_filters_query(Text, TargetName, ContextFilters) :-
    tokenize_for_match(Text, Tokens),
    counter_intent_tokens(Tokens),
    ( member("contra", Tokens)
    ; ( member(RelToken, Tokens), counter_relation_token(RelToken) )
    ),
    findall(Filter,
        ( context_filter_token(Filter, FilterTokens),
          contiguous_sublist(FilterTokens, Tokens)
        ),
        RawFilters),
    sort(RawFilters, ContextFilters),
    ContextFilters \= [],
    parse_counter_query(Text, TargetName).

parse_filtered_counter_query(Text, TypeFilters, TargetName) :-
    tokenize_for_match(Text, Tokens),
    member("contra", Tokens),
    extract_type_filters(Tokens, TypeFilters),
    TypeFilters \= [],
    append(_, ["contra" | Tail], Tokens),
    extract_name_from_tokens(Tail, TargetName).

answer_counter_with_level2_modifiers(TargetIdentifier, Generation, LevelConstraint, TypeFilters, ContextFilters) :-
    Generation \= none,
    LevelConstraint \= none,
    !,
    answer_counter_composed_query(TargetIdentifier, Generation, TypeFilters, ContextFilters, LevelConstraint).
answer_counter_with_level2_modifiers(TargetIdentifier, none, LevelConstraint, TypeFilters, ContextFilters) :-
    LevelConstraint \= none,
    !,
    answer_counter_level_cap_query_with_filters(TargetIdentifier, LevelConstraint, TypeFilters, ContextFilters).
answer_counter_with_level2_modifiers(TargetIdentifier, Generation, none, TypeFilters, ContextFilters) :-
    Generation \= none,
    !,
    answer_counter_generation_query(TargetIdentifier, Generation, TypeFilters, ContextFilters).
answer_counter_with_level2_modifiers(TargetIdentifier, none, none, TypeFilters, ContextFilters) :-
    answer_counter_with_all_filters(TargetIdentifier, TypeFilters, ContextFilters).

answer_counter_generation_query(TargetIdentifier, Generation, TypeFilters, ContextFilters) :-
    resolve_counter_target(TargetIdentifier, pokemon(TargetID, TargetName, _, _, TargetTypes, _, TargetStats), UsedFallback),
    findall(Score-Name-AttackMult-DefenseMult,
        ( pokemon(CandidateID, Name, _Height, _Weight, CandidateTypes, _Abilities, CandidateStats),
          generation_matches_id(Generation, CandidateID),
          CandidateID =\= TargetID,
          pokemon_matches_optional_type_filters(TypeFilters, CandidateTypes),
          name_passes_filters(ContextFilters, Name),
                    counter_has_super_effective_coverage(CandidateID, CandidateTypes, TargetID, TargetTypes),
          counter_metrics(CandidateID, CandidateTypes, CandidateStats, TargetID, TargetTypes, TargetStats, AttackMult, DefenseMult, AttackPressure, DefensePressure),
          AttackMult > 1.0,
          counter_score(CandidateID, CandidateStats, TargetID, TargetStats, AttackPressure, DefensePressure, Score)
        ),
        PairsRaw),
    counter_rank_limit_pairs(PairsRaw, TopPairs),
    TopPairs \= [],
    !,
    display_pokemon_name(TargetName, TargetLabel),
    counter_pairs_text(TargetID, TopPairs, CounterText),
    ( UsedFallback == true ->
        writeln('Bot: Ainda não tenho a ficha da forma especial alvo, então usei a forma base para análise.')
    ; true
    ),
    format('Bot: Contra ~w, na geração ~w, boas opções são:~n~w~n', [TargetLabel, Generation, CounterText]).
answer_counter_generation_query(TargetIdentifier, Generation, TypeFilters, _ContextFilters) :-
    display_pokemon_name(TargetIdentifier, TargetLabel),
    type_filters_text_if_any(TypeFilters, TypeText),
    format('Bot: Não encontrei counters para ~w na geração ~w~w.~n', [TargetLabel, Generation, TypeText]).

answer_counter_query(TargetIdentifier) :-
    resolve_counter_target(TargetIdentifier, pokemon(TargetID, TargetName, _, _, TargetTypes, _, TargetStats), UsedFallback),
    recommend_counters(TargetID, TargetTypes, TargetStats, CounterPairs),
    CounterPairs \= [],
    !,
    display_pokemon_name(TargetName, TargetLabel),
    counter_pairs_text(TargetID, CounterPairs, CounterText),
    ( UsedFallback == true ->
        writeln('Bot: Ainda não tenho a ficha da forma Mega, então usei a forma base para sugerir counters.')
    ; true
    ),
    extract_counter_names(CounterPairs, CounterNames),
    remember_candidate_list(CounterNames),
    format('Bot: Contra ~w, uma boa estratégia é usar:~n~w~n', [TargetLabel, CounterText]),
    writeln('Bot: Se quiser, eu também posso sugerir opções mais ofensivas ou mais defensivas.').
answer_counter_query(TargetIdentifier) :-
    resolve_counter_target(TargetIdentifier, pokemon(_, TargetName, _, _, _, _, _), _),
    !,
    display_pokemon_name(TargetName, TargetLabel),
    format('Bot: Não encontrei counters fortes o suficiente para ~w com o filtro atual de geração.~n', [TargetLabel]).
answer_counter_query(TargetIdentifier) :-
    writeln('Bot: Não consegui identificar o Pokémon alvo. Exemplo: "qual é um bom pokemon contra charizard mega x".'),
    print_suggestion_for_identifier(counter, TargetIdentifier).

answer_counter_query_with_clarification(TargetIdentifier) :-
    retractall(pending_counter_preferences(_)),
    assertz(pending_counter_preferences(TargetIdentifier)),
    display_pokemon_name(TargetIdentifier, TargetLabel),
    format('Bot: Antes de sugerir counters para ~w, quer aplicar algum filtro?~n', [TargetLabel]),
    writeln('Bot: Você pode responder: "padrão", "sem lendários", "sem mega", "tipo gelo" ou combinar filtros.').

counter_preferences_from_text(Text, TypeFilters, ContextFilters) :-
    tokenize_for_match(Text, Tokens),
    findall(Filter,
        ( context_filter_token(Filter, FilterTokens),
          contiguous_sublist(FilterTokens, Tokens)
        ),
        ContextRaw),
    sort(ContextRaw, ContextFilters),
    ( extract_type_filters(Tokens, TypeFilters)
    ; TypeFilters = []
    ),
    ( ContextFilters \= [] ; TypeFilters \= [] ).

answer_counter_with_all_filters(TargetIdentifier, TypeFilters, ContextFilters) :-
    resolve_counter_target(TargetIdentifier, pokemon(TargetID, TargetName, _, _, TargetTypes, _, TargetStats), UsedFallback),
    ( TypeFilters == [] ->
        recommend_counters(TargetID, TargetTypes, TargetStats, BasePairs)
    ; type_pokemon_list(TypeFilters, CandidateNames),
      recommend_counters_from_candidates(CandidateNames, TargetID, TargetTypes, TargetStats, BasePairs)
    ),
    BasePairs \= [],
    include(counter_pair_passes_filters(ContextFilters), BasePairs, FilteredPairs),
    FilteredPairs \= [],
    !,
    display_pokemon_name(TargetName, TargetLabel),
    counter_pairs_text(TargetID, FilteredPairs, CounterText),
    ( UsedFallback == true ->
        writeln('Bot: Ainda não tenho a ficha da forma especial alvo, então usei a forma base para análise.')
    ; true
    ),
    extract_counter_names(FilteredPairs, CounterNames),
    remember_candidate_list(CounterNames),
    format('Bot: Contra ~w, considerando seus filtros, boas opções são:~n~w~n', [TargetLabel, CounterText]).
answer_counter_with_all_filters(TargetIdentifier, _, _) :-
    answer_counter_query(TargetIdentifier).

answer_counter_with_filters_query(TargetIdentifier, Filters) :-
    resolve_counter_target(TargetIdentifier, pokemon(TargetID, TargetName, _, _, TargetTypes, _, TargetStats), UsedFallback),
    recommend_counters(TargetID, TargetTypes, TargetStats, CounterPairs),
    CounterPairs \= [],
    include(counter_pair_passes_filters(Filters), CounterPairs, FilteredPairs),
    FilteredPairs \= [],
    !,
    display_pokemon_name(TargetName, TargetLabel),
    counter_pairs_text(TargetID, FilteredPairs, CounterText),
    ( UsedFallback == true ->
        writeln('Bot: Ainda não tenho a ficha da forma especial alvo, então usei a forma base para análise.')
    ; true
    ),
    extract_counter_names(FilteredPairs, CounterNames),
    remember_candidate_list(CounterNames),
    format('Bot: Contra ~w, considerando seus filtros, boas opções são:~n~w~n', [TargetLabel, CounterText]).
answer_counter_with_filters_query(TargetIdentifier, _) :-
    answer_counter_query(TargetIdentifier).

answer_counter_level_cap_query(TargetIdentifier, LevelConstraint) :-
    resolve_counter_target(TargetIdentifier, pokemon(TargetID, TargetName, _, _, TargetTypes, _, TargetStatsRaw), _),
    level_constraint_reference_level(LevelConstraint, RefLevel),
    scale_stats_by_level(TargetStatsRaw, RefLevel, TargetStats),
    findall(Score-Name-AttackMult-DefenseMult,
        ( pokemon_in_scope(CandidateID, Name, _, _, CandidateTypes, _, CandidateStatsRaw),
          pokemon_reachable_by_level(CandidateID, LevelConstraint),
          scale_stats_by_level(CandidateStatsRaw, RefLevel, CandidateStats),
                    counter_has_super_effective_coverage(CandidateID, CandidateTypes, TargetID, TargetTypes),
          counter_metrics(CandidateID, CandidateTypes, CandidateStats, TargetID, TargetTypes, TargetStats, AttackMult, DefenseMult, AttackPressure, DefensePressure),
          AttackMult > 1.0,
          counter_score(CandidateID, CandidateStats, TargetID, TargetStats, AttackPressure, DefensePressure, Score)
        ),
        PairsRaw),
    counter_rank_limit_pairs(PairsRaw, TopPairs),
    TopPairs \= [],
    !,
    display_pokemon_name(TargetName, TargetLabel),
    counter_pairs_text(TargetID, TopPairs, CounterText),
    level_constraint_text(LevelConstraint, ConstraintText),
    format('Bot: Contra ~w, no cenário ~w, bons counters são:~n~w~n', [TargetLabel, ConstraintText, CounterText]).
answer_counter_level_cap_query(TargetIdentifier, LevelConstraint) :-
    display_pokemon_name(TargetIdentifier, TargetLabel),
    level_constraint_text(LevelConstraint, ConstraintText),
    format('Bot: Não encontrei counters válidos para ~w no recorte ~w.~n', [TargetLabel, ConstraintText]).

answer_counter_level_cap_query_with_clarification(TargetIdentifier, LevelConstraint) :-
    retractall(pending_counter_level_preferences(_, _)),
    assertz(pending_counter_level_preferences(TargetIdentifier, LevelConstraint)),
    display_pokemon_name(TargetIdentifier, TargetLabel),
    level_constraint_text(LevelConstraint, ConstraintText),
    format('Bot: Para counterar ~w no recorte ~w, quer aplicar filtros antes?~n', [TargetLabel, ConstraintText]),
    writeln('Bot: Você pode responder: "padrão", "sem lendários", "sem mega", "tipo gelo" ou combinar filtros.').

answer_counter_level_cap_query_with_filters(TargetIdentifier, LevelConstraint, TypeFilters, ContextFilters) :-
    resolve_counter_target(TargetIdentifier, pokemon(TargetID, TargetName, _, _, TargetTypes, _, TargetStatsRaw), _),
    level_constraint_reference_level(LevelConstraint, RefLevel),
    scale_stats_by_level(TargetStatsRaw, RefLevel, TargetStats),
    findall(Score-Name-AttackMult-DefenseMult,
        ( pokemon_in_scope(CandidateID, Name, _, _, CandidateTypes, _, CandidateStatsRaw),
          pokemon_reachable_by_level(CandidateID, LevelConstraint),
          pokemon_matches_optional_type_filters_by_name(TypeFilters, Name),
          scale_stats_by_level(CandidateStatsRaw, RefLevel, CandidateStats),
                    counter_has_super_effective_coverage(CandidateID, CandidateTypes, TargetID, TargetTypes),
          counter_metrics(CandidateID, CandidateTypes, CandidateStats, TargetID, TargetTypes, TargetStats, AttackMult, DefenseMult, AttackPressure, DefensePressure),
          AttackMult > 1.0,
          counter_score(CandidateID, CandidateStats, TargetID, TargetStats, AttackPressure, DefensePressure, Score)
        ),
        PairsRaw),
    counter_rank_pairs(PairsRaw, RankedPairs),
    include(counter_pair_passes_filters(ContextFilters), RankedPairs, FilteredPairs),
    counter_limit_pairs(FilteredPairs, TopPairs),
    TopPairs \= [],
    !,
    display_pokemon_name(TargetName, TargetLabel),
    counter_pairs_text(TargetID, TopPairs, CounterText),
    level_constraint_text(LevelConstraint, ConstraintText),
    format('Bot: Contra ~w, no cenário ~w e considerando seus filtros, boas opções são:~n~w~n', [TargetLabel, ConstraintText, CounterText]).
answer_counter_level_cap_query_with_filters(TargetIdentifier, LevelConstraint, _, _) :-
    answer_counter_level_cap_query(TargetIdentifier, LevelConstraint).

answer_counter_composed_query(TargetIdentifier, Generation, TypeFilters, ContextFilters, LevelConstraint) :-
    resolve_counter_target(TargetIdentifier, pokemon(TargetID, TargetName, _, _, TargetTypes, _, TargetStatsRaw), _),
    level_constraint_reference_level(LevelConstraint, RefLevel),
    scale_stats_by_level(TargetStatsRaw, RefLevel, TargetStats),
    findall(Score-Name-AttackMult-DefenseMult,
        ( pokemon(ID, Name, _Height, _Weight, CandidateTypes, _Abilities, CandidateStatsRaw),
          generation_matches_id(Generation, ID),
          pokemon_reachable_by_level(ID, LevelConstraint),
          pokemon_matches_optional_type_filters(TypeFilters, CandidateTypes),
          name_passes_filters(ContextFilters, Name),
          scale_stats_by_level(CandidateStatsRaw, RefLevel, CandidateStats),
                    counter_has_super_effective_coverage(ID, CandidateTypes, TargetID, TargetTypes),
          counter_metrics(ID, CandidateTypes, CandidateStats, TargetID, TargetTypes, TargetStats, AttackMult, DefenseMult, AttackPressure, DefensePressure),
          AttackMult > 1.0,
          counter_score(ID, CandidateStats, TargetID, TargetStats, AttackPressure, DefensePressure, Score)
        ),
        PairsRaw),
        counter_rank_limit_pairs(PairsRaw, TopPairs),
    TopPairs \= [],
    !,
    extract_counter_names(TopPairs, CounterNames),
    remember_candidate_list(CounterNames),
    display_pokemon_name(TargetName, TargetLabel),
    counter_pairs_text(TargetID, TopPairs, CounterText),
    type_filters_text_if_any(TypeFilters, TypeText),
    level_constraint_text(LevelConstraint, ConstraintText),
    format('Bot: Contra ~w, na geração ~w, ~w~w, os melhores counters são:~n~w~n', [TargetLabel, Generation, ConstraintText, TypeText, CounterText]).
answer_counter_composed_query(TargetIdentifier, Generation, TypeFilters, _ContextFilters, LevelConstraint) :-
    display_pokemon_name(TargetIdentifier, TargetLabel),
    type_filters_text_if_any(TypeFilters, TypeText),
    level_constraint_text(LevelConstraint, ConstraintText),
    format('Bot: Não encontrei counters para ~w na geração ~w com recorte ~w~w.~n', [TargetLabel, Generation, ConstraintText, TypeText]).

type_filters_text_if_any([], '').
type_filters_text_if_any(TypeFilters, Text) :-
    TypeFilters \= [],
    type_filters_text(TypeFilters, FiltersText),
    format(atom(Text), ' com tipo ~w', [FiltersText]).

answer_filtered_counter_query(TypeFilters, TargetIdentifier) :-
    resolve_counter_target(TargetIdentifier, pokemon(TargetID, TargetName, _, _, TargetTypes, _, TargetStats), UsedFallback),
    type_pokemon_list(TypeFilters, CandidateNames),
    CandidateNames \= [],
    recommend_counters_from_candidates(CandidateNames, TargetID, TargetTypes, TargetStats, TopPairs),
    TopPairs \= [],
    !,
    display_pokemon_name(TargetName, TargetLabel),
    type_filters_text(TypeFilters, FiltersText),
    counter_pairs_text(TargetID, TopPairs, CounterText),
    ( UsedFallback == true ->
        writeln('Bot: Ainda não tenho a ficha da forma especial alvo, então usei a forma base para análise.')
    ; true
    ),
    extract_counter_names(TopPairs, CounterNames),
    remember_candidate_list(CounterNames),
    format('Bot: Entre os Pokémon do tipo ~w, os com mais chances contra ~w são:~n~w~n', [FiltersText, TargetLabel, CounterText]).
answer_filtered_counter_query(TypeFilters, TargetIdentifier) :-
    resolve_counter_target(TargetIdentifier, pokemon(_, TargetName, _, _, _, _, _), _),
    !,
    type_filters_text(TypeFilters, FiltersText),
    display_pokemon_name(TargetName, TargetLabel),
    format('Bot: Não encontrei candidatos no grupo ~w com dados suficientes para comparar contra ~w.~n', [FiltersText, TargetLabel]).
answer_filtered_counter_query(TypeFilters, TargetIdentifier) :-
    writeln('Bot: Não consegui identificar o Pokémon alvo da comparação.'),
    print_suggestion_for_identifier(filtered_counter(TypeFilters), TargetIdentifier).

extract_counter_names(CounterPairs, Names) :-
    findall(Name,
        member(_Score-Name-_AttackMult-_DefenseMult, CounterPairs),
        NamesRaw),
    sort(NamesRaw, Names).

resolve_counter_target(TargetIdentifier, Pokemon, false) :-
    pokemon_info(TargetIdentifier, Pokemon),
    !.
resolve_counter_target(TargetIdentifier, Pokemon, true) :-
    mega_base_identifier(TargetIdentifier, BaseIdentifier),
    pokemon_info(BaseIdentifier, Pokemon).

mega_base_identifier(Identifier, BaseIdentifier) :-
    downcase_atom(Identifier, IdentifierAtom),
    atomic_list_concat([BaseAtom | _], '_mega_', IdentifierAtom),
    BaseAtom \= IdentifierAtom,
    atom_string(BaseAtom, BaseIdentifier).

counter_recommendation_limit(4).

recommend_counters(TargetID, TargetTypes, TargetStats, TopPairs) :-
    findall(Score-Name-AttackMult-DefenseMult,
        ( pokemon_in_scope(CandidateID, Name, _, _, CandidateTypes, _, CandidateStats),
          CandidateID =\= TargetID,
                    counter_has_super_effective_coverage(CandidateID, CandidateTypes, TargetID, TargetTypes),
          counter_metrics(CandidateID, CandidateTypes, CandidateStats, TargetID, TargetTypes, TargetStats, AttackMult, DefenseMult, AttackPressure, DefensePressure),
          AttackMult > 1.0,
          counter_score(CandidateID, CandidateStats, TargetID, TargetStats, AttackPressure, DefensePressure, Score)
        ),
        PairsRaw),
    counter_rank_limit_pairs(PairsRaw, TopPairs).

recommend_counters_from_candidates(CandidateNames, TargetID, TargetTypes, TargetStats, TopPairs) :-
    findall(Score-Name-AttackMult-DefenseMult,
        ( member(Name, CandidateNames),
          pokemon_in_scope(CandidateID, Name, _, _, CandidateTypes, _, Stats),
          CandidateID =\= TargetID,
          counter_metrics(CandidateID, CandidateTypes, Stats, TargetID, TargetTypes, TargetStats, AttackMult, DefenseMult, AttackPressure, DefensePressure),
          counter_score(CandidateID, Stats, TargetID, TargetStats, AttackPressure, DefensePressure, Score)
        ),
        PairsRaw),
    counter_rank_limit_pairs(PairsRaw, TopPairs).

counter_rank_limit_pairs(PairsRaw, TopPairs) :-
    counter_rank_pairs(PairsRaw, RankedPairs),
    counter_limit_pairs(RankedPairs, TopPairs).

counter_rank_pairs(PairsRaw, RankedPairs) :-
    keysort(PairsRaw, PairsAsc),
    reverse(PairsAsc, PairsDescRaw),
    dedupe_counter_pairs_by_name(PairsDescRaw, RankedPairs).

counter_limit_pairs(Pairs, TopPairs) :-
    counter_recommendation_limit(Limit),
    take_first_n(Pairs, Limit, TopPairs).

dedupe_counter_pairs_by_name(Pairs, UniquePairs) :-
    dedupe_counter_pairs_by_name(Pairs, [], Rev),
    reverse(Rev, UniquePairs).

dedupe_counter_pairs_by_name([], _Seen, []).
dedupe_counter_pairs_by_name([Score-Name-AttackMult-DefenseMult | Rest], Seen, Acc) :-
    ( memberchk(Name, Seen) ->
        dedupe_counter_pairs_by_name(Rest, Seen, Acc)
    ; dedupe_counter_pairs_by_name(Rest, [Name | Seen], Tail),
      Acc = [Score-Name-AttackMult-DefenseMult | Tail]
    ).

total_stats_value(Stats, Total) :-
    findall(Value, member(_Stat-Value, Stats), Values),
    sum_list(Values, Total).

counter_has_super_effective_coverage(CandidateID, CandidateTypes, TargetID, TargetTypes) :-
    coverage_attack_multiplier(CandidateID, CandidateTypes, TargetID, TargetTypes, AttackMult),
    AttackMult > 1.0.

counter_metrics(CandidateID, CandidateTypes, CandidateStats, TargetID, TargetTypes, TargetStats, AttackMult, DefenseMult, AttackPressure, DefensePressure) :-
    counter_coverage_matchup(CandidateID, CandidateTypes, TargetID, TargetTypes, AttackMult, DefenseMult),
    offensive_move_factor(CandidateID, CandidateTypes, TargetID, TargetTypes, CandidateMoveFactor),
    offensive_move_factor(TargetID, TargetTypes, CandidateID, CandidateTypes, TargetMoveFactor),
    attacking_stat_value(CandidateStats, CandidateAttackStat),
    defending_stat_against(CandidateStats, TargetStats, CandidateDefenseStat),
    attacking_stat_value(TargetStats, TargetAttackStat),
    target_defense_against(TargetStats, CandidateStats, TargetDefenseStat),
    AttackPressure is AttackMult * CandidateMoveFactor * (CandidateAttackStat / max(1.0, TargetDefenseStat)),
    DefensePressure is DefenseMult * TargetMoveFactor * (TargetAttackStat / max(1.0, CandidateDefenseStat)).

offensive_move_factor(AttackerID, AttackerTypes, DefenderID, DefenderTypes, Factor) :-
    sort(DefenderTypes, DefenderTypeKey),
    ( cache_counter_move_factor(AttackerID, DefenderID, DefenderTypeKey, Factor) ->
        true
    ; best_move_effective_power(AttackerID, AttackerTypes, DefenderID, DefenderTypeKey, BestPower),
      Normalized is BestPower / 100.0,
      Factor is min(2.5, max(0.4, Normalized)),
      assertz(cache_counter_move_factor(AttackerID, DefenderID, DefenderTypeKey, Factor))
    ).

best_move_effective_power(AttackerID, AttackerTypes, DefenderID, DefenderTypeKey, BestPower) :-
    pokemon_info(AttackerID, pokemon(_, Name, _, _, _Types, _Abilities, _Stats)),
    pokemon_move_list_for_id(AttackerID, Name, Moves, _Source),
    sort(Moves, UniqueMoves),
    findall(EffectivePower,
        ( member(Move, UniqueMoves),
          move_data(Move, MoveType, Category, BasePower, _Accuracy, _PP, _Tags, _EffectChance, _Ailment, _EffectCategory, Description),
          offensive_move_category(Category),
          combined_multiplier(MoveType, DefenderTypeKey, BaseMult),
          ( defender_ability_immune_to_type(DefenderID, MoveType) ->
              Mult = 0.0
          ; Mult = BaseMult
          ),
          move_base_power_estimate(BasePower, Description, BasePowerEstimate),
          ( member(MoveType, AttackerTypes) -> STAB = 1.5 ; STAB = 1.0 ),
          EffectivePower is BasePowerEstimate * Mult * STAB
        ),
        EffectivePowers),
    ( EffectivePowers == [] ->
        BestPower = 60.0
    ; max_list(EffectivePowers, BestPower)
    ).

move_base_power_estimate(BasePower, _Description, Estimate) :-
    number(BasePower),
    BasePower > 0,
    !,
    Estimate is BasePower.
move_base_power_estimate(_BasePower, Description, 70.0) :-
    sub_atom(Description, _, _, _, 'Power is higher'),
    !.
move_base_power_estimate(_BasePower, Description, 70.0) :-
    sub_atom(Description, _, _, _, 'power is higher'),
    !.
move_base_power_estimate(_BasePower, Description, 60.0) :-
    sub_atom(Description, _, _, _, 'more damage'),
    !.
move_base_power_estimate(_BasePower, _Description, 55.0).

counter_score(CandidateID, CandidateStats, TargetID, TargetStats, AttackPressure, DefensePressure, Score) :-
    counter_duel_viability(CandidateID, CandidateStats, TargetID, TargetStats, AttackPressure, DefensePressure, DuelScore),
    counter_stat_floor(CandidateStats, TargetStats, AttackPressure, DefensePressure),
    counter_risk_gate(CandidateID, CandidateStats, TargetID, TargetStats, AttackPressure, DefensePressure),
    DuelScore > -10.0,
    Score is (AttackPressure * 2.5) - DefensePressure + DuelScore.

counter_stat_floor(CandidateStats, TargetStats, AttackPressure, DefensePressure) :-
    total_stats_value(CandidateStats, CandidateTotal),
    total_stats_value(TargetStats, TargetTotal),
    StatRatio is CandidateTotal / max(1.0, TargetTotal),
    ( StatRatio >= 0.85
    ; ( StatRatio >= 0.72,
        AttackPressure >= 4.5,
        DefensePressure =< 1.0
      )
    ).

counter_duel_viability(CandidateID, CandidateStats, TargetID, TargetStats, AttackPressure, DefensePressure, DuelScore) :-
    counter_combat_snapshot(CandidateID, CandidateStats, TargetID, TargetStats, AttackPressure, DefensePressure, ActionOrder, HitsToKO, HitsToDie),
    counter_duel_outcome(ActionOrder, HitsToKO, HitsToDie, Outcome),
    counter_duel_margin(ActionOrder, HitsToKO, HitsToDie, Margin),
    ( Outcome == win ->
        DuelScore is 18.0 + (Margin * 6.0)
    ; counter_can_force_action(ActionOrder, HitsToDie) ->
      DuelScore = -4.0
    ; DuelScore = -28.0
    ).

counter_combat_snapshot(CandidateID, CandidateStats, TargetID, TargetStats, AttackPressure, DefensePressure, ActionOrder, HitsToKO, HitsToDie) :-
    stat_value(CandidateStats, hp, CandidateHP),
    stat_value(TargetStats, hp, TargetHP),
    EstimatedCandidateDamage is max(1.0, AttackPressure * 22.0),
    EstimatedTargetDamage is max(1.0, DefensePressure * 22.0),
    HitsToKO is ceiling(TargetHP / EstimatedCandidateDamage),
    HitsToDie is ceiling(CandidateHP / EstimatedTargetDamage),
    counter_action_order(CandidateID, CandidateStats, TargetID, TargetStats, ActionOrder).

counter_risk_gate(CandidateID, CandidateStats, TargetID, TargetStats, AttackPressure, DefensePressure) :-
    counter_combat_snapshot(CandidateID, CandidateStats, TargetID, TargetStats, AttackPressure, DefensePressure, ActionOrder, HitsToKO, HitsToDie),
    ( DefensePressure =< 3.5
    ; ( AttackPressure >= 6.0,
        ActionOrder == first,
        HitsToKO =< 1,
        HitsToDie >= 1
      )
    ).

counter_action_order(CandidateID, _CandidateStats, TargetID, _TargetStats, first) :-
    max_offensive_priority(CandidateID, CandidatePriority),
    max_offensive_priority(TargetID, TargetPriority),
    CandidatePriority > TargetPriority,
    !.
counter_action_order(CandidateID, _CandidateStats, TargetID, _TargetStats, second) :-
    max_offensive_priority(CandidateID, CandidatePriority),
    max_offensive_priority(TargetID, TargetPriority),
    CandidatePriority < TargetPriority,
    !.
counter_action_order(_CandidateID, CandidateStats, _TargetID, TargetStats, first) :-
    stat_value(CandidateStats, speed, CandidateSpeed),
    stat_value(TargetStats, speed, TargetSpeed),
    CandidateSpeed >= TargetSpeed,
    !.
counter_action_order(_, _, _, _, second).

counter_duel_outcome(first, HitsToKO, HitsToDie, win) :-
    HitsToKO =< HitsToDie,
    !.
counter_duel_outcome(first, _HitsToKO, _HitsToDie, lose) :-
    !.
counter_duel_outcome(second, HitsToKO, HitsToDie, win) :-
    HitsToKO < HitsToDie,
    !.
counter_duel_outcome(_, _, _, lose).

counter_duel_margin(first, HitsToKO, HitsToDie, Margin) :-
    Margin is max(0, HitsToDie - HitsToKO).
counter_duel_margin(second, HitsToKO, HitsToDie, Margin) :-
    Margin is max(0, (HitsToDie - 1) - HitsToKO).

counter_can_force_action(first, _HitsToDie).
counter_can_force_action(second, HitsToDie) :- HitsToDie > 1.

max_offensive_priority(PokemonID, MaxPriority) :-
    ( cache_pokemon_max_offensive_priority(PokemonID, MaxPriority) ->
        true
    ; pokemon_info(PokemonID, pokemon(_, Name, _, _, _Types, _Abilities, _Stats)),
      pokemon_move_list_for_id(PokemonID, Name, Moves, _Source),
      sort(Moves, UniqueMoves),
      findall(Priority,
          ( member(Move, UniqueMoves),
            move_data(Move, _Type, Category, _BasePower, _Accuracy, _PP, Tags, _EffectChance, _Ailment, _EffectCategory, _Description),
            offensive_move_category(Category),
            offensive_move_priority(Tags, Priority)
          ),
          Priorities),
      ( Priorities == [] -> MaxPriority = 0 ; max_list(Priorities, MaxPriority) ),
      assertz(cache_pokemon_max_offensive_priority(PokemonID, MaxPriority))
    ).

counter_coverage_matchup(CandidateID, CandidateTypes, TargetID, TargetTypes, AttackMult, DefenseMult) :-
    coverage_attack_multiplier(CandidateID, CandidateTypes, TargetID, TargetTypes, AttackMult),
    coverage_attack_multiplier(TargetID, TargetTypes, CandidateID, CandidateTypes, DefenseMult).

coverage_attack_multiplier(AttackerID, AttackerTypes, DefenderID, DefenderTypes, BestMult) :-
    sort(DefenderTypes, DefenderTypeKey),
    ( cache_move_coverage_multiplier(AttackerID, DefenderID, DefenderTypeKey, BestMult) ->
        true
    ; offensive_types_for_counter(AttackerID, AttackerTypes, OffensiveTypes),
      findall(Mult,
          ( member(AttackType, OffensiveTypes),
            combined_multiplier(AttackType, DefenderTypeKey, BaseMult),
            ( defender_ability_immune_to_type(DefenderID, AttackType) ->
                Mult = 0.0
            ; Mult = BaseMult
            )
          ),
          Multipliers),
      max_list(Multipliers, BestMult),
      assertz(cache_move_coverage_multiplier(AttackerID, DefenderID, DefenderTypeKey, BestMult))
    ).

offensive_types_for_counter(PokemonID, FallbackTypes, OffensiveTypes) :-
    ( cache_pokemon_offensive_types(PokemonID, OffensiveTypes) ->
        true
    ; pokemon_info(PokemonID, pokemon(_, Name, _, _, _Types, _, _)),
      findall(MoveType,
          ( pokemon_move_list_for_id(PokemonID, Name, Moves, _Source),
            member(Move, Moves),
            move_attack_type(Move, MoveType)
          ),
          MoveTypesRaw),
      append(FallbackTypes, MoveTypesRaw, CombinedTypesRaw),
      sort(CombinedTypesRaw, OffensiveTypes),
      assertz(cache_pokemon_offensive_types(PokemonID, OffensiveTypes))
    ).

move_attack_type(Move, Type) :-
    move_data(Move, Type, Category, _BasePower, _Accuracy, _PP, _Tags, _EffectChance, _Ailment, _EffectCategory, _Description),
    offensive_move_category(Category).

offensive_move_category(physical).
offensive_move_category(special).

defender_ability_immune_to_type(DefenderID, AttackType) :-
    ability_immunity_types_for_pokemon(DefenderID, ImmunityTypes),
    member(AttackType, ImmunityTypes).

ability_immunity_types_for_pokemon(PokemonID, ImmunityTypes) :-
    ( cache_pokemon_ability_immunity_types(PokemonID, ImmunityTypes) ->
        true
    ; pokemon_info(PokemonID, pokemon(_, _Name, _, _, _Types, Abilities, _Stats)),
      findall(Type,
          ( member(Ability, Abilities),
            ability_effect(Ability, _Category, _Trigger, CombatModel, _Description),
            member(immunity-Type, CombatModel)
          ),
          ImmunityTypesRaw),
      sort(ImmunityTypesRaw, ImmunityTypes),
      assertz(cache_pokemon_ability_immunity_types(PokemonID, ImmunityTypes))
    ).

counter_type_matchup(CandidateTypes, TargetTypes, AttackMult, DefenseMult) :-
    sort(CandidateTypes, CandidateTypeKey),
    sort(TargetTypes, TargetTypeKey),
    ( cache_counter_type_matchup(CandidateTypeKey, TargetTypeKey, AttackMult, DefenseMult) ->
        true
    ; findall(Attack,
          ( member(CandidateType, CandidateTypeKey),
            combined_multiplier(CandidateType, TargetTypeKey, Attack)
          ),
          AttackValues),
      max_list(AttackValues, AttackMult),
      findall(Defense,
          ( member(TargetType, TargetTypeKey),
            combined_multiplier(TargetType, CandidateTypeKey, Defense)
          ),
          DefenseValues),
      max_list(DefenseValues, DefenseMult),
      assertz(cache_counter_type_matchup(CandidateTypeKey, TargetTypeKey, AttackMult, DefenseMult))
    ).

attacking_stat_value(Stats, Value) :-
    member(attack-Atk, Stats),
    member(special_attack-SpAtk, Stats),
    ( Atk >= SpAtk + 10 -> Value = Atk
    ; SpAtk >= Atk + 10 -> Value = SpAtk
    ; Value is (Atk + SpAtk) / 2.0
    ).

defending_stat_against(CandidateStats, TargetStats, Value) :-
    offensive_bias(TargetStats, Bias),
    defense_value_for_bias(CandidateStats, Bias, Value).

target_defense_against(TargetStats, CandidateStats, Value) :-
    offensive_bias(CandidateStats, Bias),
    defense_value_for_bias(TargetStats, Bias, Value).

offensive_bias(Stats, physical) :-
    member(attack-Atk, Stats),
    member(special_attack-SpAtk, Stats),
    Atk >= SpAtk + 10,
    !.
offensive_bias(Stats, special) :-
    member(attack-Atk, Stats),
    member(special_attack-SpAtk, Stats),
    SpAtk >= Atk + 10,
    !.
offensive_bias(_, mixed).

defense_value_for_bias(Stats, physical, Value) :-
    member(defense-Value, Stats),
    !.
defense_value_for_bias(Stats, special, Value) :-
    member(special_defense-Value, Stats),
    !.
defense_value_for_bias(Stats, mixed, Value) :-
    member(defense-Def, Stats),
    member(special_defense-SpDef, Stats),
    Value is (Def + SpDef) / 2.0.

counter_pairs_text(TargetID, CounterPairs, Text) :-
    maplist(counter_pair_text(TargetID), CounterPairs, Items),
    bullet_block_text('  - ', Items, Text).

counter_pairs_text(CounterPairs, Text) :-
    maplist(counter_pair_text_basic, CounterPairs, Items),
    bullet_block_text('  - ', Items, Text).

counter_pair_text(TargetID, _Score-Name-AttackMult-DefenseMult, Text) :-
    display_pokemon_name(Name, NameLabel),
    multiplier_text(AttackMult, AttackText),
    multiplier_text(DefenseMult, DefenseText),
    ( pokemon_in_scope(CandidateID, Name, _, _, CandidateTypes, _, CandidateStats),
      pokemon_info(TargetID, pokemon(_, _TargetName, _, _, TargetTypes, _, TargetStats)),
      counter_metrics(CandidateID, CandidateTypes, CandidateStats, TargetID, TargetTypes, TargetStats, _AttackMultCalc, _DefenseMultCalc, AttackPressure, DefensePressure),
      counter_combat_snapshot(CandidateID, CandidateStats, TargetID, TargetStats, AttackPressure, DefensePressure, ActionOrder, HitsToKO, HitsToDie),
      counter_duel_summary_text(ActionOrder, HitsToKO, HitsToDie, DuelText),
      counter_reason_summary(CandidateID, CandidateTypes, TargetID, TargetTypes, ReasonText),
      counter_additional_moves_text(CandidateID, TargetID, TargetTypes, AdditionalMovesText),
      counter_explanation_text(DuelText, ReasonText, AdditionalMovesText, ExplanationText),
      ExplanationText \= '' ->
          format(atom(Text), '~w (bate ~w / recebe até ~w; ~w)', [NameLabel, AttackText, DefenseText, ExplanationText])
    ; format(atom(Text), '~w (bate ~w / recebe até ~w)', [NameLabel, AttackText, DefenseText])
    ).

counter_pair_text_basic(_Score-Name-AttackMult-DefenseMult, Text) :-
    display_pokemon_name(Name, NameLabel),
    multiplier_text(AttackMult, AttackText),
    multiplier_text(DefenseMult, DefenseText),
    format(atom(Text), '~w (bate ~w / recebe até ~w)', [NameLabel, AttackText, DefenseText]).

counter_duel_summary_text(ActionOrder, HitsToKO, HitsToDie, SummaryText) :-
    counter_action_order_text(ActionOrder, ActionText),
    counter_duel_outcome(ActionOrder, HitsToKO, HitsToDie, Outcome),
    turn_word(HitsToKO, TurnWordKO),
    turn_word(HitsToDie, TurnWordDie),
    ( Outcome == win ->
        format(atom(SummaryText), '~w e vence em ~w ~w', [ActionText, HitsToKO, TurnWordKO])
    ; format(atom(SummaryText), '~w, pressiona em ~w ~w mas cai em ~w ~w', [ActionText, HitsToKO, TurnWordKO, HitsToDie, TurnWordDie])
    ).

counter_action_order_text(first, 'age antes').
counter_action_order_text(second, 'age depois').

turn_word(1, 'turno') :- !.
turn_word(_, 'turnos').

counter_additional_moves_text(CandidateID, TargetID, TargetTypes, Text) :-
    top_counter_move_labels(CandidateID, TargetID, TargetTypes, 4, Labels),
    drop_first_n(Labels, 2, Remaining),
    Remaining \= [],
    take_first_n(Remaining, 2, ExtraMoves),
    atomic_list_concat(ExtraMoves, ', ', Text),
    !.
counter_additional_moves_text(_, _, _, '').

top_counter_move_labels(CandidateID, TargetID, TargetTypes, Limit, Labels) :-
    findall(Score-Move,
        offensive_counter_move_option(CandidateID, TargetID, TargetTypes, Score, Move),
        RawPairs),
    keysort(RawPairs, AscPairs),
    reverse(AscPairs, DescPairs),
    dedupe_move_pairs_by_move(DescPairs, UniquePairs),
    take_first_n(UniquePairs, Limit, TopPairs),
    findall(Label,
        ( member(_Score-Move, TopPairs),
          display_label(Move, Label)
        ),
        Labels).

offensive_counter_move_option(CandidateID, TargetID, TargetTypes, Score, Move) :-
    pokemon_info(CandidateID, pokemon(_, Name, _, _, CandidateTypes, _, _)),
    pokemon_move_list_for_id(CandidateID, Name, Moves, _Source),
    sort(Moves, UniqueMoves),
    member(Move, UniqueMoves),
    move_data(Move, MoveType, Category, BasePower, _Accuracy, _PP, Tags, EffectChance, Ailment, EffectCategory, Description),
    offensive_move_category(Category),
    combined_multiplier(MoveType, TargetTypes, BaseMult),
    ( defender_ability_immune_to_type(TargetID, MoveType) ->
        Mult = 0.0
    ; Mult = BaseMult
    ),
    Mult > 1.0,
    offensive_move_priority(Tags, Priority),
    offensive_move_score(MoveType, CandidateTypes, Mult, BasePower, Priority, Tags, EffectChance, Ailment, EffectCategory, Description, Score),
    Score >= 20.

dedupe_move_pairs_by_move(Pairs, UniquePairs) :-
    dedupe_move_pairs_by_move(Pairs, [], Rev),
    reverse(Rev, UniquePairs).

dedupe_move_pairs_by_move([], _Seen, []).
dedupe_move_pairs_by_move([Score-Move | Rest], Seen, Acc) :-
    ( memberchk(Move, Seen) ->
        dedupe_move_pairs_by_move(Rest, Seen, Acc)
    ; dedupe_move_pairs_by_move(Rest, [Move | Seen], Tail),
      Acc = [Score-Move | Tail]
    ).

counter_explanation_text(DuelText, ReasonText, AdditionalMovesText, Text) :-
    ReasonText \= '',
    AdditionalMovesText \= '',
    !,
    format(atom(Text), '~w; chave: ~w; outros golpes: ~w', [DuelText, ReasonText, AdditionalMovesText]).
counter_explanation_text(DuelText, ReasonText, '', Text) :-
    ReasonText \= '',
    !,
    format(atom(Text), '~w; chave: ~w', [DuelText, ReasonText]).
counter_explanation_text(DuelText, '', AdditionalMovesText, Text) :-
    AdditionalMovesText \= '',
    !,
    format(atom(Text), '~w; outros golpes: ~w', [DuelText, AdditionalMovesText]).
counter_explanation_text(DuelText, '', '', DuelText).

counter_reason_summary(CandidateID, CandidateTypes, TargetID, TargetTypes, SummaryText) :-
    findall(Score-Insight,
        offensive_counter_insight(CandidateID, CandidateTypes, TargetID, TargetTypes, Score, Insight),
        OffensiveRaw),
    keysort(OffensiveRaw, OffensiveAsc),
    reverse(OffensiveAsc, OffensiveDesc),
    take_first_n(OffensiveDesc, 2, OffensiveTop),
    findall(Insight, member(_-Insight, OffensiveTop), OffensiveInsights),
    findall(Score-Insight,
        utility_counter_insight(CandidateID, Score, Insight),
        UtilityRaw),
    keysort(UtilityRaw, UtilityAsc),
    reverse(UtilityAsc, UtilityDesc),
    take_first_n(UtilityDesc, 1, UtilityTop),
    findall(Insight, member(_-Insight, UtilityTop), UtilityInsights),
    ( ability_counter_insight(CandidateID, TargetTypes, AbilityInsight) ->
        AbilityInsights = [AbilityInsight]
    ; AbilityInsights = []
    ),
    append(OffensiveInsights, UtilityInsights, TempInsights),
    append(TempInsights, AbilityInsights, CombinedInsights),
    list_to_set(CombinedInsights, UniqueInsights),
    take_first_n(UniqueInsights, 3, FinalInsights),
    ( FinalInsights == [] ->
        SummaryText = ''
    ; atomic_list_concat(FinalInsights, '; ', SummaryText)
    ).

offensive_counter_insight(CandidateID, CandidateTypes, TargetID, TargetTypes, Score, InsightText) :-
    pokemon_info(CandidateID, pokemon(_, Name, _, _, _, _, _)),
    pokemon_move_list_for_id(CandidateID, Name, Moves, _Source),
    sort(Moves, UniqueMoves),
    member(Move, UniqueMoves),
    move_data(Move, MoveType, Category, BasePower, _Accuracy, _PP, Tags, EffectChance, Ailment, EffectCategory, Description),
    offensive_move_category(Category),
    combined_multiplier(MoveType, TargetTypes, BaseMult),
    ( defender_ability_immune_to_type(TargetID, MoveType) ->
        Mult = 0.0
    ; Mult = BaseMult
    ),
    ( Mult > 1.0 ; move_has_high_tactical_value(Tags, Ailment, EffectCategory, Description) ),
    offensive_move_priority(Tags, Priority),
    offensive_move_score(MoveType, CandidateTypes, Mult, BasePower, Priority, Tags, EffectChance, Ailment, EffectCategory, Description, Score),
    Score > 0,
    counter_move_insight_text(Move, Mult, Priority, Tags, EffectChance, Ailment, EffectCategory, BasePower, Description, InsightText).

utility_counter_insight(CandidateID, Score, InsightText) :-
    pokemon_info(CandidateID, pokemon(_, Name, _, _, _, _, _)),
    pokemon_move_list_for_id(CandidateID, Name, Moves, _Source),
    sort(Moves, UniqueMoves),
    member(Move, UniqueMoves),
    move_data(Move, _MoveType, status, _BasePower, _Accuracy, _PP, Tags, EffectChance, Ailment, EffectCategory, Description),
    utility_move_usable_in_duel(Move, Description, EffectCategory),
    utility_move_priority(Tags, Priority),
    utility_move_score(Priority, Ailment, EffectCategory, Score),
    Score >= 12,
    utility_move_insight_text(Move, Priority, Ailment, EffectCategory, EffectChance, InsightText).

utility_move_usable_in_duel(Move, Description, EffectCategory) :-
    \+ move_is_ally_support_only(Move, Description, EffectCategory).

move_is_ally_support_only(Move, _Description, _EffectCategory) :-
    member(Move, [helping_hand, follow_me, ally_switch, aromatic_mist, coaching, heal_pulse, life_dew, floral_healing, gear_up, mat_block]),
    !.
move_is_ally_support_only(_Move, Description, _EffectCategory) :-
    sub_atom(Description, _, _, _, 'friendly'),
    !.
move_is_ally_support_only(_Move, Description, _EffectCategory) :-
    sub_atom(Description, _, _, _, 'ally'),
    !.

ability_counter_insight(CandidateID, TargetTypes, InsightText) :-
    findall(Score-Text,
        ability_counter_option(CandidateID, TargetTypes, Score, Text),
        RawOptions),
    RawOptions \= [],
    keysort(RawOptions, AscOptions),
    reverse(AscOptions, [BestScore-InsightText | _]),
    BestScore > 0.

ability_counter_option(CandidateID, TargetTypes, 30, Text) :-
    pokemon_info(CandidateID, pokemon(_, _, _, _, _, Abilities, _)),
    member(Ability, Abilities),
    ability_effect(Ability, _Category, _Trigger, CombatModel, _Description),
    member(immunity-Type, CombatModel),
    member(Type, TargetTypes),
    display_label(Ability, AbilityLabel),
    display_type_label(Type, TypeLabel),
    format(atom(Text), '~w dá imunidade a ~w', [AbilityLabel, TypeLabel]).
ability_counter_option(CandidateID, TargetTypes, 22, Text) :-
    pokemon_info(CandidateID, pokemon(_, _, _, _, _, Abilities, _)),
    member(Ability, Abilities),
    ability_effect(Ability, _Category, _Trigger, CombatModel, _Description),
    member(damage_multiplier-Type-Factor, CombatModel),
    member(Type, TargetTypes),
    number(Factor),
    Factor < 1.0,
    display_label(Ability, AbilityLabel),
    display_type_label(Type, TypeLabel),
    format(atom(Text), '~w reduz dano de ~w', [AbilityLabel, TypeLabel]).
ability_counter_option(CandidateID, TargetTypes, 16, Text) :-
    pokemon_info(CandidateID, pokemon(_, _, _, _, _, Abilities, _)),
    member(Ability, Abilities),
    ability_effect(Ability, _Category, _Trigger, CombatModel, _Description),
    member(type_boost-BoostedTypes, CombatModel),
    model_boosted_type(BoostedTypes, Type),
    combined_multiplier(Type, TargetTypes, Mult),
    Mult > 1.0,
    display_label(Ability, AbilityLabel),
    display_type_label(Type, TypeLabel),
    format(atom(Text), '~w reforça golpes de ~w', [AbilityLabel, TypeLabel]).
ability_counter_option(CandidateID, _TargetTypes, 12, Text) :-
    pokemon_info(CandidateID, pokemon(_, _, _, _, _, Abilities, _)),
    member(Ability, Abilities),
    ability_effect(Ability, _Category, _Trigger, CombatModel, _Description),
    member(attack_multiplier-Mult, CombatModel),
    number(Mult),
    Mult > 1.0,
    display_label(Ability, AbilityLabel),
    format(atom(Text), '~w aumenta ataque físico', [AbilityLabel]).
ability_counter_option(CandidateID, _TargetTypes, 12, Text) :-
    pokemon_info(CandidateID, pokemon(_, _, _, _, _, Abilities, _)),
    member(Ability, Abilities),
    ability_effect(Ability, _Category, _Trigger, CombatModel, _Description),
    member(special_attack_multiplier-Mult, CombatModel),
    number(Mult),
    Mult > 1.0,
    display_label(Ability, AbilityLabel),
    format(atom(Text), '~w aumenta ataque especial', [AbilityLabel]).

model_boosted_type(Types, Type) :-
    is_list(Types),
    member(Type, Types).
model_boosted_type(Type, Type) :-
    atom(Type).

move_has_high_tactical_value(Tags, _Ailment, _EffectCategory, _Description) :-
    offensive_move_priority(Tags, Priority),
    Priority > 0,
    !.
move_has_high_tactical_value(Tags, _Ailment, _EffectCategory, _Description) :-
    member(high_crit, Tags),
    !.
move_has_high_tactical_value(_Tags, Ailment, _EffectCategory, _Description) :-
    ailment_present(Ailment),
    !.
move_has_high_tactical_value(_Tags, _Ailment, EffectCategory, _Description) :-
    member(EffectCategory, [damage_heal, damage_lower, damage_ailment]),
    !.
move_has_high_tactical_value(_Tags, _Ailment, _EffectCategory, Description) :-
    move_has_conditional_power(0, Description).

offensive_move_score(MoveType, CandidateTypes, Mult, BasePower, Priority, Tags, EffectChance, Ailment, EffectCategory, Description, Score) :-
    ( member(MoveType, CandidateTypes) -> STABScore = 6 ; STABScore = 0 ),
    MultScore is Mult * 30,
    ( number(BasePower), BasePower > 0 ->
        PowerScore is min(18.0, BasePower / 8.0)
    ; PowerScore = 4
    ),
    PriorityScore is max(0, Priority) * 8,
    ( member(high_crit, Tags) -> CritScore = 5 ; CritScore = 0 ),
    ailment_score(Ailment, EffectChance, AilmentScore),
    ( move_has_conditional_power(BasePower, Description) -> ConditionalScore = 5 ; ConditionalScore = 0 ),
    effect_category_score(EffectCategory, EffectScore),
    Score is MultScore + PowerScore + STABScore + PriorityScore + CritScore + AilmentScore + ConditionalScore + EffectScore.

ailment_score(Ailment, EffectChance, Score) :-
    ailment_present(Ailment),
    !,
    ( number(EffectChance) -> ChanceBonus is min(5.0, EffectChance / 20.0) ; ChanceBonus = 2.0 ),
    Score is 6.0 + ChanceBonus.
ailment_score(_, _, 0).

ailment_present(Ailment) :-
    nonvar(Ailment),
    \+ memberchk(Ailment, [none, null, unknown]).

effect_category_score(damage_heal, 5).
effect_category_score(damage_lower, 4).
effect_category_score(damage_ailment, 4).
effect_category_score(_, 0).

move_has_conditional_power(BasePower, Description) :-
    ( number(BasePower), BasePower =:= 0 ->
        true
    ; sub_atom(Description, _, _, _, 'double power')
    ; sub_atom(Description, _, _, _, 'Power is higher')
    ; sub_atom(Description, _, _, _, 'power is higher')
    ).

offensive_move_priority(Tags, Priority) :-
    member(Tag, Tags),
    atom(Tag),
    atom_concat('priority_', NumberAtom, Tag),
    atom_number(NumberAtom, Priority),
    !.
offensive_move_priority(_, 0).

utility_move_priority(Tags, Priority) :-
    offensive_move_priority(Tags, Priority).

utility_move_score(Priority, Ailment, EffectCategory, Score) :-
    PriorityScore is max(0, Priority) * 2,
    ( ailment_present(Ailment) -> AilmentScore = 7 ; AilmentScore = 0 ),
    utility_effect_category_score(EffectCategory, EffectScore),
    Score is PriorityScore + AilmentScore + EffectScore.

utility_effect_category_score(field_effect, 5).
utility_effect_category_score(whole_field_effect, 5).
utility_effect_category_score(net_good_stats, 4).
utility_effect_category_score(ailment, 4).
utility_effect_category_score(unique, 3).
utility_effect_category_score(_, 0).

counter_move_insight_text(Move, Mult, Priority, Tags, EffectChance, Ailment, EffectCategory, BasePower, Description, Text) :-
    display_label(Move, MoveLabel),
    findall(Item,
        counter_move_insight_component(Mult, Priority, Tags, EffectChance, Ailment, EffectCategory, BasePower, Description, Item),
        ItemsRaw),
    sort(ItemsRaw, Items),
    ( Items == [] ->
        Text = MoveLabel
    ; atomic_list_concat(Items, ', ', ItemsText),
      format(atom(Text), '~w (~w)', [MoveLabel, ItemsText])
    ).

counter_move_insight_component(Mult, _Priority, _Tags, _EffectChance, _Ailment, _EffectCategory, _BasePower, _Description, Item) :-
    Mult > 1.0,
    multiplier_text(Mult, Item).
counter_move_insight_component(_Mult, Priority, _Tags, _EffectChance, _Ailment, _EffectCategory, _BasePower, _Description, Item) :-
    Priority > 0,
    format(atom(Item), 'prioridade +~w', [Priority]).
counter_move_insight_component(_Mult, _Priority, Tags, _EffectChance, _Ailment, _EffectCategory, _BasePower, _Description, 'alto crítico') :-
    member(high_crit, Tags).
counter_move_insight_component(_Mult, _Priority, _Tags, EffectChance, Ailment, _EffectCategory, _BasePower, _Description, Item) :-
    ailment_present(Ailment),
    display_label(Ailment, AilmentLabel),
    ( number(EffectChance) ->
        format(atom(Item), 'status ~w (~w%)', [AilmentLabel, EffectChance])
    ; format(atom(Item), 'status ~w', [AilmentLabel])
    ).
counter_move_insight_component(_Mult, _Priority, _Tags, _EffectChance, _Ailment, EffectCategory, _BasePower, _Description, 'derruba stats') :-
    EffectCategory == damage_lower.
counter_move_insight_component(_Mult, _Priority, _Tags, _EffectChance, _Ailment, EffectCategory, _BasePower, _Description, 'recupera HP') :-
    EffectCategory == damage_heal.
counter_move_insight_component(_Mult, _Priority, _Tags, _EffectChance, _Ailment, _EffectCategory, BasePower, Description, 'poder condicional') :-
    move_has_conditional_power(BasePower, Description).

utility_move_insight_text(Move, Priority, Ailment, EffectCategory, EffectChance, Text) :-
    display_label(Move, MoveLabel),
    findall(Item,
        utility_move_insight_component(Priority, Ailment, EffectCategory, EffectChance, Item),
        ItemsRaw),
    sort(ItemsRaw, Items),
    ( Items == [] ->
        Text = MoveLabel
    ; atomic_list_concat(Items, ', ', ItemsText),
      format(atom(Text), '~w (~w)', [MoveLabel, ItemsText])
    ).

utility_move_insight_component(Priority, _Ailment, _EffectCategory, _EffectChance, Item) :-
    Priority > 0,
    format(atom(Item), 'prioridade +~w', [Priority]).
utility_move_insight_component(_Priority, Ailment, _EffectCategory, EffectChance, Item) :-
    ailment_present(Ailment),
    display_label(Ailment, AilmentLabel),
    ( number(EffectChance) ->
        format(atom(Item), 'aplica ~w (~w%)', [AilmentLabel, EffectChance])
    ; format(atom(Item), 'aplica ~w', [AilmentLabel])
    ).
utility_move_insight_component(_Priority, _Ailment, EffectCategory, _EffectChance, 'controle de campo') :-
    member(EffectCategory, [field_effect, whole_field_effect]).
utility_move_insight_component(_Priority, _Ailment, EffectCategory, _EffectChance, 'setup de stats') :-
    EffectCategory == net_good_stats.
