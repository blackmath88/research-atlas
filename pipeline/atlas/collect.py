"""Collect a bounded OpenAlex corpus into data/raw/<collection>/.

Resumable: every page is cached by redacted URL, so a rerun replays cached
pages and continues from the first uncached one. Offline mode never touches
the network.
"""

from __future__ import annotations

import datetime as dt
import hashlib
import json
from pathlib import Path

from .client import CollectionStop, OpenAlexClient

KEEP_FIELDS = (
    "id", "doi", "display_name", "title", "publication_year", "publication_date", "type",
    "authorships", "topics", "referenced_works", "abstract_inverted_index",
    "is_authors_truncated", "authors_count",
)


def sanitize_work(raw: dict) -> dict:
    out = {k: raw[k] for k in KEEP_FIELDS if k in raw}
    auths = []
    for a in out.get("authorships") or []:
        auths.append({
            "author_position": a.get("author_position"),
            "raw_author_name": a.get("raw_author_name"),
            "author": {k: (a.get("author") or {}).get(k) for k in ("id", "display_name", "orcid")},
            "institutions": [
                {k: i.get(k) for k in ("id", "display_name", "ror", "country_code")}
                for i in a.get("institutions") or []
            ],
        })
    if "authorships" in out:
        out["authorships"] = auths
    if "topics" in out:
        out["topics"] = [
            {
                "id": t.get("id"), "display_name": t.get("display_name"), "score": t.get("score"),
                **{lvl: {"id": (t.get(lvl) or {}).get("id"), "display_name": (t.get(lvl) or {}).get("display_name")}
                   for lvl in ("subfield", "field", "domain")},
            }
            for t in out["topics"] or []
        ]
    return out


def record_hash(record: dict) -> str:
    return hashlib.sha256(json.dumps(record, sort_keys=True, ensure_ascii=False).encode()).hexdigest()


def resolve_institution(client: OpenAlexClient, cfg: dict) -> tuple[dict, list[str]]:
    inst = cfg["institution"]
    warnings: list[str] = []
    body = client.get_json("/institutions", {
        "search": inst["searchName"], "filter": f"country_code:{inst['countryCode']}", "per-page": "10",
    })
    exact = [r for r in body.get("results", []) if (r.get("display_name") or "").lower() == inst["searchName"].lower()]
    if len(exact) != 1:
        raise CollectionStop("partial", f"institution resolution ambiguous or empty ({len(exact)} exact matches)")
    chosen = exact[0]
    hint = inst.get("expectedRorHint")
    if hint and chosen.get("ror") != hint:
        warnings.append(f"Resolved ROR {chosen.get('ror')} differs from unverified hint {hint}.")
    return chosen, warnings


def collect(cfg: dict, raw_dir: Path, cache_dir: Path, offline: bool = False, client: OpenAlexClient | None = None) -> dict:
    client = client or OpenAlexClient(
        cache_dir=cache_dir, offline=offline, max_requests=cfg["maxRequests"],
        interval_s=cfg["requestIntervalSeconds"], max_retries=cfg["maxRetries"],
        max_backoff_s=cfg["maxBackoffSeconds"],
    )
    raw_dir.mkdir(parents=True, exist_ok=True)
    started = dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat()
    works: dict[str, dict] = {}
    status, detail, provider_total, warnings = "complete", "", None, []
    institution = None
    try:
        institution, warnings = resolve_institution(client, cfg)
        (raw_dir / "institution.json").write_text(json.dumps(institution, indent=2, sort_keys=True))
        flt = (f"authorships.institutions.lineage:{institution['id'].rsplit('/', 1)[-1]},"
               f"from_publication_date:{cfg['filters']['fromPublicationDate']},"
               f"to_publication_date:{cfg['filters']['toPublicationDate']}")
        params = {"filter": flt, "sort": cfg["sort"], "per-page": str(cfg["perPage"])}
        cursor = "*" if client.api_key else None
        while True:
            page_params = dict(params, **({"cursor": cursor} if cursor else {"page": "1"}))
            body = client.get_json("/works", page_params)
            provider_total = (body.get("meta") or {}).get("count", provider_total)
            for r in body.get("results", []):
                if len(works) >= cfg["maxWorks"]:
                    break
                works.setdefault(r["id"], sanitize_work(r))  # duplicate IDs keep first
            if len(works) >= cfg["maxWorks"]:
                status = "cap_reached" if (provider_total or 0) > len(works) else "complete"
                break
            nxt = (body.get("meta") or {}).get("next_cursor")
            if not cursor:
                if (provider_total or 0) > len(works):
                    status, detail = "partial", "no API key: keyless cursor paging past page 1 is not permitted"
                break
            if not nxt or not body.get("results"):
                break
            cursor = nxt
    except CollectionStop as stop:
        status, detail = stop.status, stop.detail

    manifest = {
        "collectionId": cfg["id"],
        "provider": "OpenAlex",
        "attribution": "Metadata from OpenAlex (https://openalex.org), CC0.",
        "synthetic": False,
        "query": {"config": cfg, "institutionId": institution and institution.get("id")},
        "retrievedAt": started,
        "status": status,
        "statusDetail": detail,
        "providerTotal": provider_total,
        "requests": client.log,
        "cacheHits": client.cache_hits,
        "budgetHeaders": client.last_budget,
        "warnings": warnings,
        "workHashes": {},
    }
    ordered = sorted(works.values(), key=lambda w: w["id"])
    with (raw_dir / "works.jsonl").open("w") as fh:
        for w in ordered:
            manifest["workHashes"][w["id"]] = record_hash(w)
            fh.write(json.dumps(w, sort_keys=True, ensure_ascii=False) + "\n")
    (raw_dir / "manifest.json").write_text(json.dumps(manifest, indent=2, sort_keys=True))
    return manifest
