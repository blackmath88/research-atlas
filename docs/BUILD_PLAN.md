# Research Atlas — first build plan

Status: implementation handoff; no runtime dispatched.
Prepared 2026-10-15. Starting repository contained README.md only.
Product decisions: README.md. This plan operationalizes them.

## Outcome

Deliver a working static research explorer backed by a bounded, real OpenAlex snapshot. A visitor can explore research, locate a researcher, inspect publications and follow a connection back to source evidence.

The product is Research Atlas (Atlas in the interface). Constellation is its network view. English throughout. No UNIverse dependency or old scraped dataset.

A complete slice includes collection, offline rebuild, graph exports, useful UI, verification and a reviewable PR. A landing page, a mock graph or an importer alone is not complete.

## Execution contract

- Target: blackmath88/research-atlas.
- Inspect current main, open PRs, local dirty state, AGENTS.md and Observatory artifacts before changes; pin the actual base SHA in the ledger.
- Read blackmath88/weavr/docs/CHATGPT-OPERATING-CONTRACT.md. Inspect canonical state if this work is already governed. Do not invent or dispatch a Weavr Mission from this document.
- Use orchestrate-work and route-orca-work with Orca's current runtime orchestration guide.
- Work on an isolated feature branch/worktree; preserve unrelated work.
- Write scope: this repository's implementation, configs, data, tests, docs and CI. Other repositories are read-only references.
- Default execution envelope: 30 minutes total, at most two concurrent workers, no new paid API spend. If incomplete, settle workers and leave a precise checkpoint; do not claim the whole build finished.
- The coordinator may push the feature branch and open a draft PR. No merge, deployment, scheduled import, account creation or purchase.
- Credentials stay outside Git and browser output. If a free key is unavailable, continue independent work and attempt only supported bounded anonymous reads. Do not evade provider limits.
- Plans are evidence, not authority to waive an existing gate.

## Architecture and files

Suggested structure (adjust where justified):
- configs/collections/basel.json: versioned collection definition.
- pipeline/atlas/: OpenAlex client, normalization, graph, projections, validation and export.
- data/raw/: sanitized bounded source snapshot and retrieval manifest.
- data/normalized/: canonical records or intermediate tables if useful.
- public/data/: compact generated browser exports and snapshot manifest.
- src/: React + TypeScript app with D3 graph interaction/rendering.
- tests/: Python pipeline tests.
- e2e/: browser journeys.
- docs/DATA_METHOD.md, docs/VALIDATION.md, docs/BUILD_LEDGER.md.
- docs/screenshots/: reviewed desktop/mobile evidence.

Prefer Python standard library where practical and React/TypeScript/Vite/D3 for the UI. Avoid a hosted database, GIS dependencies, LLM API and GNN for this first release. Use JSON exports; SQLite is optional preparation storage, not another required service.

Adapt useful interaction patterns from blackmath88/uni-constelation after inspecting its actual code. Do not copy legacy data, faculty lexicons or UNIverse-specific filters. Check licensing before copying code; retain attribution where applicable.

Read blackmath88/basel-spatial-graph for separation of adapters, typed relations, analysis and evidence. Apply City2Graph metapath concepts rather than forcing research data into geometry objects.

## Phase 0 — orientation and shared contract

Coordinator owns:
1. Current-state inspection and exact base.
2. Current OpenAlex documentation verification, particularly API authentication, paging, fields, attribution and limits.
3. Project scaffold, dependency lockfiles, shared TypeScript/data schema and sample fixture.
4. A bounded task ledger with routes, ownership, deadlines, tests and remaining gates.

Define schemaVersion and deterministic IDs before splitting work. Synthetic fixtures must be small, explicitly labelled and confined to tests/development mode. Never present them as the public dataset.

## Phase 1 — collect a real, bounded corpus

Default initial collection:
- University of Basel as resolved from OpenAlex institution data; verify its identity and save the selected ID and source record. Do not guess an ID.
- Works dated 2021-01-01 through 2025-12-31.
- Maximum 2,000 works for the first import.
- Use a documented stable order with a deterministic tie-break when supported. Record any truncation or ordering bias; do not call a capped corpus representative or complete.
- Keep all institution and author IDs supplied on collected works; affiliation belongs to authorship at publication time.
- Start with in-corpus citations and external reference identifiers. Optional reference metadata expansion: one hop, at most 200 unique references, within the same authorized free allowance.

The client needs:
- Bounded page/request/record counts, explicit request pacing and capped backoff/retries.
- Cache, resume and offline modes.
- Capture declared query, redacted request URL, retrieval time, source IDs, response content hashes and provider totals where available.
- Credentials supplied privately, preferably via headers when supported; redact credentials from exceptions, cache keys and URLs.
- Read provider budget information when available; stop safely on exhausted/unknown spend conditions instead of purchasing usage.
- Distinguish complete collection, record cap reached, auth blocked, rate-limited, transport failure and partial response.
- Report missing abstracts, topic assignments, author IDs, incomplete author lists and absent reference information separately.
- Do not download full text.

If credentials prevent a full import, ship a smaller genuine anonymous sample if the provider supports it and label the exact scope. If no real records can be obtained, finish fixture-tested implementation but mark real-data acceptance blocked. Never substitute invented scholarly records.

## Phase 2 — canonical graph and evidence

Canonical records:
- Work: provider ID, DOI when supplied, title, year/date, type, optional abstract, authorship IDs, topic assignments, reference IDs and provenance.
- Researcher: OpenAlex author ID and supplied identifiers such as ORCID; names are labels, not merge keys.
- Institution: source identifier and metadata.
- Topic: source identifier, taxonomy hierarchy where supplied and upstream score/method when available.
- Authorship: stable association of work, author and publication-context affiliations.
- Evidence: source record/pointer, retrieval time, snapshot, input hashes and derivation metadata.

Use an explicit authorship table or node rather than an unexplained relation from a nonexistent entity.

Relations:
- AUTHORED, CITES and source-supplied topic/affiliation assertions.
- COAUTHORED derived from shared works.
- SHARES_REFERENCES derived from reference-set overlap.
- RELATED_TOPIC derived from declared topic overlap.
- CONVERSATION_CANDIDATE as a hypothesis supported by work pairs.

External reference IDs may be unresolved stubs with an explicit status, not fabricated complete nodes. Preserve genuine missingness. Never merge authors by name. Preserve all authorship evidence; above a documented large-author threshold, skip quadratic clique expansion and disclose that projection choice.

Each derived relation carries input work/reference IDs, method/version, parameters and snapshot ID. Each displayed count declares its scope. Do not infer present employment from historical affiliations.

Snapshot ID should be content-derived from sanitized source inputs, collection configuration and relevant transformation versions. Keep variable build timestamps outside deterministic content comparisons.

## Phase 3 — transparent discovery analysis

First implement:
1. Coauthor neighbourhoods.
2. Citation neighbourhoods.
3. Shared-reference work pairs (bibliographic coupling), using an inverted index rather than an all-pairs matrix.
4. Shared-topic work pairs as a separate weaker signal.
5. A small, deterministic shortlist of possible conversations.

Use a documented overlap metric such as Jaccard for reference sets, with raw overlap counts visible. Handle absent versus known-empty reference data explicitly. Downweight or filter ubiquitous references only through a documented rule.

For conversation candidates:
- Require distinct source author IDs and explicit supporting work pairs.
- Exclude observed shared-publication pairs within the snapshot, while saying only that none was found there.
- Prefer candidates with at least two shared references; label topic-only leads separately and avoid padding the shortlist if evidence is weak.
- Do not assert complementary methods, research gaps or willingness.
- Bound pair generation and keep sparse top-k results.
- Sort deterministically with stable tie-breaks.
- Show no candidates when evidence is insufficient; this is a valid result.

Record a qualitative review of up to 10 actual suggestions, including weak examples and false positives. Coordinator review is not faculty-expert validation.

## Phase 4 — build the complete interface

The map is the main workspace, with a useful first screen and visible real data.

Required:
- Collection selector showing only prepared collections.
- Search for people, papers and topics.
- Constellation and list views.
- Year and topic filters.
- Clear legend for source assertions, derived relationships and hypotheses.
- Person panel: snapshot-scoped works and coauthors, with affiliation context.
- Publication panel: metadata, abstract when available, topics, references and source links.
- Connection panel: “Why this connection?” with the full supporting path.
- Coverage panel: source, snapshot date, collection bounds, partial status and missingness.
- URL-preserved filters and selection.
- Loading, empty, filtered-out, missing-detail and error states.

Illustrative evidence path:
Researcher A → authored Work A → cites Reference R ← cited by Work B ← authored by Researcher B.
Distinguish the underlying citation assertions from the computed shared-reference relationship.

Use restrained colour, sans-serif type, strong spacing and clear labels. Avoid a decorative galaxy, orbit animation, excessive cards and a giant undifferentiated hairball. Start with a legible overview and render local detail on selection. Provide fit/reset and zoom controls, reduced-motion support, keyboard access through the list, and a mobile evidence sheet.

Filters must apply to supporting evidence, not just hide nodes. No visible edge or candidate may rely only on excluded evidence. If a panel contains whole-snapshot context, say so explicitly.

Serve local prepared files only during normal app use. Source links may navigate outward. No credential-bearing API calls from the browser and no live LLM dependency.

## Phase 5 — verification and handoff

Pipeline tests should cover:
- Duplicate IDs, author namesakes, missing identifiers and missing abstracts.
- Citation stubs and outside-corpus references.
- Large author lists and capped collection state.
- Retry/cache/resume behavior with recorded or stubbed HTTP responses.
- Provenance completeness and no dangling internal IDs.
- Correct shared-reference computations and no fabricated paths.
- Deterministic offline rebuild.
- Credentials absent from committed data, logs and browser assets.

Browser journeys:
1. Load real snapshot and inspect collection/coverage.
2. Search → person → work → original source link.
3. Connection → work pair → common-reference evidence.
4. Filter changes remove unsupported relationships.
5. Empty results, invalid deep link and missing abstract remain usable.
6. Mobile navigation and keyboard-accessible list.
7. No application runtime requests to OpenAlex or a backend.

Run typecheck, focused unit tests, production build and browser tests against that build. Render desktop and mobile screenshots and inspect them for unreadable labels, clipping and overlays. Target initial compressed data around 2 MB or less where practical; report measured payload and trade-offs, not an unmeasured performance claim.

CI should validate offline from the committed snapshot, without secrets, live provider calls, schedules or deployment. Choose currently supported actions/runtime versions at implementation time.

Independent review should be on the exact integration commit with a qualified read-only route. If unavailable, label self-review and keep the independent gate open. Any subsequent fix invalidates approval for changed code.

Final handoff:
- Branch, commit and draft PR.
- What works and how to run it.
- Exact source/query, record counts, snapshot date and coverage.
- Checks actually run and screenshot paths.
- Review status, route provenance and known limitations.
- All worker settlement states and precise next action if incomplete.

## Orca coordination

Attach orchestrate-work and route-orca-work to the coordinator. Load the actual runtime guide before dispatch:
- Resolve ORCA_CLI_COMMAND if set.
- Else use orca-dev when ORCA_DEV_REPO_ROOT identifies this development session.
- Else use orca-ide on Linux outside an Orca-managed terminal.
- Otherwise use orca.
Then run the resolved executable's skills get orchestration. Discover supported flags via --help; do not invent worker commands or use literal placeholders as commands.

After the shared schema is committed, two meaningful independent packets are possible:
- Data worker: pipeline/, configs/, tests/ and owned data outputs.
- UI worker: src/ and e2e/, consuming the frozen contract and clearly labelled test fixture.

Coordinator owns shared schemas, lockfiles, CI, integration and public/data publication. Serialize generated-output writes. Use separate worktrees and explicit paths. Real Orca workers only; do not call another subagent mechanism Orca.

Consider eligible local inference and configured Mistral routes first where reliable. Verify actual health, capability, data destination, credential isolation, deadline enforcement and settlement before dispatch. Record route decisions; unknown model or usage stays unknown. If routing is blocked, continue useful foreground work and label it direct execution.

At most one focused repair per packet within the original deadline. Do not start fallback while a previous worker may still be alive. At the deadline settle owned workers, checkpoint and report the exact remaining acceptance gates.

## Source references

- Product: README.md
- OpenAlex API and current limits: https://help.openalex.org/api/
- OpenAlex authentication: https://help.openalex.org/api/authentication/
- Prototype: https://github.com/blackmath88/uni-constelation
- Architecture: https://github.com/blackmath88/basel-spatial-graph
- Metapaths: https://city2graph.net/latest/examples/add_metapaths.html
- Weavr contract: https://github.com/blackmath88/weavr/blob/main/docs/CHATGPT-OPERATING-CONTRACT.md
