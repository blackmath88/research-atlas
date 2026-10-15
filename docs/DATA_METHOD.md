# Data method

## Collection (`pipeline/atlas/collect.py`, `client.py`)

Collection definition: `configs/collections/basel.json`.

1. Resolve the institution with `GET /institutions?search=University of Basel&filter=country_code:CH`. Exactly one exact-name match is required, otherwise collection stops as `partial`. The ROR in the config is an unverified hint: a mismatch produces a warning and the resolved record is saved to `data/raw/<id>/institution.json`.
2. Works query: `filter=authorships.institutions.lineage:<resolved id>,from_publication_date:2021-01-01,to_publication_date:2025-12-31`, `sort=publication_date:desc`, 100 per page, cap 2,000 works and 40 requests.
3. With `OPENALEX_API_KEY` set, the key goes in an `Authorization: Bearer` header (never in a URL) and collection uses cursor paging. Without a key, only page 1 is requested, because OpenAlex documents that keyless cursor paging past the first page is not permitted. The result is labelled `partial`.
4. Pages are cached under `data/cache/` (gitignored), keyed by the SHA-256 of the redacted URL. A rerun is a resume, and `--offline` replays the cache only.
5. Pacing: 0.25 s between requests. 5xx and transport errors get at most 3 retries with capped exponential backoff (30 s). A 429 with an exhausted budget or a long Retry-After stops immediately. Usage is never bought and the client never waits hours.
6. Stop states are recorded in `manifest.json` as `complete`, `cap_reached`, `auth_blocked`, `rate_limited`, `transport_failure` or `partial`. The manifest also holds the redacted request log, rate-limit headers, provider total and per-record SHA-256.
7. Raw records are sanitized to the fields used. Full text is never downloaded.

## Normalization (`build.py`)

- Short IDs are the last path segment of the OpenAlex ID (`W…`, `A…`, `I…`, `T…`).
- Researchers are keyed by their source author ID only. Names are labels, and namesakes stay separate.
- An authorship without an author ID keeps its raw name with `researcherId: null`, and nothing is inferred.
- Affiliations live on the authorship (publication context). They are never presented as current employment.
- `abstractStatus` is `present` or `missing`. `referencesStatus` is `present`, `empty` (supplied empty) or `missing` (field absent).
- `authorsTruncated` is set from the upstream flag or `authors_count`. `largeAuthorList` is set above a threshold (25 for Basel).
- A duplicate work ID keeps its first record and produces a warning.

## Graph

| Relation | Category | Evidence |
| --- | --- | --- |
| AUTHORED (researcher → work) | source assertion | the work record |
| HAS_TOPIC (work → topic) | source assertion | the work record; upstream score retained |
| CITES (work → in-corpus work) | source assertion | the citing work record |
| COAUTHORED | computed (`shared-works@1`) | supporting work IDs. Works with a large author list are not expanded into pairs. |
| SHARES_REFERENCES | computed (`jaccard-references@1`) | the two works, the shared reference IDs, the raw overlap and the Jaccard score. An inverted index is used, never all-pairs. References cited by more than 25 in-corpus works are ignored as generic. At least 2 shared references; top 5 per work. |
| CONVERSATION_CANDIDATE | hypothesis (`shared-reference-leads@1`) | supporting work pairs with the shared references. Pairs with a shared publication in the snapshot are excluded. At most 30, sorted deterministically. |

References outside the corpus are `external_unresolved` stubs. They keep the identifier and an OpenAlex link, and no metadata is invented for them. Topic-only leads are not generated in this version.

## Layout and determinism

The layout is navigation only. Topic fields are anchors on a circle, each work is placed around its primary field with hash-based jitter, and each researcher sits at the mean of their works' positions. There is no randomness and no wall-clock dependency. The snapshot ID is a SHA-256 over the pipeline version, schema, config, per-record hashes and status, and output JSON uses sorted keys. The same raw inputs give byte-identical output, and a test checks this.

## Attribution

OpenAlex metadata is CC0. Atlas credits OpenAlex in the coverage panel. Metadata availability grants no rights to full text.
