:- encoding(utf8).

response_text(start_banner_title, '=== Chatbot Pokedex (Prolog) ===').
response_text(start_banner_hint, 'Digite sua pergunta ou use comandos diretos:').
response_text(start_banner_ex_1, '  - info nome pikachu').
response_text(start_banner_ex_2, '  - info numero 25').
response_text(start_banner_ex_3, '  - tipo fogo').
response_text(start_banner_ex_4, '  - geracao 1   (ou: geracao todas)').
response_text(start_banner_ex_5, 'Digite "ajuda" para ver exemplos e "sair" para encerrar.').

response_text(goodbye, 'Bot: Ate mais!').
response_text(goodbye_eof, 'Bot: Encerrando. Ate mais!').
response_text(not_understood, 'Bot: Não entendi. Digite "ajuda" para exemplos de perguntas.').
response_text(follow_up_prompt, 'Bot: Quer fazer outra consulta? Ex.: "pokemon pikachu", "tipo água", "habilidade blaze" ou "status ataque".').

response_text(pending_counter_cancel, 'Bot: Certo, cancelei os filtros e não apliquei nenhuma sugestão de counter.').
response_text(pending_counter_level_cancel, 'Bot: Certo, cancelei os filtros e não apliquei sugestão de counter por nível.').
response_text(pending_type_cancel, 'Bot: Certo, cancelei os filtros de tipo.').
response_text(pending_list_cancel, 'Bot: Certo, cancelei os filtros dessa lista.').

response_text(pending_counter_help, 'Bot: Responda com: "padrão", "sem lendários", "sem mega", "tipo gelo" ou combinação (ex.: "sem lendários tipo gelo").').
response_text(pending_type_help, 'Bot: Responda com: "padrão", "sem lendários", "sem mega" ou combinação (ex.: "sem lendários sem mega").').
