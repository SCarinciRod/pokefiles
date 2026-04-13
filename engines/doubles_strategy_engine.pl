:- encoding(utf8).
:- ensure_loaded('../db/move_tactical_catalog.pl').

:- dynamic pending_partner_options/2.
:- dynamic pending_partner_preferences/2.
:- dynamic pending_synergy_details/2.
:- dynamic cache_pair_strategy_profile/3.
:- dynamic cache_pair_synergy_breakdown/5.

handle_pending_partner_preferences(Text) :-
    pending_partner_preferences(TargetIdentifier, Limit),
    !,
    tokenize_for_match(Text, Tokens),
    ( has_cancel_token(Tokens) ->
        retractall(pending_partner_preferences(_, _)),
        writeln('Bot: Certo, cancelei o refinamento de parceiros por agora.')
    ; partner_preferences_from_text(Text, TargetIdentifier, Preferences) ->
        retractall(pending_partner_preferences(_, _)),
        answer_compatible_partners_query_with_preferences(TargetIdentifier, Limit, Preferences)
    ; partner_preferences_default_text(Tokens) ->
        retractall(pending_partner_preferences(_, _)),
        partner_default_preferences(DefaultPreferences),
        answer_compatible_partners_query_with_preferences(TargetIdentifier, Limit, DefaultPreferences)
    ; format('Bot: Me diga em uma frase: papel de ~w (principal/suporte), filtros (sem lendarios/sem mega), parceiro em mente ou exclusoes. Diga "padrao" para seguir sem filtro.~n', [TargetIdentifier])
    ).

partner_preferences_default_text(Tokens) :-
    is_yes_response_tokens(Tokens),
    !.
partner_preferences_default_text(Tokens) :-
    counter_preferences_default_text(Tokens),
    !.
partner_preferences_default_text(Tokens) :-
    member(Token, Tokens),
    member(Token, ["padrao", "normal", "default", "livre", "qualquer", "semfiltro", "semfiltros"]),
    !.

partner_default_preferences(partner_prefs{
    target_role:flexible,
    context_filters:[],
    type_filters:[],
    include_names:[],
    exclude_names:[]
}).

partner_preferences_from_text(Text, TargetIdentifier, Preferences) :-
    tokenize_for_match(Text, Tokens),
    partner_extract_context_filters(Tokens, ContextFilters),
    ( extract_type_filters(Tokens, TypeFilters) -> true ; TypeFilters = [] ),
    partner_extract_named_preferences(Text, TargetIdentifier, IncludeNames, ExcludeNames),
    partner_target_role_from_tokens(Tokens, TargetRole),
    ( ContextFilters \= []
    ; TypeFilters \= []
    ; IncludeNames \= []
    ; ExcludeNames \= []
    ; TargetRole \= flexible
    ),
    Preferences = partner_prefs{
        target_role:TargetRole,
        context_filters:ContextFilters,
        type_filters:TypeFilters,
        include_names:IncludeNames,
        exclude_names:ExcludeNames
    }.

partner_extract_context_filters(Tokens, ContextFilters) :-
    findall(Filter,
        ( context_filter_token(Filter, FilterTokens),
          contiguous_sublist(FilterTokens, Tokens)
        ),
        Raw),
    sort(Raw, ContextFilters).

partner_extract_named_preferences(Text, TargetIdentifier, IncludeNames, ExcludeNames) :-
    extract_all_pokemon_mentions(Text, MentionsRaw),
    findall(Name,
        ( member(Name, MentionsRaw),
          Name \= TargetIdentifier
        ),
        OthersRaw),
    sort(OthersRaw, Others),
    ( Others == [] ->
        IncludeNames = [],
        ExcludeNames = []
    ; input_to_string(Text, TextString),
      string_lower(TextString, LowerText),
      findall(Name,
          ( member(Name, Others),
            partner_name_marked_excluded(LowerText, Name)
          ),
          ExcludedRaw),
      sort(ExcludedRaw, ExcludedByPattern),
      findall(Name,
          ( member(Name, Others),
            \+ member(Name, ExcludedByPattern)
          ),
          IncludedRaw),
      sort(IncludedRaw, IncludeNames),
      ExcludeNames = ExcludedByPattern
    ).

partner_name_marked_excluded(LowerText, Name) :-
    partner_name_label_text(Name, LabelText),
    string_concat('sem ', LabelText, Pattern),
    sub_string(LowerText, _, _, _, Pattern),
    !.
partner_name_marked_excluded(LowerText, Name) :-
    partner_name_label_text(Name, LabelText),
    string_concat('excluir ', LabelText, Pattern),
    sub_string(LowerText, _, _, _, Pattern),
    !.
partner_name_marked_excluded(LowerText, Name) :-
    partner_name_label_text(Name, LabelText),
    string_concat('tirar ', LabelText, Pattern),
    sub_string(LowerText, _, _, _, Pattern),
    !.
partner_name_marked_excluded(LowerText, Name) :-
    partner_name_label_text(Name, LabelText),
    string_concat('menos ', LabelText, Pattern),
    sub_string(LowerText, _, _, _, Pattern),
    !.

partner_name_label_text(Name, LabelText) :-
    display_label(Name, Label),
    input_to_string(Label, LabelRaw),
    string_lower(LabelRaw, LabelText).

partner_target_role_from_tokens(Tokens, main) :-
    member(Token, Tokens),
    member(Token, ["principal", "carry", "wincon", "atacante"]),
    !.
partner_target_role_from_tokens(Tokens, support) :-
    member(Token, Tokens),
    member(Token, ["suporte", "support", "apoio", "helper"]),
    !.
partner_target_role_from_tokens(_, flexible).

handle_pending_partner_options(Text) :-
    pending_partner_options(TargetLabel, Remaining),
    !,
    tokenize_for_match(Text, Tokens),
    ( has_cancel_token(Tokens) ->
        retractall(pending_partner_options(_, _)),
        retractall(pending_synergy_details(_, _)),
        writeln('Bot: Certo, parei as opções de parceiros por agora.')
    ; partner_next_option_request(Tokens) ->
        consume_next_partner_option(TargetLabel, Remaining)
    ; synergy_detail_request(Tokens, Text, _Request) ->
        fail
    ; format('Bot: Se quiser seguir a lista de parceiros para ~w, diga "outra opção". Para encerrar, diga "cancelar".~n', [TargetLabel])
    ).

partner_next_option_request(Tokens) :-
    is_yes_response_tokens(Tokens),
    !.
partner_next_option_request(Tokens) :-
    contiguous_sublist(["outra", "opcao"], Tokens),
    !.
partner_next_option_request(Tokens) :-
    contiguous_sublist(["proxima", "opcao"], Tokens),
    !.
partner_next_option_request(Tokens) :-
    member(Token, Tokens),
    partner_next_option_token(Token),
    !.

partner_next_option_token("outra").
partner_next_option_token("proxima").
partner_next_option_token("proximo").
partner_next_option_token("seguinte").
partner_next_option_token("alternativa").

consume_next_partner_option(_TargetLabel, []) :-
    retractall(pending_partner_options(_, _)),
    writeln('Bot: Não há mais opções na lista atual de parceiros.').
consume_next_partner_option(TargetLabel, [Pair | Rest]) :-
    print_compatible_partner_lines([Pair]),
    synergy_details_append_partner_pair(TargetLabel, Pair),
    retractall(pending_partner_options(_, _)),
    ( Rest == [] ->
        writeln('Bot: Essas eram as principais opções disponíveis neste ranking.')
    ; assertz(pending_partner_options(TargetLabel, Rest)),
      format('Bot: Se quiser outra opção para ~w, peça "outra opção".~n', [TargetLabel])
    ).

handle_pending_synergy_details(Text) :-
    pending_synergy_details(Context, Entries),
    !,
    tokenize_for_match(Text, Tokens),
    ( has_cancel_token(Tokens) ->
        retractall(pending_synergy_details(_, _)),
        writeln('Bot: Certo, parei o detalhamento de sinergia por agora.')
    ; synergy_detail_request(Tokens, Text, Request) ->
        answer_synergy_detail_request(Context, Entries, Request)
    ; synergy_detail_help_message(Context)
    ).

synergy_detail_request(Tokens, _Text, all) :-
    is_yes_response_tokens(Tokens),
    !.
synergy_detail_request(Tokens, _Text, all) :-
    member(Token, Tokens),
    member(Token, ["tudo", "todos", "todas", "geral", "completo", "completa"]),
    !.
synergy_detail_request(Tokens, _Text, index(Index)) :-
    single_numeric_word(Tokens),
    extract_number(Tokens, Index),
    !.
synergy_detail_request(Tokens, _Text, index(Index)) :-
    synergy_detail_trigger(Tokens),
    extract_number(Tokens, Index),
    !.
synergy_detail_request(Tokens, Text, name(Name)) :-
    synergy_detail_trigger(Tokens),
    extract_all_pokemon_mentions(Text, Mentions),
    Mentions = [Name | _],
    !.
synergy_detail_request(Tokens, _Text, help) :-
    synergy_detail_trigger(Tokens),
    !.

synergy_detail_trigger(Tokens) :-
    member(Token, Tokens),
    member(Token, ["detalhar", "detalhe", "detalhes", "detalhamento", "explicar", "explica", "explicacao", "aprofundar", "aprofunda", "aprofundado"]),
    !.

answer_synergy_detail_request(Context, _Entries, help) :-
    !,
    synergy_detail_help_message(Context).
answer_synergy_detail_request(Context, Entries, all) :-
    !,
    print_synergy_detail_collection(Context, Entries),
    synergy_detail_followup_message(Context).
answer_synergy_detail_request(Context, Entries, index(Index)) :-
    !,
    ( member(detail_entry(Index, Name, Title, Reasons), Entries) ->
        print_synergy_detail_entry(detail_entry(Index, Name, Title, Reasons)),
        synergy_detail_followup_message(Context)
    ; length(Entries, Count),
      format('Bot: Nao achei esse indice. Escolha um numero entre 1 e ~w, ou diga "detalhar tudo".~n', [Count])
    ).
answer_synergy_detail_request(Context, Entries, name(Name)) :-
    !,
    ( member(detail_entry(Index, Name, Title, Reasons), Entries) ->
        print_synergy_detail_entry(detail_entry(Index, Name, Title, Reasons)),
        synergy_detail_followup_message(Context)
    ; Context = partners_context(_TargetLabel) ->
        display_pokemon_name(Name, NameLabel),
        format('Bot: Nao achei ~w no ranking atual. Use um nome exibido na lista ou "detalhar <indice>".~n', [NameLabel])
    ; writeln('Bot: Neste detalhamento use indice (ex.: "detalhar 1") ou "detalhar tudo".')
    ).

print_synergy_detail_collection(pair_context(LabelA, LabelB), Entries) :-
    format('Bot: Detalhamento da sinergia entre ~w e ~w:~n', [LabelA, LabelB]),
    print_synergy_detail_entries(Entries).
print_synergy_detail_collection(partners_context(TargetLabel), Entries) :-
    format('Bot: Detalhamento das opcoes listadas para ~w:~n', [TargetLabel]),
    print_synergy_detail_entries(Entries).

print_synergy_detail_entries([]).
print_synergy_detail_entries([Entry | Rest]) :-
    print_synergy_detail_entry(Entry),
    print_synergy_detail_entries(Rest).

print_synergy_detail_entry(detail_entry(Index, _Name, Title, Reasons)) :-
    format('Bot: Detalhamento #~w - ~w.~n', [Index, Title]),
    print_synergy_reason_details(Reasons).

print_synergy_reason_details([]) :-
    writeln('  - Sem pontos adicionais para detalhar neste item.').
print_synergy_reason_details([Score-Reason | Rest]) :-
    synergy_reason_strength_label(Score, StrengthLabel),
    synergy_reason_impact_text(Reason, ImpactText),
    format('  - ~w (~w).~n', [Reason, StrengthLabel]),
    format('    Impacto pratico: ~w~n', [ImpactText]),
    print_synergy_reason_details(Rest).

synergy_reason_strength_label(Score, 'sinal forte') :-
    Score >= 24,
    !.
synergy_reason_strength_label(Score, 'sinal relevante') :-
    Score >= 14,
    !.
synergy_reason_strength_label(_Score, 'sinal complementar').

synergy_reason_impact_text(Reason, ImpactText) :-
    input_to_string(Reason, ReasonText),
    string_lower(ReasonText, LowerReason),
    ( sub_string(LowerReason, _, _, _, 'prioridade no ranking') ->
        ImpactText = 'Reflete sua preferencia declarada para ordenar o ranking; nao bloqueia alternativas.'
    ; synergy_reason_contains_any(LowerReason, ["clima", "chuva", "sol", "areia", "neve", "weather"]) ->
        ImpactText = 'Gera vantagem recorrente de estado de campo e melhora a consistencia dos turnos de pressao.'
    ; synergy_reason_contains_any(LowerReason, ["terreno", "terrain"]) ->
        ImpactText = 'Ajuda a controlar ritmo e matchups por varios turnos, favorecendo as linhas da dupla.'
    ; synergy_reason_contains_any(LowerReason, ["velocidade", "speed", "trick room"]) ->
        ImpactText = 'Mexe na ordem de acao do turno, abrindo espaco para converter dano antes da resposta rival.'
    ; synergy_reason_contains_any(LowerReason, ["janela de execução", "janela de execucao", "setup", "protect", "redirecionamento", "fake out"]) ->
        ImpactText = 'Cria turnos de baixo risco para preparar setup ou estabilizar board antes da ofensiva.'
    ; synergy_reason_contains_any(LowerReason, ["flame orb", "toxic orb", "guts", "poison heal"]) ->
        ImpactText = 'Facilita ativacao de item/habilidade em timing seguro, reduzindo dependencia de leitura perfeita.'
    ; synergy_reason_contains_any(LowerReason, ["cobertura defensiva", "fraqueza"]) ->
        ImpactText = 'Diminui punicao por cobertura rival, permitindo mais trocas e rota de jogo consistente.'
    ; synergy_reason_contains_any(LowerReason, ["pressão ofensiva", "pressao ofensiva", "stab"]) ->
        ImpactText = 'Aumenta o numero de alvos que a dupla pressiona com vantagem, reduzindo janelas de resposta.'
    ; synergy_reason_contains_any(LowerReason, ["papéis podem inverter", "papeis podem inverter", "matchup"]) ->
        ImpactText = 'Adiciona flexibilidade de funcao entre os dois slots, melhorando adaptacao em diferentes matchups.'
    ; ImpactText = 'Contribui para um plano de jogo mais estavel ao longo dos turnos, com menos dependencia de risco alto.'
    ).

synergy_reason_contains_any(_LowerReason, []) :-
    fail.
synergy_reason_contains_any(LowerReason, [Needle | Rest]) :-
    ( sub_string(LowerReason, _, _, _, Needle)
    ; synergy_reason_contains_any(LowerReason, Rest)
    ).

synergy_detail_help_message(pair_context(LabelA, LabelB)) :-
    format('Bot: Posso detalhar a dupla ~w e ~w. Diga "detalhar 1" ou "detalhar tudo". Para encerrar, diga "cancelar".~n', [LabelA, LabelB]).
synergy_detail_help_message(partners_context(TargetLabel)) :-
    format('Bot: Posso detalhar o ranking de parceiros para ~w. Diga "detalhar 1", "detalhar <nome>" ou "detalhar tudo". Para encerrar, diga "cancelar".~n', [TargetLabel]).

synergy_detail_followup_message(pair_context(_LabelA, _LabelB)) :-
    writeln('Bot: Se quiser outro ponto, peça "detalhar <indice>" ou "detalhar tudo".').
synergy_detail_followup_message(partners_context(_TargetLabel)) :-
    writeln('Bot: Se quiser outro detalhe, peça "detalhar <indice/nome>", "detalhar tudo" ou "outra opção".').

parse_doubles_strategy_query(Text, Topic) :-
    tokenize_for_match(Text, Tokens),
    doubles_strategy_tokens(Tokens),
    doubles_strategy_topic_from_tokens(Tokens, Topic),
    !.
parse_doubles_strategy_query(Text, general) :-
    tokenize_for_match(Text, Tokens),
    doubles_strategy_tokens(Tokens).

doubles_strategy_tokens(Tokens) :-
    member(Token, Tokens),
    strategy_intent_token(Token),
    !.
doubles_strategy_tokens(Tokens) :-
    member(Token, Tokens),
    doubles_format_token(Token),
    !.
doubles_strategy_tokens(Tokens) :-
    contiguous_sublist(["speed", "control"], Tokens),
    !.
doubles_strategy_tokens(Tokens) :-
    contiguous_sublist(["trick", "room"], Tokens),
    !.
doubles_strategy_tokens(Tokens) :-
    contiguous_sublist(["plano", "jogo"], Tokens),
    !.

doubles_strategy_topic_from_tokens(Tokens, anti_trick_room) :-
    doubles_strategy_tokens_include_any(Tokens, ["trick_room", "trick", "room", "inverter", "inversao"]),
    doubles_strategy_tokens_include_any(Tokens, ["contra", "lidar", "responder", "parar", "plano", "jogar"]),
    !.
doubles_strategy_topic_from_tokens(Tokens, speed_control) :-
    doubles_strategy_tokens_include_any(Tokens, ["velocidade", "speed", "rapidez", "tailwind", "icy_wind", "thunder_wave", "prioridade", "priority", "scarf", "trick_room", "trick", "room"]),
    !.
doubles_strategy_topic_from_tokens(Tokens, weather_pivot) :-
    doubles_strategy_tokens_include_any(Tokens, ["clima", "climas", "weather", "sol", "chuva", "areia", "neve", "sun", "rain", "sand", "snow"]),
    !.
doubles_strategy_topic_from_tokens(Tokens, adaptation_bo3) :-
    doubles_strategy_tokens_include_any(Tokens, ["bo1", "bo3", "adaptacao", "adaptar", "ajuste", "ajustar", "game1", "game2", "game3", "serie"]),
    !.
doubles_strategy_topic_from_tokens(Tokens, lead_positioning) :-
    doubles_strategy_tokens_include_any(Tokens, ["lead", "leads", "abertura", "posicionamento", "pivot", "pivotar", "protect", "detect", "follow_me", "rage_powder", "foco", "alvo", "troca", "switch"]),
    !.
doubles_strategy_topic_from_tokens(Tokens, mixed_modes) :-
    doubles_strategy_tokens_include_any(Tokens, ["misturar", "mistura", "surpresa", "versatil", "versatilidade", "modo", "modos", "plano"]),
    doubles_strategy_tokens_include_any(Tokens, ["dupla", "duplas", "doubles", "vgc", "bo3"]),
    !.
doubles_strategy_topic_from_tokens(Tokens, build_own_plan) :-
    doubles_strategy_tokens_include_any(Tokens, ["montar", "construir", "compor", "planejar", "core", "time", "estrategia", "estrategico", "proprio", "propria"]),
    !.
doubles_strategy_topic_from_tokens(_, general).

doubles_strategy_tokens_include_any(Tokens, Candidates) :-
    member(Token, Tokens),
    member(Token, Candidates),
    !.

answer_doubles_strategy_query(Topic) :-
    doubles_strategy_topic_title(Topic, Title),
    doubles_strategy_topic_lines(Topic, Lines),
    format('Bot: Estrategia VGC Doubles - ~w.~n', [Title]),
    writeln('Bot: Foco em arquitetura de jogo (plano, ritmo e adaptacao); os numeros podem ser calibrados depois sem quebrar o modelo.'),
    print_doubles_strategy_lines(Lines).

doubles_strategy_topic_title(speed_control, 'controle de velocidade').
doubles_strategy_topic_title(anti_trick_room, 'resposta ao trick room').
doubles_strategy_topic_title(weather_pivot, 'guerra de clima e pivot').
doubles_strategy_topic_title(adaptation_bo3, 'adaptacao em serie BO3').
doubles_strategy_topic_title(lead_positioning, 'lead e posicionamento').
doubles_strategy_topic_title(mixed_modes, 'mistura de modos de jogo').
doubles_strategy_topic_title(build_own_plan, 'montagem de estratégia própria').
doubles_strategy_topic_title(general, 'arquitetura tatico-estrategica').

doubles_strategy_topic_lines(speed_control, [
    "Defina antes da partida qual sera seu modo principal de ganhar o turno inicial.",
    "Trabalhe com tres alavancas: acelerar seu lado, reduzir o lado rival e inverter ordem com Trick Room.",
    "Trate prioridade como camada de seguranca para quando o plano de Speed falhar.",
    "Evite gastar seu principal recurso de controle de velocidade cedo sem gerar vantagem real de board.",
    "Quando possivel, mantenha um plano B de velocidade para nao perder o jogo por um unico deny."
]).

doubles_strategy_topic_lines(anti_trick_room, [
    "Tenha duas respostas prontas: impedir o setup e administrar os turnos caso Trick Room suba.",
    "Se Trick Room entrou, priorize sobrevivencia e troca de posicionamento para gastar turnos com baixo risco.",
    "Foque em pressionar setter e principal abusador em vez de distribuir dano sem objetivo.",
    "Conserve recursos defensivos (Protect, pivots e redirecionamento) para navegar a janela desfavoravel.",
    "Se o seu time permite, mantenha um mini modo lento para nao depender apenas de negar o setup."
]).

doubles_strategy_topic_lines(weather_pivot, [
    "Nao dependa de um unico clima para vencer; trate clima como vantagem de estado, nao como unica wincon.",
    "Planeje sequencias de entrada para disputar clima no turno em que o dano efetivo importa.",
    "Escolha duplas de lead que funcionem com e sem clima ativo, reduzindo fragilidade a mirror.",
    "Use pivot para reativar clima no timing correto, em vez de trocar clima sem ganho de board.",
    "Tenha sempre um plano neutro para partidas em que o clima principal seja contestado cedo."
]).

doubles_strategy_topic_lines(adaptation_bo3, [
    "No Game 1, jogue para mapear ritmo, item reveal e condicao de vitoria rival.",
    "No Game 2, ajuste os 4 escolhidos para responder ao plano mais provavel do adversario.",
    "No Game 3, priorize consistencia sobre surpresa: execute o modo com menor risco estrutural.",
    "Ajuste lead e ordem de preservacao de recursos em vez de trocar todo o plano entre jogos.",
    "Registre mentalmente quais turnos decidiram o jogo para corrigir macro decisao, nao apenas dano."
]).

doubles_strategy_topic_lines(lead_positioning, [
    "Abra com dupla que combine pressao imediata e opcao defensiva no mesmo turno.",
    "Em doubles, posicionamento vale mais que dano bruto: preserve a peca que ancora seu plano.",
    "Use Protect e redirecionamento para converter turnos perigosos em vantagem de board no turno seguinte.",
    "Defina foco de alvo por funcao: remover suporte de ritmo costuma render mais que dano espalhado.",
    "Planeje trocas com objetivo de alinhar matchups, nao apenas escapar de um golpe especifico."
]).

doubles_strategy_topic_lines(mixed_modes, [
    "Time forte em doubles geralmente carrega dois modos de jogo com transicao natural entre eles.",
    "Evite composicao que colapse quando o modo principal for lido ou negado.",
    "Misture condicoes de vitoria que compartilham pecas, para adaptar sem perder coesao.",
    "Use selecao de 4 para esconder parte do plano e forcar leitura incompleta no rival.",
    "A versatilidade deve aumentar consistencia, nao virar troca aleatoria de identidade a cada jogo."
]).

doubles_strategy_topic_lines(build_own_plan, [
    "Monte o plano em camadas: condicao de vitoria, janela de execução e plano de contingencia.",
    "Avalie cada slot por quatro eixos juntos: moveset, stats, habilidade e item viavel para o papel.",
    "Pergunta-chave por dupla: quem cria turno (Protect/redirecionamento/Fake Out) e quem converte esse turno em avanço real.",
    "Nao trate score como valor absoluto: use o ranking para ordenar opções e depois valide coerencia do plano no conjunto.",
    "Se quiser, eu analiso uma core sua e devolvo riscos, pontos fortes e ajustes de ritmo/posicionamento."
]).

doubles_strategy_topic_lines(general, [
    "Arquitetura recomendada: plano A de ritmo, plano B de emergencia e criterio de transicao entre eles.",
    "Decida cada turno em ordem: ritmo (quem age primeiro), estado de campo (clima/terreno) e posicionamento.",
    "Em doubles, preservar recurso chave costuma valer mais que buscar KO de baixo impacto.",
    "Adapte por estrutura da partida, nao por impulso: cada troca e cada Protect devem servir ao plano.",
    "Se quiser, eu detalho um plano por tema: speed control, anti trick room, clima, lead ou BO3."
]).

print_doubles_strategy_lines([]).
print_doubles_strategy_lines([Line | Rest]) :-
    format('  - ~w~n', [Line]),
    print_doubles_strategy_lines(Rest).

parse_pair_synergy_query(Text, NameA, NameB) :-
    tokenize_for_match(Text, Tokens),
    pair_synergy_query_signal(Tokens),
    extract_all_pokemon_mentions(Text, Mentions),
    Mentions = [NameA, NameB | _],
    NameA \= NameB.

parse_compatible_partners_query(Text, Name, Limit) :-
    tokenize_for_match(Text, Tokens),
    compatible_partners_query_signal(Tokens),
    extract_all_pokemon_mentions(Text, Mentions),
    ( Mentions = [] ; Mentions = [_] ),
    parse_natural_pokemon_query(Text, Name),
    strategy_partner_limit_from_tokens(Tokens, Limit).

pair_synergy_query_signal(Tokens) :-
    token_member_pred(Tokens, synergy_intent_token),
    ( member("entre", Tokens)
    ; member("e", Tokens)
    ; member("com", Tokens)
    ; member("vs", Tokens)
    ; member("x", Tokens)
    ),
    !.
pair_synergy_query_signal(Tokens) :-
    contiguous_sublist(["sinergia", "entre"], Tokens),
    !.
pair_synergy_query_signal(Tokens) :-
    contiguous_sublist(["combina", "com"], Tokens),
    !.

compatible_partners_query_signal(Tokens) :-
    token_member_pred(Tokens, synergy_intent_token),
    ( member("com", Tokens)
    ; member("para", Tokens)
    ; member("quem", Tokens)
    ),
    !.
compatible_partners_query_signal(Tokens) :-
    contiguous_sublist(["quem", "combina", "com"], Tokens),
    !.
compatible_partners_query_signal(Tokens) :-
    contiguous_sublist(["parceiros", "para"], Tokens),
    !.
compatible_partners_query_signal(Tokens) :-
    contiguous_sublist(["compativeis", "com"], Tokens),
    !.

strategy_partner_limit_from_tokens(Tokens, Limit) :-
    ( current_predicate(parse_limit_from_tokens/2),
      parse_limit_from_tokens(Tokens, Parsed) ->
        LimitRaw = Parsed
    ; LimitRaw = 6
    ),
    LimitCap is min(12, LimitRaw),
    Limit is max(1, LimitCap).

answer_pair_synergy_query(IdentifierA, IdentifierB) :-
    retractall(pending_partner_options(_, _)),
    retractall(pending_partner_preferences(_, _)),
    retractall(pending_synergy_details(_, _)),
    pokemon_info(IdentifierA, pokemon(IDA, NameA, _, _, TypesA, AbilitiesA, StatsA)),
    pokemon_info(IdentifierB, pokemon(IDB, NameB, _, _, TypesB, AbilitiesB, StatsB)),
    pair_synergy_breakdown(IDA, NameA, TypesA, AbilitiesA, StatsA, IDB, NameB, TypesB, AbilitiesB, StatsB, Score, Reasons),
    display_pokemon_name(NameA, LabelA),
    display_pokemon_name(NameB, LabelB),
    pair_synergy_band_label(Score, BandLabel),
    format('Bot: Sinergia estrategica entre ~w e ~w (~w).~n', [LabelA, LabelB, BandLabel]),
    ( Reasons \= [] ->
        writeln('Bot: Principais pontos de compatibilidade:'),
        print_pair_synergy_reasons(Reasons),
        pair_detail_entries_from_reasons(Reasons, DetailEntries)
    ; writeln('Bot: Nao encontrei sinergias fortes no modelo atual (moveset, stats, habilidades e plano de item) para essa dupla.'),
      DetailEntries = []
    ),
    writeln('Bot: Os moves citados sao exemplos de linhas viaveis dentro do movepool; o set final depende da funcao escolhida para cada um.'),
    writeln('Bot: Essa leitura e arquitetural (plano de jogo). Ajustes numericos finos podem ser calibrados depois.'),
    set_pending_synergy_details(pair_context(LabelA, LabelB), DetailEntries),
    synergy_detail_prompt(pair_context(LabelA, LabelB), DetailEntries).
answer_pair_synergy_query(IdentifierA, IdentifierB) :-
    retractall(pending_partner_options(_, _)),
    retractall(pending_partner_preferences(_, _)),
    retractall(pending_synergy_details(_, _)),
    display_pokemon_name(IdentifierA, LabelA),
    display_pokemon_name(IdentifierB, LabelB),
    format('Bot: Nao consegui resolver a dupla para sinergia (~w e ~w).~n', [LabelA, LabelB]).

answer_compatible_partners_query(Identifier, Limit) :-
    retractall(pending_partner_options(_, _)),
    retractall(pending_partner_preferences(_, _)),
    retractall(pending_synergy_details(_, _)),
    pokemon_info(Identifier, pokemon(_TargetID, TargetName, _, _, _TargetTypes, _TargetAbilities, _TargetStats)),
    !,
    display_pokemon_name(TargetName, TargetLabel),
    assertz(pending_partner_preferences(TargetName, Limit)),
    format('Bot: Antes de listar parceiros para ~w, vou refinar para ficar mais util no seu contexto.~n', [TargetLabel]),
    writeln('Bot: Me diga em uma frase:'),
    writeln('  - Se esse Pokemon sera principal (carry) ou suporte da dupla.'),
    writeln('  - Se quer filtros como "sem lendarios", "sem mega" ou foco de tipo (ex.: "tipo agua").'),
    writeln('  - Se ja tem alguem em mente ou alguem para excluir.'),
    writeln('Bot: Exemplo: "principal, sem lendarios, com rotom wash, sem garchomp". Se quiser seguir sem filtro, diga "padrao".').
answer_compatible_partners_query(Identifier, _Limit) :-
    retractall(pending_partner_options(_, _)),
    retractall(pending_partner_preferences(_, _)),
    retractall(pending_synergy_details(_, _)),
    display_pokemon_name(Identifier, TargetLabel),
    format('Bot: Nao encontrei parceiros claros para ~w com os sinais de sinergia modelados agora.~n', [TargetLabel]).

answer_compatible_partners_query_with_preferences(Identifier, Limit, Preferences) :-
    retractall(pending_partner_options(_, _)),
    retractall(pending_partner_preferences(_, _)),
    retractall(pending_synergy_details(_, _)),
    pokemon_info(Identifier, pokemon(TargetID, TargetName, _, _, TargetTypes, TargetAbilities, TargetStats)),
    pair_strategy_profile(TargetID, TargetName, TargetTypes, TargetAbilities, TargetStats, TargetProfile),
    partner_pref_context_filters(Preferences, ContextFilters),
    partner_pref_type_filters(Preferences, TypeFilters),
    partner_pref_include_names(Preferences, IncludeNames),
    partner_pref_exclude_names(Preferences, ExcludeNames),
    partner_pref_target_role(Preferences, TargetRole),
    partner_shortlist_size(Limit, ShortlistSize),
    findall(QuickScore-CandidateID-CandidateName-CandidateTypes-CandidateAbilities-CandidateStats,
        ( pokemon_in_scope(CandidateID, CandidateName, _, _, CandidateTypes, CandidateAbilities, CandidateStats),
          CandidateName \= TargetName,
          name_passes_filters(ContextFilters, CandidateName),
          pokemon_matches_optional_type_filters(TypeFilters, CandidateTypes),
          partner_candidate_allowed_by_name_filters(CandidateName, IncludeNames, ExcludeNames),
          partner_candidate_quick_score(TargetTypes, TargetAbilities, TargetStats,
              CandidateTypes, CandidateAbilities, CandidateStats,
              TargetRole, IncludeNames, CandidateName, QuickScore)
        ),
        QuickPairsRaw),
    QuickPairsRaw \= [],
    keysort(QuickPairsRaw, QuickAsc),
    reverse(QuickAsc, QuickDesc),
    partner_dedupe_quick_candidates_by_name(QuickDesc, QuickUnique),
    take_first_n(QuickUnique, ShortlistSize, ShortlistedCandidates),
    ShortlistedCandidates \= [],
    findall(FinalScore-CandidateName-Reasons,
        ( member(_QuickScore-CandidateID-CandidateName-CandidateTypes-CandidateAbilities-CandidateStats, ShortlistedCandidates),
          pair_synergy_breakdown(TargetID, TargetName, TargetTypes, TargetAbilities, TargetStats,
                                CandidateID, CandidateName, CandidateTypes, CandidateAbilities, CandidateStats,
                                BaseScore, ReasonsRaw),
          BaseScore > 0,
          pair_strategy_profile(CandidateID, CandidateName, CandidateTypes, CandidateAbilities, CandidateStats, CandidateProfile),
          partner_target_role_bonus(TargetRole, TargetProfile, CandidateProfile, RoleBonus, RoleReason),
                    partner_include_name_bonus(CandidateName, IncludeNames, IncludeBonus, IncludeReason),
                    FinalScore is BaseScore + RoleBonus + IncludeBonus,
          FinalScore > 0,
                    partner_merge_role_reason(RoleBonus, RoleReason, ReasonsRaw, ReasonsWithRole),
                    partner_merge_include_reason(IncludeBonus, IncludeReason, ReasonsWithRole, ReasonsMerged),
          pair_reasons_top(ReasonsMerged, 3, Reasons)
        ),
        ScoredRaw),
    ScoredRaw \= [],
    keysort(ScoredRaw, ScoredAsc),
    reverse(ScoredAsc, ScoredDesc),
    partner_dedupe_pairs_by_name(ScoredDesc, ScoredUnique),
    take_first_n(ScoredUnique, Limit, TopPairs),
    display_pokemon_name(TargetName, TargetLabel),
    partner_preferences_summary_text(Preferences, SummaryText),
    format('Bot: Parceiros compativeis com ~w (top ~w):~n', [TargetLabel, Limit]),
    format('Bot: Filtro aplicado: ~w.~n', [SummaryText]),
    print_compatible_partner_preview(TargetLabel, Limit, TopPairs),
    writeln('Bot: Lista baseada em estrutura de jogo (moveset, stats, habilidades e plano de item), independente de tuning numerico fino.').
answer_compatible_partners_query_with_preferences(Identifier, _Limit, _Preferences) :-
    retractall(pending_partner_options(_, _)),
    retractall(pending_partner_preferences(_, _)),
    retractall(pending_synergy_details(_, _)),
    display_pokemon_name(Identifier, TargetLabel),
    format('Bot: Nao encontrei parceiros claros para ~w com os filtros escolhidos. Se quiser, diga "padrao" ou relaxe algum filtro.~n', [TargetLabel]).

partner_pref_context_filters(Preferences, ContextFilters) :-
    ( get_dict(context_filters, Preferences, ContextFilters) -> true ; ContextFilters = [] ).

partner_pref_type_filters(Preferences, TypeFilters) :-
    ( get_dict(type_filters, Preferences, TypeFilters) -> true ; TypeFilters = [] ).

partner_pref_include_names(Preferences, IncludeNames) :-
    ( get_dict(include_names, Preferences, IncludeNames) -> true ; IncludeNames = [] ).

partner_pref_exclude_names(Preferences, ExcludeNames) :-
    ( get_dict(exclude_names, Preferences, ExcludeNames) -> true ; ExcludeNames = [] ).

partner_pref_target_role(Preferences, TargetRole) :-
    ( get_dict(target_role, Preferences, TargetRole) -> true ; TargetRole = flexible ).

partner_candidate_allowed_by_name_filters(CandidateName, _IncludeNames, ExcludeNames) :-
    \+ member(CandidateName, ExcludeNames).

partner_include_name_bonus(CandidateName, IncludeNames, 48, Reason) :-
    member(CandidateName, IncludeNames),
    display_pokemon_name(CandidateName, Label),
    format(atom(Reason), 'preferencia declarada: parceiro em mente ~w (prioridade no ranking, sem bloquear opcoes similares)', [Label]),
    !.
partner_include_name_bonus(_CandidateName, _IncludeNames, 0, '').

partner_target_role_bonus(flexible, _TargetProfile, _CandidateProfile, 0, '') :-
    !.
partner_target_role_bonus(main, TargetProfile, CandidateProfile, Bonus, Reason) :-
    partner_support_to_carry_score(CandidateProfile, TargetProfile, SupportScore),
    Bonus is min(60, round(SupportScore * 0.9)),
    display_pokemon_name(TargetProfile.name, TargetLabel),
    display_pokemon_name(CandidateProfile.name, CandidateLabel),
    format(atom(Reason), 'foco declarado: ~w como principal, priorizando parceiro que abra janelas para ele (~w)', [TargetLabel, CandidateLabel]).
partner_target_role_bonus(support, TargetProfile, CandidateProfile, Bonus, Reason) :-
    partner_support_to_carry_score(TargetProfile, CandidateProfile, SupportScore),
    Bonus is min(60, round(SupportScore * 0.9)),
    display_pokemon_name(TargetProfile.name, TargetLabel),
    display_pokemon_name(CandidateProfile.name, CandidateLabel),
    format(atom(Reason), 'foco declarado: ~w como suporte, priorizando parceiro para receber essa estrutura (~w)', [TargetLabel, CandidateLabel]).

partner_support_to_carry_score(SupportProfile, CarryProfile, Score) :-
    ( pair_turn_window_support(SupportProfile, CarryProfile, TurnScore, _) -> true ; TurnScore = 0 ),
    ( pair_speed_lane_support(SupportProfile, CarryProfile, SpeedScore, _) -> true ; SpeedScore = 0 ),
    ( pair_item_activation_support(SupportProfile, CarryProfile, ItemScore, _) -> true ; ItemScore = 0 ),
    ( pair_role_swap_flexibility(SupportProfile, CarryProfile, FlexScore, _) -> true ; FlexScore = 0 ),
    Score is TurnScore + SpeedScore + ItemScore + max(0, FlexScore - 8).

partner_merge_role_reason(RoleBonus, _RoleReason, ReasonsRaw, ReasonsRaw) :-
    RoleBonus =< 0,
    !.
partner_merge_role_reason(RoleBonus, RoleReason, ReasonsRaw, ReasonsMerged) :-
    append([RoleBonus-RoleReason], ReasonsRaw, ReasonsSeed),
    sort(ReasonsSeed, ReasonsMerged).

partner_merge_include_reason(IncludeBonus, _IncludeReason, ReasonsRaw, ReasonsRaw) :-
    IncludeBonus =< 0,
    !.
partner_merge_include_reason(IncludeBonus, IncludeReason, ReasonsRaw, ReasonsMerged) :-
    append([IncludeBonus-IncludeReason], ReasonsRaw, ReasonsSeed),
    sort(ReasonsSeed, ReasonsMerged).

partner_preferences_summary_text(Preferences, SummaryText) :-
    partner_pref_target_role(Preferences, TargetRole),
    partner_pref_context_filters(Preferences, ContextFilters),
    partner_pref_type_filters(Preferences, TypeFilters),
    partner_pref_include_names(Preferences, IncludeNames),
    partner_pref_exclude_names(Preferences, ExcludeNames),
    findall(Part,
        ( partner_preference_summary_part(TargetRole, ContextFilters, TypeFilters, IncludeNames, ExcludeNames, Part),
          Part \= ''
        ),
        Parts),
    ( Parts == [] ->
        SummaryText = 'perfil padrao (sem filtros adicionais)'
    ; atomic_list_concat(Parts, '; ', SummaryText)
    ).

partner_preference_summary_part(TargetRole, _ContextFilters, _TypeFilters, _IncludeNames, _ExcludeNames, Part) :-
    partner_target_role_label(TargetRole, Label),
    Label \= '',
    format(atom(Part), 'papel do alvo: ~w', [Label]).
partner_preference_summary_part(_TargetRole, ContextFilters, _TypeFilters, _IncludeNames, _ExcludeNames, Part) :-
    ContextFilters \= [],
    findall(Label,
        ( member(Filter, ContextFilters),
          partner_context_filter_label(Filter, Label)
        ),
        Labels),
    atomic_list_concat(Labels, ', ', LabelText),
    format(atom(Part), 'filtros: ~w', [LabelText]).
partner_preference_summary_part(_TargetRole, _ContextFilters, TypeFilters, _IncludeNames, _ExcludeNames, Part) :-
    TypeFilters \= [],
    types_list_text(TypeFilters, TypeText),
    format(atom(Part), 'foco por tipo: ~w', [TypeText]).
partner_preference_summary_part(_TargetRole, _ContextFilters, _TypeFilters, IncludeNames, _ExcludeNames, Part) :-
    IncludeNames \= [],
    names_list_text(IncludeNames, NameText),
    format(atom(Part), 'parceiro(s) em mente (prioridade): ~w', [NameText]).
partner_preference_summary_part(_TargetRole, _ContextFilters, _TypeFilters, _IncludeNames, ExcludeNames, Part) :-
    ExcludeNames \= [],
    names_list_text(ExcludeNames, NameText),
    format(atom(Part), 'excluidos: ~w', [NameText]).

partner_target_role_label(main, 'principal').
partner_target_role_label(support, 'suporte').
partner_target_role_label(flexible, '').

partner_context_filter_label(no_legendary, 'sem lendarios/miticos').
partner_context_filter_label(no_mega, 'sem mega').
partner_context_filter_label(only_legendary, 'apenas lendarios/miticos').
partner_context_filter_label(only_mega, 'apenas mega').
partner_context_filter_label(only_unevolved, 'apenas nao evoluidos').
partner_context_filter_label(only_evolved, 'apenas evoluidos').

types_list_text(Types, Text) :-
    findall(Label,
        ( member(Type, Types),
          display_label(Type, Label)
        ),
        Labels),
    atomic_list_concat(Labels, ', ', Text).

names_list_text(Names, Text) :-
    findall(Label,
        ( member(Name, Names),
          display_pokemon_name(Name, Label)
        ),
        Labels),
    atomic_list_concat(Labels, ', ', Text).

partner_dedupe_pairs_by_name(Pairs, UniquePairs) :-
    partner_dedupe_pairs_by_name(Pairs, [], UniquePairs).

partner_dedupe_pairs_by_name([], _SeenNames, []).
partner_dedupe_pairs_by_name([Score-Name-Reasons | Rest], SeenNames, Unique) :-
    ( member(Name, SeenNames) ->
        partner_dedupe_pairs_by_name(Rest, SeenNames, Unique)
    ; Unique = [Score-Name-Reasons | Tail],
      partner_dedupe_pairs_by_name(Rest, [Name | SeenNames], Tail)
    ).

partner_shortlist_size(Limit, ShortlistSize) :-
    Base is max(80, Limit * 20),
    ShortlistSize is min(240, Base).

partner_candidate_quick_score(TargetTypes, TargetAbilities, TargetStats,
    CandidateTypes, CandidateAbilities, CandidateStats,
    TargetRole, IncludeNames, CandidateName, QuickScore) :-
    pair_quick_type_synergy(TargetTypes, CandidateTypes, TypeScore),
    pair_quick_field_synergy(TargetAbilities, TargetTypes, CandidateAbilities, CandidateTypes, FieldScore),
    partner_quick_stat_role_hint(TargetRole, TargetStats, CandidateStats, RoleHint),
    partner_include_name_priority_bonus(CandidateName, IncludeNames, IncludeBonus),
    QuickScore is TypeScore + FieldScore + RoleHint + IncludeBonus.

partner_include_name_priority_bonus(CandidateName, IncludeNames, 48) :-
    member(CandidateName, IncludeNames),
    !.
partner_include_name_priority_bonus(_CandidateName, _IncludeNames, 0).

partner_quick_stat_role_hint(main, TargetStats, CandidateStats, Hint) :-
    pair_offense_peak_from_stats(TargetStats, TargetOffense),
    pair_bulk_avg_from_stats(CandidateStats, CandidateBulk),
    pair_speed_value_from_stats(CandidateStats, CandidateSpeed),
    ( TargetOffense >= 105 -> OffenseNeed = 12 ; OffenseNeed = 6 ),
    BulkHint is max(0, round(CandidateBulk - 85.0)),
    SpeedHint is max(0, CandidateSpeed - 75),
    Hint is min(24, OffenseNeed + (BulkHint // 3) + (SpeedHint // 10)).
partner_quick_stat_role_hint(support, TargetStats, CandidateStats, Hint) :-
    pair_offense_peak_from_stats(CandidateStats, CandidateOffense),
    pair_offense_peak_from_stats(TargetStats, TargetOffense),
    pair_speed_value_from_stats(CandidateStats, CandidateSpeed),
    OffenseDelta is max(0, CandidateOffense - TargetOffense),
    SpeedDelta is max(0, CandidateSpeed - 75),
    Hint is min(24, (OffenseDelta // 4) + (SpeedDelta // 12)).
partner_quick_stat_role_hint(flexible, _TargetStats, _CandidateStats, 0).

pair_offense_peak_from_stats(Stats, OffensePeak) :-
    pair_stat_value(Stats, attack, Attack),
    pair_stat_value(Stats, special_attack, SpecialAttack),
    OffensePeak is max(Attack, SpecialAttack).

pair_bulk_avg_from_stats(Stats, BulkAvg) :-
    pair_stat_value(Stats, hp, HP),
    pair_stat_value(Stats, defense, Defense),
    pair_stat_value(Stats, special_defense, SpecialDefense),
    BulkAvg is (HP + Defense + SpecialDefense) / 3.0.

pair_speed_value_from_stats(Stats, Speed) :-
    pair_stat_value(Stats, speed, Speed).

pair_quick_type_synergy(TypesA, TypesB, Score) :-
    all_types(AllTypes),
    findall(AttackType,
        ( member(AttackType, AllTypes),
          combined_multiplier(AttackType, TypesA, MultA),
          combined_multiplier(AttackType, TypesB, MultB),
          pair_best_defensive_multiplier(MultA, MultB, BestMult),
          BestMult =< 0.5
        ),
        CoveredRaw),
    sort(CoveredRaw, Covered),
    length(Covered, CoveredCount),
    findall(AttackType,
        ( member(AttackType, AllTypes),
          combined_multiplier(AttackType, TypesA, MultA),
          combined_multiplier(AttackType, TypesB, MultB),
          MultA >= 2.0,
          MultB >= 2.0
        ),
        SharedWeakRaw),
    sort(SharedWeakRaw, SharedWeak),
    length(SharedWeak, SharedWeakCount),
    append(TypesA, TypesB, CombinedTypes),
    sort(CombinedTypes, StabTypes),
    findall(TargetType,
        ( member(TargetType, AllTypes),
          member(StabType, StabTypes),
          combined_multiplier(StabType, [TargetType], Mult),
          Mult > 1.0
        ),
        HitsRaw),
    sort(HitsRaw, Hits),
    length(Hits, HitCount),
    Score is (CoveredCount * 2) + HitCount - (SharedWeakCount * 4).

pair_quick_field_synergy(AbilitiesA, TypesA, AbilitiesB, TypesB, Score) :-
    pair_quick_direction_field_synergy(AbilitiesA, TypesB, AbilitiesB, ScoreAB),
    pair_quick_direction_field_synergy(AbilitiesB, TypesA, AbilitiesA, ScoreBA),
    Score is ScoreAB + ScoreBA.

pair_quick_direction_field_synergy(SetterAbilities, PartnerTypes, PartnerAbilities, Score) :-
    findall(LocalScore,
        ( member(SetterAbility, SetterAbilities),
          pair_quick_field_lane_score(SetterAbility, PartnerTypes, PartnerAbilities, LocalScore)
        ),
        RawScores),
    ( RawScores == [] ->
        Score = 0
    ; max_list(RawScores, Score)
    ).

pair_quick_field_lane_score(SetterAbility, PartnerTypes, PartnerAbilities, Score) :-
    ability_sets_weather_for_strategy(SetterAbility, Weather),
    weather_partner_support_score(Weather, PartnerTypes, PartnerAbilities, SupportScore),
    Score is max(0, min(14, round(SupportScore / 2.0))).
pair_quick_field_lane_score(SetterAbility, PartnerTypes, PartnerAbilities, Score) :-
    ability_sets_terrain_for_strategy(SetterAbility, Terrain),
    terrain_partner_support_score(Terrain, PartnerTypes, PartnerAbilities, SupportScore),
    Score is max(0, min(12, round(SupportScore / 2.0))).

partner_dedupe_quick_candidates_by_name(Pairs, UniquePairs) :-
    partner_dedupe_quick_candidates_by_name(Pairs, [], UniquePairs).

partner_dedupe_quick_candidates_by_name([], _SeenNames, []).
partner_dedupe_quick_candidates_by_name(
    [Score-ID-Name-Types-Abilities-Stats | Rest],
    SeenNames,
    UniquePairs
) :-
    ( member(Name, SeenNames) ->
        partner_dedupe_quick_candidates_by_name(Rest, SeenNames, UniquePairs)
    ; UniquePairs = [Score-ID-Name-Types-Abilities-Stats | Tail],
      partner_dedupe_quick_candidates_by_name(Rest, [Name | SeenNames], Tail)
    ).

pair_synergy_breakdown(IDA, NameA, TypesA, AbilitiesA, StatsA,
                      IDB, NameB, TypesB, AbilitiesB, StatsB,
                      Score, Reasons) :-
    pair_generation_cache_key(CacheKey),
    ( cache_pair_synergy_breakdown(CacheKey, IDA, IDB, Score, Reasons) ->
        true
    ; pair_synergy_breakdown_uncached(IDA, NameA, TypesA, AbilitiesA, StatsA,
                                    IDB, NameB, TypesB, AbilitiesB, StatsB,
                                    Score, Reasons),
      assertz(cache_pair_synergy_breakdown(CacheKey, IDA, IDB, Score, Reasons))
    ).

pair_generation_cache_key(CacheKey) :-
    ( current_predicate(current_generation_key/1),
      current_generation_key(CacheKey) ->
        true
    ; CacheKey = all
    ).

pair_synergy_breakdown_uncached(IDA, NameA, TypesA, AbilitiesA, StatsA,
                      IDB, NameB, TypesB, AbilitiesB, StatsB,
                      Score, Reasons) :-
    pair_strategy_profile(IDA, NameA, TypesA, AbilitiesA, StatsA, ProfileA),
    pair_strategy_profile(IDB, NameB, TypesB, AbilitiesB, StatsB, ProfileB),
    findall(ReasonScore-ReasonText,
        ( pair_direction_weather_synergy(NameA, AbilitiesA, TypesB, AbilitiesB, ReasonScore, ReasonText)
        ; pair_direction_weather_synergy(NameB, AbilitiesB, TypesA, AbilitiesA, ReasonScore, ReasonText)
        ; pair_direction_terrain_synergy(NameA, AbilitiesA, TypesB, AbilitiesB, ReasonScore, ReasonText)
        ; pair_direction_terrain_synergy(NameB, AbilitiesB, TypesA, AbilitiesA, ReasonScore, ReasonText)
        ; pair_shared_weather_mode(TypesA, AbilitiesA, TypesB, AbilitiesB, ReasonScore, ReasonText)
        ; pair_shared_terrain_mode(TypesA, AbilitiesA, TypesB, AbilitiesB, ReasonScore, ReasonText)
        ; pair_turn_window_support(ProfileA, ProfileB, ReasonScore, ReasonText)
        ; pair_turn_window_support(ProfileB, ProfileA, ReasonScore, ReasonText)
        ; pair_speed_lane_support(ProfileA, ProfileB, ReasonScore, ReasonText)
        ; pair_speed_lane_support(ProfileB, ProfileA, ReasonScore, ReasonText)
        ; pair_item_activation_support(ProfileA, ProfileB, ReasonScore, ReasonText)
        ; pair_item_activation_support(ProfileB, ProfileA, ReasonScore, ReasonText)
    ; pair_weather_pivot_execution(ProfileA, ProfileB, ReasonScore, ReasonText)
    ; pair_weather_pivot_execution(ProfileB, ProfileA, ReasonScore, ReasonText)
    ; pair_role_swap_flexibility(ProfileA, ProfileB, ReasonScore, ReasonText)
        ; pair_complementary_defense_bonus(TypesA, TypesB, ReasonScore, ReasonText)
        ; pair_offensive_coverage_bonus(TypesA, TypesB, ReasonScore, ReasonText)
        ),
        RawReasons),
    sort(RawReasons, UniqueReasons),
    pair_reasons_top(UniqueReasons, 6, Reasons),
    pair_reasons_score_sum(Reasons, RawScore),
    pair_raw_score_to_1000(RawScore, Score).

pair_strategy_profile(ID, Name, Types, Abilities, Stats, Profile) :-
    pair_generation_cache_key(CacheKey),
    ( cache_pair_strategy_profile(CacheKey, ID, Profile) ->
        true
    ; pair_strategy_profile_uncached(ID, Name, Types, Abilities, Stats, Profile),
      assertz(cache_pair_strategy_profile(CacheKey, ID, Profile))
    ).

pair_strategy_profile_uncached(ID, Name, Types, Abilities, Stats, Profile) :-
    pair_profile_move_list(ID, Name, Moves),
    pair_profile_collect_moves_by_role(Moves, protection, ProtectMoves),
    pair_profile_collect_moves_by_role(Moves, redirection, RedirectionMoves),
    pair_profile_collect_moves_by_role(Moves, fake_out, FakeOutMoves),
    pair_profile_collect_moves_by_role(Moves, speed_control, SpeedControlMoves),
    pair_profile_collect_moves_by_role(Moves, trick_room, TrickRoomMoves),
    pair_profile_collect_moves_by_role(Moves, ally_boost, DamageAmplifierMoves),
    pair_profile_collect_moves_by_role(Moves, pivot, PivotMoves),
    pair_profile_collect_moves_by_role(Moves, screen_control, ScreenMoves),
    pair_profile_collect_moves_by_role(Moves, setup_buff, SetupMoves),
    pair_profile_collect_moves_by_role(Moves, disruption, DisruptionMoves),
    pair_profile_pressure_moves(Moves, Types, PressureMoves),
    append(RedirectionMoves, FakeOutMoves, SupportSeedA),
    append(SupportSeedA, SpeedControlMoves, SupportSeedB),
    append(SupportSeedB, TrickRoomMoves, SupportSeedC),
    append(SupportSeedC, DamageAmplifierMoves, SupportSeedD),
    append(SupportSeedD, ScreenMoves, SupportMoves),
    pair_stat_value(Stats, speed, Speed),
    pair_stat_value(Stats, attack, Attack),
    pair_stat_value(Stats, special_attack, SpecialAttack),
    pair_stat_value(Stats, hp, HP),
    pair_stat_value(Stats, defense, Defense),
    pair_stat_value(Stats, special_defense, SpecialDefense),
    OffensePeak is max(Attack, SpecialAttack),
    BulkAvg is (HP + Defense + SpecialDefense) / 3.0,
    pair_profile_bool_nonempty(ProtectMoves, HasProtect),
    pair_profile_bool_nonempty(RedirectionMoves, HasRedirection),
    pair_profile_bool_nonempty(FakeOutMoves, HasFakeOut),
    pair_profile_bool_nonempty(SpeedControlMoves, HasSpeedControl),
    pair_profile_bool_nonempty(TrickRoomMoves, HasTrickRoom),
    pair_profile_bool_nonempty(DamageAmplifierMoves, HasDamageAmplifier),
    pair_profile_bool_nonempty(PivotMoves, HasPivot),
    pair_profile_bool_nonempty(ScreenMoves, HasScreens),
    pair_profile_bool_nonempty(SetupMoves, HasSetup),
    pair_profile_has_any_move(Moves, [facade], HasFacade),
    pair_profile_has_ability(Abilities, [guts], HasGuts),
    pair_profile_has_ability(Abilities, [poison_heal], HasPoisonHeal),
    pair_profile_has_weather_setter_ability(Abilities, HasWeatherSetterAbility),
    pair_profile_has_terrain_setter_ability(Abilities, HasTerrainSetterAbility),
    Profile = pair_profile{
        name:Name,
        moves:Moves,
        types:Types,
        abilities:Abilities,
        speed:Speed,
        offense_peak:OffensePeak,
        bulk_avg:BulkAvg,
        support_moves:SupportMoves,
        disruption_moves:DisruptionMoves,
        pivot_moves:PivotMoves,
        setup_moves:SetupMoves,
        pressure_moves:PressureMoves,
        protect_moves:ProtectMoves,
        has_protect:HasProtect,
        has_redirection:HasRedirection,
        has_fake_out:HasFakeOut,
        has_speed_control:HasSpeedControl,
        has_trick_room:HasTrickRoom,
        has_damage_amplifier:HasDamageAmplifier,
        has_pivot:HasPivot,
        has_screens:HasScreens,
        has_setup:HasSetup,
        has_facade:HasFacade,
        has_guts:HasGuts,
        has_poison_heal:HasPoisonHeal,
        has_weather_setter_ability:HasWeatherSetterAbility,
        has_terrain_setter_ability:HasTerrainSetterAbility
    }.

pair_profile_move_list(ID, Name, Moves) :-
    current_predicate(pokemon_move_list_for_id/4),
    pokemon_move_list_for_id(ID, Name, MovesRaw, _Source),
    !,
    sort(MovesRaw, Moves).
pair_profile_move_list(_ID, _Name, []).

pair_stat_value(Stats, Stat, Value) :-
    member(Stat-Value, Stats),
    !.
pair_stat_value(_Stats, _Stat, 0).

pair_profile_collect_moves_by_role(Moves, Role, Collected) :-
        findall(Move,
                ( member(Move, Moves),
            move_has_tactical_role(Move, Role)
                ),
                Raw),
        sort(Raw, Collected).

    pair_profile_bool_nonempty([], false).
    pair_profile_bool_nonempty([_ | _], true).

pair_profile_pressure_moves(Moves, Types, PressureMoves) :-
    findall(Score-Move,
        ( member(Move, Moves),
          pair_pressure_move_score(Move, Types, Score)
        ),
        CandidateRaw),
    ( CandidateRaw == [] ->
                PressureMoves = []
    ; keysort(CandidateRaw, Asc),
            reverse(Asc, Desc),
              findall(Move,
                  member(_-Move, Desc),
                  Ranked),
              take_first_n(Ranked, 4, PressureMoves)
        ).

pair_pressure_move_score(Move, Types, Score) :-
        move_data(Move, MoveType, Category, BasePower, Accuracy, _PP, _Tags, _EffectChance, _Ailment, _EffectCategory, Description),
        member(Category, [physical, special]),
        number(BasePower),
        BasePower >= 70,
        \+ pair_pressure_move_unreliable(Description),
    member(MoveType, Types),
    StabBonus = 26,
        ( number(Accuracy), Accuracy >= 95 -> AccuracyBonus = 8
        ; number(Accuracy), Accuracy >= 85 -> AccuracyBonus = 4
        ; AccuracyBonus = 0
        ),
        Score is BasePower + StabBonus + AccuracyBonus.

pair_pressure_move_unreliable(DescriptionRaw) :-
        input_to_string(DescriptionRaw, DescriptionText),
        string_lower(DescriptionText, Lower),
        ( sub_string(Lower, _, _, _, 'recharge')
        ; sub_string(Lower, _, _, _, 'turn to charge')
        ; sub_string(Lower, _, _, _, 'charging')
        ).

pair_profile_has_any_move(Moves, CandidateMoves, true) :-
    member(Move, Moves),
    member(Move, CandidateMoves),
    !.
pair_profile_has_any_move(_Moves, _CandidateMoves, false).

pair_profile_value(Profile, Key, Default, Value) :-
    ( get_dict(Key, Profile, Raw) -> Value = Raw ; Value = Default ).

pair_profile_first_present_move(Profile, Candidates, Move) :-
    pair_profile_value(Profile, moves, [], Moves),
    member(Move, Candidates),
    member(Move, Moves),
    !.

pair_profile_move_labels_text([], 'ferramentas de suporte').
pair_profile_move_labels_text(Moves, Text) :-
    take_first_n(Moves, 3, TopMoves),
    findall(Label,
        ( member(Move, TopMoves),
          display_label(Move, Label)
        ),
        Labels),
    atomic_list_concat(Labels, ', ', Text).

pair_profile_support_move_text(Profile, Text) :-
    pair_profile_value(Profile, support_moves, [], SupportMoves),
    pair_profile_value(Profile, disruption_moves, [], DisruptionMoves),
    pair_profile_value(Profile, pivot_moves, [], PivotMoves),
    pair_profile_value(Profile, protect_moves, [], ProtectMoves),
    append(SupportMoves, DisruptionMoves, SeedA),
    append(SeedA, PivotMoves, SeedB),
    append(SeedB, ProtectMoves, AllMoves),
    sort(AllMoves, UniqueMoves),
    pair_profile_move_labels_text(UniqueMoves, Text).

pair_profile_carry_plan_text(Profile, Text) :-
    pair_profile_value(Profile, setup_moves, [], SetupMoves),
    pair_profile_value(Profile, pressure_moves, [], PressureMoves),
    ( SetupMoves \= [], PressureMoves \= [] ->
        SetupMoves = [SetupMove | _],
        display_label(SetupMove, SetupLabel),
        format(atom(Text), 'setup com ~w e finalização por golpes STAB fortes', [SetupLabel])
    ; PressureMoves \= [] ->
        Text = 'pressão direta por golpes STAB de alta potência'
    ; SetupMoves \= [] ->
        pair_profile_move_labels_text(SetupMoves, SetupText),
        format(atom(Text), 'setup com ~w', [SetupText])
    ; Text = 'pressão incremental'
    ).

pair_profile_has_ability(Abilities, CandidateAbilities, true) :-
    member(Ability, Abilities),
    member(Ability, CandidateAbilities),
    !.
pair_profile_has_ability(_Abilities, _CandidateAbilities, false).

pair_profile_has_weather_setter_ability(Abilities, true) :-
    member(Ability, Abilities),
    ability_sets_weather_for_strategy(Ability, _),
    !.
pair_profile_has_weather_setter_ability(_Abilities, false).

pair_profile_has_terrain_setter_ability(Abilities, true) :-
    member(Ability, Abilities),
    ability_sets_terrain_for_strategy(Ability, _),
    !.
pair_profile_has_terrain_setter_ability(_Abilities, false).

pair_turn_window_support(Enabler, Carry, Score, Reason) :-
    pair_profile_support_bundle(Enabler, ToolsText, SupportScore),
    pair_profile_turn_window_need(Carry, NeedText, NeedScore),
    pair_profile_carry_plan_text(Carry, CarryPlanText),
    SupportScore > 0,
    NeedScore > 0,
    Raw is SupportScore + NeedScore + 4,
    Score is min(34, Raw),
    display_pokemon_name(Enabler.name, EnablerLabel),
    display_pokemon_name(Carry.name, CarryLabel),
    format(atom(Reason), '~w cria janela de execução com opções de suporte como ~w para ~w (~w), abrindo linha de ~w', [EnablerLabel, ToolsText, CarryLabel, NeedText, CarryPlanText]).

pair_speed_lane_support(Controller, Carry, 26, Reason) :-
    Controller.has_trick_room == true,
    Carry.speed =< 80,
    Carry.offense_peak >= 95,
    ( pair_profile_first_present_move(Controller, [trick_room], TrickRoomMove) ->
        display_label(TrickRoomMove, TrickRoomLabel)
    ; TrickRoomLabel = 'Trick Room'
    ),
    pair_profile_carry_plan_text(Carry, CarryPlanText),
    display_pokemon_name(Controller.name, ControllerLabel),
    display_pokemon_name(Carry.name, CarryLabel),
    format(atom(Reason), '~w oferece ~w para ~w executar sweep mesmo com Speed baixa (~w)', [ControllerLabel, TrickRoomLabel, CarryLabel, CarryPlanText]).
pair_speed_lane_support(Controller, Carry, 20, Reason) :-
    Controller.has_speed_control == true,
    Carry.speed >= 70,
    Carry.speed =< 110,
    Carry.offense_peak >= 100,
    pair_profile_support_move_text(Controller, ControlMoveText),
    pair_profile_carry_plan_text(Carry, CarryPlanText),
    display_pokemon_name(Controller.name, ControllerLabel),
    display_pokemon_name(Carry.name, CarryLabel),
    format(atom(Reason), '~w oferece controle de velocidade com ~w para ~w converter pressão sem depender de KO em turno único (~w)', [ControllerLabel, ControlMoveText, CarryLabel, CarryPlanText]).

pair_item_activation_support(Enabler, Carry, Score, Reason) :-
    pair_profile_item_activation_need(Carry, ActivationText, ActivationNeedScore),
    pair_profile_activation_enabler_bundle(Enabler, EnablerText, EnablerScore),
    ActivationNeedScore > 0,
    EnablerScore > 0,
    Raw is ActivationNeedScore + EnablerScore + 4,
    Score is min(28, Raw),
    display_pokemon_name(Enabler.name, EnablerLabel),
    display_pokemon_name(Carry.name, CarryLabel),
    format(atom(Reason), '~w facilita ~w de ~w usando ~w', [EnablerLabel, ActivationText, CarryLabel, EnablerText]).

pair_weather_pivot_execution(SetterProfile, PartnerProfile, Score, Reason) :-
    SetterProfile.has_pivot == true,
    SetterProfile.has_weather_setter_ability == true,
    SetterProfile.speed < 100,
    member(SetterAbility, SetterProfile.abilities),
    ability_sets_weather_for_strategy(SetterAbility, Weather),
    weather_partner_best_reason(Weather, PartnerProfile.types, PartnerProfile.abilities, PartnerBonus, PartnerReason),
    PartnerBonus > 0,
    pair_profile_first_present_move(SetterProfile, [u_turn, volt_switch, flip_turn, parting_shot, teleport], PivotMove),
    pair_profile_carry_plan_text(PartnerProfile, PartnerCarryPlanText),
    strategy_weather_label(Weather, WeatherLabel),
    display_label(PivotMove, PivotMoveLabel),
    display_label(SetterAbility, SetterAbilityLabel),
    display_pokemon_name(SetterProfile.name, SetterLabel),
    display_pokemon_name(PartnerProfile.name, PartnerLabel),
    Score is min(32, PartnerBonus + 12),
    format(atom(Reason), '~w (~w) tem linha de execução de campo com pivot: ativa ~w e usa ~w para reposicionar, trazendo ~w para ~w (~w)',
        [SetterLabel, SetterAbilityLabel, WeatherLabel, PivotMoveLabel, PartnerLabel, PartnerCarryPlanText, PartnerReason]).

pair_role_swap_flexibility(ProfileA, ProfileB, Score, Reason) :-
    pair_profile_support_bundle(ProfileA, SupportAText, SupportAScore),
    pair_profile_support_bundle(ProfileB, SupportBText, SupportBScore),
    pair_profile_carry_plan_text(ProfileA, CarryAText),
    pair_profile_carry_plan_text(ProfileB, CarryBText),
    SupportAScore >= 8,
    SupportBScore >= 8,
    Raw is ((SupportAScore + SupportBScore) / 2.0) + 6,
    Score is min(24, round(Raw)),
    display_pokemon_name(ProfileA.name, LabelA),
    display_pokemon_name(ProfileB.name, LabelB),
    format(atom(Reason), 'papéis podem inverter conforme o matchup: ~w suporta com opções como ~w para ~w executar (~w), ou ~w suporta com opções como ~w para ~w executar (~w)',
        [LabelA, SupportAText, LabelB, CarryBText, LabelB, SupportBText, LabelA, CarryAText]).

pair_profile_support_bundle(Profile, Text, Score) :-
    findall(LocalScore-Label,
        pair_profile_support_tool(Profile, LocalScore, Label),
        Raw),
    Raw \= [],
    findall(LocalScore, member(LocalScore-_, Raw), Scores),
    sum_list(Scores, ScoreRaw),
    Score is min(20, ScoreRaw),
    findall(Label, member(_-Label, Raw), Labels),
    atomic_list_concat(Labels, ', ', Text).

pair_profile_support_tool(Profile, 10, Label) :-
    pair_profile_first_present_move(Profile, [follow_me, rage_powder], Move),
    display_label(Move, MoveLabel),
    format(atom(Label), 'redirecionamento com ~w', [MoveLabel]).
pair_profile_support_tool(Profile, 9, Label) :-
    pair_profile_first_present_move(Profile, [fake_out], Move),
    display_label(Move, MoveLabel),
    format(atom(Label), 'pressão de turno com ~w', [MoveLabel]).
pair_profile_support_tool(Profile, 8, Label) :-
    pair_profile_first_present_move(Profile, [reflect, light_screen, aurora_veil], Move),
    display_label(Move, MoveLabel),
    format(atom(Label), 'telas com ~w', [MoveLabel]).
pair_profile_support_tool(Profile, 7, Label) :-
    pair_profile_first_present_move(Profile, [helping_hand, coaching, howl], Move),
    display_label(Move, MoveLabel),
    format(atom(Label), 'amplificação com ~w', [MoveLabel]).
pair_profile_support_tool(Profile, 6, Label) :-
    pair_profile_first_present_move(Profile, [u_turn, volt_switch, flip_turn, parting_shot, teleport], Move),
    display_label(Move, MoveLabel),
    format(atom(Label), 'pivot com ~w', [MoveLabel]).
pair_profile_support_tool(Profile, 6, Label) :-
    pair_profile_first_present_move(Profile, [taunt, snarl, will_o_wisp, thunder_wave, icy_wind, electroweb, encore, disable], Move),
    display_label(Move, MoveLabel),
    format(atom(Label), 'disrupção com ~w', [MoveLabel]).
pair_profile_support_tool(Profile, 4, Label) :-
    pair_profile_first_present_move(Profile, [protect, detect, kings_shield, spiky_shield, baneful_bunker, obstruct, silk_trap], Move),
    display_label(Move, MoveLabel),
    format(atom(Label), 'proteção com ~w', [MoveLabel]).

pair_profile_support_tool(Profile, 10, 'redirecionamento') :-
    pair_profile_value(Profile, has_redirection, false, true),
    \+ pair_profile_first_present_move(Profile, [follow_me, rage_powder], _).
pair_profile_support_tool(Profile, 9, 'Fake Out') :-
    pair_profile_value(Profile, has_fake_out, false, true),
    \+ pair_profile_first_present_move(Profile, [fake_out], _).
pair_profile_support_tool(Profile, 8, 'telas defensivas') :-
    pair_profile_value(Profile, has_screens, false, true),
    \+ pair_profile_first_present_move(Profile, [reflect, light_screen, aurora_veil], _).
pair_profile_support_tool(Profile, 7, 'amplificação de dano') :-
    pair_profile_value(Profile, has_damage_amplifier, false, true),
    \+ pair_profile_first_present_move(Profile, [helping_hand, coaching, howl], _).
pair_profile_support_tool(Profile, 6, 'pivot') :-
    pair_profile_value(Profile, has_pivot, false, true),
    \+ pair_profile_first_present_move(Profile, [u_turn, volt_switch, flip_turn, parting_shot, teleport], _).
pair_profile_support_tool(Profile, 4, 'Protect') :-
    pair_profile_value(Profile, has_protect, false, true),
    \+ pair_profile_first_present_move(Profile, [protect, detect, kings_shield, spiky_shield, baneful_bunker, obstruct, silk_trap], _).

pair_profile_turn_window_need(Profile, NeedText, NeedScore) :-
    findall(LocalScore-Text,
        pair_profile_turn_window_need_signal(Profile, LocalScore, Text),
        Raw),
    Raw \= [],
    findall(LocalScore, member(LocalScore-_, Raw), Scores),
    sum_list(Scores, NeedRaw),
    NeedScore is min(20, NeedRaw),
    findall(Text, member(_-Text, Raw), Labels),
    atomic_list_concat(Labels, '; ', NeedText).

pair_profile_turn_window_need_signal(Profile, 10, 'depende de setup para fechar jogo') :-
    Profile.has_setup == true.
pair_profile_turn_window_need_signal(Profile, 8, 'tem perfil de sweeper lento e precisa de proteção de turno') :-
    Profile.speed =< 75,
    Profile.offense_peak >= 95.
pair_profile_turn_window_need_signal(Profile, 6, 'normalmente precisa de dois turnos para consolidar pressão ofensiva') :-
    Profile.offense_peak >= 90,
    Profile.offense_peak =< 115,
    Profile.speed =< 95.

pair_profile_item_activation_need(Profile, 'ativação de Flame Orb + Guts', Score) :-
    Profile.has_guts == true,
    ( Profile.has_facade == true -> Score = 16 ; Score = 12 ).
pair_profile_item_activation_need(Profile, 'ativação de Toxic Orb + Poison Heal', 14) :-
    Profile.has_poison_heal == true.

pair_profile_activation_enabler_bundle(Profile, Text, Score) :-
    findall(LocalScore-Label,
        pair_profile_activation_enabler_tool(Profile, LocalScore, Label),
        Raw),
    Raw \= [],
    findall(LocalScore, member(LocalScore-_, Raw), Scores),
    sum_list(Scores, ScoreRaw),
    Score is min(14, ScoreRaw),
    findall(Label, member(_-Label, Raw), Labels),
    atomic_list_concat(Labels, ', ', Text).

pair_profile_activation_enabler_tool(Profile, 8, 'redirecionamento') :-
    Profile.has_redirection == true.
pair_profile_activation_enabler_tool(Profile, 8, 'Fake Out') :-
    Profile.has_fake_out == true.
pair_profile_activation_enabler_tool(Profile, 5, 'Protect') :-
    Profile.has_protect == true.
pair_profile_activation_enabler_tool(Profile, 4, 'telas') :-
    Profile.has_screens == true.

pair_complementary_defense_bonus(TypesA, TypesB, Score, Reason) :-
    all_types(AllTypes),
    findall(AttackType,
        ( member(AttackType, AllTypes),
          combined_multiplier(AttackType, TypesA, MultA),
          combined_multiplier(AttackType, TypesB, MultB),
          pair_best_defensive_multiplier(MultA, MultB, BestMult),
          BestMult =< 0.5
        ),
        CoveredRaw),
    sort(CoveredRaw, Covered),
    length(Covered, CoveredCount),
    CoveredCount > 0,
    findall(AttackType,
        ( member(AttackType, AllTypes),
          combined_multiplier(AttackType, TypesA, MultA),
          combined_multiplier(AttackType, TypesB, MultB),
          MultA >= 2.0,
          MultB >= 2.0
        ),
        SharedWeakRaw),
    sort(SharedWeakRaw, SharedWeak),
    length(SharedWeak, SharedWeakCount),
    Raw is (CoveredCount * 3) - (SharedWeakCount * 5),
    Raw > 0,
    Score is min(34, Raw),
    format(atom(Reason), 'cobertura defensiva complementar: o par cobre ~w tipo(s) ofensivo(s) e compartilha ~w fraqueza(s) forte(s)', [CoveredCount, SharedWeakCount]).

pair_offensive_coverage_bonus(TypesA, TypesB, Score, Reason) :-
    append(TypesA, TypesB, CombinedTypes),
    sort(CombinedTypes, StabTypes),
    length(StabTypes, StabCount),
    all_types(AllTypes),
    findall(TargetType,
        ( member(TargetType, AllTypes),
          member(StabType, StabTypes),
          combined_multiplier(StabType, [TargetType], Mult),
          Mult > 1.0
        ),
        HitsRaw),
    sort(HitsRaw, Hits),
    length(Hits, HitCount),
    HitCount > 0,
    OverlapPenalty is max(0, 4 - StabCount),
    Raw is (HitCount * 2) - (OverlapPenalty * 2),
    Raw > 0,
    Score is min(28, Raw),
    format(atom(Reason), 'pressão ofensiva complementar: STABs do par ameaçam ~w tipo(s) com vantagem', [HitCount]).

pair_best_defensive_multiplier(MultA, MultB, MultA) :-
    MultA =< MultB,
    !.
pair_best_defensive_multiplier(_MultA, MultB, MultB).

pair_raw_score_to_1000(RawScore, Score) :-
    Scaled0 is round((RawScore / 320.0) * 1000.0),
    Score is max(0, min(1000, Scaled0)).

pair_synergy_band_label(Score, 'sinergia estrutural muito alta') :-
    Score >= 800,
    !.
pair_synergy_band_label(Score, 'sinergia estrutural alta') :-
    Score >= 600,
    !.
pair_synergy_band_label(Score, 'sinergia estrutural moderada') :-
    Score >= 350,
    !.
pair_synergy_band_label(_Score, 'sinergia estrutural inicial').

pair_direction_weather_synergy(_SetterName, SetterAbilities, PartnerTypes, PartnerAbilities, Score, Reason) :-
    member(SetterAbility, SetterAbilities),
    ability_sets_weather_for_strategy(SetterAbility, Weather),
    weather_partner_best_reason(Weather, PartnerTypes, PartnerAbilities, Bonus, PartnerReason),
    Bonus > 0,
    strategy_weather_label(Weather, WeatherLabel),
    display_label(SetterAbility, SetterAbilityLabel),
    Score is Bonus + 8,
    format(atom(Reason), '~w ativa ~w e ~w', [SetterAbilityLabel, WeatherLabel, PartnerReason]).

pair_direction_terrain_synergy(_SetterName, SetterAbilities, PartnerTypes, PartnerAbilities, Score, Reason) :-
    member(SetterAbility, SetterAbilities),
    ability_sets_terrain_for_strategy(SetterAbility, Terrain),
    terrain_partner_best_reason(Terrain, PartnerTypes, PartnerAbilities, Bonus, PartnerReason),
    Bonus > 0,
    strategy_terrain_label(Terrain, TerrainLabel),
    display_label(SetterAbility, SetterAbilityLabel),
    Score is Bonus + 6,
    format(atom(Reason), '~w ativa ~w e ~w', [SetterAbilityLabel, TerrainLabel, PartnerReason]).

pair_shared_weather_mode(TypesA, AbilitiesA, TypesB, AbilitiesB, 8, Reason) :-
    strategy_weather_label(Weather, WeatherLabel),
    weather_partner_support_score(Weather, TypesA, AbilitiesA, ScoreA),
    weather_partner_support_score(Weather, TypesB, AbilitiesB, ScoreB),
    ScoreA >= 10,
    ScoreB >= 10,
    format(atom(Reason), 'os dois lados conseguem operar bem sob ~w', [WeatherLabel]).

pair_shared_terrain_mode(TypesA, AbilitiesA, TypesB, AbilitiesB, 6, Reason) :-
    strategy_terrain_label(Terrain, TerrainLabel),
    terrain_partner_support_score(Terrain, TypesA, AbilitiesA, ScoreA),
    terrain_partner_support_score(Terrain, TypesB, AbilitiesB, ScoreB),
    ScoreA >= 8,
    ScoreB >= 8,
    format(atom(Reason), 'os dois lados conseguem explorar ~w como plano auxiliar', [TerrainLabel]).

weather_partner_support_score(Weather, Types, Abilities, Score) :-
    findall(LocalScore,
        weather_partner_reason(Weather, Types, Abilities, LocalScore, _),
        Scores),
    Scores \= [],
    max_list(Scores, Score).

terrain_partner_support_score(Terrain, Types, Abilities, Score) :-
    findall(LocalScore,
        terrain_partner_reason(Terrain, Types, Abilities, LocalScore, _),
        Scores),
    Scores \= [],
    max_list(Scores, Score).

weather_partner_best_reason(Weather, Types, Abilities, Score, Reason) :-
    findall(LocalScore-LocalReason,
        weather_partner_reason(Weather, Types, Abilities, LocalScore, LocalReason),
        Options),
    Options \= [],
    keysort(Options, Asc),
    reverse(Asc, [Score-Reason | _]).

terrain_partner_best_reason(Terrain, Types, Abilities, Score, Reason) :-
    findall(LocalScore-LocalReason,
        terrain_partner_reason(Terrain, Types, Abilities, LocalScore, LocalReason),
        Options),
    Options \= [],
    keysort(Options, Asc),
    reverse(Asc, [Score-Reason | _]).

weather_partner_reason(Weather, _Types, Abilities, Score, Reason) :-
    member(Ability, Abilities),
    weather_ability_bonus(Weather, Ability, Score, CoreReason),
    display_label(Ability, AbilityLabel),
    format(atom(Reason), '~w (~w)', [CoreReason, AbilityLabel]).
weather_partner_reason(sandstorm, Types, Abilities, 28,
    'perfil Ground/Dragon com Sand Veil combina muito com plano de areia') :-
    member(ground, Types),
    member(dragon, Types),
    member(sand_veil, Abilities),
    !.
weather_partner_reason(Weather, Types, _Abilities, Score, Reason) :-
    weather_type_bonus(Weather, Types, Score, Reason).

terrain_partner_reason(Terrain, _Types, Abilities, Score, Reason) :-
    member(Ability, Abilities),
    terrain_ability_bonus(Terrain, Ability, Score, CoreReason),
    display_label(Ability, AbilityLabel),
    format(atom(Reason), '~w (~w)', [CoreReason, AbilityLabel]).
terrain_partner_reason(Terrain, Types, _Abilities, Score, Reason) :-
    terrain_type_bonus(Terrain, Types, Score, Reason).

weather_ability_bonus(Weather, Ability, Score, Reason) :-
    manual_weather_ability_bonus(Ability, Weather, Score, Reason),
    !.
weather_ability_bonus(Weather, Ability, Score, Reason) :-
    ability_effect(Ability, _Category, _Trigger, CombatModel, _Description),
    combat_model_has_weather(CombatModel, Weather),
    combat_model_weather_bonus(CombatModel, Score, Reason).

manual_weather_ability_bonus(sand_veil, sandstorm, 20, 'a habilidade aumenta evasao durante a areia').
manual_weather_ability_bonus(slush_rush, snow, 22, 'a habilidade dobra speed durante neve').
manual_weather_ability_bonus(snow_cloak, snow, 14, 'a habilidade aumenta evasao durante neve').
manual_weather_ability_bonus(dry_skin, rain, 16, 'a habilidade favorece sustain em chuva').
manual_weather_ability_bonus(leaf_guard, sun, 12, 'a habilidade protege contra status sob sol').

combat_model_has_weather(CombatModel, Weather) :-
    member(weather-WeatherRaw, CombatModel),
    normalize_weather_key(WeatherRaw, Weather).

normalize_weather_key(hail, snow) :- !.
normalize_weather_key(Weather, Weather).

combat_model_weather_bonus(CombatModel, 24, 'ganha forte controle de velocidade sob esse clima') :-
    member(speed_multiplier-Multiplier, CombatModel),
    number(Multiplier),
    Multiplier >= 1.5,
    !.
combat_model_weather_bonus(CombatModel, 18, 'ganha boost ofensivo direto sob esse clima') :-
    member(special_attack_multiplier-Multiplier, CombatModel),
    number(Multiplier),
    Multiplier > 1.0,
    !.
combat_model_weather_bonus(CombatModel, 18, 'ganha boost de tipo sob esse clima') :-
    member(type_boost-BoostedTypes, CombatModel),
    BoostedTypes \= [],
    !.
combat_model_weather_bonus(CombatModel, 14, 'ganha recuperacao de HP por turno') :-
    member(heal_per_turn-Heal, CombatModel),
    number(Heal),
    Heal > 0,
    !.
combat_model_weather_bonus(CombatModel, 10, 'ganha utilidade defensiva recorrente sob esse clima') :-
    member(cure_status_end_turn-true, CombatModel),
    !.
combat_model_weather_bonus(CombatModel, 10, 'ganha pressao de evasao sob esse clima') :-
    member(evasion_multiplier-Multiplier, CombatModel),
    number(Multiplier),
    Multiplier > 1.0.

weather_type_bonus(sandstorm, Types, 16, 'o parceiro e tipo Rock: recebe boost defensivo especial e nao sofre chip da areia') :-
    member(rock, Types),
    !.
weather_type_bonus(sandstorm, Types, 10, 'o parceiro e imune ao chip da areia (Ground/Steel)') :-
    ( member(ground, Types)
    ; member(steel, Types)
    ),
    !.
weather_type_bonus(sun, Types, 10, 'o parceiro pode pressionar com STAB Fire sob sol') :-
    member(fire, Types),
    !.
weather_type_bonus(rain, Types, 10, 'o parceiro pode pressionar com STAB Water sob chuva') :-
    member(water, Types),
    !.
weather_type_bonus(snow, Types, 8, 'o parceiro Ice tende a ganhar valor estrutural sob neve') :-
    member(ice, Types).

terrain_ability_bonus(electric, surge_surfer, 24, 'a habilidade dobra speed em terreno eletrico').
terrain_ability_bonus(electric, quark_drive, 18, 'a habilidade ganha boost adicional em terreno eletrico').
terrain_ability_bonus(electric, hadron_engine, 18, 'a habilidade ganha boost adicional em terreno eletrico').
terrain_ability_bonus(_Terrain, mimicry, 8, 'a habilidade pode adaptar o tipo ao terreno para mudar matchups').

terrain_type_bonus(electric, Types, 12, 'o parceiro aproveita boost de dano em golpes Electric no terreno eletrico') :-
    member(electric, Types),
    !.
terrain_type_bonus(grassy, Types, 12, 'o parceiro aproveita boost de dano em golpes Grass no terreno de grama') :-
    member(grass, Types),
    !.
terrain_type_bonus(psychic, Types, 12, 'o parceiro aproveita boost de dano em golpes Psychic no terreno psiquico') :-
    member(psychic, Types),
    !.
terrain_type_bonus(misty, Types, 10, 'o parceiro Dragon ganha alivio de pressao contra golpes Dragon no terreno mistico') :-
    member(dragon, Types).

ability_sets_weather_for_strategy(Ability, Weather) :-
    ability_effect(Ability, _Category, _Trigger, CombatModel, _Description),
    member(set_weather-WeatherRaw, CombatModel),
    normalize_weather_key(WeatherRaw, Weather),
    !.
ability_sets_weather_for_strategy(drought, sun).
ability_sets_weather_for_strategy(desolate_land, sun).
ability_sets_weather_for_strategy(orichalcum_pulse, sun).
ability_sets_weather_for_strategy(drizzle, rain).
ability_sets_weather_for_strategy(primordial_sea, rain).
ability_sets_weather_for_strategy(sand_stream, sandstorm).
ability_sets_weather_for_strategy(snow_warning, snow).

ability_sets_terrain_for_strategy(electric_surge, electric).
ability_sets_terrain_for_strategy(grassy_surge, grassy).
ability_sets_terrain_for_strategy(misty_surge, misty).
ability_sets_terrain_for_strategy(psychic_surge, psychic).
ability_sets_terrain_for_strategy(hadron_engine, electric).

strategy_weather_label(sun, 'sol').
strategy_weather_label(rain, 'chuva').
strategy_weather_label(sandstorm, 'tempestade de areia').
strategy_weather_label(snow, 'neve').

strategy_terrain_label(electric, 'terreno eletrico').
strategy_terrain_label(grassy, 'terreno de grama').
strategy_terrain_label(misty, 'terreno mistico').
strategy_terrain_label(psychic, 'terreno psiquico').

pair_reasons_top(Reasons, Limit, TopReasons) :-
    keysort(Reasons, Asc),
    reverse(Asc, Desc),
    take_first_n(Desc, Limit, TopReasons).

pair_reasons_score_sum([], 0).
pair_reasons_score_sum([Score-_|Rest], Total) :-
    pair_reasons_score_sum(Rest, TailTotal),
    Total is Score + TailTotal.

print_pair_synergy_reasons([]).
print_pair_synergy_reasons([_-Reason | Rest]) :-
    format('  - ~w~n', [Reason]),
    print_pair_synergy_reasons(Rest).

print_compatible_partner_lines([]).
print_compatible_partner_lines([_Score-Name-Reasons | Rest]) :-
    display_pokemon_name(Name, NameLabel),
    partner_reasons_excerpt(Reasons, Excerpt),
    format('  - ~w: ~w~n', [NameLabel, Excerpt]),
    print_compatible_partner_lines(Rest).

print_compatible_partner_preview(_TargetLabel, _Limit, []) :-
    retractall(pending_partner_options(_, _)),
    retractall(pending_synergy_details(_, _)).
print_compatible_partner_preview(TargetLabel, Limit, TopPairs) :-
    PreviewSize is min(4, Limit),
    take_first_n(TopPairs, PreviewSize, Preview),
    print_compatible_partner_lines(Preview),
    ( append(Preview, Remaining, TopPairs),
      Remaining \= [] ->
        length(Remaining, RemainingCount),
        retractall(pending_partner_options(_, _)),
        assertz(pending_partner_options(TargetLabel, Remaining)),
        format('Bot: Tenho mais ~w opção(ões) para ~w. Se quiser, peça "outra opção".~n', [RemainingCount, TargetLabel])
    ; retractall(pending_partner_options(_, _))
    ),
    partner_detail_entries_from_pairs(Preview, DetailEntries),
    set_pending_synergy_details(partners_context(TargetLabel), DetailEntries),
    synergy_detail_prompt(partners_context(TargetLabel), DetailEntries).

partner_reasons_excerpt([], 'sem detalhes adicionais').
partner_reasons_excerpt([_-Reason], Reason).
partner_reasons_excerpt([_-ReasonA, _-ReasonB | _], Text) :-
    atomic_list_concat([ReasonA, ReasonB], '; ', Text).

set_pending_synergy_details(_Context, []) :-
    retractall(pending_synergy_details(_, _)).
set_pending_synergy_details(Context, Entries) :-
    Entries \= [],
    retractall(pending_synergy_details(_, _)),
    assertz(pending_synergy_details(Context, Entries)).

synergy_detail_prompt(_Context, []) :-
    !.
synergy_detail_prompt(pair_context(_LabelA, _LabelB), _Entries) :-
    !,
    writeln('Bot: Se quiser, eu detalho os pontos acima. Ex.: "detalhar 1" ou "detalhar tudo".').
synergy_detail_prompt(partners_context(_TargetLabel), _Entries) :-
    writeln('Bot: Se quiser, eu detalho qualquer opção listada. Ex.: "detalhar 1", "detalhar <nome>" ou "detalhar tudo".').

pair_detail_entries_from_reasons(Reasons, Entries) :-
    pair_detail_entries_from_reasons(Reasons, 1, Entries).

pair_detail_entries_from_reasons([], _Index, []).
pair_detail_entries_from_reasons([Score-Reason | Rest], Index,
    [detail_entry(Index, none, Title, [Score-Reason]) | Tail]) :-
    format(atom(Title), 'ponto ~w', [Index]),
    NextIndex is Index + 1,
    pair_detail_entries_from_reasons(Rest, NextIndex, Tail).

partner_detail_entries_from_pairs(Pairs, Entries) :-
    partner_detail_entries_from_pairs(Pairs, 1, Entries).

partner_detail_entries_from_pairs([], _Index, []).
partner_detail_entries_from_pairs([_Score-Name-Reasons | Rest], Index,
    [detail_entry(Index, Name, NameLabel, Reasons) | Tail]) :-
    display_pokemon_name(Name, NameLabel),
    NextIndex is Index + 1,
    partner_detail_entries_from_pairs(Rest, NextIndex, Tail).

synergy_details_append_partner_pair(TargetLabel, _Score-Name-_Reasons) :-
    pending_synergy_details(partners_context(TargetLabel), ExistingEntries),
    member(detail_entry(_, Name, _Title, _ExistingReasons), ExistingEntries),
    !.
synergy_details_append_partner_pair(TargetLabel, _Score-Name-Reasons) :-
    pending_synergy_details(partners_context(TargetLabel), ExistingEntries),
    length(ExistingEntries, ExistingCount),
    NextIndex is ExistingCount + 1,
    display_pokemon_name(Name, NameLabel),
    append(ExistingEntries, [detail_entry(NextIndex, Name, NameLabel, Reasons)], UpdatedEntries),
    set_pending_synergy_details(partners_context(TargetLabel), UpdatedEntries),
    !.
synergy_details_append_partner_pair(_TargetLabel, _Pair).
