:- encoding(utf8).
:- use_module(library(readutil)).
:- use_module(library(lists)).
:- initialization(configure_text_encoding).

:- dynamic active_generation/1.
:- multifile pokemon/7.
:- multifile pokemon_lore/2.
:- multifile pokemon_mega_base/2.
:- multifile pokemon_form_base/2.

start :-
    load_database,
    set_default_generation,
    writeln('=== Chatbot Pokedex (Prolog) ==='),
    writeln('Digite sua pergunta ou use comandos diretos:'),
    writeln('  - info nome pikachu'),
    writeln('  - info numero 25'),
    writeln('  - tipo fogo'),
    writeln('  - geracao 1   (ou: geracao todas)'),
    writeln('Digite "ajuda" para ver exemplos e "sair" para encerrar.'),
    chat_loop.

configure_text_encoding :-
    catch(set_stream(user_input, encoding(utf8)), _, true),
    catch(set_stream(user_output, encoding(utf8)), _, true),
    catch(set_stream(user_error, encoding(utf8)), _, true).

load_database :-
    expand_file_name('db/generation_*.pl', GenerationFiles),
    expand_file_name('db/lore_generation_*.pl', LoreFiles),
    expand_file_name('db/mega_forms.pl', MegaFiles),
    expand_file_name('db/lore_mega_forms.pl', MegaLoreFiles),
    expand_file_name('db/special_forms.pl', SpecialFiles),
    expand_file_name('db/lore_special_forms.pl', SpecialLoreFiles),
    ( GenerationFiles \= [] ->
        maplist(consult, GenerationFiles)
    ; consult('pokemon_db.pl')
    ),
    ( LoreFiles \= [] ->
        maplist(consult, LoreFiles)
    ; true
    ),
    ( MegaFiles \= [] ->
        maplist(consult, MegaFiles)
    ; true
    ),
    ( MegaLoreFiles \= [] ->
        maplist(consult, MegaLoreFiles)
    ; true
    ),
    ( SpecialFiles \= [] ->
        maplist(consult, SpecialFiles)
    ; true
    ),
    ( SpecialLoreFiles \= [] ->
        maplist(consult, SpecialLoreFiles)
    ; true
    ).

set_default_generation :-
    retractall(active_generation(_)),
    assertz(active_generation(all)).

chat_loop :-
    write('Voce: '),
    flush_output(current_output),
    read_line_to_string(user_input, InputRaw),
    ( InputRaw == end_of_file ->
        nl, writeln('Bot: Encerrando. Ate mais!')
    ; normalize_space(string(Input), InputRaw),
      downcase_atom(Input, Text),
      handle(Text),
      ( should_stop(Text) -> true ; chat_loop )
    ).

should_stop(Text) :-
    member(Text, ['sair', 'tchau', 'exit', 'quit']).

handle(Text) :-
    ( parse_generation_command(Text, Generation) ->
        set_active_generation(Generation)
    ; member(Text, ['ajuda', 'help']) ->
        show_help
    ; should_stop(Text) ->
        writeln('Bot: Ate mais!')
    ; answer_query(Text)
    ).

parse_generation_command(Text, all) :-
    member(Text, ['geracao todas', 'geração todas', 'geracao all', 'geração all']).
parse_generation_command(Text, Generation) :-
    split_string(Text, " ", "", [Cmd, Value]),
    member(Cmd, ["geracao", "geração"]),
    string_number(Value, Generation),
    integer(Generation),
    between(1, 9, Generation).

set_active_generation(all) :-
    retractall(active_generation(_)),
    assertz(active_generation(all)),
    writeln('Bot: Agora estou consultando todas as geracoes carregadas.').
set_active_generation(Generation) :-
    retractall(active_generation(_)),
    assertz(active_generation(Generation)),
    format('Bot: Agora estou consultando apenas a geracao ~w.~n', [Generation]).

answer_query(Text) :-
    ( parse_info_by_number(Text, Number) ->
        answer_pokemon(Number),
        print_follow_up_prompt
    ; parse_info_by_name(Text, Name) ->
        answer_pokemon(Name),
        print_follow_up_prompt
    ; parse_counter_query(Text, TargetName) ->
        answer_counter_query(TargetName),
        print_follow_up_prompt
    ; parse_type_query(Text, TypeFilters) ->
        answer_type_query(TypeFilters),
        print_follow_up_prompt
    ; parse_ability_query(Text, Ability) ->
        answer_ability_query(Ability),
        print_follow_up_prompt
    ; parse_status_full_query(Text, Stat) ->
        answer_status_full_query(Stat),
        print_follow_up_prompt
    ; parse_status_query(Text, Stat) ->
        answer_status_query(Stat),
        print_follow_up_prompt
    ; writeln('Bot: Não entendi. Digite "ajuda" para exemplos de perguntas.'),
      print_follow_up_prompt
    ).

parse_info_by_number(Text, Number) :-
    split_string(Text, " ", "", Tokens),
    ( starts_with_tokens(Tokens, ["info", "numero"]) ;
      starts_with_tokens(Tokens, ["pokemon", "numero"]) ;
            starts_with_tokens(Tokens, ["pokemon"]) ;
      starts_with_tokens(Tokens, ["numero"]) ;
      starts_with_tokens(Tokens, ["pokedex"]) ;
            single_numeric_word(Tokens) ;
      sub_string(Text, _, _, _, "numero") ;
      sub_string(Text, _, _, _, "pokedex")
    ),
    extract_number(Tokens, Number).

parse_info_by_name(Text, Name) :-
    split_string(Text, " ", "", Tokens),
    ( starts_with_tokens(Tokens, ["info", "nome"]) ->
        drop_first_n(Tokens, 2, NameTokens),
        extract_name_from_tokens(NameTokens, Name)
    ; starts_with_tokens(Tokens, ["pokemon", "nome"]) ->
        drop_first_n(Tokens, 2, NameTokens),
        extract_name_from_tokens(NameTokens, Name)
    ; starts_with_tokens(Tokens, ["nome"]) ->
        drop_first_n(Tokens, 1, NameTokens),
        extract_name_from_tokens(NameTokens, Name)
    ; starts_with_tokens(Tokens, ["pokemon"]) ->
        drop_first_n(Tokens, 1, NameTokens),
        extract_name_from_tokens(NameTokens, Name)
    ; single_word(Tokens, Name)
    ).

parse_counter_query(Text, TargetName) :-
    split_string(Text, " ", "", Tokens),
    append(_, ["contra" | Tail], Tokens),
    extract_name_from_tokens(Tail, TargetName).

parse_type_query(Text, TypeFilters) :-
    split_string(Text, " ", "", Tokens),
    ( append(_, ["tipo" | Tail], Tokens)
    ; append(_, ["tipos" | Tail], Tokens)
    ),
    extract_type_filters(Tail, TypeFilters).

parse_ability_query(Text, Ability) :-
    split_string(Text, " ", "", Tokens),
    append(_, ["habilidade" | Tail], Tokens),
    extract_ability_token(Tail, Ability).

parse_status_query(Text, Stat) :-
    split_string(Text, " ", "", Tokens),
    ( append(_, ["status" | Tail], Tokens)
    ; starts_with_tokens(Tokens, ["maior"], Tail)
    ; starts_with_tokens(Tokens, ["top"], Tail)
    ),
    extract_stat_from_tokens(Tail, Stat).

parse_status_full_query(Text, Stat) :-
    split_string(Text, " ", "", Tokens),
    member("status", Tokens),
    ( member("completo", Tokens) ; member("lista", Tokens) ; member("todos", Tokens) ),
    extract_stat_from_tokens(Tokens, Stat).

starts_with_tokens(Tokens, Prefix) :-
    append(Prefix, _, Tokens).
starts_with_tokens(Tokens, Prefix, Rest) :-
    append(Prefix, Rest, Tokens).

drop_first_n(List, N, Rest) :-
    length(Prefix, N),
    append(Prefix, Rest, List),
    !.
drop_first_n(_, _, []).

single_word([Word], Word) :-
    \+ string_number(Word, _),
    \+ member(Word, ["tipo", "numero", "nome", "info", "pokemon"]).

single_numeric_word([Word]) :-
    string_number(Word, _).

extract_name_from_tokens(RawTokens, Name) :-
    findall(Token,
        ( member(Raw, RawTokens),
          normalize_name_token(Raw, Token),
          Token \= "",
          \+ name_stopword(Token)
        ),
        NameTokens),
    NameTokens \= [],
    atomic_list_concat(NameTokens, '_', Name).

normalize_name_token(RawToken, Normalized) :-
    split_string(RawToken, "-_", "", Parts0),
    include(non_empty_string, Parts0, Parts),
    atomic_list_concat(Parts, '_', Combined0),
    string_lower(Combined0, Normalized).

name_stopword("o").
name_stopword("a").
name_stopword("os").
name_stopword("as").
name_stopword("um").
name_stopword("uma").
name_stopword("de").
name_stopword("do").
name_stopword("da").
name_stopword("qual").
name_stopword("que").
name_stopword("bom").
name_stopword("boa").
name_stopword("melhor").
name_stopword("eh").
name_stopword("é").
name_stopword("pokemon").
name_stopword("pokémon").
name_stopword("pokemons").
name_stopword("pokémons").

extract_number(Tokens, Number) :-
    member(Token, Tokens),
    token_to_number(Token, Number),
    !.

token_to_number(Token, Number) :-
    string_number(Token, Number),
    !.
token_to_number(Token, Number) :-
    sub_string(Token, 0, 1, _, "#"),
    sub_string(Token, 1, _, 0, Digits),
    string_number(Digits, Number).

string_number(Text, Number) :-
    catch(number_string(Number, Text), _, fail).

extract_type_filters(Tokens, TypeFilters) :-
    findall(Type,
        ( member(Token, Tokens),
          token_to_type_candidates(Token, Candidates),
          member(Candidate, Candidates),
          \+ member(Candidate, ["e", "ou", "com", "de", "do", "da", "pokemon", "pokemons", "pokémon", "pokémons"]),
          normalize_type(Candidate, Type),
          valid_type(Type)
        ),
        TypesRaw),
    sort(TypesRaw, TypeFilters),
    TypeFilters \= [].

token_to_type_candidates(Token, Candidates) :-
    split_string(Token, "/,+", "", Candidates0),
    include(non_empty_string, Candidates0, Candidates).

non_empty_string(Text) :- Text \= "".

valid_type(Type) :-
    all_types(Types),
    member(Type, Types).

extract_ability_token(Tokens, Ability) :-
    include(valid_ability_word, Tokens, Words),
    Words \= [],
    atomic_list_concat(Words, '_', Ability).

valid_ability_word(Token) :-
    Token \= "",
    \+ member(Token, ["com", "de", "do", "da", "que", "tem", "têm", "pokemon", "pokemons", "pokémon", "pokémons"]).

extract_stat_from_tokens(Tokens, Stat) :-
    include(non_empty_string, Tokens, Words),
    stat_from_words(Words, Stat),
    !.

stat_from_words(Words, Stat) :-
    append(_, [W1, W2 | _], Words),
    stat_pair_alias(W1, W2, Stat),
    !.
stat_from_words(Words, Stat) :-
    member(Word, Words),
    stat_token_alias(Word, Stat),
    !.

stat_pair_alias("special", "attack", special_attack).
stat_pair_alias("ataque", "especial", special_attack).
stat_pair_alias("special", "defense", special_defense).
stat_pair_alias("defesa", "especial", special_defense).

stat_token_alias("hp", hp).
stat_token_alias("vida", hp).
stat_token_alias("attack", attack).
stat_token_alias("ataque", attack).
stat_token_alias("defense", defense).
stat_token_alias("defesa", defense).
stat_token_alias("speed", speed).
stat_token_alias("velocidade", speed).

answer_pokemon(Identifier) :-
    pokemon_info(Identifier, Pokemon),
    !,
    print_lookup_hint(Identifier),
    print_pokemon_info(Pokemon).
answer_pokemon(Identifier) :-
    mega_base_identifier(Identifier, BaseIdentifier),
    pokemon_info(BaseIdentifier, Pokemon),
    !,
    display_pokemon_name(BaseIdentifier, BaseLabel),
    format('Bot: Ainda não tenho a ficha da forma Mega no banco local; mostrando dados do ~w base.~n', [BaseLabel]),
    print_pokemon_info(Pokemon).
answer_pokemon(_) :-
    writeln('Bot: Não consegui encontrar esse Pokémon.').

print_lookup_hint(Identifier) :-
    number(Identifier),
    !,
    format('Bot: Consulta por numero da Pokedex (#~w).~n', [Identifier]).
print_lookup_hint(_) :-
    true.

answer_type_query(TypeFilters) :-
    type_pokemon_list(TypeFilters, Names),
    Names \= [],
    !,
    length(Names, Count),
    type_filters_text(TypeFilters, FiltersText),
    sample_names_text(Names, 8, SampleText),
    format('Bot: Encontrei ~w Pokémon do tipo ~w.~n', [Count, FiltersText]),
    format('  Exemplos: ~w~n', [SampleText]).
answer_type_query(TypeFilters) :-
    type_filters_text(TypeFilters, FiltersText),
    format('Bot: Não encontrei Pokémon para o filtro de tipo ~w.~n', [FiltersText]).

answer_ability_query(Ability) :-
    ability_pokemon_list(Ability, Names),
    Names \= [],
    !,
    length(Names, Count),
    display_label(Ability, AbilityLabel),
    sample_names_text(Names, 8, SampleText),
    format('Bot: Encontrei ~w Pokémon com a habilidade ~w.~n', [Count, AbilityLabel]),
    format('  Exemplos: ~w~n', [SampleText]).
answer_ability_query(Ability) :-
    display_label(Ability, AbilityLabel),
    format('Bot: Não encontrei Pokémon com a habilidade ~w.~n', [AbilityLabel]).

answer_status_query(Stat) :-
    top_pokemon_by_stat(Stat, 8, TopPairs),
    TopPairs \= [],
    !,
    display_stat_label(Stat, StatLabel),
    stat_command_text(Stat, StatCommandText),
    top_pairs_names_text(TopPairs, TopText),
    format('Bot: Estes são alguns Pokémon com destaque em ~w: ~w.~n', [StatLabel, TopText]),
    format('Bot: Deseja saber a lista completa de Pokémon com ~w como maior ou segundo maior status?~n', [StatLabel]),
    format('  Se quiser, digite: status ~w completo~n', [StatCommandText]).
answer_status_query(Stat) :-
    display_stat_label(Stat, StatLabel),
    format('Bot: Não consegui montar ranking para o status ~w.~n', [StatLabel]).

answer_status_full_query(Stat) :-
    status_top2_pokemon_list(Stat, Names),
    Names \= [],
    !,
    display_stat_label(Stat, StatLabel),
    length(Names, Count),
    sample_names_text(Names, 20, SampleText),
    format('Bot: Encontrei ~w Pokémon com ~w entre os 2 maiores status.~n', [Count, StatLabel]),
    format('  Amostra: ~w~n', [SampleText]).
answer_status_full_query(Stat) :-
    display_stat_label(Stat, StatLabel),
    format('Bot: Não encontrei Pokémon com ~w no perfil principal.~n', [StatLabel]).

answer_counter_query(TargetIdentifier) :-
    resolve_counter_target(TargetIdentifier, pokemon(TargetID, TargetName, _, _, TargetTypes, _, _), UsedFallback),
    recommend_counters(TargetID, TargetTypes, CounterPairs),
    CounterPairs \= [],
    !,
    display_pokemon_name(TargetName, TargetLabel),
    counter_pairs_text(CounterPairs, CounterText),
    ( UsedFallback == true ->
        writeln('Bot: Ainda não tenho a ficha da forma Mega no banco local, então usei a forma base para sugerir counters.')
    ; true
    ),
    format('Bot: Contra ~w, uma boa estratégia é usar: ~w.~n', [TargetLabel, CounterText]),
    writeln('Bot: Se quiser, eu também posso sugerir opções mais ofensivas ou mais defensivas.').
answer_counter_query(TargetIdentifier) :-
    resolve_counter_target(TargetIdentifier, pokemon(_, TargetName, _, _, _, _, _), _),
    !,
    display_pokemon_name(TargetName, TargetLabel),
    format('Bot: Não encontrei counters fortes o suficiente para ~w com o filtro atual de geração.~n', [TargetLabel]).
answer_counter_query(_) :-
    writeln('Bot: Não consegui identificar o Pokémon alvo. Exemplo: "qual é um bom pokemon contra charizard mega x".').

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

recommend_counters(TargetID, TargetTypes, TopPairs) :-
    findall(Score-Name-AttackMult-DefenseMult,
        ( pokemon_in_scope(CandidateID, Name, _, _, CandidateTypes, _, _),
          CandidateID =\= TargetID,
          counter_metrics(CandidateTypes, TargetTypes, AttackMult, DefenseMult),
          AttackMult > 1.0,
          Score is (AttackMult * 3.0) - DefenseMult
        ),
        PairsRaw),
    keysort(PairsRaw, PairsAsc),
    reverse(PairsAsc, PairsDesc),
    take_first_n(PairsDesc, 6, TopPairs).

counter_metrics(CandidateTypes, TargetTypes, AttackMult, DefenseMult) :-
    findall(Attack,
        ( member(CandidateType, CandidateTypes),
          combined_multiplier(CandidateType, TargetTypes, Attack)
        ),
        AttackValues),
    max_list(AttackValues, AttackMult),
    findall(Defense,
        ( member(TargetType, TargetTypes),
          combined_multiplier(TargetType, CandidateTypes, Defense)
        ),
        DefenseValues),
    max_list(DefenseValues, DefenseMult).

counter_pairs_text(CounterPairs, Text) :-
    maplist(counter_pair_text, CounterPairs, Items),
    atomic_list_concat(Items, ', ', Text).

counter_pair_text(_Score-Name-AttackMult-DefenseMult, Text) :-
    display_pokemon_name(Name, NameLabel),
    multiplier_text(AttackMult, AttackText),
    multiplier_text(DefenseMult, DefenseText),
    format(atom(Text), '~w (bate ~w / recebe até ~w)', [NameLabel, AttackText, DefenseText]).

pokemon_info(Identifier, Pokemon) :-
    number(Identifier),
    !,
    ( pokemon_in_scope(Identifier, Name, Height, Weight, Types, Abilities, Stats)
    ; pokemon(Identifier, Name, Height, Weight, Types, Abilities, Stats)
    ),
    Pokemon = pokemon(Identifier, Name, Height, Weight, Types, Abilities, Stats).
pokemon_info(Identifier, Pokemon) :-
    downcase_atom(Identifier, Name),
    ( pokemon_in_scope(ID, Name, Height, Weight, Types, Abilities, Stats)
    ; pokemon(ID, Name, Height, Weight, Types, Abilities, Stats)
    ),
    Pokemon = pokemon(ID, Name, Height, Weight, Types, Abilities, Stats).

type_pokemon_count(Type, Count) :-
        findall(Name,
        ( pokemon_in_scope(_, Name, _, _, Types, _, _),
                    member(Type, Types)
                ),
                NamesRaw),
    sort(NamesRaw, UniqueNames),
    length(UniqueNames, Count).

type_pokemon_list(TypeFilters, Names) :-
    findall(Name,
        ( pokemon_in_scope(_, Name, _, _, Types, _, _),
          pokemon_matches_type_filters(TypeFilters, Types)
        ),
        NamesRaw),
    sort(NamesRaw, Names).

pokemon_matches_type_filters([], _).
pokemon_matches_type_filters([Type | Rest], PokemonTypes) :-
    member(Type, PokemonTypes),
    pokemon_matches_type_filters(Rest, PokemonTypes).

ability_pokemon_list(Ability, Names) :-
    findall(Name,
        ( pokemon_in_scope(_, Name, _, _, _, Abilities, _),
          member(Ability, Abilities)
        ),
        NamesRaw),
    sort(NamesRaw, Names).

top_pokemon_by_stat(Stat, Limit, TopPairs) :-
    findall(Value-Name,
        ( pokemon_in_scope(_, Name, _, _, _, _, Stats),
          member(Stat-Value, Stats)
        ),
        Pairs),
    keysort(Pairs, AscPairs),
    reverse(AscPairs, DescPairs),
    take_first_n(DescPairs, Limit, TopPairs).

status_top2_pokemon_list(Stat, Names) :-
    findall(Name,
        ( pokemon_in_scope(_, Name, _, _, _, _, Stats),
          stat_in_top_two(Stat, Stats)
        ),
        NamesRaw),
    sort(NamesRaw, Names).

stat_in_top_two(Stat, Stats) :-
    keysort_stats_desc(Stats, Sorted),
    take_first_n(Sorted, 2, Top2),
    member(Stat-_, Top2).

keysort_stats_desc(Stats, SortedDesc) :-
    findall(Value-Stat,
        member(Stat-Value, Stats),
        StatValuePairs),
    keysort(StatValuePairs, Asc),
    reverse(Asc, Desc),
    findall(Stat-Value,
        member(Value-Stat, Desc),
        SortedDesc).

take_first_n(List, N, Taken) :-
    length(Taken, N),
    append(Taken, _, List),
    !.
take_first_n(List, _, List).

sample_names_text(Names, Limit, Text) :-
    take_first_n(Names, Limit, Sample),
    maplist(display_pokemon_name, Sample, Labels),
    atomic_list_concat(Labels, ', ', Text).

top_pairs_names_text(Pairs, Text) :-
    maplist(pair_to_name_text, Pairs, Items),
    atomic_list_concat(Items, ', ', Text).

pair_to_name_text(_Value-Name, Text) :-
    display_pokemon_name(Name, NameLabel),
    format(atom(Text), '~w', [NameLabel]).

display_pokemon_name(NameAtom, Label) :-
    atom_string(NameAtom, Text),
    split_string(Text, "_-", "", Parts),
    maplist(capitalize_word, Parts, CapParts),
    atomic_list_concat(CapParts, ' ', Label).

capitalize_word("", "").
capitalize_word(Word, Capitalized) :-
    string_chars(Word, [First | Rest]),
    upcase_atom(First, FirstUp),
    string_chars(Capitalized, [FirstUp | Rest]).

type_filters_text(TypeFilters, Text) :-
    maplist(display_type_label, TypeFilters, Labels),
    atomic_list_concat(Labels, ' + ', Text).

normalize_type(InputType, ApiType) :-
    downcase_atom(InputType, TypeAtom),
    ( type_alias(TypeAtom, ApiType) -> true ; ApiType = TypeAtom ).

type_alias(fogo, fire).
type_alias(agua, water).
type_alias('água', water).
type_alias(grama, grass).
type_alias(planta, grass).
type_alias(inseto, bug).
type_alias(normal, normal).
type_alias(veneno, poison).
type_alias('elétrico', electric).
type_alias(eletrico, electric).
type_alias(terra, ground).
type_alias(pedra, rock).
type_alias(psiquico, psychic).
type_alias('psíquico', psychic).
type_alias(gelo, ice).
type_alias(dragao, dragon).
type_alias('dragão', dragon).
type_alias(fantasma, ghost).
type_alias(lutador, fighting).
type_alias(sombrio, dark).
type_alias('aço', steel).
type_alias(aco, steel).
type_alias(fada, fairy).
type_alias(voador, flying).

pokemon_in_scope(ID, Name, Height, Weight, Types, Abilities, Stats) :-
    pokemon(ID, Name, Height, Weight, Types, Abilities, Stats),
    active_generation_matches(ID).

active_generation_matches(_) :-
    active_generation(all),
    !.
active_generation_matches(ID) :-
    pokemon_form_base(ID, BaseID),
    !,
    active_generation_matches(BaseID).
active_generation_matches(ID) :-
    pokemon_mega_base(ID, BaseID),
    !,
    active_generation_matches(BaseID).
active_generation_matches(ID) :-
    active_generation(Generation),
    generation_range(Generation, MinID, MaxID),
    ID >= MinID,
    ID =< MaxID.

generation_range(1, 1, 151).
generation_range(2, 152, 251).
generation_range(3, 252, 386).
generation_range(4, 387, 493).
generation_range(5, 494, 649).
generation_range(6, 650, 721).
generation_range(7, 722, 809).
generation_range(8, 810, 905).
generation_range(9, 906, 1025).

print_pokemon_info(pokemon(ID, Name, Height, Weight, Types, Abilities, Stats)) :-
    maplist(display_type_label, Types, TypeLabels),
    maplist(display_label, Abilities, AbilityLabels),
    atomic_list_concat(TypeLabels, ', ', TypesText),
    atomic_list_concat(AbilityLabels, ', ', AbilitiesText),
    HeightM is Height / 10,
    WeightKg is Weight / 10,
    type_effectiveness_summary(Types, Weaknesses, Resistances, Immunities),
    effect_list_text(Weaknesses, WeakText),
    effect_list_text(Resistances, ResistText),
    type_list_text(Immunities, ImmunityText),
    build_brief_description(Types, Abilities, Stats, Description),
    pokemon_lore_text(ID, LoreRaw),
    beautify_lore_text(LoreRaw, LoreText),
    display_pokemon_name(Name, DisplayName),
    writeln('Bot: Pokémon encontrado!'),
    format('  Nome: ~w~n', [DisplayName]),
    format('  Número Pokédex: ~w~n', [ID]),
    format('  Altura: ~1f m (~w dm)~n', [HeightM, Height]),
    format('  Peso: ~1f kg (~w hg)~n', [WeightKg, Weight]),
    format('  Tipos: ~w~n', [TypesText]),
    format('  Habilidades: ~w~n', [AbilitiesText]),
    format('  Fraquezas: ~w~n', [WeakText]),
    format('  Resistências: ~w~n', [ResistText]),
    format('  Imunidades: ~w~n', [ImmunityText]),
    format('  Descrição: ~w~n', [Description]),
    format('  Lore: ~w~n', [LoreText]),
    writeln('  Status base:'),
    print_stats(Stats).

pokemon_lore_text(ID, LoreText) :-
    pokemon_lore(ID, LoreText),
    !.
pokemon_lore_text(_, 'Sem lore local disponível para este Pokémon.').

beautify_lore_text(Raw, Pretty) :-
    atom_string(Raw, RawText),
    lore_replace(RawText, "pokemon", "Pokémon", T1),
    lore_replace(T1, "regiao", "região", T2),
    lore_replace(T2, "eletrico", "elétrico", T3),
    lore_replace(T3, "psiquico", "psíquico", T4),
    lore_replace(T4, "dragao", "dragão", T5),
    lore_replace(T5, "agua", "água", T6),
    lore_replace(T6, "trovao", "trovão", T7),
    lore_replace(T7, "nao", "não", T8),
    lore_replace(T8, "lanca", "lança", T9),
    normalize_space(atom(Pretty), T9).

lore_replace(Input, Search, Replace, Output) :-
    ( sub_string(Input, Before, _, After, Search) ->
        sub_string(Input, 0, Before, _, Prefix),
        string_length(Search, SearchLength),
        Start is Before + SearchLength,
        sub_string(Input, Start, After, 0, Suffix),
        string_concat(Prefix, Replace, Temp),
        string_concat(Temp, Suffix, Next),
        lore_replace(Next, Search, Replace, Output)
    ; Output = Input
    ).

print_stats([]).
print_stats([Name-Value | Rest]) :-
    display_stat_label(Name, Label),
    format('    - ~w: ~w~n', [Label, Value]),
    print_stats(Rest).

display_label(Value, Label) :-
    atom_string(Value, Text),
    split_string(Text, "_", "", Parts),
    atomic_list_concat(Parts, ' ', Label).

all_types([normal, fire, water, electric, grass, ice, fighting, poison, ground, flying, psychic, bug, rock, ghost, dragon, dark, steel, fairy]).

type_effectiveness_summary(DefenseTypes, Weaknesses, Resistances, Immunities) :-
    all_types(AttackTypes),
    findall(Type-M,
        ( member(Type, AttackTypes),
          combined_multiplier(Type, DefenseTypes, M),
          M > 1.0
        ),
        Weaknesses),
    findall(Type-M,
        ( member(Type, AttackTypes),
          combined_multiplier(Type, DefenseTypes, M),
          M > 0.0,
          M < 1.0
        ),
        Resistances),
    findall(Type,
        ( member(Type, AttackTypes),
          combined_multiplier(Type, DefenseTypes, 0.0)
        ),
        Immunities).

combined_multiplier(AttackType, DefenseTypes, Multiplier) :-
    foldl(type_multiplier_fold(AttackType), DefenseTypes, 1.0, Multiplier).

type_multiplier_fold(AttackType, DefenseType, Acc, Result) :-
    type_multiplier(AttackType, DefenseType, ThisMultiplier),
    Result is Acc * ThisMultiplier.

type_multiplier(AttackType, DefenseType, Multiplier) :-
    ( type_chart(AttackType, DefenseType, Multiplier) -> true ; Multiplier = 1.0 ).

effect_list_text([], 'nenhuma').
effect_list_text(Effects, Text) :-
    maplist(effect_label, Effects, Labels),
    atomic_list_concat(Labels, ', ', Text).

effect_label(Type-Multiplier, Label) :-
    display_type_label(Type, TypeLabel),
    multiplier_text(Multiplier, MultText),
    format(atom(Label), '~w (~w)', [TypeLabel, MultText]).

multiplier_text(Multiplier, Text) :-
    RoundedInt is round(Multiplier),
    RoundedTenths is round(Multiplier * 10),
    ( abs(Multiplier - RoundedInt) < 0.00001 ->
        format(atom(Text), 'x~0f', [Multiplier])
    ; abs((Multiplier * 10) - RoundedTenths) < 0.00001 ->
        format(atom(Text), 'x~1f', [Multiplier])
    ; format(atom(Text), 'x~2f', [Multiplier])
    ).

type_list_text([], 'nenhuma').
type_list_text(Types, Text) :-
    maplist(display_type_label, Types, Labels),
    atomic_list_concat(Labels, ', ', Text).

build_brief_description(Types, Abilities, Stats, Description) :-
    maplist(display_type_label, Types, TypeLabels),
    atomic_list_concat(TypeLabels, '/', TypeText),
    dominant_stat(Stats, MainStat, _MainValue),
    stat_profile(MainStat, Profile),
    first_ability_text(Abilities, AbilityText),
    display_stat_label(MainStat, MainStatText),
    format(atom(Description), 'Pokémon do tipo ~w, com ~w. Destaque em ~w. Habilidade de destaque: ~w.', [TypeText, Profile, MainStatText, AbilityText]).

dominant_stat([Stat-Value], Stat, Value).
dominant_stat([Stat-Value | Rest], BestStat, BestValue) :-
    dominant_stat(Rest, CurrentStat, CurrentValue),
    ( Value >= CurrentValue ->
        BestStat = Stat,
        BestValue = Value
    ; BestStat = CurrentStat,
      BestValue = CurrentValue
    ).

stat_profile(attack, 'perfil ofensivo físico').
stat_profile(special_attack, 'perfil ofensivo especial').
stat_profile(defense, 'perfil defensivo').
stat_profile(special_defense, 'perfil defensivo').
stat_profile(speed, 'perfil veloz').
stat_profile(hp, 'boa resistência').
stat_profile(_, 'perfil equilibrado').

first_ability_text([Ability | _], Text) :-
    display_label(Ability, Text).
first_ability_text([], 'desconhecida').

display_type_label(Type, Label) :-
    ( type_pt(Type, Label) -> true ; display_label(Type, Label) ).

display_stat_label(Stat, Label) :-
    ( stat_pt(Stat, Label) -> true ; display_label(Stat, Label) ).

stat_command_text(hp, 'hp').
stat_command_text(attack, 'ataque').
stat_command_text(defense, 'defesa').
stat_command_text(special_attack, 'ataque especial').
stat_command_text(special_defense, 'defesa especial').
stat_command_text(speed, 'velocidade').

stat_pt(hp, 'HP').
stat_pt(attack, 'Ataque').
stat_pt(defense, 'Defesa').
stat_pt(special_attack, 'Ataque Especial').
stat_pt(special_defense, 'Defesa Especial').
stat_pt(speed, 'Velocidade').

type_pt(normal, 'Normal').
type_pt(fire, 'Fogo').
type_pt(water, 'Água').
type_pt(electric, 'Elétrico').
type_pt(grass, 'Grama').
type_pt(ice, 'Gelo').
type_pt(fighting, 'Lutador').
type_pt(poison, 'Veneno').
type_pt(ground, 'Terra').
type_pt(flying, 'Voador').
type_pt(psychic, 'Psíquico').
type_pt(bug, 'Inseto').
type_pt(rock, 'Pedra').
type_pt(ghost, 'Fantasma').
type_pt(dragon, 'Dragão').
type_pt(dark, 'Sombrio').
type_pt(steel, 'Aço').
type_pt(fairy, 'Fada').

type_chart(normal, rock, 0.5).
type_chart(normal, ghost, 0.0).
type_chart(normal, steel, 0.5).
type_chart(fire, fire, 0.5).
type_chart(fire, water, 0.5).
type_chart(fire, grass, 2.0).
type_chart(fire, ice, 2.0).
type_chart(fire, bug, 2.0).
type_chart(fire, rock, 0.5).
type_chart(fire, dragon, 0.5).
type_chart(fire, steel, 2.0).
type_chart(water, fire, 2.0).
type_chart(water, water, 0.5).
type_chart(water, grass, 0.5).
type_chart(water, ground, 2.0).
type_chart(water, rock, 2.0).
type_chart(water, dragon, 0.5).
type_chart(electric, water, 2.0).
type_chart(electric, electric, 0.5).
type_chart(electric, grass, 0.5).
type_chart(electric, ground, 0.0).
type_chart(electric, flying, 2.0).
type_chart(electric, dragon, 0.5).
type_chart(grass, fire, 0.5).
type_chart(grass, water, 2.0).
type_chart(grass, grass, 0.5).
type_chart(grass, poison, 0.5).
type_chart(grass, ground, 2.0).
type_chart(grass, flying, 0.5).
type_chart(grass, bug, 0.5).
type_chart(grass, rock, 2.0).
type_chart(grass, dragon, 0.5).
type_chart(grass, steel, 0.5).
type_chart(ice, fire, 0.5).
type_chart(ice, water, 0.5).
type_chart(ice, grass, 2.0).
type_chart(ice, ground, 2.0).
type_chart(ice, flying, 2.0).
type_chart(ice, dragon, 2.0).
type_chart(ice, steel, 0.5).
type_chart(ice, ice, 0.5).
type_chart(fighting, normal, 2.0).
type_chart(fighting, ice, 2.0).
type_chart(fighting, poison, 0.5).
type_chart(fighting, flying, 0.5).
type_chart(fighting, psychic, 0.5).
type_chart(fighting, bug, 0.5).
type_chart(fighting, rock, 2.0).
type_chart(fighting, ghost, 0.0).
type_chart(fighting, dark, 2.0).
type_chart(fighting, steel, 2.0).
type_chart(fighting, fairy, 0.5).
type_chart(poison, grass, 2.0).
type_chart(poison, poison, 0.5).
type_chart(poison, ground, 0.5).
type_chart(poison, rock, 0.5).
type_chart(poison, ghost, 0.5).
type_chart(poison, steel, 0.0).
type_chart(poison, fairy, 2.0).
type_chart(ground, fire, 2.0).
type_chart(ground, electric, 2.0).
type_chart(ground, grass, 0.5).
type_chart(ground, poison, 2.0).
type_chart(ground, flying, 0.0).
type_chart(ground, bug, 0.5).
type_chart(ground, rock, 2.0).
type_chart(ground, steel, 2.0).
type_chart(flying, electric, 0.5).
type_chart(flying, grass, 2.0).
type_chart(flying, fighting, 2.0).
type_chart(flying, bug, 2.0).
type_chart(flying, rock, 0.5).
type_chart(flying, steel, 0.5).
type_chart(psychic, fighting, 2.0).
type_chart(psychic, poison, 2.0).
type_chart(psychic, psychic, 0.5).
type_chart(psychic, dark, 0.0).
type_chart(psychic, steel, 0.5).
type_chart(bug, fire, 0.5).
type_chart(bug, grass, 2.0).
type_chart(bug, fighting, 0.5).
type_chart(bug, poison, 0.5).
type_chart(bug, flying, 0.5).
type_chart(bug, psychic, 2.0).
type_chart(bug, ghost, 0.5).
type_chart(bug, dark, 2.0).
type_chart(bug, steel, 0.5).
type_chart(bug, fairy, 0.5).
type_chart(rock, fire, 2.0).
type_chart(rock, ice, 2.0).
type_chart(rock, fighting, 0.5).
type_chart(rock, ground, 0.5).
type_chart(rock, flying, 2.0).
type_chart(rock, bug, 2.0).
type_chart(rock, steel, 0.5).
type_chart(ghost, normal, 0.0).
type_chart(ghost, psychic, 2.0).
type_chart(ghost, ghost, 2.0).
type_chart(ghost, dark, 0.5).
type_chart(dragon, dragon, 2.0).
type_chart(dragon, steel, 0.5).
type_chart(dragon, fairy, 0.0).
type_chart(dark, fighting, 0.5).
type_chart(dark, psychic, 2.0).
type_chart(dark, ghost, 2.0).
type_chart(dark, dark, 0.5).
type_chart(dark, fairy, 0.5).
type_chart(steel, fire, 0.5).
type_chart(steel, water, 0.5).
type_chart(steel, electric, 0.5).
type_chart(steel, ice, 2.0).
type_chart(steel, rock, 2.0).
type_chart(steel, steel, 0.5).
type_chart(steel, fairy, 2.0).
type_chart(fairy, fire, 0.5).
type_chart(fairy, fighting, 2.0).
type_chart(fairy, poison, 0.5).
type_chart(fairy, dragon, 2.0).
type_chart(fairy, dark, 2.0).
type_chart(fairy, steel, 0.5).

show_help :-
    writeln('Bot: Exemplos de uso:'),
    writeln('  1) info nome pikachu'),
    writeln('  2) info numero 25'),
    writeln('  3) pokemon charizard'),
    writeln('  4) tipo fogo'),
    writeln('  5) quantos pokemon existem do tipo grama'),
    writeln('  6) 25  (numero direto)'),
    writeln('  7) pokemon #25'),
    writeln('  8) geracao 1'),
    writeln('  9) geracao todas'),
    writeln(' 10) tipo fogo/voador'),
    writeln(' 11) habilidade blaze'),
    writeln(' 12) status velocidade'),
    writeln(' 13) status velocidade completo'),
    writeln(' 14) pokemon charizard mega x'),
    writeln(' 15) qual é um bom pokemon contra charizard').

print_follow_up_prompt :-
    writeln('Bot: Quer fazer outra consulta? Ex.: "pokemon pikachu", "tipo água", "habilidade blaze" ou "status ataque".').
