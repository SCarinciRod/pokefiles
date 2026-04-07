:- encoding(utf8).

handle_pending_rank_focus(Text) :-
    pending_rank_focus(Role, Limit, Generation),
    !,
    tokenize_for_match(Text, Tokens),
    ( has_cancel_token(Tokens) ->
        retractall(pending_rank_focus(_, _, _)),
        writeln('Bot: Certo, cancelei o ranking por foco.')
    ; rank_focus_choice(Tokens, physical) ->
        retractall(pending_rank_focus(_, _, _)),
        role_focus_metric(Role, physical, Metric),
        answer_ranked_metric_query(Metric, Limit, Generation)
    ; rank_focus_choice(Tokens, special) ->
        retractall(pending_rank_focus(_, _, _)),
        role_focus_metric(Role, special, Metric),
        answer_ranked_metric_query(Metric, Limit, Generation)
    ; role_focus_hint(Role)
    ).

rank_focus_choice(Tokens, Focus) :-
    member(Token, Tokens),
    focus_choice_token(Focus, Token),
    !.

role_focus_metric(attacker, physical, physical_attack).
role_focus_metric(attacker, special, special_attack).
role_focus_metric(defender, physical, physical_defense).
role_focus_metric(defender, special, special_defense).

role_focus_hint(attacker) :-
    writeln('Bot: Para atacantes, você quer ranking de ataque físico ou ataque especial?').
role_focus_hint(defender) :-
    writeln('Bot: Para defensores, você quer defesa física ou defesa especial?').

parse_ranked_metric_needs_focus_query(Text, Role, Limit, Generation) :-
    tokenize_for_match(Text, Tokens),
    has_ranking_signal(Tokens),
    rank_role_from_tokens(Tokens, Role),
    \+ ranked_metric_from_tokens(Tokens, physical_attack),
    \+ ranked_metric_from_tokens(Tokens, special_attack),
    \+ ranked_metric_from_tokens(Tokens, physical_defense),
    \+ ranked_metric_from_tokens(Tokens, special_defense),
    ( parse_limit_from_tokens(Tokens, ParsedLimit) -> Limit = ParsedLimit ; Limit = 10 ),
    ( parse_generation_from_tokens(Tokens, ParsedGeneration) -> Generation = ParsedGeneration ; Generation = all ).

parse_ranked_metric_query(Text, Metric, Limit, Generation) :-
    tokenize_for_match(Text, Tokens),
    has_ranking_signal(Tokens),
    ranked_metric_from_tokens(Tokens, Metric),
    ( parse_limit_from_tokens(Tokens, ParsedLimit) -> Limit = ParsedLimit ; Limit = 10 ),
    ( parse_generation_from_tokens(Tokens, ParsedGeneration) -> Generation = ParsedGeneration ; Generation = all ).

parse_ranked_metric_query_invalid_generation(Text, Metric) :-
    tokenize_for_match(Text, Tokens),
    has_ranking_signal(Tokens),
    ranked_metric_from_tokens(Tokens, Metric),
    has_generation_request_tokens(Tokens),
    \+ parse_generation_from_tokens(Tokens, _).

has_generation_request_tokens(Tokens) :-
    member(Token, Tokens),
    generation_keyword_token(Token),
    !.
has_generation_request_tokens(Tokens) :-
    member(Token, Tokens),
    generation_prefix(Token),
    !.

rank_role_from_tokens(Tokens, Role) :-
    member(Token, Tokens),
    rank_role_token(Role, Token),
    !.

parse_bst_threshold_query(Text, Comparator, Threshold, Generation) :-
    tokenize_for_match(Text, Tokens),
    ranked_metric_from_tokens(Tokens, bst),
    threshold_comparator_from_tokens(Tokens, Comparator),
    extract_threshold_value(Tokens, Threshold),
    ( parse_generation_from_tokens(Tokens, ParsedGeneration) -> Generation = ParsedGeneration ; Generation = all ).

parse_type_coverage_query(Text, TargetType) :-
    tokenize_for_match(Text, Tokens),
    ( member(Token, Tokens), coverage_intent_token(Token) ),
    extract_type_filters(Tokens, [TargetType | _]).

parse_double_weakness_query(Text, AttackType) :-
    tokenize_for_match(Text, Tokens),
    ( contiguous_sublist(["dupla", "fraqueza"], Tokens)
    ; member("4x", Tokens)
    ),
    extract_type_filters(Tokens, [AttackType | _]).

parse_most_immunities_query(Text, Limit) :-
    tokenize_for_match(Text, Tokens),
    ( member(Token, Tokens), immunity_intent_token(Token) ),
    has_ranking_signal(Tokens),
    ( parse_limit_from_tokens(Tokens, ParsedLimit) -> Limit = ParsedLimit ; Limit = 10 ).

parse_team_coverage_query(Text) :-
    tokenize_for_match(Text, Tokens),
    ( member(Token, Tokens), team_intent_token(Token) ),
    ( member(Token, Tokens), coverage_intent_token(Token) ).

parse_multi_compare_query(Text, Names) :-
    tokenize_for_match(Text, Tokens),
    ( member(Token, Tokens), compare_intent_token(Token) ),
    extract_all_pokemon_mentions(Text, Names),
    length(Names, Count),
    Count >= 3.

parse_rank_team_vs_target_query(Text, TeamNames, TargetName) :-
    tokenize_for_match(Text, Tokens),
    has_ranking_signal(Tokens),
    ( member(Token, Tokens), team_intent_token(Token) ),
    ( member(Token, Tokens), counter_relation_token(Token)
    ; member(Token, Tokens), counter_intent_token(Token)
    ),
    extract_target_name_after_relation(Text, TargetName),
    extract_all_pokemon_mentions(Text, Mentions),
    exclude(=(TargetName), Mentions, TeamNames),
    TeamNames \= [].

parse_best_team_member_vs_target_query(Text, TeamNames, TargetName) :-
    tokenize_for_match(Text, Tokens),
    ( member(Token, Tokens), team_intent_token(Token) ),
    ( contiguous_sublist(["entra", "melhor"], Tokens)
    ; contiguous_sublist(["melhor", "contra"], Tokens)
    ; contiguous_sublist(["quem", "entra"], Tokens)
    ),
    extract_target_name_after_relation(Text, TargetName),
    extract_all_pokemon_mentions(Text, Mentions),
    exclude(=(TargetName), Mentions, TeamNames),
    TeamNames \= [].

has_ranking_signal(Tokens) :-
    member(Token, Tokens),
    ranking_signal_token(Token),
    !.
has_ranking_signal(Tokens) :-
    member("mais", Tokens),
    ranked_metric_from_tokens(Tokens, _).

ranked_metric_from_tokens(Tokens, speed) :-
    metric_match(Tokens, speed).
ranked_metric_from_tokens(Tokens, defensive_bulk) :-
    metric_match(Tokens, defensive_bulk).
ranked_metric_from_tokens(Tokens, physical_attack) :-
    metric_match(Tokens, physical_attack).
ranked_metric_from_tokens(Tokens, special_attack) :-
    metric_match(Tokens, special_attack).
ranked_metric_from_tokens(Tokens, physical_defense) :-
    metric_match(Tokens, physical_defense).
ranked_metric_from_tokens(Tokens, special_defense) :-
    metric_match(Tokens, special_defense).
ranked_metric_from_tokens(Tokens, bst) :-
    metric_match(Tokens, bst).
ranked_metric_from_tokens(Tokens, tallest) :-
    metric_match(Tokens, tallest).
ranked_metric_from_tokens(Tokens, shortest) :-
    metric_match(Tokens, shortest).
ranked_metric_from_tokens(Tokens, heaviest) :-
    metric_match(Tokens, heaviest).
ranked_metric_from_tokens(Tokens, lightest) :-
    metric_match(Tokens, lightest).

metric_match(Tokens, Metric) :-
    metric_phrase(Metric, PhraseTokens),
    contiguous_sublist(PhraseTokens, Tokens),
    !.
metric_match(Tokens, Metric) :-
    member(Token, Tokens),
    metric_token(Metric, Token),
    !.

parse_limit_from_tokens(Tokens, Limit) :-
    member("top", Tokens),
    extract_threshold_value(Tokens, Parsed),
    Parsed =< 30,
    Limit = Parsed,
    !.
parse_limit_from_tokens(Tokens, Limit) :-
    extract_threshold_value(Tokens, Parsed),
    Parsed =< 20,
    Limit = Parsed,
    !.

extract_threshold_value(Tokens, Threshold) :-
    findall(Number,
        ( member(Token, Tokens),
          token_to_numeric_value(Token, Number),
          integer(Number),
          Number >= 1,
          Number =< 999
        ),
        NumbersSingle),
    findall(Number,
        token_compound_numeric_value(Tokens, Number),
        NumbersCompound),
    append(NumbersSingle, NumbersCompound, Numbers),
    Numbers \= [],
    max_list(Numbers, Threshold).

token_to_numeric_value(Token, Number) :-
    string_number(Token, Number),
    integer(Number).
token_to_numeric_value(Token, Number) :-
    safe_number_word_value(Token, Number).

token_compound_numeric_value(Tokens, Number) :-
    append(_, [TensToken, "e", UnitToken | _], Tokens),
    safe_number_word_value(TensToken, Tens),
    safe_number_word_value(UnitToken, Units),
    member(Tens, [20, 30, 40, 50, 60, 70, 80, 90]),
    between(1, 9, Units),
    Number is Tens + Units.

threshold_comparator_from_tokens(Tokens, ge) :-
    ( member("acima", Tokens)
    ; contiguous_sublist(["maior", "que"], Tokens)
    ; contiguous_sublist(["maiores", "que"], Tokens)
    ; member(">=", Tokens)
    ; member("minimo", Tokens)
    ; member("mínimo", Tokens)
    ).
threshold_comparator_from_tokens(Tokens, le) :-
    ( member("abaixo", Tokens)
    ; contiguous_sublist(["menor", "que"], Tokens)
    ; contiguous_sublist(["menores", "que"], Tokens)
    ; member("<=", Tokens)
    ; member("maximo", Tokens)
    ; member("máximo", Tokens)
    ).

answer_ranked_metric_query(Metric, Limit, Generation) :-
    ranked_metric_pairs(Metric, Generation, Pairs),
    Pairs \= [],
    take_first_n(Pairs, Limit, TopPairs),
    TopPairs \= [],
    !,
    extract_names_from_pairs(TopPairs, Names),
    remember_candidate_list(Names),
    ranked_metric_label(Metric, MetricLabel),
    generation_scope_text(Generation, ScopeText),
    writeln('Bot: Ranking encontrado:'),
    format('  Métrica: ~w (~w)~n', [MetricLabel, ScopeText]),
    print_ranked_metric_lines(Metric, TopPairs, 1).
answer_ranked_metric_query(Metric, _Limit, Generation) :-
    ranked_metric_label(Metric, MetricLabel),
    generation_scope_text(Generation, ScopeText),
    format('Bot: Não encontrei ranking de ~w no recorte ~w.~n', [MetricLabel, ScopeText]).

answer_ranked_metric_invalid_generation(Metric) :-
    ranked_metric_label(Metric, MetricLabel),
    format('Bot: Entendi que você quer ranking de ~w, mas não reconheci a geração informada.~n', [MetricLabel]),
    writeln('Bot: Use geração de 1 a 9 (ex.: "segunda geração", "geração 2", "gen quatro").').

answer_ranked_metric_needs_focus_query(Role, Limit, Generation) :-
    retractall(pending_rank_focus(_, _, _)),
    assertz(pending_rank_focus(Role, Limit, Generation)),
    generation_scope_text(Generation, ScopeText),
    ( Role == attacker ->
        format('Bot: Para atacantes no recorte ~w, quer ataque físico ou ataque especial?~n', [ScopeText])
    ; format('Bot: Para defensores no recorte ~w, quer defesa física ou defesa especial?~n', [ScopeText])
    ).

answer_bst_threshold_query(Comparator, Threshold, Generation) :-
    findall(Name,
        ( pokemon_in_scope(ID, Name, _Height, _Weight, _Types, _Abilities, Stats),
          generation_filter_matches(Generation, ID),
          total_stats_value(Stats, BST),
          bst_threshold_matches(Comparator, BST, Threshold)
        ),
        NamesRaw),
    sort(NamesRaw, Names),
    Names \= [],
    !,
    remember_candidate_list(Names),
    length(Names, Count),
    sample_names_text(Names, 12, SampleText),
    bst_comparator_text(Comparator, ComparatorText),
    generation_scope_text(Generation, ScopeText),
    format('Bot: Encontrei ~w Pokémon com BST ~w ~w (~w).~n', [Count, ComparatorText, Threshold, ScopeText]),
    format('  Exemplos: ~w~n', [SampleText]).
answer_bst_threshold_query(Comparator, Threshold, Generation) :-
    bst_comparator_text(Comparator, ComparatorText),
    generation_scope_text(Generation, ScopeText),
    format('Bot: Não encontrei Pokémon com BST ~w ~w (~w).~n', [ComparatorText, Threshold, ScopeText]).

answer_type_coverage_query(TargetType) :-
    findall(Multiplier-AttackType,
        ( all_types(Types),
          member(AttackType, Types),
          combined_multiplier(AttackType, [TargetType], Multiplier),
          Multiplier > 1.0
        ),
        PairsRaw),
    keysort(PairsRaw, Asc),
    reverse(Asc, Desc),
    Desc \= [],
    !,
    display_type_label(TargetType, TargetLabel),
    take_first_n(Desc, 6, Top),
    coverage_pairs_text(Top, Text),
    format('Bot: Tipos que cobrem melhor ~w: ~w.~n', [TargetLabel, Text]).
answer_type_coverage_query(TargetType) :-
    display_type_label(TargetType, TargetLabel),
    format('Bot: Não encontrei cobertura super efetiva para o tipo ~w.~n', [TargetLabel]).

answer_double_weakness_query(AttackType) :-
    findall(Name,
        ( pokemon_in_scope(_, Name, _, _, Types, _, _),
          combined_multiplier(AttackType, Types, Multiplier),
          Multiplier >= 4.0
        ),
        NamesRaw),
    sort(NamesRaw, Names),
    length(Names, Count),
    display_type_label(AttackType, TypeLabel),
    format('Bot: Encontrei ~w Pokémon com dupla fraqueza (4x) a ~w.~n', [Count, TypeLabel]),
    ( Count > 0 ->
        remember_candidate_list(Names),
        sample_names_text(Names, 12, SampleText),
        format('  Exemplos: ~w~n', [SampleText])
    ; true
    ).

answer_most_immunities_query(Limit) :-
    findall(Count-Name,
        ( pokemon_in_scope(_, Name, _, _, Types, _, _),
          type_effectiveness_summary(Types, _Weak, _Resist, Immunities),
          length(Immunities, Count),
          Count > 0
        ),
        PairsRaw),
    keysort(PairsRaw, Asc),
    reverse(Asc, Desc),
    Desc \= [],
    !,
    take_first_n(Desc, Limit, Top),
    extract_names_from_pairs(Top, Names),
    remember_candidate_list(Names),
    writeln('Bot: Pokémon com mais imunidades:'),
    print_ranked_metric_lines(immunities, Top, 1).
answer_most_immunities_query(_) :-
    writeln('Bot: Não encontrei Pokémon com imunidades no recorte atual.').

answer_team_coverage_query :-
    greedy_coverage_team(6, Team),
    Team \= [],
    !,
    remember_candidate_list(Team),
    sample_names_text(Team, 6, TeamText),
    coverage_by_team(Team, CoveredTypes),
    length(CoveredTypes, CoveredCount),
    format('Bot: Time heurístico de cobertura (6): ~w.~n', [TeamText]),
    format('Bot: Esse time pressiona super efetivo ~w tipos diferentes.~n', [CoveredCount]).
answer_team_coverage_query :-
    writeln('Bot: Não consegui montar um time de cobertura no recorte atual.').

answer_multi_compare_query(Names) :-
    compare_candidates_ranked(Names, Ranked),
    Ranked \= [],
    !,
    remember_candidate_list(Names),
    writeln('Bot: Comparação rápida do grupo:'),
    print_multi_compare_lines(Ranked, 1).
answer_multi_compare_query(_) :-
    writeln('Bot: Não consegui comparar esse grupo de Pokémon.').

answer_rank_team_vs_target_query(TeamNames, TargetIdentifier) :-
    resolve_counter_target(TargetIdentifier, pokemon(TargetID, TargetName, _, _, TargetTypes, _, TargetStats), _),
    findall(Score-Name,
        ( member(Name, TeamNames),
          pokemon_in_scope(CandidateID, Name, _, _, CandidateTypes, _, CandidateStats),
          CandidateID =\= TargetID,
          counter_metrics(CandidateID, CandidateTypes, CandidateStats, TargetID, TargetTypes, TargetStats, _AttackMult, _DefenseMult, AttackPressure, DefensePressure),
          counter_score(CandidateID, CandidateStats, TargetID, TargetStats, AttackPressure, DefensePressure, Score)
        ),
        PairsRaw),
    keysort(PairsRaw, Asc),
    reverse(Asc, Ranked),
    Ranked \= [],
    !,
    display_pokemon_name(TargetName, TargetLabel),
    format('Bot: Ranking do seu time contra ~w:~n', [TargetLabel]),
    print_ranked_metric_lines(team_matchup, Ranked, 1).
answer_rank_team_vs_target_query(_, TargetIdentifier) :-
    display_pokemon_name(TargetIdentifier, TargetLabel),
    format('Bot: Não consegui ranquear seu time contra ~w com os nomes informados.~n', [TargetLabel]).

answer_best_team_member_vs_target_query(TeamNames, TargetIdentifier) :-
    answer_rank_team_vs_target_query(TeamNames, TargetIdentifier),
    resolve_counter_target(TargetIdentifier, pokemon(TargetID, _, _, _, TargetTypes, _, TargetStats), _),
    findall(Score-Name,
        ( member(Name, TeamNames),
          pokemon_in_scope(CandidateID, Name, _, _, CandidateTypes, _, CandidateStats),
          CandidateID =\= TargetID,
          counter_metrics(CandidateID, CandidateTypes, CandidateStats, TargetID, TargetTypes, TargetStats, _AttackMult, _DefenseMult, AttackPressure, DefensePressure),
          counter_score(CandidateID, CandidateStats, TargetID, TargetStats, AttackPressure, DefensePressure, Score)
        ),
        PairsRaw),
    keysort(PairsRaw, Asc),
    reverse(Asc, [BestScore-BestName | _]),
    display_pokemon_name(BestName, BestLabel),
    format('Bot: Melhor entrada do seu time nesse cenário: ~w (score ~2f).~n', [BestLabel, BestScore]).
answer_best_team_member_vs_target_query(_TeamNames, TargetIdentifier) :-
    display_pokemon_name(TargetIdentifier, TargetLabel),
    format('Bot: Não consegui apontar a melhor entrada do seu time contra ~w.~n', [TargetLabel]).

ranked_metric_pairs(Metric, Generation, OrderedPairs) :-
    findall(Value-Name,
        ( pokemon_in_scope(ID, Name, Height, Weight, _Types, _Abilities, Stats),
          generation_filter_matches(Generation, ID),
          \+ is_mega_name(Name),
          \+ is_special_form_id(ID),
          ranked_metric_value(Metric, Height, Weight, Stats, Value)
        ),
        PairsRaw),
    keysort(PairsRaw, Asc),
    ( metric_sort_order(Metric, asc) -> OrderedPairs = Asc ; reverse(Asc, OrderedPairs) ).

ranked_metric_value(speed, _Height, _Weight, Stats, Value) :- member(speed-Value, Stats).
ranked_metric_value(defensive_bulk, _Height, _Weight, Stats, Value) :-
    member(hp-HP, Stats),
    member(defense-Def, Stats),
    member(special_defense-SpDef, Stats),
    Value is HP + Def + SpDef.
ranked_metric_value(physical_attack, _Height, _Weight, Stats, Value) :- member(attack-Value, Stats).
ranked_metric_value(special_attack, _Height, _Weight, Stats, Value) :- member(special_attack-Value, Stats).
ranked_metric_value(physical_defense, _Height, _Weight, Stats, Value) :- member(defense-Value, Stats).
ranked_metric_value(special_defense, _Height, _Weight, Stats, Value) :- member(special_defense-Value, Stats).
ranked_metric_value(bst, _Height, _Weight, Stats, Value) :- total_stats_value(Stats, Value).
ranked_metric_value(tallest, Height, _Weight, _Stats, Height).
ranked_metric_value(shortest, Height, _Weight, _Stats, Height).
ranked_metric_value(heaviest, _Height, Weight, _Stats, Weight).
ranked_metric_value(lightest, _Height, Weight, _Stats, Weight).
ranked_metric_value(immunities, _Height, _Weight, _Stats, _Value) :- fail.
ranked_metric_value(team_matchup, _Height, _Weight, _Stats, _Value) :- fail.

metric_sort_order(shortest, asc).
metric_sort_order(lightest, asc).
metric_sort_order(_, desc).

ranked_metric_label(speed, 'velocidade').
ranked_metric_label(defensive_bulk, 'bulk defensivo (HP+Def+SpDef)').
ranked_metric_label(physical_attack, 'ataque físico').
ranked_metric_label(special_attack, 'ataque especial').
ranked_metric_label(physical_defense, 'defesa física').
ranked_metric_label(special_defense, 'defesa especial').
ranked_metric_label(bst, 'BST (soma dos status base)').
ranked_metric_label(tallest, 'altura (maiores)').
ranked_metric_label(shortest, 'altura (menores)').
ranked_metric_label(heaviest, 'peso (maiores)').
ranked_metric_label(lightest, 'peso (menores)').
ranked_metric_label(immunities, 'imunidades').
ranked_metric_label(team_matchup, 'matchup do time').

print_ranked_metric_lines(_Metric, [], _Index).
print_ranked_metric_lines(Metric, [Value-Name | Rest], Index) :-
    display_pokemon_name(Name, Label),
    ranked_metric_value_text(Metric, Value, ValueText),
    format('  ~w) ~w -> ~w~n', [Index, Label, ValueText]),
    NextIndex is Index + 1,
    print_ranked_metric_lines(Metric, Rest, NextIndex).

ranked_metric_value_text(tallest, HeightDecimeters, Text) :-
    HeightMeters is HeightDecimeters / 10,
    format(atom(Text), '~1f m', [HeightMeters]).
ranked_metric_value_text(shortest, HeightDecimeters, Text) :-
    HeightMeters is HeightDecimeters / 10,
    format(atom(Text), '~1f m', [HeightMeters]).
ranked_metric_value_text(heaviest, WeightHectograms, Text) :-
    WeightKg is WeightHectograms / 10,
    format(atom(Text), '~1f kg', [WeightKg]).
ranked_metric_value_text(lightest, WeightHectograms, Text) :-
    WeightKg is WeightHectograms / 10,
    format(atom(Text), '~1f kg', [WeightKg]).
ranked_metric_value_text(team_matchup, Value, Text) :-
    format(atom(Text), 'score ~2f', [Value]).
ranked_metric_value_text(_, Value, Text) :-
    format(atom(Text), '~w', [Value]).

extract_names_from_pairs(Pairs, Names) :-
    findall(Name,
        member(_Value-Name, Pairs),
        Names).

bst_threshold_matches(ge, Value, Threshold) :- Value >= Threshold.
bst_threshold_matches(le, Value, Threshold) :- Value =< Threshold.

bst_comparator_text(ge, '>=').
bst_comparator_text(le, '<=').

coverage_pairs_text(Pairs, Text) :-
    maplist(coverage_pair_label, Pairs, Labels),
    atomic_list_concat(Labels, ', ', Text).

coverage_pair_label(Multiplier-Type, Label) :-
    display_type_label(Type, TypeLabel),
    multiplier_text(Multiplier, MultText),
    format(atom(Label), '~w (~w)', [TypeLabel, MultText]).

greedy_coverage_team(Size, Team) :-
    findall(Name,
        pokemon_in_scope(_ID, Name, _Height, _Weight, _Types, _Abilities, _Stats),
        NamesRaw),
    sort(NamesRaw, Names),
    greedy_coverage_team(Names, [], [], Size, Team).

greedy_coverage_team(_Pool, TeamAcc, _Covered, 0, Team) :-
    reverse(TeamAcc, Team),
    !.
greedy_coverage_team(Pool, TeamAcc, Covered, SlotsLeft, Team) :-
    best_coverage_pick(Pool, Covered, BestName, BestNewCovered),
    !,
    delete(Pool, BestName, RemainingPool),
    append(Covered, BestNewCovered, CoveredRaw),
    sort(CoveredRaw, UpdatedCovered),
    NextSlots is SlotsLeft - 1,
    greedy_coverage_team(RemainingPool, [BestName | TeamAcc], UpdatedCovered, NextSlots, Team).
greedy_coverage_team(_Pool, TeamAcc, _Covered, _SlotsLeft, Team) :-
    reverse(TeamAcc, Team).

best_coverage_pick(Pool, Covered, BestName, BestNewCovered) :-
    findall(NewCount-Name-NewCovered,
        ( member(Name, Pool),
          pokemon_info(Name, pokemon(_, _, _, _, Types, _, _)),
          offensive_coverage_types(Types, Coverage),
          subtract(Coverage, Covered, NewCovered),
          length(NewCovered, NewCount)
        ),
        Candidates),
    keysort(Candidates, Sorted),
    reverse(Sorted, [_BestCount-BestName-BestNewCovered | _]).

offensive_coverage_types(AttackTypes, CoveredTypes) :-
    all_types(TargetTypes),
    findall(TargetType,
        ( member(TargetType, TargetTypes),
          member(AttackType, AttackTypes),
          combined_multiplier(AttackType, [TargetType], Multiplier),
          Multiplier > 1.0
        ),
        CoveredRaw),
    sort(CoveredRaw, CoveredTypes).

coverage_by_team(TeamNames, CoveredTypes) :-
    findall(Type,
        ( member(Name, TeamNames),
          pokemon_info(Name, pokemon(_, _, _, _, Types, _, _)),
          offensive_coverage_types(Types, TeamCovered),
          member(Type, TeamCovered)
        ),
        CoveredRaw),
    sort(CoveredRaw, CoveredTypes).

compare_candidates_ranked(Names, Ranked) :-
    findall(BST-Name,
        ( member(Name, Names),
          pokemon_info(Name, pokemon(_, _, _, _, _, _, Stats)),
          total_stats_value(Stats, BST)
        ),
        PairsRaw),
    keysort(PairsRaw, Asc),
    reverse(Asc, Ranked).

print_multi_compare_lines([], _Index).
print_multi_compare_lines([BST-Name | Rest], Index) :-
    pokemon_info(Name, pokemon(ID, _, _, _, Types, _, Stats)),
    compare_role_profile(ID, Stats, RoleText, _Bucket),
    display_pokemon_name(Name, NameLabel),
    type_list_text(Types, TypeText),
    format('  ~w) ~w -> BST ~w, tipos: ~w, perfil: ~w~n', [Index, NameLabel, BST, TypeText, RoleText]),
    Next is Index + 1,
    print_multi_compare_lines(Rest, Next).
