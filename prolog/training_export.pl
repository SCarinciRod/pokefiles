:- encoding(utf8).
:- use_module(library(http/json)).
:- ensure_loaded('pokedex_bot.pl').

% POC: unified scorer + exporter for training examples (counters)

score_candidate(counter(TargetID), CandidateID, Score, explanation(Reason)) :-
  pokemon_info(TargetID, pokemon(_, _TargetName, _H, _W, TargetTypes, _Ab, TargetStats)),
  pokemon_info(CandidateID, pokemon(_, _CandidateName, _CH, _CW, CandidateTypes, _CAb, CandidateStats)),
    counter_metrics(CandidateID, CandidateTypes, CandidateStats, TargetID, TargetTypes, TargetStats, AttackMult, DefenseMult, AttackPressure, DefensePressure),
    counter_score(CandidateID, CandidateStats, TargetID, TargetStats, AttackPressure, DefensePressure, Score),
    format(atom(Reason), 'attack_mult=~w;defense_mult=~w;attack_pressure=~2f;defense_pressure=~2f', [AttackMult, DefenseMult, AttackPressure, DefensePressure]).

% Engine / context helpers
get_engine_version(Version) :-
  ( getenv('POKEFILES_ENGINE_VERSION', V) -> Version = V ; Version = 'unknown' ).

get_active_generation(Gen) :-
  ( current_predicate(active_generation/1) ->
    ( catch(call(active_generation(G)), _, fail) -> Gen = G ; Gen = all )
  ; Gen = all ).

% Export helpers
write_json_line(Stream, Dict) :-
  atom_json_dict(JSONAtom, Dict, [width(0)]),
  format(Stream, '~w~n', [JSONAtom]),
  flush_output(Stream).

% Time helper
get_export_time(ISO) :-
  get_time(T),
  format_time(atom(ISO), '%Y-%m-%dT%H:%M:%SZ', T).

export_counter_dataset(File, MaxPerTarget) :-
    export_counter_dataset_for_generation(File, MaxPerTarget, all).

export_counter_dataset_for_generation(File, MaxPerTarget, Generation) :-
    with_project_root(
      ( load_database_from_root,
        set_active_generation(Generation),
        findall(TargetID, pokemon_in_scope(TargetID, _, _, _, _, _, _), TargetsRaw),
        sort(TargetsRaw, Targets),
        length(Targets, NTargets),
        format('EXPORT: target_count=~w (deduped) generation=~w~n', [NTargets, Generation]),
        get_export_time(ExportTime),
        absolute_file_name(File, Abs, [access(write), file_errors(fail)]),
        format('EXPORT: path=~w~n', [Abs]),
        open(Abs, write, Stream, [encoding(utf8)]),
        export_targets(Stream, Targets, MaxPerTarget, ExportTime, 0, TotalWritten),
        close(Stream),
        format('EXPORT: total_written=~w~n', [TotalWritten])
      )
    ).

% Export a set of counter files, one per generation. BaseFile may include an extension
% (eg. 'exports/counter_pairs.jsonl') — generated files will be named
% '<base>_gen<N>.<ext>' (eg. 'counter_pairs_gen1.jsonl').
export_counter_dataset_per_generation(BaseFile, MaxPerTarget) :-
    with_project_root(
      ( load_database_from_root,
        ( file_name_extension(BaseNoExt, Ext0, BaseFile) -> ( Ext0 == '' -> Ext = 'jsonl' ; Ext = Ext0 ) ; ( BaseNoExt = BaseFile, Ext = 'jsonl' ) ),
        forall(between(1,9,Gen),
          ( set_active_generation(Gen),
            get_export_time(ExportTime),
            format(atom(OutFile), '~w_gen~w.~w', [BaseNoExt, Gen, Ext]),
            absolute_file_name(OutFile, Abs, [access(write), file_errors(fail)]),
            format('EXPORT_GEN: gen=~w path=~w~n', [Gen, Abs]),
            open(Abs, write, Stream, [encoding(utf8)]),
            findall(TargetID, pokemon_in_scope(TargetID, _, _, _, _, _, _), TargetsRaw),
            sort(TargetsRaw, Targets),
            export_targets(Stream, Targets, MaxPerTarget, ExportTime, 0, TotalWritten),
            close(Stream),
            format('EXPORT_GEN: gen=~w total_written=~w~n', [Gen, TotalWritten])
          )
        )
      )
    ).

export_targets(_Stream, [], _MaxPerTarget, _ExportTime, Total, Total).
export_targets(Stream, [T|Rest], MaxPerTarget, ExportTime, Acc, Total) :-
  export_for_target_counted(Stream, T, MaxPerTarget, ExportTime, Written),
  Acc1 is Acc + Written,
  ( 0 is Acc1 mod 500 -> format('EXPORT: written so far=~w~n', [Acc1]) ; true ),
  export_targets(Stream, Rest, MaxPerTarget, ExportTime, Acc1, Total).

export_for_target_counted(Stream, TargetID, MaxPerTarget, ExportTime, Written) :-
    pokemon_info(TargetID, pokemon(_, TargetName, _H, _W, TargetTypes, _Ab, TargetStats)),
    findall(CID,
        ( pokemon_in_scope(CID, _, _, _, CandidateTypes, _, _),
          CID =\= TargetID,
          counter_has_super_effective_coverage(CID, CandidateTypes, TargetID, TargetTypes)
        ), CandidateIDsRaw),
    sort(CandidateIDsRaw, CandidateIDs),
    length(CandidateIDs, CandCount),
    format('CANDIDATES_FOUND: target=~w count=~w (deduped)~n', [TargetID, CandCount]),
    ( CandidateIDs == [] -> Written = 0
    ; take_first_n(CandidateIDs, MaxPerTarget, Selected),
      length(Selected, SelCount),
      ( Selected = [SelFirst | _] -> SelFirstVal = SelFirst ; SelFirstVal = none ),
      format('SELECTED: target=~w sel_count=~w sel_first=~w~n', [TargetID, SelCount, SelFirstVal]),
      export_write_loop(Stream, TargetID, TargetName, TargetTypes, TargetStats, CandidateIDs, Selected, 0, Written, ExportTime)
    ).

export_write_loop(_Stream, _TargetID, _TargetName, _TargetTypes, _TargetStats, _CandidateIDs, [], Acc, Acc, _ExportTime).
export_write_loop(Stream, TargetID, TargetName, TargetTypes, TargetStats, CandidateIDs, [CID | Rest], Acc, Written, ExportTime) :-
    ( catch(
        ( pokemon_info(CID, pokemon(_, CandidateName, _CH, _CW, CandidateTypes, _CAb, CandidateStats)),
          counter_metrics(CID, CandidateTypes, CandidateStats, TargetID, TargetTypes, TargetStats, AttackMult, DefenseMult, AttackPressure, DefensePressure),
          counter_score(CID, CandidateStats, TargetID, TargetStats, AttackPressure, DefensePressure, Score),
          format(atom(Explanation), 'attack_mult=~w;defense_mult=~w;attack_pressure=~2f;defense_pressure=~2f', [AttackMult, DefenseMult, AttackPressure, DefensePressure]),
          get_engine_version(EngineVersion),
          get_active_generation(Generation),
          ( generation_matches_id(CandidateGen, CID) -> true ; CandidateGen = unknown ),
          length(CandidateIDs, CandCount),
          ( nth1(Index, CandidateIDs, CID) -> true ; Index = 1 ),
          ( CandCount > 0 -> RetrievalConfidence is (CandCount - Index + 1) / CandCount ; RetrievalConfidence = 1.0 ),
          Dict = _{target_id:TargetID, target_name:TargetName, candidate_id:CID, candidate_name:CandidateName, candidate_generation:CandidateGen, candidate_types:CandidateTypes, score:Score, attack_pressure:AttackPressure, defense_pressure:DefensePressure, attack_mult:AttackMult, defense_mult:DefenseMult, explanation:Explanation, engine_version:EngineVersion, generation:Generation, retrieval_confidence:RetrievalConfidence, export_time:ExportTime},
          format('WRITE: target=~w candidate=~w score=~w~n', [TargetID, CID, Score]),
          write_json_line(Stream, Dict)
        ),
        E,
        ( format('ERROR_WRITING: target=~w candidate=~w ex=~w~n', [TargetID, CID, E]), fail )
      ) ->
        Acc1 is Acc + 1
    ; Acc1 is Acc
    ),
    export_write_loop(Stream, TargetID, TargetName, TargetTypes, TargetStats, CandidateIDs, Rest, Acc1, Written, ExportTime).

% Simple dispatcher for export_training_examples/2 (extendable)
export_training_examples(counter, File) :-
    export_counter_dataset(File, 4).

% Sample export entry (to avoid large runs by default)
export_counter_dataset_sample(File, MaxPerTarget, SampleTargets) :-
    with_project_root(
      ( load_database_from_root,
        set_active_generation(all),
        findall(TargetID, pokemon_in_scope(TargetID, _, _, _, _, _, _), AllTargetsRaw),
        sort(AllTargetsRaw, AllTargets),
        take_first_n(AllTargets, SampleTargets, Targets),
        length(AllTargets, NAll),
        format('EXPORT: sample target_count=~w (deduped) sample=~w~n', [NAll, SampleTargets]),
        get_export_time(ExportTime),
        absolute_file_name(File, Abs, [access(write), file_errors(fail)]),
        format('EXPORT: sample path=~w~n', [Abs]),
        open(Abs, write, Stream, [encoding(utf8)]),
        export_targets(Stream, Targets, MaxPerTarget, ExportTime, 0, TotalWritten),
        close(Stream),
        format('EXPORT: sample total_written=~w~n', [TotalWritten])
      )
    ).

% Export ranking + metrics (one JSON per target with ranked_candidates list)
export_ranking_metrics(File, TopK) :-
    export_ranking_metrics_for_generation(File, TopK, all).

export_ranking_metrics_for_generation(File, TopK, Generation) :-
    with_project_root(
      ( load_database_from_root,
        set_active_generation(Generation),
        findall(TargetID, pokemon_in_scope(TargetID, _, _, _, _, _, _), TargetsRaw),
        sort(TargetsRaw, Targets),
        length(Targets, NTargets),
        format('EXPORT_RANK: target_count=~w (deduped) generation=~w~n', [NTargets, Generation]),
        get_export_time(ExportTime),
        absolute_file_name(File, Abs, [access(write), file_errors(fail)]),
        format('EXPORT_RANK: path=~w~n', [Abs]),
        open(Abs, write, Stream, [encoding(utf8)]),
        export_ranking_targets(Stream, Targets, TopK, ExportTime, 0, TotalWritten),
        close(Stream),
        format('EXPORT_RANK: total_written=~w~n', [TotalWritten])
      )
    ).

% Export ranking files, one per generation (filename base -> base_gen<N>.<ext>)
export_ranking_metrics_per_generation(BaseFile, TopK) :-
    with_project_root(
      ( load_database_from_root,
        ( file_name_extension(BaseNoExt, Ext0, BaseFile) -> ( Ext0 == '' -> Ext = 'jsonl' ; Ext = Ext0 ) ; ( BaseNoExt = BaseFile, Ext = 'jsonl' ) ),
        forall(between(1,9,Gen),
          ( set_active_generation(Gen),
            get_export_time(ExportTime),
            format(atom(OutFile), '~w_gen~w.~w', [BaseNoExt, Gen, Ext]),
            absolute_file_name(OutFile, Abs, [access(write), file_errors(fail)]),
            format('EXPORT_RANK_GEN: gen=~w path=~w~n', [Gen, Abs]),
            open(Abs, write, Stream, [encoding(utf8)]),
            findall(TargetID, pokemon_in_scope(TargetID, _, _, _, _, _, _), TargetsRaw),
            sort(TargetsRaw, Targets),
            export_ranking_targets(Stream, Targets, TopK, ExportTime, 0, TotalWritten),
            close(Stream),
            format('EXPORT_RANK_GEN: gen=~w total_written=~w~n', [Gen, TotalWritten])
          )
        )
      )
    ).

export_ranking_targets(_Stream, [], _TopK, _ExportTime, Total, Total).
export_ranking_targets(Stream, [T|Rest], TopK, ExportTime, Acc, Total) :-
    export_ranking_for_target(Stream, T, TopK, ExportTime, Written),
    Acc1 is Acc + Written,
    ( 0 is Acc1 mod 200 -> format('EXPORT_RANK: written so far=~w~n', [Acc1]) ; true ),
    export_ranking_targets(Stream, Rest, TopK, ExportTime, Acc1, Total).

export_ranking_for_target(Stream, TargetID, TopK, ExportTime, Written) :-
    pokemon_info(TargetID, pokemon(_, TargetName, _H, _W, TargetTypes, _Ab, TargetStats)),
    findall(Score-CandidateID-CandidateName-AttackMult-DefenseMult-AttackPressure-DefensePressure-CandidateTypes-CandidateGen,
        ( pokemon_in_scope(CandidateID, CandidateName, _, _, CandidateTypes, _, CandidateStats),
          CandidateID =\= TargetID,
          counter_metrics(CandidateID, CandidateTypes, CandidateStats, TargetID, TargetTypes, TargetStats, AttackMult, DefenseMult, AttackPressure, DefensePressure),
          counter_score(CandidateID, CandidateStats, TargetID, TargetStats, AttackPressure, DefensePressure, Score),
          ( generation_matches_id(CandidateGen, CandidateID) -> true ; CandidateGen = unknown )
        ), PairsRaw),
    ( PairsRaw == [] -> Written = 0
    ; keysort(PairsRaw, PairsAsc),
      reverse(PairsAsc, PairsDesc),
      dedupe_pairs_by_cid(PairsDesc, PairsUnique),
      take_first_n(PairsUnique, TopK, TopPairs),
      pairs_to_jsonlist(TopPairs, 1, CandidatesList),
      get_engine_version(EngineVersion),
      get_active_generation(Generation),
      Dict = _{target_id:TargetID, target_name:TargetName, engine_version:EngineVersion, generation:Generation, export_time:ExportTime, ranked_candidates:CandidatesList},
      write_json_line(Stream, Dict),
      length(CandidatesList, Written)
    ).

dedupe_pairs_by_cid(Pairs, Unique) :-
  dedupe_pairs_by_cid(Pairs, [], Rev),
  reverse(Rev, Unique).
dedupe_pairs_by_cid([], _Seen, []).
dedupe_pairs_by_cid([Score-CID-Name-AM-DM-AP-DP-Types-Gen | Rest], Seen, Acc) :-
  ( memberchk(CID, Seen) ->
    dedupe_pairs_by_cid(Rest, Seen, Acc)
  ; dedupe_pairs_by_cid(Rest, [CID | Seen], Tail),
    Acc = [Score-CID-Name-AM-DM-AP-DP-Types-Gen | Tail]
  ).

pairs_to_jsonlist([], _Rank, []).
pairs_to_jsonlist([Score-CID-Name-AM-DM-AP-DP-Types-Gen | Rest], Rank, [_{rank:Rank, candidate_id:CID, candidate_name:Name, candidate_generation:Gen, candidate_types:Types, score:Score, attack_mult:AM, defense_mult:DM, attack_pressure:AP, defense_pressure:DP} | Tail]) :-
  Rank1 is Rank + 1,
  pairs_to_jsonlist(Rest, Rank1, Tail).

% CLI entry (sample run)
main :-
    format('training_export: loading DB and exporting COUNTERS (sample)...~n'),
    catch(
      ( export_counter_dataset_sample('poc/poc-typescript/exports/counter_pairs_sample.jsonl', 4, 50),
        format('training_export: sample export complete.~n')
      ),
      E,
      ( print_message(error, E), format('training_export: export failed with exception.~n') )
    ),
    halt.
