# Research Atlas

**Explore research. Discover connections. Find people.**

Research Atlas is an independent map of open scholarly data. Explore people, publications, topics and institutions; inspect established relationships; discover possible conversations with evidence you can follow.

**Status: product and architecture brief. No application or imported dataset is implemented in this repository yet.**

## Product decisions

- Product name: **Research Atlas**; short interface name: **Atlas**.
- **Constellation** names the network view.
- OpenAlex is the primary data source.
- No dependency on UNIverse, university credentials or the competition submission.
- The old UNIverse/edoc dataset is not the starting dataset.
- Basel may be the initial institutional lens; the data model supports other institutions and topic-based collections.
- English interface and documentation.
- First release: static frontend and a separate reproducible import/build pipeline. No always-on application backend.
- MCP is optional future access to the graph, not a replacement for data preparation or a requirement for the website.

## User journey

Choose a prepared institution or topic collection → explore its research landscape → select a person or publication → inspect connections → discover possible conversations and their evidence.

The first version explores published snapshots. Choosing an arbitrary institution does not silently imply a live import. Clearly identify which collections are available.

Three useful views:
1. Research landscape: topics, publications and people.
2. Research neighbourhood: authorship, coauthorship, references and related work.
3. Possible conversations: explainable leads across research communities.

Keep a searchable list alternative to the graph. Use progressive detail, accessible controls and shareable filter/selection URLs. Prefer a restrained interface with sans-serif typography. Spatial layout is navigation, not calibrated scientific distance.

## Architecture

### Preparation

A local Python pipeline, later optionally run by GitHub Actions:
1. Resolve collection identifiers and save the explicit query and collection scope.
2. Fetch bounded OpenAlex records with caching, retries, rate and budget limits.
3. Preserve source records and their retrieval metadata.
4. Normalize identities and relations without silently collapsing ambiguous people.
5. Build sparse graph projections, analysis results and a deterministic layout.
6. Export versioned static files and a coverage manifest.

Use a private environment variable for any API key. Never include credentials in source URLs, logs, committed raw responses or browser assets. No account creation, paid usage or scheduled imports are implied by this brief.

### Serving

A React/TypeScript frontend with D3 can build on the useful interaction patterns of the existing prototype. Static hosting serves the application and prepared data files. The browser searches, filters and explores those files.

Load the overview first and publication details on demand. Start with JSON exports; SQLite may be useful inside preparation, but a hosted database is not required.

A running backend becomes a separate design decision if arbitrary live imports, shared user state or server-side processing are introduced.

### Shared graph core

Follow the architectural separation in Basel Spatial Graph: source adapters, normalized graph, deterministic analysis, query operations, then presentation. The map is a client of that core.

Use City2Graph's heterogeneous-graph and metapath principles without requiring geographic coordinates or its geospatial stack.

Initial node types:
- Work
- Researcher
- Institution
- Topic

Initial relations:
- Researcher AUTHORED Work
- Work CITES Work
- Work HAS_TOPIC Topic (retain upstream classification provenance)
- Authorship HAS_AFFILIATION Institution (publication context, not present employment)
- Work SIMILAR_TO Work (derived, method-specific)

Derived coauthorship and shared-reference relations must retain their supporting work IDs. Project, dataset and software nodes can be added when a concrete source and use case justify them.

## Evidence contract

Distinguish three categories throughout the pipeline and interface:

| Category | Example | Required explanation |
| --- | --- | --- |
| Source assertion | An author is listed on a work | Source record, identifiers, retrieval date |
| Derived relationship | Two works share references | Inputs, method/version and parameters |
| Conversation hypothesis | Two researchers may benefit from talking | Supporting works, reasons and limitations |

For each imported record preserve source/provider, source ID and URL, retrieval timestamp and snapshot membership. Preserve field-level provenance when combining providers. Record licensing/attribution at the appropriate source or field level; metadata availability does not grant rights to full text.

For each derived result preserve input evidence IDs, algorithm/model version, parameters and snapshot ID. Upstream topic assignments and identity matches are source assertions, not independently verified truth.

Rules:
- No connection found means no connection found in this snapshot.
- Source-listed authors are not automatically employees of the selected institution.
- Historical affiliations must not be presented as current employment.
- Never merge researchers solely because names match.
- Similarity scores are not probabilities of successful collaboration.
- Missing abstracts, incomplete authorship and unresolved identities remain explicit.
- Do not infer methods, findings, complementary expertise or willingness to collaborate without supporting evidence.
- Distinguish references outside the imported collection from missing records and failed requests.
- Preserve large author lists without blindly creating combinatorial coauthor cliques.
- A classifier may assign multiple topics and must retain uncertainty and method provenance.
- Do not use prestige or citation counts as a default ranking of people.

## First implementation slice

Build one complete, bounded path:
1. An explicit, configurable OpenAlex collection, initially Basel-related works.
2. Real cached source responses with provenance and a declared record cap/time range.
3. Normalized works, authors, topics and publication-context affiliations.
4. Citations within the collection and a bounded optional reference neighbourhood.
5. A static searchable map and list view.
6. Person/work panels and an inspectable “Why this connection?” path.
7. A coverage panel showing snapshot date, scope, missingness and collection completeness.
8. A reproducible offline rebuild and useful tests.

Conversation suggestions should first use transparent shared-topic/shared-reference signals. Evaluate a manually reviewed sample before making stronger claims or adding complex ranking. Embeddings and graph neural networks require a concrete evaluation question; they are not prerequisites.

Acceptance:
- The app runs from static build output without backend credentials.
- A reviewer can follow a displayed relationship to its original source.
- Observed, derived and suggested relationships are visually distinguishable.
- Offline rebuilds from the same inputs reproduce graph outputs.
- Dangling references, ambiguous identities and incomplete collection are handled explicitly.
- Search → person → publication → source and connection → evidence work on desktop and mobile.
- No legacy UNIverse payload or faculty-specific assumption is required.
- No fake data is presented as real; synthetic fixtures are clearly labelled and isolated.

## Implementation references

- Existing interaction prototype: https://github.com/blackmath88/uni-constelation
- Graph-core architecture: https://github.com/blackmath88/basel-spatial-graph
- Heterogeneous graphs and metapaths: https://city2graph.net/latest/
- OpenAlex API: https://help.openalex.org/api/
- OpenAlex authentication/budgets: https://help.openalex.org/api/authentication/
- OpenAlex MCP connector: https://help.openalex.org/access/connector/
- Crossref metadata: https://www.crossref.org/documentation/retrieve-metadata/rest-api/
- ORCID public records: https://info.orcid.org/documentation/api-tutorials/api-tutorial-read-data-on-a-record/

Provider limits and terms must be checked at implementation time. Optional enrichment sources are not required for the first slice.

## Delivery boundaries

This is a fresh repository, separate from the competition prototype. Inspect current repository state before implementation. Follow the canonical Weavr operating contract when using governed work:
https://github.com/blackmath88/weavr/blob/main/docs/CHATGPT-OPERATING-CONTRACT.md

This brief does not dispatch a mission, enable a schedule, authorize paid services, or publish a deployment.
