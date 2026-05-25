# Intent Reformulation Study - 2026-04-13

## Scope
This study was executed after the lexical expansion phases and covers:
- Domain disambiguation by evidence score (instead of first-match only) for mixed prompts.
- Ability intent reform for ability-name phrases without explicit keyword.
- New intent for specific item detail.
- New intent for specific move detail.
- Synthetic confusion matrix for intent routing quality.

## Method
A synthetic benchmark script was added in tests/intent_confusion_study.pl.

Workflow:
1. Load database and default generation.
2. Run 54 labeled prompts across 9 intent classes.
3. Resolve each prompt with resolve_intent(guarded,...).
4. Map goals to classes and compute confusion entries.
5. Report mismatches.

## Benchmark Result
- Total cases: 54
- Correct: 54
- Accuracy: 100.00%
- Mismatches: none

Classes validated:
- rules
- strategy
- held_item_recommendation
- specific_item_detail
- specific_move_detail
- pokemon_movelist
- global_movelist
- ability_details
- ability_catalog

## What was changed
### Phase 1 - Evidence-based disambiguation
- Added mixed-domain conflict detectors:
  - item_move_ability_conflict_signal/1
  - strategy_rules_conflict_signal/1
- Added candidate scoring routers:
  - resolve_item_move_ability_by_evidence/3
  - resolve_strategy_rules_by_evidence/3
- Added evidence strength functions by domain.

### Phase 2 - Ability intent reform
- Ability details now accept explicit ability-name mention plus pokemon context, without requiring explicit "habilidade/ability" keyword.

### Phase 3 - New specific item intent
- Added parse_specific_item_query/2.
- Added answer_specific_item_query/1.

### Phase 4 - New specific move intent
- Added parse_specific_move_query/2.
- Added answer_specific_move_query/1.

### Phase 5 - Confusion study and iterative fixes
- Added synthetic matrix script in tests/intent_confusion_study.pl.
- Fixed observed collisions and guard gaps until matrix reached 100%.

## Recommended next analysis tracks
1. Intent confidence threshold + clarification mode
- Add low-confidence threshold for close-score ties and ask user to confirm intent.

2. Multi-intent decomposition
- Split prompts with conjunction markers ("e depois", "alem disso", "tambem") into ordered subtasks.

3. Catalog mention indexing
- Add token-to-item and token-to-move indexes (similar to pokemon_name_index) to reduce O(n) scans.

4. Domain drift monitoring
- Keep confusion study in CI/nightly and compare trend over time.

5. Intent overlap audit by lexicon source
- Track overlap introduced by each generated lexical file and cap high-risk token classes.

## Re-run commands
- swipl -q -s tests/nlp_token_heuristics_tests.pl -g "run_tests,halt."
- swipl -q -s tests/intent_confusion_study.pl

