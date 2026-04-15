:- encoding(utf8).
:- use_module(library(http/json)).
:- ensure_loaded('../prolog/pokedex_bot.pl').
:- initialization(main).

main :-
    configure_text_encoding,
    load_database,
    set_default_generation,
    bridge_loop.

bridge_loop :-
    read_line_to_string(user_input, InputRaw),
    ( InputRaw == end_of_file ->
        true
    ; catch(process_bridge_command(InputRaw), Error, process_bridge_error(Error)),
      bridge_loop
    ).

process_bridge_command("__PING__") :-
    write_response("pong").
process_bridge_command("__RESET__") :-
    set_default_generation,
    write_response("Bot: Estado da conversa reiniciado.").
process_bridge_command("__POKEDEX_LIST_JSON__") :-
    bridge_pokedex_list_json(Response),
    write_response(Response).
process_bridge_command(InputRaw) :-
    string_concat("__POKEDEX_DETAIL_JSON__:", IdentifierRaw, InputRaw),
    IdentifierRaw \= "",
    !,
    bridge_pokedex_detail_json(IdentifierRaw, Response),
    write_response(Response).
process_bridge_command(InputRaw) :-
    normalize_space(string(Input), InputRaw),
    ( Input == "" ->
        write_response("Bot: Digite uma pergunta para continuar.")
    ; downcase_atom(Input, Text),
      with_output_to(string(OutputRaw), handle(Text)),
      normalize_bridge_output(OutputRaw, Output),
      write_response(Output)
    ).

normalize_bridge_output(OutputRaw, Output) :-
    normalize_space(string(Probe), OutputRaw),
    ( Probe == "" ->
        Output = "Bot: Sem resposta."
    ; Output = OutputRaw
    ).

process_bridge_error(Error) :-
    message_to_string(Error, Message),
    format(string(Output), "Bot: Ocorreu um erro interno (~s).", [Message]),
    write_response(Output).

bridge_pokedex_list_json(Response) :-
    pokedex_list_entries(Entries),
    Dict = _{ok:true, pokemon:Entries},
    dict_to_json_string(Dict, Response).

bridge_pokedex_detail_json(IdentifierRaw, Response) :-
    normalize_identifier_for_lookup(IdentifierRaw, Identifier),
    ( pokemon_detail_dict(Identifier, Detail) ->
        Dict = _{ok:true, detail:Detail}
    ; Dict = _{ok:false, error:"Pokémon não encontrado."}
    ),
    dict_to_json_string(Dict, Response).

normalize_identifier_for_lookup(IdentifierRaw, Identifier) :-
    string_lower(IdentifierRaw, Lower),
    split_string(Lower, " ", "", PartsRaw),
    include(bridge_non_empty_string, PartsRaw, Parts),
    atomic_list_concat(Parts, '_', IdentifierAtom),
    atom_string(Identifier, IdentifierAtom).

bridge_non_empty_string(Text) :-
    Text \= "".

pokedex_list_entries(Entries) :-
    findall(ID-Entry,
        pokedex_list_entry(ID, Entry),
        RawPairs),
    keysort(RawPairs, SortedPairs),
    pairs_values_local(SortedPairs, Entries).

pokedex_list_entry(ID, Entry) :-
    pokemon_in_scope(ID, Name, _Height, _Weight, Types, _Abilities, _Stats),
    safe_display_pokemon_name(Name, DisplayName),
    maplist(display_type_label, Types, TypeLabels),
    Entry = _{
        id:ID,
        identifier:Name,
        display_name:DisplayName,
        types:Types,
        type_labels:TypeLabels
    }.

pairs_values_local([], []).
pairs_values_local([_Key-Value | Rest], [Value | ValuesRest]) :-
    pairs_values_local(Rest, ValuesRest).

pokemon_detail_dict(Identifier, DetailDict) :-
    pokemon_info(Identifier, pokemon(ID, Name, Height, Weight, Types, Abilities, Stats)),
    safe_display_pokemon_name(Name, DisplayName),
    maplist(display_type_label, Types, TypeLabels),
    maplist(display_label, Abilities, AbilityLabels),
    ability_options_dict(Types, Abilities, AbilityOptions),
    preferred_ability_identifier(Abilities, SelectedAbility),
    HeightM is Height / 10,
    WeightKg is Weight / 10,
    type_effectiveness_summary(Types, Weaknesses, Resistances, Immunities),
    effect_entries_dict(Weaknesses, WeakEntries),
    effect_entries_dict(Resistances, ResistEntries),
    maplist(type_only_entry_dict, Immunities, ImmunityEntries),
    build_brief_description(Types, Abilities, Stats, Description),
    pokemon_lore_text(ID, LoreRaw),
    beautify_lore_text(LoreRaw, LoreText),
    evolution_navigation_dict(ID, EvolutionDict),
    pokemon_move_list_for_id(ID, Name, Moves, MoveSource),
    sort(Moves, UniqueMoves),
    maplist(display_label, UniqueMoves, MoveLabels),
    maplist(move_entry_dict, UniqueMoves, MoveDetails),
    length(MoveLabels, MoveCount),
    first_n(MoveLabels, 25, MoveSample),
    move_source_text(MoveSource, MoveSourceText),
    stats_entries_dict(Stats, StatEntries, MaxStat),
    DetailDict = _{
        id:ID,
        identifier:Name,
        display_name:DisplayName,
        height_dm:Height,
        height_m:HeightM,
        weight_hg:Weight,
        weight_kg:WeightKg,
        types:Types,
        type_labels:TypeLabels,
        abilities:AbilityLabels,
        ability_identifiers:Abilities,
        ability_options:AbilityOptions,
        selected_ability:SelectedAbility,
        description:Description,
        lore:LoreText,
        moves_count:MoveCount,
        moves_sample:MoveSample,
        moves:MoveLabels,
        moves_details:MoveDetails,
        moves_source:MoveSourceText,
        type_relations:_{
            weaknesses:WeakEntries,
            resistances:ResistEntries,
            immunities:ImmunityEntries
        },
        evolution:EvolutionDict,
        stats:StatEntries,
        max_stat:MaxStat
    }.

preferred_ability_identifier([Ability | _], Ability) :- !.
preferred_ability_identifier([], '').

ability_options_dict(_Types, [], []).
ability_options_dict(Types, [Ability | Rest], [Entry | Tail]) :-
    display_label(Ability, AbilityLabel),
    ability_catalog_text(Ability, ShortEffect, Effect),
    type_effectiveness_summary_with_ability(Types, Ability, Weaknesses, Resistances, Immunities),
    effect_entries_dict(Weaknesses, WeakEntries),
    effect_entries_dict(Resistances, ResistEntries),
    maplist(type_only_entry_dict, Immunities, ImmunityEntries),
    Entry = _{
        identifier:Ability,
        label:AbilityLabel,
        short_effect:ShortEffect,
        effect:Effect,
        type_relations:_{
            weaknesses:WeakEntries,
            resistances:ResistEntries,
            immunities:ImmunityEntries
        }
    },
    ability_options_dict(Types, Rest, Tail).

ability_catalog_text(Ability, ShortEffect, Effect) :-
    ( ability_entry(Ability, _Generation, _IsMainSeries, ShortRaw, EffectRaw) ->
        ShortEffect = ShortRaw,
        Effect = EffectRaw
    ; ShortEffect = 'Sem descrição curta disponível.',
      Effect = 'Sem descrição detalhada disponível.'
    ).

type_effectiveness_summary_with_ability(DefenseTypes, Ability, Weaknesses, Resistances, Immunities) :-
    all_types(AttackTypes),
    findall(Type-M,
        ( member(Type, AttackTypes),
          combined_multiplier(Ability, Type, DefenseTypes, M),
          M > 1.0
        ),
        Weaknesses),
    findall(Type-M,
        ( member(Type, AttackTypes),
          combined_multiplier(Ability, Type, DefenseTypes, M),
          M > 0.0,
          M < 1.0
        ),
        Resistances),
    findall(Type,
        ( member(Type, AttackTypes),
          combined_multiplier(Ability, Type, DefenseTypes, 0.0)
        ),
        Immunities).

combined_multiplier(Ability, AttackType, DefenseTypes, Multiplier) :-
    combined_multiplier(AttackType, DefenseTypes, BaseMultiplier),
    ability_multiplier_adjustment(Ability, AttackType, BaseMultiplier, Multiplier).

ability_multiplier_adjustment(Ability, AttackType, _BaseMultiplier, 0.0) :-
    ability_grants_type_immunity(Ability, AttackType),
    !.
ability_multiplier_adjustment(Ability, AttackType, BaseMultiplier, Multiplier) :-
    findall(Factor,
        ( ability_effect(Ability, _Category, _Trigger, CombatModel, _Description),
          member(damage_multiplier-AttackType-Factor, CombatModel),
          number(Factor)
        ),
        Factors),
    multiply_factors(Factors, FactorMultiplier),
    Multiplier is BaseMultiplier * FactorMultiplier.

ability_grants_type_immunity(Ability, AttackType) :-
        ability_effect(Ability, _Category, _Trigger, CombatModel, _Description),
        member(immunity-AttackType, CombatModel),
        !.
ability_grants_type_immunity(Ability, AttackType) :-
        ability_catalog_absorb_immunity(Ability, AttackType).

ability_catalog_absorb_immunity(Ability, AttackType) :-
        ability_catalog_text(Ability, ShortEffect, Effect),
        format(atom(CombinedRaw), '~w ~w', [ShortEffect, Effect]),
        downcase_atom(CombinedRaw, Combined),
        ( format(atom(PatternA), 'absorbs ~w moves', [AttackType]),
            sub_atom(Combined, _, _, _, PatternA)
        ; format(atom(PatternB), 'absorbs ~w-type moves', [AttackType]),
            sub_atom(Combined, _, _, _, PatternB)
        ).

multiply_factors([], 1.0).
multiply_factors([Factor | Rest], Product) :-
    multiply_factors(Rest, TailProduct),
    Product is Factor * TailProduct.

effect_entries_dict([], []).
effect_entries_dict([Type-Multiplier | Rest], [Entry | Tail]) :-
    display_type_label(Type, TypeLabel),
    multiplier_text(Multiplier, MultText),
    Entry = _{
        type:Type,
        type_label:TypeLabel,
        multiplier:MultText,
        multiplier_value:Multiplier
    },
    effect_entries_dict(Rest, Tail).

stats_entries_dict(Stats, Entries, MaxStat) :-
    findall(Value, member(_Stat-Value, Stats), Values),
    ( Values = [] -> MaxStat = 1 ; max_list(Values, MaxStat) ),
    maplist(stat_entry_dict, Stats, Entries).

stat_entry_dict(Stat-Value, Entry) :-
    display_stat_label(Stat, Label),
    Entry = _{key:Stat, label:Label, value:Value}.

type_only_entry_dict(Type, Entry) :-
    display_type_label(Type, TypeLabel),
    Entry = _{type:Type, type_label:TypeLabel}.

evolution_navigation_dict(CurrentID, Dict) :-
    ( current_predicate(level_gate_species_id/2),
      level_gate_species_id(CurrentID, SpeciesID) ->
        true
    ; SpeciesID = CurrentID
    ),
    ( current_predicate(species_family_members/2),
      species_family_members(SpeciesID, FamilyIDsRaw),
      FamilyIDsRaw \= [] ->
        true
    ; FamilyIDsRaw = [SpeciesID]
    ),
    sort(FamilyIDsRaw, FamilyIDs),
    evolution_member_entries(FamilyIDs, SpeciesID, Members),
    ( current_predicate(family_evolution_transitions/2),
      family_evolution_transitions(FamilyIDs, TransitionRaw) ->
        true
    ; TransitionRaw = []
    ),
    maplist(evolution_transition_dict, TransitionRaw, Transitions),
    Dict = _{
        current_id:SpeciesID,
        members:Members,
        transitions:Transitions
    }.

evolution_member_entries(FamilyIDs, SpeciesID, Members) :-
    findall(Key-Entry,
        ( member(MemberID, FamilyIDs),
          evolution_member_entry(MemberID, SpeciesID, Key, Entry)
        ),
        RawPairs),
    keysort(RawPairs, SortedPairs),
    pairs_values_local(SortedPairs, Members).

evolution_member_entry(MemberID, SpeciesID, Stage-MemberID, Entry) :-
    species_stage_index(MemberID, Stage),
    pokemon_info(MemberID, pokemon(_, Identifier, _Height, _Weight, Types, _Abilities, _Stats)),
    safe_display_pokemon_name(Identifier, DisplayName),
    maplist(display_type_label, Types, TypeLabels),
    ( MemberID =:= SpeciesID -> IsCurrent = true ; IsCurrent = false ),
    Entry = _{
        id:MemberID,
        identifier:Identifier,
        display_name:DisplayName,
        stage:Stage,
        current:IsCurrent,
        types:Types,
        type_labels:TypeLabels
    }.

evolution_transition_dict(detailed_edge(FromID, ToID, Trigger, MinLevel, Condition), Entry) :-
    evolution_target_identifier_label(FromID, FromIdentifier, FromLabel),
    evolution_target_identifier_label(ToID, ToIdentifier, ToLabel),
    evolution_condition_text(Trigger, MinLevel, Condition, ConditionText),
    Entry = _{
        kind:"detailed",
        from_id:FromID,
        to_id:ToID,
        from_identifier:FromIdentifier,
        to_identifier:ToIdentifier,
        from_label:FromLabel,
        to_label:ToLabel,
        condition:ConditionText
    }.
evolution_transition_dict(ambiguous_edge(FromID, ToID, Count), Entry) :-
    evolution_target_identifier_label(FromID, FromIdentifier, FromLabel),
    evolution_target_identifier_label(ToID, ToIdentifier, ToLabel),
    format(string(ConditionText), "Existem ~w caminhos alternativos.", [Count]),
    Entry = _{
        kind:"ambiguous",
        from_id:FromID,
        to_id:ToID,
        from_identifier:FromIdentifier,
        to_identifier:ToIdentifier,
        from_label:FromLabel,
        to_label:ToLabel,
        count:Count,
        condition:ConditionText
    }.

evolution_target_identifier_label(ID, Identifier, DisplayName) :-
    ( pokemon_info(ID, pokemon(_, IdentifierRaw, _Height, _Weight, _Types, _Abilities, _Stats)) ->
        Identifier = IdentifierRaw,
        safe_display_pokemon_name(IdentifierRaw, DisplayName)
    ; format(atom(Identifier), '#~w', [ID]),
      format(atom(DisplayName), '#~w', [ID])
    ).

move_entry_dict(MoveIdentifier, Entry) :-
    display_label(MoveIdentifier, MoveLabel),
    ( move_data(MoveIdentifier, Type, Category, BasePower, Accuracy, PP, Tags, EffectChance, Ailment, EffectCategory, Description) ->
        display_type_label(Type, TypeLabel),
        display_label(Category, CategoryLabel),
        move_power_text(Category, BasePower, PowerText),
        move_accuracy_text(Accuracy, AccuracyText),
        move_priority_from_tags(Tags, Priority),
        move_effect_text(Description, EffectText),
        move_effect_chance_text(EffectChance, EffectChanceText),
        display_label(Ailment, AilmentLabel),
        display_label(EffectCategory, EffectCategoryLabel),
        Entry = _{
            identifier:MoveIdentifier,
            label:MoveLabel,
            type:Type,
            type_label:TypeLabel,
            category_label:CategoryLabel,
            power:PowerText,
            accuracy:AccuracyText,
            pp:PP,
            priority:Priority,
            effect:EffectText,
            effect_chance:EffectChanceText,
            ailment:AilmentLabel,
            effect_category:EffectCategoryLabel
        }
    ; Entry = _{
        identifier:MoveIdentifier,
        label:MoveLabel,
        type:none,
        type_label:"-",
        category_label:"-",
        power:"-",
        accuracy:"-",
        pp:"-",
        priority:0,
        effect:"Sem descrição disponível.",
        effect_chance:"-",
        ailment:"-",
        effect_category:"-"
      }
    ).

move_effect_chance_text(Chance, "-") :-
    var(Chance),
    !.
move_effect_chance_text(null, "-") :- !.
move_effect_chance_text(Chance, Text) :-
    format(string(Text), '~w%%', [Chance]).

move_source_text(exact, "exact").
move_source_text(base(BaseName), Text) :-
    safe_display_pokemon_name(BaseName, BaseLabel),
    format(string(Text), "base:~w", [BaseLabel]).
move_source_text(fallback, "fallback").

first_n(List, N, First) :-
    length(List, Len),
    Len =< N,
    !,
    First = List.
first_n(List, N, First) :-
    length(First, N),
    append(First, _, List).

safe_display_pokemon_name(Name, DisplayName) :-
    ( current_predicate(display_pokemon_name/2),
      display_pokemon_name(Name, DisplayName) ->
        true
    ; display_label(Name, DisplayName)
    ).

dict_to_json_string(Dict, JsonString) :-
    atom_json_dict(JsonAtom, Dict, []),
    atom_string(JsonAtom, JsonString).

write_response(Output) :-
    format('[[BOT_RESPONSE_BEGIN]]~n~s~n[[BOT_RESPONSE_END]]~n', [Output]),
    flush_output(user_output).
