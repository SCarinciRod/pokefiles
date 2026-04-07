:- encoding(utf8).

parse_mega_count_query(Text) :-
    tokenize_for_match(Text, Tokens),
    quantity_intent_tokens(Tokens),
    ( member("mega", Tokens)
    ; member("megas", Tokens)
    ; contiguous_sublist(["mega", "evolucoes"], Tokens)
    ; contiguous_sublist(["mega", "evoluções"], Tokens)
    ; contiguous_sublist(["megas", "evolucoes"], Tokens)
    ; contiguous_sublist(["megas", "evoluções"], Tokens)
    ; contiguous_sublist(["evolucao", "mega"], Tokens)
    ; contiguous_sublist(["evolução", "mega"], Tokens)
    ; contiguous_sublist(["evolucoes", "mega"], Tokens)
    ; contiguous_sublist(["evoluções", "mega"], Tokens)
    ).

parse_megas_per_generation_summary_query(Text) :-
    tokenize_for_match(Text, Tokens),
    ( member("mega", Tokens) ; member("megas", Tokens) ),
    ( contiguous_sublist(["por", "geracao"], Tokens)
    ; contiguous_sublist(["por", "geração"], Tokens)
    ).

parse_pokemon_per_generation_summary_query(Text) :-
    tokenize_for_match(Text, Tokens),
    pokemon_noun_tokens(Tokens),
    ( contiguous_sublist(["por", "geracao"], Tokens)
    ; contiguous_sublist(["por", "geração"], Tokens)
    ).

parse_legendary_per_generation_summary_query(Text) :-
    tokenize_for_match(Text, Tokens),
    legendary_request_tokens(Tokens),
    ( contiguous_sublist(["por", "geracao"], Tokens)
    ; contiguous_sublist(["por", "geração"], Tokens)
    ).

parse_mega_by_generation_query(Text, Generation, TypeFilters, ContextFilters) :-
    tokenize_for_match(Text, Tokens),
    parse_generation_from_tokens(Tokens, Generation),
    mega_tokens(Tokens),
    ( extract_type_filters(Tokens, TypeFilters) ; TypeFilters = [] ),
    extract_context_filters(Tokens, RawContext),
    ensure_filter_present(only_mega, RawContext, ContextFilters).

parse_legendary_by_generation_query(Text, Generation, TypeFilters, ContextFilters) :-
    tokenize_for_match(Text, Tokens),
    parse_generation_from_tokens(Tokens, Generation),
    legendary_request_tokens(Tokens),
    ( extract_type_filters(Tokens, TypeFilters) ; TypeFilters = [] ),
    extract_context_filters(Tokens, RawContext),
    ensure_filter_present(only_legendary, RawContext, ContextFilters).

parse_legendary_by_type_query(Text, TypeFilters, ContextFilters) :-
    tokenize_for_match(Text, Tokens),
    legendary_request_tokens(Tokens),
    extract_type_filters(Tokens, TypeFilters),
    extract_context_filters(Tokens, RawContext),
    ensure_filter_present(only_legendary, RawContext, ContextFilters).

parse_generation_type_query(Text, Generation, TypeFilters, ContextFilters) :-
    tokenize_for_match(Text, Tokens),
    parse_generation_from_tokens(Tokens, Generation),
    extract_type_filters(Tokens, TypeFilters),
    TypeFilters \= [],
    ( member("tipo", Tokens)
    ; member("tipos", Tokens)
    ; pokemon_noun_tokens(Tokens)
    ; quantity_intent_tokens(Tokens)
    ; list_intent_tokens(Tokens)
    ),
    \+ legendary_request_tokens(Tokens),
    extract_context_filters(Tokens, ContextFilters).

parse_pokemon_by_generation_query(Text, Generation, TypeFilters, ContextFilters) :-
    tokenize_for_match(Text, Tokens),
    parse_generation_from_tokens(Tokens, Generation),
    ( pokemon_noun_tokens(Tokens)
    ; quantity_intent_tokens(Tokens)
    ; list_intent_tokens(Tokens)
    ),
    \+ legendary_request_tokens(Tokens),
    \+ mega_tokens(Tokens),
    ( extract_type_filters(Tokens, TypeFilters) ; TypeFilters = [] ),
    extract_context_filters(Tokens, ContextFilters).

legendary_request_tokens(Tokens) :-
    member(Token, Tokens),
    legendary_request_token(Token),
    !.

ensure_filter_present(Filter, Filters, Filters) :-
    member(Filter, Filters),
    !.
ensure_filter_present(Filter, Filters, [Filter | Filters]).

answer_mega_count_query :-
    findall(Name,
        ( pokemon_in_scope(_, Name, _, _, _, _, _),
          is_mega_name(Name)
        ),
        NamesRaw),
    sort(NamesRaw, Names),
    length(Names, Count),
    format('Bot: Existem ~w formas Mega na base atual.~n', [Count]).

answer_megas_per_generation_summary_query :-
    findall(Generation-Count,
        ( between(1, 9, Generation),
          collect_generation_names(Generation, [], [only_mega], Names),
          length(Names, Count)
        ),
        Summary),
    writeln('Bot: Quantidade de formas Mega por geração:'),
    print_generation_summary(Summary).

answer_pokemon_per_generation_summary_query :-
    findall(Generation-Count,
        ( between(1, 9, Generation),
          collect_generation_names(Generation, [], [], Names),
          length(Names, Count)
        ),
        Summary),
    writeln('Bot: Quantidade de Pokémon por geração:'),
    print_generation_summary(Summary).

answer_legendary_per_generation_summary_query :-
    findall(Generation-Count,
        ( between(1, 9, Generation),
          collect_generation_names(Generation, [], [only_legendary], Names),
          length(Names, Count)
        ),
        Summary),
    writeln('Bot: Quantidade de lendários/míticos por geração:'),
    print_generation_summary(Summary).

answer_mega_by_generation_query(Generation, TypeFilters, ContextFilters) :-
    ensure_filter_present(only_mega, ContextFilters, EffectiveFilters),
    collect_generation_names(Generation, TypeFilters, EffectiveFilters, Names),
    Names \= [],
    !,
    remember_candidate_list(Names),
    length(Names, Count),
    sample_names_text(Names, 10, SampleText),
    generation_type_query_text(Generation, TypeFilters, QueryText),
    format('Bot: Encontrei ~w formas Mega ~w.~n', [Count, QueryText]),
    format('  Exemplos: ~w~n', [SampleText]).
answer_mega_by_generation_query(Generation, TypeFilters, _) :-
    generation_type_query_text(Generation, TypeFilters, QueryText),
    format('Bot: Não encontrei formas Mega ~w.~n', [QueryText]).

answer_legendary_by_generation_query(Generation, TypeFilters, ContextFilters) :-
    ensure_filter_present(only_legendary, ContextFilters, EffectiveFilters),
    collect_generation_names(Generation, TypeFilters, EffectiveFilters, Names),
    Names \= [],
    !,
    remember_candidate_list(Names),
    length(Names, Count),
    sample_names_text(Names, 10, SampleText),
    generation_type_query_text(Generation, TypeFilters, QueryText),
    format('Bot: Encontrei ~w lendários/míticos ~w.~n', [Count, QueryText]),
    format('  Exemplos: ~w~n', [SampleText]).
answer_legendary_by_generation_query(Generation, TypeFilters, _) :-
    generation_type_query_text(Generation, TypeFilters, QueryText),
    format('Bot: Não encontrei lendários/míticos ~w.~n', [QueryText]).

answer_legendary_by_type_query(TypeFilters, ContextFilters) :-
    ensure_filter_present(only_legendary, ContextFilters, EffectiveFilters),
    collect_scoped_names(TypeFilters, EffectiveFilters, Names),
    Names \= [],
    !,
    remember_candidate_list(Names),
    length(Names, Count),
    type_filters_text(TypeFilters, FiltersText),
    sample_names_text(Names, 12, SampleText),
    format('Bot: Encontrei ~w lendários/míticos do tipo ~w no recorte atual.~n', [Count, FiltersText]),
    format('  Exemplos: ~w~n', [SampleText]).
answer_legendary_by_type_query(TypeFilters, _) :-
    type_filters_text(TypeFilters, FiltersText),
    format('Bot: Não encontrei lendários/míticos do tipo ~w no recorte atual.~n', [FiltersText]).

answer_generation_type_query(Generation, TypeFilters, ContextFilters) :-
    collect_generation_names(Generation, TypeFilters, ContextFilters, Names),
    Names \= [],
    !,
    remember_candidate_list(Names),
    length(Names, Count),
    sample_names_text(Names, 12, SampleText),
    generation_type_query_text(Generation, TypeFilters, QueryText),
    format('Bot: Encontrei ~w Pokémon ~w.~n', [Count, QueryText]),
    format('  Exemplos: ~w~n', [SampleText]).
answer_generation_type_query(Generation, TypeFilters, _) :-
    generation_type_query_text(Generation, TypeFilters, QueryText),
    format('Bot: Não encontrei Pokémon ~w.~n', [QueryText]).

answer_pokemon_by_generation_query(Generation, TypeFilters, ContextFilters) :-
    collect_generation_names(Generation, TypeFilters, ContextFilters, Names),
    Names \= [],
    !,
    remember_candidate_list(Names),
    length(Names, Count),
    sample_names_text(Names, 12, SampleText),
    generation_type_query_text(Generation, TypeFilters, QueryText),
    format('Bot: Existem ~w Pokémon ~w.~n', [Count, QueryText]),
    format('  Exemplos: ~w~n', [SampleText]).
answer_pokemon_by_generation_query(Generation, TypeFilters, _) :-
    generation_type_query_text(Generation, TypeFilters, QueryText),
    format('Bot: Não encontrei Pokémon ~w.~n', [QueryText]).

collect_scoped_names(TypeFilters, ContextFilters, Names) :-
    query_name_candidates(scoped, TypeFilters, ContextFilters, Names).

query_name_candidates(scoped, TypeFilters, ContextFilters, Names) :-
    scoped_filtered_names(TypeFilters, ContextFilters, Names).
query_name_candidates(generation(Generation), TypeFilters, ContextFilters, Names) :-
    generation_filtered_names(Generation, TypeFilters, ContextFilters, Names).

normalize_filter_keys(TypeFilters, ContextFilters, TypeKey, ContextKey) :-
    sort(TypeFilters, TypeKey),
    sort(ContextFilters, ContextKey).

scoped_filtered_names(TypeFilters, ContextFilters, Names) :-
    current_generation_key(GenerationKey),
    normalize_filter_keys(TypeFilters, ContextFilters, TypeKey, ContextKey),
    ( cache_scoped_filtered_names(GenerationKey, TypeKey, ContextKey, Names) ->
        true
    ; findall(Name,
            ( pokemon_in_scope(_ID, Name, _Height, _Weight, Types, _Abilities, _Stats),
              pokemon_matches_optional_type_filters(TypeKey, Types),
              name_passes_optional_filters(ContextKey, Name)
            ),
            NamesRaw),
      sort(NamesRaw, NamesSorted),
      assertz(cache_scoped_filtered_names(GenerationKey, TypeKey, ContextKey, NamesSorted)),
      Names = NamesSorted
    ).

generation_filtered_names(Generation, TypeFilters, ContextFilters, Names) :-
    normalize_filter_keys(TypeFilters, ContextFilters, TypeKey, ContextKey),
    ( cache_generation_filtered_names(Generation, TypeKey, ContextKey, Names) ->
        true
    ; findall(Name,
            ( pokemon(ID, Name, _Height, _Weight, Types, _Abilities, _Stats),
              generation_matches_id(Generation, ID),
              generation_name_passes_form_policy(ContextKey, ID, Name),
              pokemon_matches_optional_type_filters(TypeKey, Types),
              name_passes_optional_filters(ContextKey, Name)
            ),
            NamesRaw),
      sort(NamesRaw, NamesSorted),
      assertz(cache_generation_filtered_names(Generation, TypeKey, ContextKey, NamesSorted)),
      Names = NamesSorted
    ).

collect_generation_names(Generation, TypeFilters, ContextFilters, Names) :-
    generation_filtered_names(Generation, TypeFilters, ContextFilters, Names).

generation_matches_id(Generation, ID) :-
    pokemon_form_base(ID, BaseID),
    !,
    generation_matches_id(Generation, BaseID).
generation_matches_id(Generation, ID) :-
    pokemon_mega_base(ID, BaseID),
    !,
    generation_matches_id(Generation, BaseID).
generation_matches_id(Generation, ID) :-
    generation_range(Generation, MinID, MaxID),
    ID >= MinID,
    ID =< MaxID.

generation_type_query_text(Generation, [], Text) :-
    format(atom(Text), 'da geração ~w', [Generation]).
generation_type_query_text(Generation, TypeFilters, Text) :-
    TypeFilters \= [],
    type_filters_text(TypeFilters, FiltersText),
    format(atom(Text), 'do tipo ~w na geração ~w', [FiltersText, Generation]).

generation_name_passes_form_policy(ContextFilters, _ID, Name) :-
    member(only_mega, ContextFilters),
    !,
    is_mega_name(Name).
generation_name_passes_form_policy(_ContextFilters, ID, Name) :-
    \+ is_mega_name(Name),
    \+ is_special_form_id(ID).

is_special_form_id(ID) :-
    pokemon_form_base(ID, _),
    !.
is_special_form_id(ID) :-
    pokemon_mega_base(ID, _).

print_generation_summary([]).
print_generation_summary([Generation-Count | Rest]) :-
    format('  - Geração ~w: ~w~n', [Generation, Count]),
    print_generation_summary(Rest).
