:- encoding(utf8).
:- ensure_loaded('../db/catalogs/move_tactical_catalog.pl').

:- dynamic pending_held_item_options/2.

handle_pending_held_item_options(Text) :-
    pending_held_item_options(TargetLabel, Remaining),
    !,
    tokenize_for_match(Text, Tokens),
    ( has_cancel_token(Tokens) ->
        retractall(pending_held_item_options(_, _)),
        writeln('Bot: Certo, parei as opções de held item por agora.')
    ; held_item_next_option_request(Tokens) ->
        held_item_consume_next_option(TargetLabel, Remaining)
    ; held_item_pending_should_yield(Tokens) ->
        retractall(pending_held_item_options(_, _)),
        fail
    ; format('Bot: Se quiser seguir no ranking de ~w, diga "outra opção". Para encerrar, diga "cancelar".~n', [TargetLabel])
    ).

held_item_pending_should_yield(Tokens) :-
    held_item_pending_yield_signal(Tokens),
    !.

held_item_pending_yield_signal(Tokens) :-
    held_item_pending_yield_predicate(PredicateName),
    current_predicate(PredicateName/1),
    Goal =.. [PredicateName, Tokens],
    call(Goal),
    !.

held_item_pending_yield_predicate(counter_domain_signal).
held_item_pending_yield_predicate(compare_or_battle_domain_signal).
held_item_pending_yield_predicate(type_domain_signal).
held_item_pending_yield_predicate(generation_domain_signal).
held_item_pending_yield_predicate(ranking_domain_signal).
held_item_pending_yield_predicate(evolution_domain_signal).
held_item_pending_yield_predicate(status_domain_signal).
held_item_pending_yield_predicate(move_or_ability_domain_signal).
held_item_pending_yield_predicate(strategy_domain_signal).
held_item_pending_yield_predicate(tournament_rules_domain_signal).
held_item_pending_yield_predicate(level_domain_signal).
held_item_pending_yield_predicate(modifier_domain_signal).
held_item_pending_yield_predicate(item_domain_signal).

held_item_next_option_request(Tokens) :-
    is_yes_response_tokens(Tokens),
    !.
held_item_next_option_request(Tokens) :-
    contiguous_sublist(["outra", "opcao"], Tokens),
    !.
held_item_next_option_request(Tokens) :-
    contiguous_sublist(["proxima", "opcao"], Tokens),
    !.
held_item_next_option_request(Tokens) :-
    member(Token, Tokens),
    held_item_next_option_token(Token),
    !.

held_item_next_option_token("outra").
held_item_next_option_token("proxima").
held_item_next_option_token("proximo").
held_item_next_option_token("seguinte").
held_item_next_option_token("alternativa").

held_item_consume_next_option(_TargetLabel, []) :-
    retractall(pending_held_item_options(_, _)),
    writeln('Bot: Não há mais opções no ranking atual de held item.').
held_item_consume_next_option(TargetLabel, [Recommendation | Rest]) :-
    print_held_item_recommendation_line(Recommendation),
    retractall(pending_held_item_options(_, _)),
    ( Rest == [] ->
        writeln('Bot: Essas eram as principais opções disponíveis neste ranking.')
    ; assertz(pending_held_item_options(TargetLabel, Rest)),
      format('Bot: Se quiser outra opção para ~w, peça "outra opção".~n', [TargetLabel])
    ).

parse_held_item_recommendation_query(Text, Name, Strategy) :-
    tokenize_for_match(Text, Tokens),
    held_item_intent_signal(Tokens),
    parse_held_item_target_name(Text, Tokens, Name),
    held_item_strategy_from_tokens(Tokens, Strategy).

parse_held_item_target_name(Text, _Tokens, Name) :-
    parse_natural_pokemon_query(Text, Name),
    !.
parse_held_item_target_name(_Text, Tokens, Name) :-
    held_item_guess_name_after_preposition(Tokens, Name),
    !.
parse_held_item_target_name(_Text, Tokens, Name) :-
    held_item_guess_name_from_tokens(Tokens, Name).

held_item_guess_name_after_preposition(Tokens, Name) :-
    append(_, [Prep | Tail], Tokens),
    member(Prep, ["de", "do", "da", "para", "pra", "pro"]),
    extract_name_from_tokens(Tail, Name),
    Name \= "".

held_item_guess_name_from_tokens(Tokens, Name) :-
    findall(Token,
        ( member(Token, Tokens),
          held_item_name_candidate_token(Token)
        ),
        CandidateTokens),
    CandidateTokens \= [],
    extract_name_from_tokens(CandidateTokens, Name),
    Name \= "".

held_item_name_candidate_token(Token) :-
    Token \= "",
    \+ name_stopword(Token),
    \+ item_intent_token(Token),
    \+ held_item_name_noise_token(Token).

held_item_name_noise_token("held").
held_item_name_noise_token("item").
held_item_name_noise_token("itens").
held_item_name_noise_token("melhor").
held_item_name_noise_token("recomendacao").
held_item_name_noise_token("recomendacoes").
held_item_name_noise_token("recomendar").
held_item_name_noise_token("recomendado").
held_item_name_noise_token("recomendados").
held_item_name_noise_token("forte").
held_item_name_noise_token("forca").
held_item_name_noise_token("potencializar").
held_item_name_noise_token("aumentar").
held_item_name_noise_token("dano").
held_item_name_noise_token("ofensivo").
held_item_name_noise_token("defensivo").
held_item_name_noise_token("balanceado").
held_item_name_noise_token("cobrir").
held_item_name_noise_token("cobertura").
held_item_name_noise_token("fraqueza").
held_item_name_noise_token("segurar").
held_item_name_noise_token("bulk").

held_item_intent_signal(Tokens) :-
    member(Token, Tokens),
    item_intent_token(Token),
    !.
held_item_intent_signal(Tokens) :-
    current_predicate(item_intent_phrase/1),
    item_intent_phrase(Phrase),
    contiguous_sublist(Phrase, Tokens),
    !.

held_item_strategy_from_tokens(Tokens, balanced) :-
    held_item_tokens_include_any(Tokens, ["forte", "forca", "potencializar", "aumentar", "dano", "ofensivo", "sweeper"]),
    held_item_tokens_include_any(Tokens, ["fraqueza", "cobrir", "cobertura", "defensivo", "defesa", "sobreviver", "segurar", "resistencia", "bulk"]),
    !.
held_item_strategy_from_tokens(Tokens, amplify_strength) :-
    held_item_tokens_include_any(Tokens, ["forte", "forca", "potencializar", "aumentar", "dano", "ofensivo", "sweeper", "ameaca"]),
    !.
held_item_strategy_from_tokens(Tokens, cover_weakness) :-
    held_item_tokens_include_any(Tokens, ["fraqueza", "cobrir", "cobertura", "defensivo", "defesa", "sobreviver", "segurar", "resistencia", "bulk", "mitigar"]),
    !.
held_item_strategy_from_tokens(_, balanced).

held_item_tokens_include_any(Tokens, Candidates) :-
    member(Token, Tokens),
    member(Token, Candidates),
    !.

answer_held_item_recommendation_query(NameIdentifier, Strategy) :-
    pokemon_info(NameIdentifier, pokemon(ID, NameAtom, _, _, Types, Abilities, Stats)),
    !,
    retractall(pending_held_item_options(_, _)),
    display_pokemon_name(NameAtom, NameLabel),
    held_item_recommendations_for_pokemon(ID, NameAtom, Types, Abilities, Stats, Strategy, Profile, ContextMatrix, Recommendations),
    held_item_strategy_label(Strategy, StrategyLabel),
    held_item_abilities_text(Abilities, AbilitiesText),
    remember_candidate_list([NameAtom]),
    format('Bot: Recomendação de held items para ~w (~w):~n', [NameLabel, StrategyLabel]),
    writeln('  - Critério: análise contextual em 6 camadas (sinergia habilidade-item, perfil oficial, densidade de evidências, quadro de possibilidades, ajuste de estratégia e ranking interno normalizado).'),
    print_held_item_profile_summary(Profile),
    format('  - Habilidades consideradas: ~w.~n', [AbilitiesText]),
    writeln('  - Quadro de possibilidades (perfil + habilidades + sinergias):'),
    print_held_item_context_matrix(ContextMatrix),
    writeln('  - Ranking contextual final:'),
    print_held_item_recommendation_preview(NameLabel, Recommendations),
    writeln('Bot: Quando eu citar moves, trate como exemplos de execução dentro do movepool possível, não como set obrigatório.').
answer_held_item_recommendation_query(NameIdentifier, Strategy) :-
    retractall(pending_held_item_options(_, _)),
    display_pokemon_name(NameIdentifier, NameLabel),
    format('Bot: Não consegui identificar o Pokémon para analisar held item (~w).~n', [NameLabel]),
    print_suggestion_for_identifier(held_item(Strategy), NameIdentifier).

held_item_abilities_text([], 'nenhuma habilidade catalogada').
held_item_abilities_text(Abilities, Text) :-
    maplist(display_label, Abilities, Labels),
    atomic_list_concat(Labels, ', ', Text).

print_held_item_profile_summary(Profile) :-
    held_item_bucket_label(Profile.official_bucket, BucketLabel),
    format('  - Classificação oficial detectada: ~w (~w).~n', [Profile.official_role_text, BucketLabel]),
    format('  - Eixos auxiliares de contexto (não substituem a classe oficial): wall ~w | breaker ~w | setup ~w | speed control ~w | suporte ~w | anti-contato ~w.~n',
        [Profile.wall, Profile.breaker, Profile.setup, Profile.speed_control, Profile.support, Profile.contact_punish]).

held_item_bucket_label(offensive, 'bucket ofensivo').
held_item_bucket_label(defensive, 'bucket defensivo').
held_item_bucket_label(support, 'bucket de suporte').
held_item_bucket_label(balanced, 'bucket equilibrado').

print_held_item_context_matrix([]) :-
    writeln('    * Contexto insuficiente para montar o quadro com confiança.').
print_held_item_context_matrix([context_row(Context, Weight, Entries) | Rest]) :-
    held_item_context_label(Context, ContextLabel),
    held_item_context_entries_text(Entries, EntriesText),
    format('    * ~w (peso ~w): ~w~n', [ContextLabel, Weight, EntriesText]),
    print_held_item_context_matrix_nonempty(Rest).

print_held_item_context_matrix_nonempty([]).
print_held_item_context_matrix_nonempty([context_row(Context, Weight, Entries) | Rest]) :-
    held_item_context_label(Context, ContextLabel),
    held_item_context_entries_text(Entries, EntriesText),
    format('    * ~w (peso ~w): ~w~n', [ContextLabel, Weight, EntriesText]),
    print_held_item_context_matrix_nonempty(Rest).

held_item_context_label(contact_punish, 'anti-contato').
held_item_context_label(long_game_wall, 'jogo longo defensivo').
held_item_context_label(setup_sweep, 'setup sweep').
held_item_context_label(breaker, 'break imediato').
held_item_context_label(speed_control, 'controle de velocidade').
held_item_context_label(support, 'suporte').

held_item_context_entries_text([], 'sem itens fortes nesse contexto').
held_item_context_entries_text(Entries, Text) :-
    findall(Label,
        ( member(Fit-Item, Entries),
          display_label(Item, ItemLabel),
          format(atom(Label), '~w [fit ~w]', [ItemLabel, Fit])
        ),
        Labels),
    atomic_list_concat(Labels, '; ', Text).

held_item_strategy_label(amplify_strength, 'foco em potencializar ponto forte').
held_item_strategy_label(cover_weakness, 'foco em cobrir fraquezas').
held_item_strategy_label(balanced, 'foco balanceado').

print_held_item_recommendation_lines([]) :-
    writeln('  - Não consegui pontuar itens com confiança na base atual para esse caso.').
print_held_item_recommendation_lines([Score-Item-Objective-Reason | Rest]) :-
    print_held_item_recommendation_line(Score-Item-Objective-Reason),
    print_held_item_recommendation_lines_nonempty(Rest).

print_held_item_recommendation_lines_nonempty([]).
print_held_item_recommendation_lines_nonempty([Score-Item-Objective-Reason | Rest]) :-
    print_held_item_recommendation_line(Score-Item-Objective-Reason),
    print_held_item_recommendation_lines_nonempty(Rest).

print_held_item_recommendation_preview(_TargetLabel, []) :-
    print_held_item_recommendation_lines([]),
    retractall(pending_held_item_options(_, _)).
print_held_item_recommendation_preview(TargetLabel, Recommendations) :-
    take_first_n(Recommendations, 3, InitialBatch),
    print_held_item_recommendation_lines(InitialBatch),
    ( append(InitialBatch, Remaining, Recommendations),
      Remaining \= [] ->
        length(Remaining, RemainingCount),
        retractall(pending_held_item_options(_, _)),
        assertz(pending_held_item_options(TargetLabel, Remaining)),
        format('Bot: Tenho mais ~w opção(ões) para ~w. Se quiser, peça "outra opção".~n', [RemainingCount, TargetLabel])
    ; retractall(pending_held_item_options(_, _))
    ).

print_held_item_recommendation_line(_Score-Item-Objective-Reason) :-
    display_label(Item, ItemLabel),
    held_item_objective_label(Objective, ObjectiveLabel),
    held_item_effect_text(Item, EffectText),
    format('  - ~w (~w): ~w. Efeito: ~w~n', [ItemLabel, ObjectiveLabel, Reason, EffectText]).

held_item_objective_label(strengthen, 'potencializar').
held_item_objective_label(cover_weakness, 'cobrir fraqueza').

held_item_effect_text(Item, EffectText) :-
    held_item_ensure_item_text_data_loaded,
    held_item_curated_description(Item, Description),
    !,
    held_item_short_effect(Description, EffectText).
held_item_effect_text(Item, EffectText) :-
    held_item_ensure_item_text_data_loaded,
    held_item_description(Item, Description),
    held_item_short_effect(Description, EffectText).

held_item_ensure_item_text_data_loaded :-
    ( current_predicate(held_item_effect/6) ->
        true
    ; held_item_try_ensure_loaded('db/generated/held_item_data_auto.pl')
    ; held_item_try_ensure_loaded('../db/generated/held_item_data_auto.pl')
    ; true
    ),
    ( current_predicate(item_entry/6) ->
        true
    ; held_item_try_ensure_loaded('db/catalogs/items_catalog.pl')
    ; held_item_try_ensure_loaded('../db/catalogs/items_catalog.pl')
    ; true
    ).

held_item_try_ensure_loaded(Path) :-
    catch(ensure_loaded(Path), _, fail).

held_item_curated_description(Item, Description) :-
    current_predicate(held_item_effect/6),
    held_item_effect(Item, _Category, _Trigger, _CombatModel, RawDescription, _Confidence),
    input_to_string(RawDescription, CuratedDescription),
    normalize_space(string(Normalized), CuratedDescription),
    Normalized \= "",
    Description = Normalized.

held_item_description(Item, Description) :-
    current_predicate(item_entry/6),
    item_entry(Item, _Category, _Cost, _FlingPower, _FlingEffect, RawDescription),
    !,
    input_to_string(RawDescription, Description).
held_item_description(_, 'Sem descrição curta disponível').

held_item_short_effect(Description, EffectText) :-
    ( sub_string(Description, Before, _Length, _After, '. ') ->
        sub_string(Description, 0, Before, _Rest, First)
    ; First = Description
    ),
    normalize_space(string(Normalized), First),
    held_item_strip_curation_prefix(Normalized, Cleaned),
    ( Cleaned == "" -> EffectText = Description ; EffectText = Cleaned ).

held_item_strip_curation_prefix(Text, Cleaned) :-
    Prefix = 'Curadoria automatica de held item:',
    ( sub_string(Text, 0, PrefixLength, _After, Prefix) ->
        sub_string(Text, PrefixLength, _RestLength, 0, RawTail),
        normalize_space(string(Tail), RawTail),
        Cleaned = Tail
    ; Cleaned = Text
    ).

held_item_ability_effect_text(Ability, EffectText) :-
    held_item_ensure_ability_text_data_loaded,
    current_predicate(ability_entry/5),
    ability_entry(Ability, _Generation, _IsMainSeries, RawShortEffect, _Effect),
    !,
    input_to_string(RawShortEffect, ShortEffectString),
    normalize_space(string(Normalized), ShortEffectString),
    ( Normalized == "" -> EffectText = 'Sem descricao curta disponivel para a habilidade.' ; EffectText = Normalized ).
held_item_ability_effect_text(_Ability, 'Sem descricao curta disponivel para a habilidade.').

held_item_ensure_ability_text_data_loaded :-
    ( current_predicate(ability_entry/5) ->
        true
    ; held_item_try_ensure_loaded('db/catalogs/abilities_catalog.pl')
    ; held_item_try_ensure_loaded('../db/catalogs/abilities_catalog.pl')
    ; true
    ).

held_item_recommendations_for_pokemon(ID, NameAtom, Types, Abilities, Stats, Strategy, Profile, ContextMatrix, Recommendations) :-
    current_generation_key(GenerationKey),
    ( cache_held_item_recommendation(GenerationKey, ID, Strategy, Profile, ContextMatrix, Recommendations) ->
        true
    ; held_item_recommendations_for_pokemon_uncached(ID, NameAtom, Types, Abilities, Stats, Strategy, Profile, ContextMatrix, Recommendations),
      assertz(cache_held_item_recommendation(GenerationKey, ID, Strategy, Profile, ContextMatrix, Recommendations))
    ).

held_item_recommendations_for_pokemon_uncached(ID, NameAtom, Types, Abilities, Stats, Strategy, Profile, ContextMatrix, Recommendations) :-
    pokemon_move_list_for_id(ID, NameAtom, MovesRaw, _Source),
    sort(MovesRaw, Moves),
    held_item_feature_pack(ID, Types, Abilities, Stats, Moves, Features),
    held_item_official_role_profile(NameAtom, Stats, OfficialRole, OfficialBucket, OfficialRoleText),
    held_item_build_profile(Features, OfficialRole, OfficialBucket, OfficialRoleText, Profile),
        held_item_context_weights(Features, Profile, ContextWeights),
        take_first_n(ContextWeights, 4, TopContextWeights),
        held_item_context_matrix(TopContextWeights, Features, ContextMatrix),
    ( held_item_forced_slot_item(ID, NameAtom, ForcedItem, ForcedReason) ->
        Recommendations = [1000-ForcedItem-strengthen-ForcedReason]
    ; findall(RawScore-Item-Objective-FinalReason,
            ( held_item_candidate_id(Item),
                held_item_candidate_score(Item, Features, balanced, BaseScore, BaseObjective, BaseReason),
                held_item_contextual_bonus(Strategy, ContextWeights, Item, Features, ContextBonus, ContextObjective, ContextReason),
                held_item_ability_item_bonus(Features.abilities, Item, AbilityBonus, AbilityReason),
                held_item_merge_objective(BaseObjective, ContextObjective, Objective),
                held_item_strategy_adjustment(Strategy, Objective, StrategyAdj),
                held_item_role_alignment_bonus(Profile, Objective, RoleAlignmentBonus),
                held_item_context_match_count(ContextWeights, Item, Features, ContextMatches),
                held_item_ability_match_count(Features.abilities, Item, AbilityMatches),
                held_item_evidence_density_bonus(ContextMatches, AbilityMatches, EvidenceBonus),
                RawScore is BaseScore + ContextBonus + AbilityBonus + StrategyAdj + RoleAlignmentBonus + EvidenceBonus,
                RawScore > 0,
                held_item_compose_reason(BaseReason, ContextReason, AbilityReason, FinalReason)
            ),
            ScoredRaw),
      ( ScoredRaw == [] ->
          Recommendations = []
      ; held_item_scale_recommendations_to_1000(ScoredRaw, ScaledRaw),
        keysort(ScaledRaw, ScoredAsc),
        reverse(ScoredAsc, ScoredDesc),
        take_first_n(ScoredDesc, 5, Recommendations)
      )
    ).

held_item_forced_slot_item(PokemonID, NameAtom, ForcedItem, Reason) :-
    held_item_required_mega_stone(PokemonID, NameAtom, ForcedItem),
    display_label(ForcedItem, ItemLabel),
    format(atom(Reason), 'forma Mega detectada: slot de held item fixo em ~w para manter a transformação', [ItemLabel]).

held_item_required_mega_stone(PokemonID, NameAtom, Item) :-
    held_item_mega_base_name(PokemonID, NameAtom, BaseName),
    held_item_mega_stone_for_base(BaseName, Item),
    held_item_is_competitive_slot_item(Item),
    !.

held_item_mega_base_name(PokemonID, _NameAtom, BaseName) :-
    current_predicate(pokemon_mega_base/2),
    current_predicate(pokemon/7),
    pokemon_mega_base(PokemonID, BaseID),
    pokemon(BaseID, BaseName, _Height, _Weight, _Types, _Abilities, _Stats),
    !.
held_item_mega_base_name(_PokemonID, NameAtom, BaseName) :-
    atom(NameAtom),
    sub_atom(NameAtom, Before, _Length, _After, '_mega'),
    sub_atom(NameAtom, 0, Before, _Rest, BaseName).

held_item_mega_stone_for_base(BaseName, Item) :-
    current_predicate(item_entry/6),
    item_entry(Item, mega_stones, _Cost, _FlingPower, _FlingEffect, RawDescription),
    held_item_extract_mega_stone_base_name(RawDescription, DescBaseName),
    held_item_species_key(BaseName, BaseKey),
    held_item_species_key(DescBaseName, DescKey),
    BaseKey == DescKey,
    !.

held_item_extract_mega_stone_base_name(RawDescription, BaseName) :-
    input_to_string(RawDescription, Description),
    split_string(Description, " ", ".,:;()[]\"'", TokensRaw),
    exclude(=(""), TokensRaw, Tokens),
    append(_, ["Allows", BaseToken | _], Tokens),
    BaseToken \= "",
    atom_string(BaseName, BaseToken).

held_item_species_key(Value, Key) :-
    input_to_string(Value, Raw),
    normalize_space(string(Spaced), Raw),
    string_lower(Spaced, Lower),
    split_string(Lower, " _-", "", PartsRaw),
    exclude(=(""), PartsRaw, Parts),
    atomic_list_concat(Parts, '_', Key).

held_item_scale_recommendations_to_1000(ScoredRaw, Scaled) :-
    findall(Score,
        member(Score-_-_-_, ScoredRaw),
        Scores),
    min_list(Scores, MinScore),
    max_list(Scores, MaxScore),
    findall(ScaledScore-Item-Objective-Reason,
        ( member(RawScore-Item-Objective-Reason, ScoredRaw),
          held_item_scale_score_to_1000(RawScore, MinScore, MaxScore, ScaledScore)
        ),
        Scaled).

held_item_scale_score_to_1000(_RawScore, MinScore, MaxScore, 1000) :-
    MaxScore =:= MinScore,
    !.
held_item_scale_score_to_1000(RawScore, MinScore, MaxScore, Scaled) :-
    Normalized is (RawScore - MinScore) / (MaxScore - MinScore),
    Scaled0 is round(Normalized * 1000.0),
    Scaled is max(0, min(1000, Scaled0)).

held_item_role_alignment_bonus(Profile, strengthen, Bonus) :-
    ( Profile.official_bucket == offensive -> Bonus = 16
    ; Profile.official_bucket == balanced -> Bonus = 8
    ; Bonus = 2
    ).
held_item_role_alignment_bonus(Profile, cover_weakness, Bonus) :-
    ( member(Profile.official_bucket, [defensive, support]) -> Bonus = 16
    ; Profile.official_bucket == balanced -> Bonus = 8
    ; Bonus = 2
    ).

held_item_context_match_count(ContextWeights, Item, Features, Count) :-
    findall(Context,
        ( member(_Weight-Context, ContextWeights),
          held_item_item_fit_in_context(Context, Item, Features, Fit, _Objective, _Reason),
          Fit > 0
        ),
        ContextsRaw),
    sort(ContextsRaw, Contexts),
    length(Contexts, Count).

held_item_ability_match_count(Abilities, Item, Count) :-
    findall(Ability,
        ( member(Ability, Abilities),
          held_item_ability_item_rule(Ability, Item, _Score, _Text)
        ),
        Raw),
    sort(Raw, Unique),
    length(Unique, Count).

held_item_evidence_density_bonus(ContextMatches, AbilityMatches, Bonus) :-
    Raw is (ContextMatches * 6) + (AbilityMatches * 10),
    Bonus is min(32, Raw).

held_item_feature_value(Features, Key, Default, Value) :-
    ( get_dict(Key, Features, Raw) -> Value = Raw ; Value = Default ).

held_item_move_labels_text([], 'movimento de execução').
held_item_move_labels_text(Moves, Text) :-
    take_first_n(Moves, 2, TopMoves),
    findall(Label,
        ( member(Move, TopMoves),
          display_label(Move, Label)
        ),
        Labels),
    atomic_list_concat(Labels, ', ', Text).

held_item_feature_pack(PokemonID, Types, Abilities, Stats, Moves, Features) :-
    offensive_bias(Stats, Bias),
    stat_value(Stats, attack, Atk),
    stat_value(Stats, special_attack, SpAtk),
    stat_value(Stats, speed, Speed),
    stat_value(Stats, hp, HP),
    stat_value(Stats, defense, Def),
    stat_value(Stats, special_defense, SpDef),
    OffensePeak is max(Atk, SpAtk),
    BulkAverage is (HP + Def + SpDef) / 3.0,
    combined_multiplier(rock, Types, RockWeakMult),
    held_item_collect_moves_by_role(Moves, pivot, PivotMoves),
    held_item_collect_moves_by_role(Moves, protection, ProtectMoves),
    held_item_bool_nonempty(PivotMoves, HasPivot),
    held_item_bool_nonempty(ProtectMoves, HasProtectTurn),
    held_item_move_category_counts(Moves, OffensiveCount, StatusCount),
    held_item_bool_has_role_move(Moves, setup_buff, HasSetup),
    held_item_bool_has_role_move(Moves, recovery, HasRecovery),
    held_item_bool_has_role_move(Moves, screen_control, HasScreens),
    held_item_bool_has_role_move(Moves, hazard, HasHazards),
    held_item_bool_has_any_move(Moves, [leech_seed], HasLeechSeed),
    held_item_bool_has_role_move(Moves, terrain_control, HasTerrainMove),
    held_item_bool_has_role_move(Moves, self_drop_pressure, HasSelfDropMove),
    held_item_bool_has_any_move(Moves, [facade], HasFacade),
    held_item_bool_has_any_move(Moves, [acrobatics], HasAcrobatics),
    held_item_bool_member(unburden, Abilities, HasUnburden),
    held_item_bool_member(guts, Abilities, HasGuts),
    held_item_bool_member(poison_heal, Abilities, HasPoisonHeal),
    held_item_bool_member(magic_guard, Abilities, HasMagicGuard),
    held_item_bool_member(regenerator, Abilities, HasRegenerator),
    held_item_bool_member(multiscale, Abilities, HasMultiscale),
    held_item_bool_member(sturdy, Abilities, HasSturdy),
    held_item_bool_has_weather_setter_ability(Abilities, HasWeatherSetterAbility),
    held_item_bool_has_terrain_setter_ability(Abilities, HasTerrainSetterAbility),
    held_item_bool_has_any_ability(Abilities, [iron_barbs, rough_skin, flame_body, static], HasContactPunishAbility),
    held_item_bool_member(poison, Types, IsPoisonType),
    held_item_bool_can_evolve(PokemonID, CanEvolve),
    PhysicalBulk is (HP + Def) / 2.0,
    SpecialBulk is (HP + SpDef) / 2.0,
    Features = held_features{
        bias:Bias,
        abilities:Abilities,
        offense_peak:OffensePeak,
        speed:Speed,
        bulk_avg:BulkAverage,
        physical_bulk:PhysicalBulk,
        special_bulk:SpecialBulk,
        rock_weak_mult:RockWeakMult,
        offensive_count:OffensiveCount,
        status_count:StatusCount,
        has_setup:HasSetup,
        has_recovery:HasRecovery,
        has_pivot:HasPivot,
        pivot_moves:PivotMoves,
        has_protect_turn:HasProtectTurn,
        protect_moves:ProtectMoves,
        has_screens:HasScreens,
        has_hazards:HasHazards,
        has_leech_seed:HasLeechSeed,
        has_terrain_move:HasTerrainMove,
        has_self_drop_move:HasSelfDropMove,
        has_facade:HasFacade,
        has_acrobatics:HasAcrobatics,
        has_unburden:HasUnburden,
        has_guts:HasGuts,
        has_poison_heal:HasPoisonHeal,
        has_magic_guard:HasMagicGuard,
        has_regenerator:HasRegenerator,
        has_multiscale:HasMultiscale,
        has_sturdy:HasSturdy,
        has_weather_setter_ability:HasWeatherSetterAbility,
        has_terrain_setter_ability:HasTerrainSetterAbility,
        has_contact_punish_ability:HasContactPunishAbility,
        is_poison_type:IsPoisonType,
        can_evolve:CanEvolve
    }.

held_item_collect_moves_by_role(Moves, Role, Collected) :-
    findall(Move,
        ( member(Move, Moves),
                    move_has_tactical_role(Move, Role)
        ),
        Raw),
    sort(Raw, Collected).

held_item_bool_nonempty([], false).
held_item_bool_nonempty([_ | _], true).

held_item_move_category_counts(Moves, OffensiveCount, StatusCount) :-
    findall(Category,
        ( member(Move, Moves),
          held_item_move_category(Move, Category)
        ),
        Categories),
    include(offensive_move_category, Categories, OffensiveCategories),
    length(OffensiveCategories, OffensiveCount),
    length(Categories, TotalCount),
    StatusCount is max(0, TotalCount - OffensiveCount).

held_item_move_category(Move, Category) :-
    move_data(Move, _Type, Category, _BasePower, _Accuracy, _PP, _Tags, _EffectChance, _Ailment, _EffectCategory, _Description),
    !.
held_item_move_category(_, status).

held_item_bool_has_any_move(Moves, CandidateMoves, true) :-
    has_any_move(Moves, CandidateMoves),
    !.
held_item_bool_has_any_move(_, _, false).

held_item_bool_has_role_move(Moves, Role, true) :-
    member(Move, Moves),
    move_has_tactical_role(Move, Role),
    !.
held_item_bool_has_role_move(_, _, false).

held_item_bool_member(Value, Values, true) :-
    member(Value, Values),
    !.
held_item_bool_member(_, _, false).

held_item_bool_has_any_ability(Abilities, CandidateAbilities, true) :-
    member(Ability, Abilities),
    member(Ability, CandidateAbilities),
    !.
held_item_bool_has_any_ability(_, _, false).

held_item_bool_has_weather_setter_ability(Abilities, true) :-
    member(Ability, Abilities),
    held_item_weather_setter_ability(Ability),
    !.
held_item_bool_has_weather_setter_ability(_, false).

held_item_bool_has_terrain_setter_ability(Abilities, true) :-
    member(Ability, Abilities),
    held_item_terrain_setter_ability(Ability),
    !.
held_item_bool_has_terrain_setter_ability(_, false).

held_item_weather_setter_ability(drought).
held_item_weather_setter_ability(desolate_land).
held_item_weather_setter_ability(orichalcum_pulse).
held_item_weather_setter_ability(drizzle).
held_item_weather_setter_ability(primordial_sea).
held_item_weather_setter_ability(sand_stream).
held_item_weather_setter_ability(snow_warning).

held_item_terrain_setter_ability(electric_surge).
held_item_terrain_setter_ability(grassy_surge).
held_item_terrain_setter_ability(misty_surge).
held_item_terrain_setter_ability(psychic_surge).
held_item_terrain_setter_ability(hadron_engine).

held_item_first_weather_setter_ability(Abilities, Ability) :-
    member(Ability, Abilities),
    held_item_weather_setter_ability(Ability),
    !.

held_item_first_terrain_setter_ability(Abilities, Ability) :-
    member(Ability, Abilities),
    held_item_terrain_setter_ability(Ability),
    !.

held_item_weather_execution_text(drizzle, 'chamando chuva que aumenta a pressao de golpes Water do time e reduz dano de golpes Fire').
held_item_weather_execution_text(primordial_sea, 'ativando chuva forte para ampliar pressao de golpes Water e travar linhas baseadas em Fire').
held_item_weather_execution_text(drought, 'chamando sol para elevar pressao de golpes Fire e controlar trocas no mid game').
held_item_weather_execution_text(desolate_land, 'ativando sol extremo para consolidar pressao ofensiva de Fire no ritmo da dupla').
held_item_weather_execution_text(orichalcum_pulse, 'chamando sol e reforcando ritmo ofensivo para a dupla').
held_item_weather_execution_text(sand_stream, 'ativando tempestade de areia para habilitar o plano de chip e resistencia do time').
held_item_weather_execution_text(snow_warning, 'ativando neve para habilitar planos de controle de ritmo e defesa do time').

held_item_bool_can_evolve(PokemonID, true) :-
    level_gate_species_id(PokemonID, SpeciesID),
    pokemon_evolution(SpeciesID, _ToID, _Trigger, _MinLevel, _Condition),
    !.
held_item_bool_can_evolve(_, false).

held_item_candidate_id(focus_sash).
held_item_candidate_id(life_orb).
held_item_candidate_id(choice_band).
held_item_candidate_id(choice_specs).
held_item_candidate_id(choice_scarf).
held_item_candidate_id(leftovers).
held_item_candidate_id(assault_vest).
held_item_candidate_id(heavy_duty_boots).
held_item_candidate_id(eviolite).
held_item_candidate_id(weakness_policy).
held_item_candidate_id(flame_orb).
held_item_candidate_id(toxic_orb).
held_item_candidate_id(black_sludge).
held_item_candidate_id(light_clay).
held_item_candidate_id(rocky_helmet).
held_item_candidate_id(electric_seed).
held_item_candidate_id(psychic_seed).
held_item_candidate_id(grassy_seed).
held_item_candidate_id(misty_seed).
held_item_candidate_id(white_herb).

held_item_strategy_adjustment(balanced, _Objective, 0).
held_item_strategy_adjustment(amplify_strength, strengthen, 12).
held_item_strategy_adjustment(amplify_strength, cover_weakness, -6).
held_item_strategy_adjustment(cover_weakness, cover_weakness, 12).
held_item_strategy_adjustment(cover_weakness, strengthen, -6).

held_item_bonus_if(Condition, TrueBonus, FalseBonus, Bonus) :-
    ( call(Condition) ->
        Bonus = TrueBonus
    ; Bonus = FalseBonus
    ).

held_item_candidate_score(focus_sash, Features, Strategy, Score, cover_weakness, Reason) :-
    Base = 30,
    held_item_bonus_if(Features.speed >= 100, 8, 0, SpeedBonus),
    held_item_bonus_if(Features.has_setup == true, 10, 0, SetupBonus),
    held_item_bonus_if(Features.bulk_avg =< 85, 8, 0, FragileBonus),
    held_item_bonus_if(Features.has_unburden == true, 32, 0, UnburdenBonus),
    held_item_bonus_if(Features.has_acrobatics == true, 8, 0, AcrobaticsBonus),
    held_item_strategy_adjustment(Strategy, cover_weakness, StrategyAdj),
    Score is Base + SpeedBonus + SetupBonus + FragileBonus + UnburdenBonus + AcrobaticsBonus + StrategyAdj,
    ( Features.has_unburden == true ->
        Reason = 'turno de sobrevivência garantido e ativação de Unburden após consumo, criando janela forte de setup'
    ; Reason = 'sobrevive a um golpe letal em HP cheio e compra um turno crítico para setup ou pressão inicial'
    ).

held_item_candidate_score(rocky_helmet, Features, Strategy, Score, cover_weakness,
    'pune ataques de contato e transforma o papel defensivo em pressão passiva constante') :-
    Base = 16,
    held_item_bonus_if(Features.has_contact_punish_ability == true, 34, 0, ContactAbilityBonus),
    held_item_bonus_if(Features.bulk_avg >= 95, 14, 4, BulkBonus),
    held_item_bonus_if(Features.speed =< 70, 6, 0, SlowWallBonus),
    held_item_strategy_adjustment(Strategy, cover_weakness, StrategyAdj),
    Score is Base + ContactAbilityBonus + BulkBonus + SlowWallBonus + StrategyAdj.

held_item_candidate_score(life_orb, Features, Strategy, Score, strengthen,
    'amplifica dano bruto e funciona melhor em kit ofensivo com vários golpes de ataque') :-
    Base = 26,
    held_item_bonus_if(Features.offense_peak >= 110, 16, 0, OffenseHighBonus),
    held_item_bonus_if(Features.offense_peak >= 95, 8, 0, OffenseMidBonus),
    OffenseBonus is max(OffenseHighBonus, OffenseMidBonus),
    held_item_bonus_if(Features.offensive_count >= 6, 10, 0, MoveHighBonus),
    held_item_bonus_if(Features.offensive_count >= 4, 5, 0, MoveMidBonus),
    MoveBonus is max(MoveHighBonus, MoveMidBonus),
    held_item_bonus_if(Features.has_setup == true, 6, 0, SetupBonus),
    held_item_bonus_if(Features.bulk_avg =< 78, -8, 0, BulkPenalty),
    held_item_strategy_adjustment(Strategy, strengthen, StrategyAdj),
    Score is Base + OffenseBonus + MoveBonus + SetupBonus + BulkPenalty + StrategyAdj.

held_item_candidate_score(choice_band, Features, Strategy, Score, strengthen,
    'eleva o teto de dano físico quando o movepool é majoritariamente ofensivo e pouco dependente de status') :-
    Base = 8,
    held_item_bonus_if(Features.bias == physical, 24, -18, BiasBonus),
    held_item_bonus_if(Features.offense_peak >= 120, 10, 0, OffenseHighBonus),
    held_item_bonus_if(Features.offense_peak >= 105, 5, 0, OffenseMidBonus),
    OffenseBonus is max(OffenseHighBonus, OffenseMidBonus),
    held_item_bonus_if(Features.status_count =< 2, 8, -10, StatusPenalty),
    held_item_bonus_if(Features.has_setup == true, -6, 0, SetupPenalty),
    held_item_strategy_adjustment(Strategy, strengthen, StrategyAdj),
    Score is Base + BiasBonus + OffenseBonus + StatusPenalty + SetupPenalty + StrategyAdj.

held_item_candidate_score(choice_specs, Features, Strategy, Score, strengthen,
    'eleva o teto de dano especial quando o movepool é majoritariamente ofensivo e pouco dependente de status') :-
    Base = 8,
    held_item_bonus_if(Features.bias == special, 24, -18, BiasBonus),
    held_item_bonus_if(Features.offense_peak >= 120, 10, 0, OffenseHighBonus),
    held_item_bonus_if(Features.offense_peak >= 105, 5, 0, OffenseMidBonus),
    OffenseBonus is max(OffenseHighBonus, OffenseMidBonus),
    held_item_bonus_if(Features.status_count =< 2, 8, -10, StatusPenalty),
    held_item_bonus_if(Features.has_setup == true, -6, 0, SetupPenalty),
    held_item_strategy_adjustment(Strategy, strengthen, StrategyAdj),
    Score is Base + BiasBonus + OffenseBonus + StatusPenalty + SetupPenalty + StrategyAdj.

held_item_candidate_score(choice_scarf, Features, Strategy, Score, cover_weakness, Reason) :-
    Base = 12,
    held_item_bonus_if(Features.speed < 95, 18, 0, SpeedLowBonus),
    held_item_bonus_if(Features.speed < 110, 10, -4, SpeedMidBonus),
    SpeedBonus is max(SpeedLowBonus, SpeedMidBonus),
    held_item_bonus_if(Features.offense_peak >= 100, 8, 0, OffenseBonus),
    held_item_bonus_if(Features.has_pivot == true, 6, 0, PivotBonus),
        held_item_bonus_if(Features.has_weather_setter_ability == true, 16, 0, WeatherSetterBonus),
        held_item_bonus_if(Features.has_terrain_setter_ability == true, 12, 0, TerrainSetterBonus),
        held_item_bonus_if((Features.has_pivot == true, Features.has_weather_setter_ability == true), 18, 0, WeatherPivotExecutionBonus),
        held_item_bonus_if((Features.has_pivot == true, Features.has_terrain_setter_ability == true), 12, 0, TerrainPivotExecutionBonus),
    held_item_strategy_adjustment(Strategy, cover_weakness, StrategyAdj),
        Score is Base + SpeedBonus + OffenseBonus + PivotBonus + WeatherSetterBonus + TerrainSetterBonus + WeatherPivotExecutionBonus + TerrainPivotExecutionBonus + StrategyAdj,
        held_item_feature_value(Features, pivot_moves, [], PivotMoves),
        held_item_move_labels_text(PivotMoves, PivotMoveText),
        held_item_feature_value(Features, abilities, [], Abilities),
        ( Features.has_pivot == true,
            Features.has_weather_setter_ability == true,
            held_item_first_weather_setter_ability(Abilities, WeatherAbility),
            held_item_weather_execution_text(WeatherAbility, WeatherText) ->
                display_label(WeatherAbility, WeatherAbilityLabel),
                format(atom(Reason), 'alinha velocidade e execução: ativa a habilidade ~w, ~w, e usa ~w para pivotar com segurança no mesmo ciclo', [WeatherAbilityLabel, WeatherText, PivotMoveText])
        ; Features.has_pivot == true,
          Features.has_terrain_setter_ability == true,
          held_item_first_terrain_setter_ability(Abilities, TerrainAbility) ->
                display_label(TerrainAbility, TerrainAbilityLabel),
                format(atom(Reason), 'alinha velocidade e execução: ativa a habilidade ~w para estabelecer terreno e usa ~w para reposicionar com segurança no mesmo ciclo', [TerrainAbilityLabel, PivotMoveText])
        ; Reason = 'corrige matchup de velocidade e melhora revenge kill em perfis ofensivos ou de pivot'
        ).

held_item_candidate_score(leftovers, Features, Strategy, Score, cover_weakness,
    'ganho passivo de HP por turno para aumentar consistência em trocas e jogos longos') :-
    Base = 18,
    held_item_bonus_if(Features.bulk_avg >= 95, 16, 0, BulkHighBonus),
    held_item_bonus_if(Features.bulk_avg >= 85, 8, 0, BulkMidBonus),
    BulkBonus is max(BulkHighBonus, BulkMidBonus),
    held_item_bonus_if(Features.has_recovery == true, 6, 0, RecoveryBonus),
    held_item_bonus_if(Features.status_count >= 3, 4, 0, UtilityBonus),
    held_item_strategy_adjustment(Strategy, cover_weakness, StrategyAdj),
    Score is Base + BulkBonus + RecoveryBonus + UtilityBonus + StrategyAdj.

held_item_candidate_score(assault_vest, Features, Strategy, Score, cover_weakness,
    'aumenta especial bulk em Pokémon com kit majoritariamente ofensivo e sem dependência de golpes de status') :-
    Base = 10,
    held_item_bonus_if(Features.status_count =< 1, 18, 0, StatusHighBonus),
    held_item_bonus_if(Features.status_count =< 2, 8, -14, StatusMidBonus),
    StatusBonus is max(StatusHighBonus, StatusMidBonus),
    held_item_bonus_if(Features.bulk_avg >= 85, 8, 0, BulkBonus),
    held_item_bonus_if(Features.has_setup == true, -8, 0, SetupPenalty),
    held_item_strategy_adjustment(Strategy, cover_weakness, StrategyAdj),
    Score is Base + StatusBonus + BulkBonus + SetupPenalty + StrategyAdj.

held_item_candidate_score(heavy_duty_boots, Features, Strategy, Score, cover_weakness,
    'remove pressão de hazards e facilita pivots repetidos durante a partida') :-
    Base = 10,
    held_item_bonus_if(Features.rock_weak_mult >= 4.0, 26, 0, RockHighBonus),
    held_item_bonus_if(Features.rock_weak_mult >= 2.0, 18, 0, RockMidBonus),
    RockBonus is max(RockHighBonus, RockMidBonus),
    held_item_bonus_if(Features.has_pivot == true, 8, 0, PivotBonus),
    held_item_bonus_if(Features.speed >= 100, 4, 0, SpeedBonus),
    held_item_strategy_adjustment(Strategy, cover_weakness, StrategyAdj),
    Score is Base + RockBonus + PivotBonus + SpeedBonus + StrategyAdj.

held_item_candidate_score(eviolite, Features, Strategy, Score, cover_weakness,
    'excelente para estágios não finalizados, elevando defesa física e especial simultaneamente') :-
    held_item_bonus_if(Features.can_evolve == true, 34, -50, Base),
    held_item_bonus_if(Features.bulk_avg >= 80, 12, 6, BulkBonus),
    held_item_strategy_adjustment(Strategy, cover_weakness, StrategyAdj),
    Score is Base + BulkBonus + StrategyAdj.

held_item_candidate_score(weakness_policy, Features, Strategy, Score, strengthen,
    'pune hits super efetivos e pode virar sweep quando o Pokémon aguenta o primeiro golpe') :-
    Base = 8,
    held_item_bonus_if(Features.bulk_avg >= 92, 12, 0, BulkBonus),
    held_item_bonus_if(Features.has_setup == true, 10, 0, SetupBonus),
    held_item_bonus_if(Features.offense_peak >= 110, 8, 0, OffenseBonus),
    held_item_strategy_adjustment(Strategy, strengthen, StrategyAdj),
    Score is Base + BulkBonus + SetupBonus + OffenseBonus + StrategyAdj.

held_item_candidate_score(flame_orb, Features, Strategy, Score, strengthen, Reason) :-
    held_item_bonus_if(Features.has_guts == true, 42, -30, Base),
    held_item_bonus_if(Features.has_facade == true, 10, 0, FacadeBonus),
    held_item_bonus_if(Features.has_protect_turn == true, 12, 0, ProtectActivationBonus),
    held_item_strategy_adjustment(Strategy, strengthen, StrategyAdj),
    Score is Base + FacadeBonus + ProtectActivationBonus + StrategyAdj,
    held_item_feature_value(Features, protect_moves, [], ProtectMoves),
    held_item_move_labels_text(ProtectMoves, ProtectMoveText),
    ( Features.has_guts == true,
      Features.has_protect_turn == true ->
        format(atom(Reason), 'ativa Guts com alta confiabilidade via ~w e ainda blinda contra outros status negativos', [ProtectMoveText])
    ; Features.has_guts == true ->
        Reason = 'ativa Guts e ajuda a blindar contra status negativos concorrentes, convertendo o turno inicial em pressão'
    ; Reason = 'sinergia situacional com Guts/Facade para transformar status em pressão ofensiva'
    ).

held_item_candidate_score(toxic_orb, Features, Strategy, Score, cover_weakness, Reason) :-
    held_item_bonus_if(Features.has_poison_heal == true, 40, -30, Base),
    held_item_bonus_if(Features.has_facade == true, 8, 0, FacadeBonus),
    held_item_bonus_if(Features.has_protect_turn == true, 10, 0, ProtectActivationBonus),
    held_item_strategy_adjustment(Strategy, cover_weakness, StrategyAdj),
    Score is Base + FacadeBonus + ProtectActivationBonus + StrategyAdj,
    held_item_feature_value(Features, protect_moves, [], ProtectMoves),
    held_item_move_labels_text(ProtectMoves, ProtectMoveText),
    ( Features.has_poison_heal == true,
      Features.has_protect_turn == true ->
        format(atom(Reason), 'ativa Poison Heal com consistência via ~w, estabilizando sustain desde o início', [ProtectMoveText])
    ; Features.has_poison_heal == true ->
        Reason = 'ativa Poison Heal para recuperação contínua e aumenta longevidade em trocas longas'
    ; Reason = 'sinergia situacional com Poison Heal para recuperação contínua e maior longevidade'
    ).

held_item_candidate_score(black_sludge, Features, Strategy, Score, cover_weakness,
    'recuperação passiva sólida para tipos Poison em jogos longos') :-
    held_item_bonus_if(Features.is_poison_type == true, 24, -25, Base),
    held_item_bonus_if(Features.bulk_avg >= 85, 6, 0, BulkBonus),
    held_item_strategy_adjustment(Strategy, cover_weakness, StrategyAdj),
    Score is Base + BulkBonus + StrategyAdj.

held_item_candidate_score(light_clay, Features, Strategy, Score, cover_weakness,
    'estende Reflect/Light Screen para suporte de equipe quando o kit já usa telas') :-
    held_item_bonus_if(Features.has_screens == true, 30, -20, Base),
    held_item_strategy_adjustment(Strategy, cover_weakness, StrategyAdj),
    Score is Base + StrategyAdj.

held_item_candidate_score(electric_seed, Features, Strategy, Score, strengthen,
    'consumível que ativa Unburden e melhora bulk físico quando há Electric Terrain') :-
    held_item_bonus_if(Features.has_unburden == true, 34, -12, Base),
    held_item_bonus_if(Features.has_setup == true, 10, 0, SetupBonus),
    held_item_bonus_if(Features.has_terrain_move == true, 14, 0, TerrainSelfBonus),
    held_item_strategy_adjustment(Strategy, strengthen, StrategyAdj),
    Score is Base + SetupBonus + TerrainSelfBonus + StrategyAdj.

held_item_candidate_score(psychic_seed, Features, Strategy, Score, strengthen,
    'consumível que ativa Unburden e melhora bulk especial quando há Psychic Terrain') :-
    held_item_bonus_if(Features.has_unburden == true, 34, -12, Base),
    held_item_bonus_if(Features.has_setup == true, 10, 0, SetupBonus),
    held_item_bonus_if(Features.has_terrain_move == true, 14, 0, TerrainSelfBonus),
    held_item_strategy_adjustment(Strategy, strengthen, StrategyAdj),
    Score is Base + SetupBonus + TerrainSelfBonus + StrategyAdj.

held_item_candidate_score(grassy_seed, Features, Strategy, Score, strengthen,
    'consumível que ativa Unburden e melhora bulk físico quando há Grassy Terrain') :-
    held_item_bonus_if(Features.has_unburden == true, 34, -12, Base),
    held_item_bonus_if(Features.has_setup == true, 10, 0, SetupBonus),
    held_item_bonus_if(Features.has_terrain_move == true, 14, 0, TerrainSelfBonus),
    held_item_strategy_adjustment(Strategy, strengthen, StrategyAdj),
    Score is Base + SetupBonus + TerrainSelfBonus + StrategyAdj.

held_item_candidate_score(misty_seed, Features, Strategy, Score, strengthen,
    'consumível que ativa Unburden e melhora bulk especial quando há Misty Terrain') :-
    held_item_bonus_if(Features.has_unburden == true, 34, -12, Base),
    held_item_bonus_if(Features.has_setup == true, 10, 0, SetupBonus),
    held_item_bonus_if(Features.has_terrain_move == true, 14, 0, TerrainSelfBonus),
    held_item_strategy_adjustment(Strategy, strengthen, StrategyAdj),
    Score is Base + SetupBonus + TerrainSelfBonus + StrategyAdj.

held_item_candidate_score(white_herb, Features, Strategy, Score, strengthen,
    'mitiga queda de status e pode ativar Unburden em sets com Close Combat/Superpower') :-
    held_item_bonus_if(Features.has_self_drop_move == true, 34, -8, Base),
    held_item_bonus_if(Features.has_unburden == true, 24, 0, UnburdenBonus),
    held_item_bonus_if(Features.has_setup == true, 8, 0, SetupBonus),
    held_item_strategy_adjustment(Strategy, strengthen, StrategyAdj),
    Score is Base + UnburdenBonus + SetupBonus + StrategyAdj.

held_item_official_role_profile(Identifier, Stats, OfficialRole, OfficialBucket, OfficialRoleText) :-
    compare_role_key(Identifier, Stats, OfficialRole, OfficialBucket),
    role_label(OfficialRole, OfficialRoleText),
    !.
held_item_official_role_profile(_Identifier, _Stats, balanced, balanced, 'Equilibrado (perfil misto sem extremo dominante)').

held_item_build_profile(Features, OfficialRole, OfficialBucket, OfficialRoleText, Profile) :-
    held_item_bonus_if(Features.bulk_avg >= 105, 32, 0, WallBulkHigh),
    held_item_bonus_if(Features.bulk_avg >= 92, 18, 0, WallBulkMid),
    WallBulkBonus is max(WallBulkHigh, WallBulkMid),
    held_item_bonus_if(Features.has_recovery == true, 16, 0, WallRecoveryBonus),
    held_item_bonus_if(Features.has_hazards == true, 12, 0, WallHazardBonus),
    held_item_bonus_if(Features.has_leech_seed == true, 10, 0, WallLeechSeedBonus),
    held_item_bonus_if(Features.speed =< 65, 8, 0, WallSlowBonus),
    WallRaw is WallBulkBonus + WallRecoveryBonus + WallHazardBonus + WallLeechSeedBonus + WallSlowBonus,
    held_item_cap_score(WallRaw, WallScore),

    held_item_bonus_if(Features.offense_peak >= 125, 42, 0, BreakerOffenseHigh),
    held_item_bonus_if(Features.offense_peak >= 108, 28, 0, BreakerOffenseMid),
    BreakerOffenseBonus is max(BreakerOffenseHigh, BreakerOffenseMid),
    held_item_bonus_if(Features.offensive_count >= 6, 16, 8, BreakerMoveBonus),
    held_item_bonus_if(Features.speed >= 90, 10, 0, BreakerSpeedBonus),
    BreakerRaw is BreakerOffenseBonus + BreakerMoveBonus + BreakerSpeedBonus,
    held_item_cap_score(BreakerRaw, BreakerScore),

    held_item_bonus_if(Features.has_setup == true, 34, 0, SetupBaseBonus),
    held_item_bonus_if(Features.offense_peak >= 105, 20, 0, SetupOffenseBonus),
    held_item_bonus_if(Features.speed >= 80, 12, 0, SetupSpeedBonus),
    SetupRaw is SetupBaseBonus + SetupOffenseBonus + SetupSpeedBonus,
    held_item_cap_score(SetupRaw, SetupScore),

    held_item_bonus_if(Features.speed < 70, 34, 0, SpeedControlSlowBonus),
    held_item_bonus_if(Features.speed < 95, 18, 0, SpeedControlMidBonus),
    SpeedControlBase is max(SpeedControlSlowBonus, SpeedControlMidBonus),
    held_item_bonus_if(Features.offense_peak >= 100, 12, 0, SpeedControlOffenseBonus),
    held_item_bonus_if(Features.has_pivot == true, 10, 0, SpeedControlPivotBonus),
    SpeedControlRaw is SpeedControlBase + SpeedControlOffenseBonus + SpeedControlPivotBonus,
    held_item_cap_score(SpeedControlRaw, SpeedControlScore),

    held_item_bonus_if(Features.has_screens == true, 34, 0, SupportScreensBonus),
    held_item_bonus_if(Features.has_hazards == true, 24, 0, SupportHazardsBonus),
    held_item_bonus_if(Features.has_pivot == true, 12, 0, SupportPivotBonus),
    held_item_bonus_if(Features.status_count >= 3, 8, 0, SupportStatusBonus),
    SupportRaw is SupportScreensBonus + SupportHazardsBonus + SupportPivotBonus + SupportStatusBonus,
    held_item_cap_score(SupportRaw, SupportScore),

    held_item_bonus_if(Features.has_contact_punish_ability == true, 58, 0, ContactAbilityScore),
    held_item_bonus_if(Features.bulk_avg >= 95, 20, 0, ContactBulkScore),
    held_item_bonus_if(Features.speed =< 70, 8, 0, ContactSlowScore),
    ContactRaw is ContactAbilityScore + ContactBulkScore + ContactSlowScore,
    held_item_cap_score(ContactRaw, ContactPunishScore),

    Profile = held_profile{
        official_role:OfficialRole,
        official_bucket:OfficialBucket,
        official_role_text:OfficialRoleText,
        wall:WallScore,
        breaker:BreakerScore,
        setup:SetupScore,
        speed_control:SpeedControlScore,
        support:SupportScore,
        contact_punish:ContactPunishScore
    }.

held_item_cap_score(Value, Capped) :-
    Limited is max(0.0, min(100.0, Value)),
    Capped is round(Limited).

held_item_context_weights(_Features, Profile, ContextWeights) :-
    held_item_official_role_context_boosts(Profile.official_role, RoleBoosts),
    held_item_context_weight(Profile.wall, RoleBoosts, long_game_wall, WallWeight),
    held_item_context_weight(Profile.breaker, RoleBoosts, breaker, BreakerWeight),
    held_item_context_weight(Profile.setup, RoleBoosts, setup_sweep, SetupWeight),
    held_item_context_weight(Profile.speed_control, RoleBoosts, speed_control, SpeedControlWeight),
    held_item_context_weight(Profile.support, RoleBoosts, support, SupportWeight),
    held_item_context_weight(Profile.contact_punish, RoleBoosts, contact_punish, ContactWeight),
    Raw = [
        ContactWeight-contact_punish,
        WallWeight-long_game_wall,
        SetupWeight-setup_sweep,
        BreakerWeight-breaker,
        SpeedControlWeight-speed_control,
        SupportWeight-support
    ],
    findall(Weight-Context,
        ( member(Weight-Context, Raw),
          Weight >= 10
        ),
        Filtered),
    keysort(Filtered, SortedAsc),
    reverse(SortedAsc, ContextWeights).

held_item_context_weight(Base, RoleBoosts, Context, FinalWeight) :-
    held_item_context_boost(RoleBoosts, Context, Boost),
    Raw is Base + Boost,
    held_item_cap_score(Raw, FinalWeight).

held_item_context_boost(RoleBoosts, Context, Boost) :-
    member(Context-Boost, RoleBoosts),
    !.
held_item_context_boost(_RoleBoosts, _Context, 0).

held_item_official_role_context_boosts(physical_wall,
    [long_game_wall-35, contact_punish-20, support-10]).
held_item_official_role_context_boosts(special_wall,
    [long_game_wall-35, support-12]).
held_item_official_role_context_boosts(tank,
    [long_game_wall-28, breaker-12, contact_punish-8]).
held_item_official_role_context_boosts(setup_sweeper,
    [setup_sweep-32, breaker-18, speed_control-8]).
held_item_official_role_context_boosts(physical_sweeper,
    [breaker-34, speed_control-18, setup_sweep-8]).
held_item_official_role_context_boosts(special_sweeper,
    [breaker-34, speed_control-18, setup_sweep-8]).
held_item_official_role_context_boosts(lead,
    [support-20, speed_control-15, breaker-8]).
held_item_official_role_context_boosts(hazard_setter,
    [support-34, long_game_wall-14]).
held_item_official_role_context_boosts(hazard_remover,
    [support-30, speed_control-12]).
held_item_official_role_context_boosts(pivot_volt_turn,
    [support-24, speed_control-24, breaker-8]).
held_item_official_role_context_boosts(cleric,
    [support-34, long_game_wall-16]).
held_item_official_role_context_boosts(support_utility,
    [support-34, long_game_wall-10, speed_control-8]).
held_item_official_role_context_boosts(balanced,
    [long_game_wall-8, breaker-8, setup_sweep-8, speed_control-8, support-8, contact_punish-8]).

held_item_context_matrix(ContextWeights, Features, Matrix) :-
    findall(context_row(Context, Weight, TopEntries),
        ( member(Weight-Context, ContextWeights),
          Weight >= 18,
          findall(Fit-Item,
            ( held_item_candidate_id(Item),
              held_item_item_fit_in_context(Context, Item, Features, Fit, _Objective, _Reason),
              Fit > 0
            ),
            FitsRaw),
          FitsRaw \= [],
          keysort(FitsRaw, FitsAsc),
          reverse(FitsAsc, FitsDesc),
          take_first_n(FitsDesc, 3, TopEntries)
        ),
        Matrix).

held_item_strategy_context_multiplier(balanced, _Context, 1.0).
held_item_strategy_context_multiplier(amplify_strength, breaker, 1.25).
held_item_strategy_context_multiplier(amplify_strength, setup_sweep, 1.25).
held_item_strategy_context_multiplier(amplify_strength, speed_control, 1.10).
held_item_strategy_context_multiplier(amplify_strength, support, 0.80).
held_item_strategy_context_multiplier(amplify_strength, long_game_wall, 0.75).
held_item_strategy_context_multiplier(amplify_strength, contact_punish, 0.80).
held_item_strategy_context_multiplier(cover_weakness, contact_punish, 1.30).
held_item_strategy_context_multiplier(cover_weakness, long_game_wall, 1.25).
held_item_strategy_context_multiplier(cover_weakness, support, 1.10).
held_item_strategy_context_multiplier(cover_weakness, speed_control, 1.00).
held_item_strategy_context_multiplier(cover_weakness, setup_sweep, 0.75).
held_item_strategy_context_multiplier(cover_weakness, breaker, 0.70).

held_item_contextual_bonus(Strategy, ContextWeights, Item, Features, Bonus, Objective, Reason) :-
    findall(Contribution-LocalObjective-LocalReason,
        ( member(Weight-Context, ContextWeights),
          held_item_item_fit_in_context(Context, Item, Features, Fit, LocalObjective, LocalReason),
          held_item_strategy_context_multiplier(Strategy, Context, Multiplier),
          Contribution is (Weight * Fit * Multiplier) / 100.0
        ),
        Contributions),
    ( Contributions == [] ->
        Bonus = 0,
        Objective = none,
        Reason = ''
    ; keysort(Contributions, SortedAsc),
      reverse(SortedAsc, SortedDesc),
      SortedDesc = [_BestContribution-Objective-Reason | _],
      findall(Value, member(Value-_-_, SortedDesc), Values),
      sum_list(Values, Total),
      Bonus is Total / 5.0
    ).

held_item_ability_item_bonus(Abilities, Item, Bonus, Reason) :-
        held_item_is_competitive_slot_item(Item),
        !,
    findall(Score-Ability-Text,
        ( member(Ability, Abilities),
          held_item_ability_item_rule(Ability, Item, Score, Text)
        ),
        Synergies),
    ( Synergies == [] ->
        Bonus = 0,
        Reason = ''
    ; findall(Value, member(Value-_-_, Synergies), Values),
      sum_list(Values, Bonus),
      keysort(Synergies, SynergyAsc),
      reverse(SynergyAsc, [_TopScore-TopAbility-TopText | _]),
      display_label(TopAbility, AbilityLabel),
      format(atom(Reason), 'sinergia direta com ~w: ~w', [AbilityLabel, TopText])
    ).
held_item_ability_item_bonus(_Abilities, _Item, 0, '').

held_item_ability_compatible_item(Ability, Item, Score, Reason) :-
    held_item_candidate_id(Item),
    held_item_is_competitive_slot_item(Item),
    held_item_ability_item_rule(Ability, Item, Score, Reason).

held_item_top_compatible_items_for_ability(Ability, TopN, Recommendations) :-
    findall(Score-Item-Reason,
        held_item_ability_compatible_item(Ability, Item, Score, Reason),
        Raw),
    keysort(Raw, SortedAsc),
    reverse(SortedAsc, SortedDesc),
    ( integer(TopN), TopN > 0 ->
        take_first_n(SortedDesc, TopN, Recommendations)
    ; Recommendations = SortedDesc
    ).

held_item_ability_compatible_item_marker_based(Ability, Item, Score, Reason) :-
    held_item_is_competitive_slot_item(Item),
    \+ held_item_item_weather_conflicts_with_ability(Ability, Item),
    \+ held_item_item_weather_domain_without_match(Ability, Item),
    held_item_ability_marker_overlap_score(Ability, Item, Score, Reason),
    Score > 0.

held_item_top_compatible_items_for_ability_marker_based(Ability, TopN, Recommendations) :-
    held_item_top_compatible_items_for_ability_marker_based_scored(Ability, TopN, ScoredRecommendations),
    held_item_marker_based_ranked_recommendations(ScoredRecommendations, Recommendations).

held_item_top_compatible_items_for_ability_marker_based_scored(Ability, TopN, Recommendations) :-
    findall(Score-Item-Reason,
        held_item_ability_compatible_item_marker_based(Ability, Item, Score, Reason),
        Raw),
    keysort(Raw, SortedAsc),
    reverse(SortedAsc, SortedDesc),
    held_item_deduplicate_scored_recommendations(SortedDesc, DeduplicatedDesc),
    ( integer(TopN), TopN > 0 ->
        take_first_n(DeduplicatedDesc, TopN, Recommendations)
    ; Recommendations = DeduplicatedDesc
    ).

held_item_deduplicate_scored_recommendations(ScoredRecommendations, Deduplicated) :-
    held_item_deduplicate_scored_recommendations(ScoredRecommendations, [], Deduplicated).

held_item_deduplicate_scored_recommendations([], _Seen, []).
held_item_deduplicate_scored_recommendations([Score-Item-Reason | Rest], Seen,
    Deduplicated) :-
    held_item_recommendation_signature(Item, Reason, Signature),
    ( memberchk(Signature, Seen) ->
        held_item_deduplicate_scored_recommendations(Rest, Seen, Deduplicated)
    ; Deduplicated = [Score-Item-Reason | Tail],
      held_item_deduplicate_scored_recommendations(Rest, [Signature | Seen], Tail)
    ).

held_item_recommendation_signature(Item, _Reason, Signature) :-
    held_item_effect_text(Item, EffectText),
    EffectText \= 'Sem descrição curta disponível',
    input_to_string(EffectText, EffectString),
    normalize_space(string(NormalizedEffect), EffectString),
    Signature = effect(NormalizedEffect),
    !.
held_item_recommendation_signature(Item, Reason, Signature) :-
    Signature = fallback(Item, Reason).

held_item_marker_based_ranked_recommendations(ScoredRecommendations, RankedRecommendations) :-
    held_item_marker_based_ranked_recommendations(ScoredRecommendations, 1, RankedRecommendations).

held_item_marker_based_ranked_recommendations([], _Index, []).
held_item_marker_based_ranked_recommendations([_Score-Item-Reason | Rest], Index,
    [indicacao(RankLabel, Item, Reason, EffectText) | RankedRest]) :-
    held_item_recommendation_rank_label(Index, RankLabel),
    held_item_effect_text(Item, EffectText),
    NextIndex is Index + 1,
    held_item_marker_based_ranked_recommendations(Rest, NextIndex, RankedRest).

held_item_recommendation_rank_label(Index, RankLabel) :-
    format(atom(RankLabel), '~wa indicacao', [Index]).

held_item_print_top_compatible_items_for_ability_marker_based(Ability, TopN) :-
    held_item_top_compatible_items_for_ability_marker_based(Ability, TopN, Recommendations),
    display_label(Ability, AbilityLabel),
    held_item_ability_effect_text(Ability, AbilityEffectText),
    format('Bot: Indicacoes de held item para a habilidade ~w~n', [AbilityLabel]),
    format('  - efeito da habilidade: ~w~n', [AbilityEffectText]),
    held_item_print_marker_based_ranked_recommendations(Recommendations).

held_item_print_marker_based_ranked_recommendations([]) :-
    writeln('  - Nenhuma indicacao com confianca suficiente.').
held_item_print_marker_based_ranked_recommendations([indicacao(RankLabel, Item, Reason, EffectText) | Rest]) :-
    display_label(Item, ItemLabel),
    format('  - ~w: ~w~n', [RankLabel, ItemLabel]),
    format('    sinergia: ~w~n', [Reason]),
    format('    efeito: ~w~n', [EffectText]),
    held_item_print_marker_based_ranked_recommendations_nonempty(Rest).

held_item_print_marker_based_ranked_recommendations_nonempty([]).
held_item_print_marker_based_ranked_recommendations_nonempty([indicacao(RankLabel, Item, Reason, EffectText) | Rest]) :-
    display_label(Item, ItemLabel),
    format('  - ~w: ~w~n', [RankLabel, ItemLabel]),
    format('    sinergia: ~w~n', [Reason]),
    format('    efeito: ~w~n', [EffectText]),
    held_item_print_marker_based_ranked_recommendations_nonempty(Rest).

held_item_weather_condition_marker(Condition) :-
    held_item_weather_condition_key(Condition, _).

held_item_weather_condition_key(Condition, Key) :-
    atom(Condition),
    ( atom_concat(weather_, RawKey, Condition) ->
        held_item_weather_key_alias(RawKey, Key)
    ; held_item_weather_key_alias(Condition, Key)
    ).

held_item_weather_key_alias(rain, weather_rain).
held_item_weather_key_alias(sun, weather_sun).
held_item_weather_key_alias(sand, weather_sand).
held_item_weather_key_alias(snow, weather_snow).
held_item_weather_key_alias(hail, weather_snow).
held_item_weather_key_alias(weather_rain, weather_rain).
held_item_weather_key_alias(weather_sun, weather_sun).
held_item_weather_key_alias(weather_sand, weather_sand).
held_item_weather_key_alias(weather_snow, weather_snow).

held_item_ability_weather_condition(Ability, WeatherCondition) :-
    current_predicate(ability_marker/3),
    ability_marker(Ability, condition, RawCondition),
    held_item_weather_condition_key(RawCondition, WeatherCondition).
held_item_ability_weather_condition(Ability, WeatherCondition) :-
    held_item_ability_weather_affinity(Ability, WeatherCondition).

held_item_ability_weather_affinity(drizzle, weather_rain).
held_item_ability_weather_affinity(primordial_sea, weather_rain).
held_item_ability_weather_affinity(swift_swim, weather_rain).
held_item_ability_weather_affinity(rain_dish, weather_rain).
held_item_ability_weather_affinity(hydration, weather_rain).
held_item_ability_weather_affinity(drought, weather_sun).
held_item_ability_weather_affinity(desolate_land, weather_sun).
held_item_ability_weather_affinity(orichalcum_pulse, weather_sun).
held_item_ability_weather_affinity(chlorophyll, weather_sun).
held_item_ability_weather_affinity(leaf_guard, weather_sun).
held_item_ability_weather_affinity(solar_power, weather_sun).
held_item_ability_weather_affinity(harvest, weather_sun).
held_item_ability_weather_affinity(sand_stream, weather_sand).
held_item_ability_weather_affinity(sand_rush, weather_sand).
held_item_ability_weather_affinity(sand_force, weather_sand).
held_item_ability_weather_affinity(sand_veil, weather_sand).
held_item_ability_weather_affinity(sand_spit, weather_sand).
held_item_ability_weather_affinity(snow_warning, weather_snow).
held_item_ability_weather_affinity(slush_rush, weather_snow).
held_item_ability_weather_affinity(snow_cloak, weather_snow).
held_item_ability_weather_affinity(ice_body, weather_snow).
held_item_ability_weather_affinity(ice_face, weather_snow).

held_item_weather_related_ability(Ability) :-
    held_item_weather_setter_ability(Ability),
    !.
held_item_weather_related_ability(Ability) :-
    held_item_ability_weather_condition(Ability, _).

held_item_item_weather_condition(Item, WeatherCondition) :-
    item_marker(Item, condition, RawCondition),
    held_item_weather_condition_key(RawCondition, WeatherCondition).
held_item_item_weather_condition(Item, WeatherCondition) :-
    item_marker(Item, relation_hook, RawCondition),
    held_item_weather_condition_key(RawCondition, WeatherCondition).
held_item_item_weather_condition(Item, WeatherCondition) :-
    current_predicate(held_item_effect/6),
    held_item_effect(Item, _Category, _Trigger, CombatModel, _Description, _Confidence),
    member(condition-RawCondition, CombatModel),
    held_item_weather_condition_key(RawCondition, WeatherCondition).
held_item_item_weather_condition(Item, WeatherCondition) :-
    current_predicate(held_item_effect/6),
    held_item_effect(Item, _Category, _Trigger, CombatModel, _Description, _Confidence),
    member(relation_hook-RawCondition, CombatModel),
    held_item_weather_condition_key(RawCondition, WeatherCondition).

held_item_item_has_weather_condition(Item) :-
    held_item_item_weather_condition(Item, _).

held_item_item_matches_ability_weather(Ability, Item) :-
    held_item_ability_weather_condition(Ability, AbilityWeather),
    held_item_item_weather_condition(Item, AbilityWeather).

held_item_item_weather_conflicts_with_ability(Ability, Item) :-
    held_item_weather_related_ability(Ability),
    held_item_item_has_weather_condition(Item),
    \+ held_item_item_matches_ability_weather(Ability, Item).

held_item_item_weather_domain_without_match(Ability, Item) :-
    held_item_weather_related_ability(Ability),
    item_marker(Item, domain, weather),
    \+ held_item_item_matches_ability_weather(Ability, Item).

held_item_domain_marker_is_compatible(Ability, Item, weather) :-
    held_item_weather_related_ability(Ability),
    !,
    held_item_item_matches_ability_weather(Ability, Item).
held_item_domain_marker_is_compatible(_Ability, _Item, weather) :-
    !,
    fail.
held_item_domain_marker_is_compatible(_Ability, _Item, _Domain).

held_item_weather_condition_type(weather_rain, water).
held_item_weather_condition_type(weather_sun, fire).
held_item_weather_condition_type(weather_sand, rock).
held_item_weather_condition_type(weather_snow, ice).

held_item_weather_type_amplification_reason(WeatherCondition, TypeHint, Item, Reason) :-
    display_label(Item, ItemLabel),
    display_label(WeatherCondition, WeatherLabel),
    display_label(TypeHint, TypeLabel),
    held_item_weather_item_specific_detail(Item, Detail),
    format(atom(Reason),
        'amplificacao apos ativacao com ~w: clima ~w favorece pressao de golpes ~w; ~w',
        [ItemLabel, WeatherLabel, TypeLabel, Detail]).

held_item_weather_item_specific_detail(Item, Detail) :-
    held_item_item_family_tag(Item, FamilyTag),
    held_item_marker_signature(Item, Signature),
    format(atom(Detail), 'perfil ~w com assinatura tatica: ~w', [FamilyTag, Signature]).

held_item_item_family_tag(Item, 'incense') :-
    atom_concat(_, '_incense', Item),
    !.
held_item_item_family_tag(Item, 'plate') :-
    atom_concat(_, '_plate', Item),
    !.
held_item_item_family_tag(Item, 'orb') :-
    atom_concat(_, '_orb', Item),
    !.
held_item_item_family_tag(_Item, 'geral').

held_item_marker_signature(Item, Signature) :-
    findall(Label,
        held_item_marker_signature_label(Item, Label),
        RawLabels),
    sort(RawLabels, Labels),
    ( Labels == [] ->
        Signature = 'perfil utilitario contextual'
    ; atomic_list_concat(Labels, ', ', Signature)
    ).

held_item_marker_signature_label(Item, Label) :-
    item_marker(Item, modifier_kind, ModifierKind),
    display_label(ModifierKind, ModifierLabel),
    format(atom(Label), 'modificador ~w', [ModifierLabel]).
held_item_marker_signature_label(Item, Label) :-
    item_marker(Item, trigger, Trigger),
    display_label(Trigger, TriggerLabel),
    format(atom(Label), 'gatilho ~w', [TriggerLabel]).
held_item_marker_signature_label(Item, Label) :-
    item_marker(Item, item_role, Role),
    display_label(Role, RoleLabel),
    format(atom(Label), 'papel ~w', [RoleLabel]).

held_item_ability_marker_overlap_score(Ability, Item, Score, Reason) :-
    current_predicate(ability_marker/3),
    current_predicate(item_marker/3),
    findall(Value-Text,
        held_item_ability_item_marker_signal(Ability, Item, Value, Text),
        RawSignals),
    RawSignals \= [],
    sort(RawSignals, Signals),
    findall(Value, member(Value-_, Signals), Values),
    sum_list(Values, Total),
    findall(Penalty-PenaltyReason,
        held_item_ability_item_marker_penalty(Ability, Item, Penalty, PenaltyReason),
        Penalties),
    findall(PenaltyValue, member(PenaltyValue-_, Penalties), PenaltyValues),
    sum_list(PenaltyValues, PenaltyTotal),
    ScoreWithPenalty is max(0, Total - PenaltyTotal),
    ScoreRaw is min(ScoreWithPenalty, 100),
    Score is round(ScoreRaw),
    keysort(Signals, SignalsAsc),
    reverse(SignalsAsc, SignalsDesc),
    take_first_n(SignalsDesc, 3, TopSignals),
    findall(Text, member(_-Text, TopSignals), Texts),
    held_item_join_reasons(Texts, BaseReason),
    findall(PenaltyReasonText, member(_-PenaltyReasonText, Penalties), PenaltyReasonTexts),
    held_item_join_reasons(PenaltyReasonTexts, PenaltyReason),
    held_item_compose_marker_reason(BaseReason, PenaltyReason, Reason).

held_item_ability_item_marker_penalty(_Ability, Item, 20,
    'restricao relevante: efeito pleno depende de especie especifica, reduzindo aplicabilidade geral') :-
    item_marker(Item, category, species_specific).
held_item_ability_item_marker_penalty(unburden, Item, 16,
    'restricao relevante: item nao consumivel tende a atrasar ativacao de Unburden') :-
    held_item_is_competitive_slot_item(Item),
    \+ item_marker(Item, usage_mode, consumable).

held_item_join_reasons([], '').
held_item_join_reasons(Texts, Joined) :-
    atomic_list_concat(Texts, '; ', Joined).

held_item_compose_marker_reason(BaseReason, '', BaseReason) :- !.
held_item_compose_marker_reason('', PenaltyReason, PenaltyReason) :- !.
held_item_compose_marker_reason(BaseReason, PenaltyReason, Reason) :-
    format(atom(Reason), '~w; ~w', [BaseReason, PenaltyReason]).

held_item_generic_coverage_item(Item) :-
    held_item_candidate_id(Item),
    \+ item_marker(Item, type_hint, _),
    \+ item_marker(Item, domain, form_change).

held_item_ability_item_marker_signal(Ability, Item, 36, Reason) :-
    ability_marker(Ability, condition, Condition),
    Condition \= always_active,
    item_marker(Item, condition, Condition),
    held_item_marker_reason(condition, Condition, Reason).
held_item_ability_item_marker_signal(Ability, Item, 26,
    'domínio compartilhado: weather (controle direto de clima)') :-
    held_item_weather_setter_ability(Ability),
    ability_marker(Ability, domain, weather),
    item_marker(Item, domain, weather),
    held_item_domain_marker_is_compatible(Ability, Item, weather).
held_item_ability_item_marker_signal(Ability, Item, 12,
    'domínio compartilhado: weather (beneficio condicional no clima correto)') :-
    held_item_weather_related_ability(Ability),
    \+ held_item_weather_setter_ability(Ability),
    ability_marker(Ability, domain, weather),
    item_marker(Item, domain, weather),
    held_item_domain_marker_is_compatible(Ability, Item, weather).
held_item_ability_item_marker_signal(Ability, Item, 24, Reason) :-
    ability_marker(Ability, domain, Domain),
    Domain \= weather,
    item_marker(Item, domain, Domain),
    held_item_domain_marker_is_compatible(Ability, Item, Domain),
    held_item_marker_reason(domain, Domain, Reason).
held_item_ability_item_marker_signal(Ability, Item, 14, Reason) :-
    held_item_ability_weather_condition(Ability, WeatherCondition),
    held_item_weather_condition_type(WeatherCondition, TypeHint),
    item_marker(Item, type_hint, TypeHint),
    item_marker(Item, modifier_kind, move_power_modifier),
    \+ item_marker(Item, usage_mode, consumable),
    \+ item_marker(Item, domain, form_change),
    held_item_weather_type_amplification_reason(WeatherCondition, TypeHint, Item, Reason).
held_item_ability_item_marker_signal(Ability, Item, 18, Reason) :-
    ability_marker(Ability, type_hint, TypeHint),
    item_marker(Item, type_hint, TypeHint),
    held_item_marker_reason(type_hint, TypeHint, Reason).
held_item_ability_item_marker_signal(Ability, Item, 16, Reason) :-
    ability_marker(Ability, condition, Condition),
    Condition \= always_active,
    item_marker(Item, relation_hook, Condition),
    held_item_marker_reason(relation_hook, Condition, Reason).
held_item_ability_item_marker_signal(Ability, Item, 10, Reason) :-
    ability_marker(Ability, trigger, Trigger),
    Trigger \= passive,
    item_marker(Item, trigger, Trigger),
    held_item_marker_reason(trigger, Trigger, Reason).
held_item_ability_item_marker_signal(unburden, Item, 34, Reason) :-
    held_item_is_competitive_slot_item(Item),
    item_marker(Item, usage_mode, consumable),
    held_item_unburden_activation_reason(Item, Reason).

held_item_ability_item_marker_signal(_Ability, Item, 12,
    'cobertura de fraqueza: recuperacao sustentada quando a habilidade nao protege o ciclo de dano') :-
    held_item_generic_coverage_item(Item),
    item_marker(Item, modifier_kind, hp_recovery_modifier).
held_item_ability_item_marker_signal(_Ability, Item, 10,
    'cobertura de fraqueza: mitigacao de dano em janelas sem controle direto da habilidade') :-
    held_item_generic_coverage_item(Item),
    item_marker(Item, modifier_kind, damage_taken_modifier).
held_item_ability_item_marker_signal(Ability, Item, 10,
    'execucao apos ativacao: controle de velocidade para capitalizar o turno seguinte') :-
    held_item_generic_coverage_item(Item),
    current_predicate(ability_marker/3),
    ability_marker(Ability, trigger, on_switch_in),
    item_marker(Item, modifier_kind, stat_scalar_modifier),
    item_marker(Item, stat_target, speed).
held_item_ability_item_marker_signal(_Ability, Item, 8,
    'cobertura de estabilidade: reforco de defesa especial para segurar contra-ataques') :-
    held_item_generic_coverage_item(Item),
    item_marker(Item, modifier_kind, stat_scalar_modifier),
    item_marker(Item, stat_target, special_defense).

held_item_unburden_activation_reason(Item, Reason) :-
    display_label(Item, ItemLabel),
    held_item_effect_text(Item, EffectText),
    format(atom(Reason),
        'ativacao direta de Unburden com item consumivel (~w): ~w',
        [ItemLabel, EffectText]).

held_item_marker_reason(condition, Value, Reason) :-
    display_label(Value, Label),
    format(atom(Reason), 'condição compartilhada: ~w', [Label]).
held_item_marker_reason(domain, Value, Reason) :-
    display_label(Value, Label),
    format(atom(Reason), 'domínio compartilhado: ~w', [Label]).
held_item_marker_reason(type_hint, Value, Reason) :-
    display_label(Value, Label),
    format(atom(Reason), 'tipo em comum: ~w', [Label]).
held_item_marker_reason(relation_hook, Value, Reason) :-
    display_label(Value, Label),
    format(atom(Reason), 'gancho tático compatível: ~w', [Label]).
held_item_marker_reason(trigger, Value, Reason) :-
    display_label(Value, Label),
    format(atom(Reason), 'gatilho em comum: ~w', [Label]).

held_item_is_competitive_slot_item(Item) :-
    current_predicate(item_marker/3),
    !,
    item_marker(Item, relation_hook, held_item_slot).
held_item_is_competitive_slot_item(_Item).

held_item_ability_item_rule(iron_barbs, rocky_helmet, 58, 'chip acumulado em golpes de contato').
held_item_ability_item_rule(rough_skin, rocky_helmet, 52, 'chip acumulado em golpes de contato').
held_item_ability_item_rule(flame_body, rocky_helmet, 22, 'força trocas ao punir contato').
held_item_ability_item_rule(static, rocky_helmet, 22, 'força trocas ao punir contato').
held_item_ability_item_rule(unburden, focus_sash, 34, 'item consumível ativa boost de Speed com segurança').
held_item_ability_item_rule(unburden, electric_seed, 36, 'ativa Unburden em times com Electric Terrain').
held_item_ability_item_rule(unburden, psychic_seed, 36, 'ativa Unburden em times com Psychic Terrain').
held_item_ability_item_rule(unburden, grassy_seed, 36, 'ativa Unburden em times com Grassy Terrain').
held_item_ability_item_rule(unburden, misty_seed, 36, 'ativa Unburden em times com Misty Terrain').
held_item_ability_item_rule(unburden, white_herb, 28, 'consumo do item pode ativar Unburden em sequência de pressão').
held_item_ability_item_rule(guts, flame_orb, 54, 'ativa Guts com consistência e reduz risco de receber outro status disruptivo').
held_item_ability_item_rule(poison_heal, toxic_orb, 52, 'ativa recuperação por turno com consistência e melhora o jogo longo').
held_item_ability_item_rule(magic_guard, life_orb, 30, 'mantém boost ofensivo sem recuo de Life Orb').
held_item_ability_item_rule(regenerator, assault_vest, 18, 'compensa ausência de recovery no pivot').
held_item_ability_item_rule(multiscale, heavy_duty_boots, 20, 'preserva HP cheio e ativa Multiscale com mais frequência').
held_item_ability_item_rule(sturdy, heavy_duty_boots, 14, 'facilita manutenção de HP cheio para manter Sturdy ativo').
held_item_ability_item_rule(drizzle, choice_scarf, 24, 'facilita lead de chuva com ativação de campo e pivot seguro no mesmo ciclo').
held_item_ability_item_rule(drought, choice_scarf, 22, 'facilita lead de sol com ativação de campo e reposicionamento mais seguro').
held_item_ability_item_rule(sand_stream, choice_scarf, 20, 'facilita ativação da areia e saída rápida para encaixar o abusador do clima').
held_item_ability_item_rule(snow_warning, choice_scarf, 18, 'facilita ativação de neve e controle de ritmo via entrada/saída').
held_item_ability_item_rule(electric_surge, choice_scarf, 18, 'facilita ativação de terreno elétrico com reposicionamento imediato').
held_item_ability_item_rule(grassy_surge, choice_scarf, 18, 'facilita ativação de terreno de grama com reposicionamento imediato').
held_item_ability_item_rule(misty_surge, choice_scarf, 18, 'facilita ativação de terreno místico com reposicionamento imediato').
held_item_ability_item_rule(psychic_surge, choice_scarf, 18, 'facilita ativação de terreno psíquico com reposicionamento imediato').

held_item_merge_objective(BaseObjective, none, BaseObjective).
held_item_merge_objective(_BaseObjective, ContextObjective, ContextObjective).

held_item_compose_reason(BaseReason, ContextReason, AbilityReason, FinalReason) :-
    findall(Part,
        held_item_compose_reason_part(BaseReason, ContextReason, AbilityReason, Part),
        Parts),
    atomic_list_concat(Parts, '; ', FinalReason).

held_item_compose_reason_part(BaseReason, _ContextReason, _AbilityReason, BaseReason).
held_item_compose_reason_part(_BaseReason, ContextReason, _AbilityReason, Part) :-
    held_item_non_empty_text(ContextReason),
    format(atom(Part), 'contexto: ~w', [ContextReason]).
held_item_compose_reason_part(_BaseReason, _ContextReason, AbilityReason, Part) :-
    held_item_non_empty_text(AbilityReason),
    format(atom(Part), 'habilidade: ~w', [AbilityReason]).

held_item_non_empty_text(Text) :-
    nonvar(Text),
    Text \= ''.

held_item_item_fit_in_context(contact_punish, rocky_helmet, Features, Fit, cover_weakness,
    'ideal para parede que pune contato continuamente') :-
    held_item_bonus_if(Features.has_contact_punish_ability == true, 95, 62, Fit).
held_item_item_fit_in_context(contact_punish, leftovers, _Features, 42, cover_weakness,
    'sustenta o ciclo de trocas para manter punição passiva').
held_item_item_fit_in_context(contact_punish, assault_vest, _Features, 35, cover_weakness,
    'ajuda a segurar hits especiais enquanto pressiona por chip').

held_item_item_fit_in_context(long_game_wall, leftovers, _Features, 92, cover_weakness,
    'melhor consistência para jogos longos').
held_item_item_fit_in_context(long_game_wall, rocky_helmet, Features, Fit, cover_weakness,
    'transforma switch-ins físicos em custo para o oponente') :-
    held_item_bonus_if(Features.has_contact_punish_ability == true, 86, 70, Fit).
held_item_item_fit_in_context(long_game_wall, black_sludge, Features, Fit, cover_weakness,
    'equivalente ao Leftovers para tipo Poison') :-
    held_item_bonus_if(Features.is_poison_type == true, 90, 10, Fit).
held_item_item_fit_in_context(long_game_wall, eviolite, Features, Fit, cover_weakness,
    'forte incremento de bulk em estágio não finalizado') :-
    held_item_bonus_if(Features.can_evolve == true, 88, 0, Fit).
held_item_item_fit_in_context(long_game_wall, heavy_duty_boots, Features, Fit, cover_weakness,
    'reduz dano indireto e melhora frequência de entrada') :-
    held_item_bonus_if(Features.rock_weak_mult >= 2.0, 70, 32, Fit).

held_item_item_fit_in_context(setup_sweep, focus_sash, Features, Fit, strengthen,
    'garante turno de setup em matchups agressivos') :-
    held_item_bonus_if(Features.has_setup == true, 90, 62, Fit).
held_item_item_fit_in_context(setup_sweep, life_orb, _Features, 84, strengthen,
    'maximiza snowball após setup').
held_item_item_fit_in_context(setup_sweep, white_herb, Features, Fit, strengthen,
    'boa em sets com queda de status e pressão contínua') :-
    held_item_bonus_if(Features.has_self_drop_move == true, 86, 42, Fit).
held_item_item_fit_in_context(setup_sweep, electric_seed, Features, Fit, strengthen,
    'forte em composições de terreno para ativar Unburden') :-
    held_item_bonus_if(Features.has_unburden == true, 88, 18, Fit).
held_item_item_fit_in_context(setup_sweep, psychic_seed, Features, Fit, strengthen,
    'forte em composições de terreno para ativar Unburden') :-
    held_item_bonus_if(Features.has_unburden == true, 88, 18, Fit).
held_item_item_fit_in_context(setup_sweep, grassy_seed, Features, Fit, strengthen,
    'forte em composições de terreno para ativar Unburden') :-
    held_item_bonus_if(Features.has_unburden == true, 88, 18, Fit).
held_item_item_fit_in_context(setup_sweep, misty_seed, Features, Fit, strengthen,
    'forte em composições de terreno para ativar Unburden') :-
    held_item_bonus_if(Features.has_unburden == true, 88, 18, Fit).
held_item_item_fit_in_context(setup_sweep, weakness_policy, Features, Fit, strengthen,
    'ameaça reverse sweep quando o usuário aguenta hit super efetivo') :-
    held_item_bonus_if(Features.bulk_avg >= 90, 76, 52, Fit).

held_item_item_fit_in_context(breaker, life_orb, _Features, 92, strengthen,
    'aumenta dano imediato sem lock de golpe').
held_item_item_fit_in_context(breaker, choice_band, Features, Fit, strengthen,
    'maximiza pressão física de break') :-
    held_item_bonus_if(Features.bias == physical, 90, 28, Fit).
held_item_item_fit_in_context(breaker, choice_specs, Features, Fit, strengthen,
    'maximiza pressão especial de break') :-
    held_item_bonus_if(Features.bias == special, 90, 28, Fit).
held_item_item_fit_in_context(breaker, weakness_policy, _Features, 64, strengthen,
    'pico de dano quando ativado na troca certa').

held_item_item_fit_in_context(speed_control, choice_scarf, Features, Fit, cover_weakness,
    'corrige speed tier e, em setters de campo com pivot, garante execução consistente de entrada e reposicionamento') :-
    held_item_bonus_if((Features.has_weather_setter_ability == true ; Features.has_terrain_setter_ability == true), 98, 96, BaseFit),
    held_item_bonus_if(Features.has_pivot == true, 2, 0, PivotFitBonus),
    Fit is min(100, BaseFit + PivotFitBonus).
held_item_item_fit_in_context(speed_control, focus_sash, _Features, 48, cover_weakness,
    'ganha turno contra ameaças mais rápidas').
held_item_item_fit_in_context(speed_control, heavy_duty_boots, Features, Fit, cover_weakness,
    'mantém frequência de entrada em perfis de pivot') :-
    held_item_bonus_if(Features.has_pivot == true, 58, 24, Fit).

held_item_item_fit_in_context(support, light_clay, Features, Fit, cover_weakness,
    'estende telas e aumenta valor do suporte') :-
    held_item_bonus_if(Features.has_screens == true, 96, 0, Fit).
held_item_item_fit_in_context(support, leftovers, _Features, 70, cover_weakness,
    'sustentação estável para ciclos utilitários').
held_item_item_fit_in_context(support, heavy_duty_boots, Features, Fit, cover_weakness,
    'mantém pivots e utilidade ativos mesmo sob hazards') :-
    held_item_bonus_if(Features.rock_weak_mult >= 2.0, 72, 36, Fit).
held_item_item_fit_in_context(support, rocky_helmet, Features, Fit, cover_weakness,
    'suporte passivo de chip para punir pressão física') :-
    held_item_bonus_if(Features.has_contact_punish_ability == true, 78, 46, Fit).


