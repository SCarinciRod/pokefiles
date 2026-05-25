# Pokefiles NN Migration Plan (VGC Doubles)

Last updated: 2026-05-04

## Goals
- Remove Prolog from runtime entirely.
- Keep GUI behavior stable (same request/response protocol).
- Focus on VGC Doubles first.
- Build NN-based analytics with consistent answers.
- Keep initial download <= 500 MB (compressed), with local extraction.
- Support language dropdown (English default, PT-BR optional).
- Allow quarterly/semiannual data + model updates.

## Guiding Principles
- Determinism first: the rules engine is the source of truth.
- Idempotent data pipeline: same inputs -> same outputs, manifest-backed.
- Avoid quadratic time/space on full datasets; prefer linear or n log n.
- No runtime Prolog; Node/TS owns the protocol boundary.
- Favor explicit schemas, versioning, and automated validation.

## Scope (Phase 1)
- VGC Doubles only.
- Recommendations for Pokemon, abilities, and held items.
- Core mechanics included: speed control, redirection, Protect.
- Deterministic game rules engine in TypeScript.
- NN used for evaluation/strategy scoring and explanation.

## Out of Scope (Phase 1)
- EV/IV optimization and full moveset tuning.
- Complex metagame tiering or usage data.
- Full damage calc across all move interactions.
- Advanced forms, evolutions, and lore tables.

## Architecture Overview
- Data layer: SQLite with indexes + caching layer for hot queries.
- Rule engine: deterministic VGC mechanics in TS, pure functions where possible.
- NLU: intent + slot model (small, quantized), backed by intent catalogs.
- Strategy model: pair/team scoring (medium, quantized), bounded candidate sets.
- Explanation layer: template + evidence, optional lightweight generator later.
- Bridge: Node/TS process that replaces Prolog bridge, same protocol surface.

## Data Pipeline (Phase 1)
1) Input discovery and hashing (db/*.pl + schema).
2) Parse Prolog facts into normalized records (stable ordering).
3) Load into SQLite using a versioned schema.
4) Build derived tables for roles, tags, and synergy features.
5) Export manifest with input hashes and artifact metadata.
6) Validate invariants (counts, key coverage, referential integrity).

## Complexity Guardrails
- No nested full scans over pokemon x moves or move x effect lists.
- Use maps/sets for joins and dedupe; prefer indexed lookups.
- Bound candidate sets for pair/team ranking (top-k, heuristics).
- Keep derivations linear where possible; allow n log n for sorting.
- Streaming or chunked parsing for large inputs; avoid double buffering.

## Model Strategy
- NLU model:
  - Input: user query.
  - Output: intent + slots.
  - Target size: <= 100 MB.
  - Training data from intent catalogs and expansions.
- Strategy model:
  - Input: team context + candidate options.
  - Output: ranking and confidence.
  - Target size: 200-400 MB.
- Total compressed size: <= 500 MB.

## VGC Mechanics (Phase 1)
- Speed control: Tailwind, Trick Room, Icy Wind, Electroweb.
- Redirection: Follow Me, Rage Powder.
- Protect: Protect, Detect, Wide Guard, Quick Guard.
- Priority and turn order rules.
- Basic weather/terrain optional if time allows.

## GUI Integration
- Replace Prolog bridge with Node/TS bridge.
- Keep current protocol format and markers.
- Add language dropdown (EN default, PT-BR).
- Maintain response style and latency expectations.

## Performance Targets
- P95 response time <= 8s (including model inference).
- Warm cache response <= 2s for simple queries.
- First load <= 3s (excluding model download).

## Testing and QA
- Run validate_and_benchmark for parser/heuristics and regression tests.
- Golden set parity checks between Prolog and TS rule engine.
- Schema validation and referential integrity checks after each export.
- Latency benchmarks with cold/warm cache.

## Milestones and Exit Criteria
1) Data conversion + SQLite schema
  - Export script, schema, manifest, integrity checks.
  - Exit: deterministic outputs and validated counts.
2) Deterministic VGC engine (mechanics + scoring)
  - Core rules implemented; parity tests vs Prolog.
  - Exit: no major discrepancies on golden scenarios.
3) NLU pipeline and baseline model
  - Intent/slot model + evaluator.
  - Exit: >= 95% accuracy on golden set.
4) Strategy model training and integration
  - Candidate ranking with bounded search.
  - Exit: stable recommendations and acceptable latency.
5) GUI bridge swap + language dropdown
  - Protocol compatibility and localized strings.
  - Exit: GUI regression passes.
6) Regression tests + benchmarks
  - Automated CI-like script and perf baselines.
  - Exit: P95 targets met.

## Acceptance Criteria
- Prolog not used at runtime.
- GUI works unchanged except new dropdown.
- Intent parsing accuracy >= 95% on golden set.
- Strategy recommendations stable and consistent.
- Meets latency targets.

## Risks and Mitigations
- Risk: model hallucination -> deterministic engine as source of truth.
- Risk: slow inference -> quantize, cache, and bound candidates.
- Risk: data mismatch -> automated validation + manifests.
- Risk: hidden quadratic paths -> complexity review on each milestone.

## Next Actions
- Confirm exact VGC move list for Phase 1.
- Decide on weather/terrain inclusion in Phase 1.
- Lock schema versioning and data validation rules.
- Define golden scenarios for parity testing.
