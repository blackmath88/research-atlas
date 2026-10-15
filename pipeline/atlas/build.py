"""Offline build: raw snapshot -> normalized records -> typed graph -> static export.

Deterministic: identical raw inputs and config produce byte-identical output.
"""

from __future__ import annotations

import hashlib
import json
import math
from collections import defaultdict
from itertools import combinations
from pathlib import Path

from . import PIPELINE_VERSION, SCHEMA_VERSION

COUPLING_METHOD = "jaccard-references@1"
COAUTHOR_METHOD = "shared-works@1"
CANDIDATE_METHOD = "shared-reference-leads@1"
MAX_REF_DOC_FREQ = 25   # references cited by more in-corpus works are too generic to couple on
MIN_SHARED_REFS = 2     # coupling edge threshold
TOP_K_COUPLING = 5      # sparse: keep top-k coupled works per work
MAX_CANDIDATES = 30


def short_id(full: str | None) -> str | None:
    if not full:
        return None
    return full.rstrip("/").rsplit("/", 1)[-1]


def abstract_text(inv: dict | None) -> str | None:
    if not inv:
        return None
    pos = sorted((p, w) for w, ps in inv.items() for p in ps)
    return " ".join(w for _, w in pos) or None


def load_raw(raw_dir: Path) -> tuple[dict, list[dict]]:
    manifest = json.loads((raw_dir / "manifest.json").read_text())
    works = [json.loads(line) for line in (raw_dir / "works.jsonl").read_text().splitlines() if line.strip()]
    return manifest, works


def source_url(full: str | None, synthetic: bool) -> str | None:
    if not full:
        return None
    return full if (synthetic or full.startswith("https://openalex.org/")) else None


def normalize(manifest: dict, raw_works: list[dict], large_threshold: int) -> dict:
    synthetic = bool(manifest.get("synthetic"))
    provider = manifest["provider"]
    retrieved = manifest.get("retrievedAt")
    hashes = manifest.get("workHashes", {})
    works, researchers, institutions, topics = {}, {}, {}, {}
    warnings: list[str] = []
    seen = set()
    for r in sorted(raw_works, key=lambda w: w["id"]):
        wid = short_id(r["id"])
        if wid in seen:
            warnings.append(f"Duplicate work id {wid} ignored after first occurrence.")
            continue
        seen.add(wid)
        auths = []
        for a in r.get("authorships") or []:
            au = a.get("author") or {}
            rid = short_id(au.get("id"))
            inst_ids = []
            for inst in a.get("institutions") or []:
                iid = short_id(inst.get("id"))
                if not iid:
                    continue
                inst_ids.append(iid)
                institutions.setdefault(iid, {
                    "id": iid, "name": inst.get("display_name") or iid, "ror": inst.get("ror"),
                    "countryCode": inst.get("country_code"), "sourceUrl": source_url(inst.get("id"), synthetic),
                })
            if rid:
                person = researchers.setdefault(rid, {
                    "id": rid, "name": au.get("display_name") or a.get("raw_author_name") or rid,
                    "orcid": au.get("orcid"), "workIds": [], "sourceUrl": source_url(au.get("id"), synthetic),
                })
                if wid not in person["workIds"]:
                    person["workIds"].append(wid)
            auths.append({
                "researcherId": rid, "rawName": a.get("raw_author_name") or au.get("display_name") or "Unknown",
                "position": a.get("author_position") or "unknown", "institutionIds": sorted(set(inst_ids)),
            })
        tlist = []
        for rank, t in enumerate(r.get("topics") or []):
            tid = short_id(t.get("id"))
            if not tid:
                continue
            topics.setdefault(tid, {
                "id": tid, "name": t.get("display_name") or tid,
                "subfield": (t.get("subfield") or {}).get("display_name"),
                "field": (t.get("field") or {}).get("display_name"),
                "domain": (t.get("domain") or {}).get("display_name"),
                "sourceUrl": source_url(t.get("id"), synthetic),
            })
            tlist.append({"topicId": tid, "score": t.get("score"), "rank": rank})
        refs_raw = r.get("referenced_works")
        refs = sorted({short_id(x) for x in refs_raw or [] if short_id(x)})
        abstract = abstract_text(r.get("abstract_inverted_index"))
        works[wid] = {
            "id": wid, "doi": r.get("doi"), "title": r.get("display_name") or r.get("title") or "(untitled)",
            "year": r.get("publication_year"), "date": r.get("publication_date"), "type": r.get("type"),
            "abstract": abstract, "abstractStatus": "present" if abstract else "missing",
            "topics": tlist, "authorships": auths,
            "authorsTruncated": bool(r.get("is_authors_truncated"))
            or (r.get("authors_count") or 0) > len(auths),
            "largeAuthorList": len(auths) > large_threshold,
            "referenceIds": refs,
            "referencesStatus": "missing" if refs_raw is None else ("present" if refs else "empty"),
            "provenance": {
                "provider": provider, "sourceId": r["id"], "sourceUrl": source_url(r["id"], synthetic),
                "retrievedAt": retrieved, "contentHash": hashes.get(r["id"], ""),
            },
        }
    for p in researchers.values():
        p["workIds"].sort()
    return {"works": works, "researchers": researchers, "institutions": institutions,
            "topics": topics, "warnings": warnings}


def edge(etype, category, a, b, work_ids, ref_ids=(), method=None, params=None, overlap=None, score=None):
    return {
        "id": f"{etype}:{a}:{b}", "type": etype, "category": category, "source": a, "target": b,
        "evidence": {"workIds": sorted(work_ids), "referenceIds": sorted(ref_ids), "method": method,
                     "params": params, "overlap": overlap, "score": score},
    }


def build_graph(norm: dict, large_threshold: int) -> tuple[list, list, list, dict]:
    works, edges = norm["works"], []
    stats = defaultdict(int)
    # Source assertions
    for w in works.values():
        for rid in sorted({a["researcherId"] for a in w["authorships"] if a["researcherId"]}):
            edges.append(edge("AUTHORED", "source", rid, w["id"], [w["id"]]))
        for t in w["topics"]:
            edges.append(edge("HAS_TOPIC", "source", w["id"], t["topicId"], [w["id"]]))
        for ref in w["referenceIds"]:
            if ref in works:
                edges.append(edge("CITES", "source", w["id"], ref, [w["id"]]))
    # References: in-corpus vs external unresolved stubs
    cited_by = defaultdict(list)
    for w in works.values():
        for ref in w["referenceIds"]:
            cited_by[ref].append(w["id"])
    references = [{
        "id": ref, "status": "in_corpus" if ref in works else "external_unresolved",
        "sourceUrl": f"https://openalex.org/{ref}" if ref.startswith("W") else None,
        "citedBy": sorted(ws),
    } for ref, ws in sorted(cited_by.items())]
    # Derived: coauthorship (skip clique expansion for large author lists)
    co = defaultdict(set)
    any_shared = set()  # every pair with a shared work, including large author lists
    for w in works.values():
        ids = sorted({a["researcherId"] for a in w["authorships"] if a["researcherId"]})
        any_shared.update(combinations(ids, 2))
        if w["largeAuthorList"]:
            stats["coauthorCliquesSkipped"] += 1
            continue
        for a, b in combinations(ids, 2):
            co[(a, b)].add(w["id"])
    for (a, b), ws in sorted(co.items()):
        edges.append(edge("COAUTHORED", "derived", a, b, ws, method=COAUTHOR_METHOD,
                          params={"largeAuthorListThreshold": large_threshold}, overlap=len(ws)))
    # Derived: bibliographic coupling via inverted index, generic refs filtered
    pair_shared = defaultdict(set)
    for ref, ws in cited_by.items():
        if len(ws) > MAX_REF_DOC_FREQ:
            stats["genericReferencesIgnored"] += 1
            continue
        for a, b in combinations(sorted(set(ws)), 2):
            pair_shared[(a, b)].add(ref)
    scored = []
    for (a, b), shared in pair_shared.items():
        if len(shared) < MIN_SHARED_REFS:
            continue
        union = len(set(works[a]["referenceIds"]) | set(works[b]["referenceIds"]))
        scored.append((round(len(shared) / union, 4), a, b, shared))
    scored.sort(key=lambda s: (-s[0], -len(s[3]), s[1], s[2]))
    per_work = defaultdict(int)
    coupling = []
    for jac, a, b, shared in scored:
        if per_work[a] >= TOP_K_COUPLING or per_work[b] >= TOP_K_COUPLING:
            continue
        per_work[a] += 1
        per_work[b] += 1
        coupling.append((jac, a, b, shared))
        edges.append(edge("SHARES_REFERENCES", "derived", a, b, [a, b], shared, method=COUPLING_METHOD,
                          params={"minShared": MIN_SHARED_REFS, "maxRefDocFreq": MAX_REF_DOC_FREQ, "topK": TOP_K_COUPLING},
                          overlap=len(shared), score=jac))
    candidates = build_candidates(works, coupling, any_shared)
    for c in candidates:
        edges.append(edge("CONVERSATION_CANDIDATE", "hypothesis", c["a"], c["b"],
                          {x for p in c["supportingPairs"] for x in (p["workA"], p["workB"])},
                          {r for p in c["supportingPairs"] for r in p["sharedReferenceIds"]},
                          method=CANDIDATE_METHOD, params={"minShared": MIN_SHARED_REFS},
                          overlap=c["sharedReferenceCount"], score=c["score"]))
    edges.sort(key=lambda e: e["id"])
    return edges, references, candidates, dict(stats)


def build_candidates(works: dict, coupling: list, any_shared: set) -> list:
    coauthored = any_shared
    leads = defaultdict(list)
    for jac, wa, wb, shared in coupling:
        A = {a["researcherId"] for a in works[wa]["authorships"] if a["researcherId"]}
        B = {a["researcherId"] for a in works[wb]["authorships"] if a["researcherId"]}
        if works[wa]["largeAuthorList"] or works[wb]["largeAuthorList"]:
            continue
        for ra in A - B:
            for rb in B - A:
                x, y = sorted((ra, rb))
                if (x, y) in coauthored:
                    continue  # shared publication observed in snapshot
                pa, pb = (wa, wb) if x == ra else (wb, wa)
                shared_topics = sorted({t["topicId"] for t in works[pa]["topics"]} & {t["topicId"] for t in works[pb]["topics"]})
                leads[(x, y)].append({"workA": pa, "workB": pb, "sharedReferenceIds": sorted(shared),
                                      "sharedTopicIds": shared_topics, "jaccard": jac})
    out = []
    for (x, y), pairs in leads.items():
        refs = {r for p in pairs for r in p["sharedReferenceIds"]}
        pairs.sort(key=lambda p: (-p["jaccard"], p["workA"], p["workB"]))
        out.append({
            "id": f"CAND:{x}:{y}", "a": x, "b": y, "strength": "shared_references",
            "sharedReferenceCount": len(refs), "score": round(sum(p["jaccard"] for p in pairs), 4),
            "supportingPairs": pairs[:5],
            "limitations": [
                "Based only on overlapping reference lists in this snapshot.",
                "No shared publication was found in this snapshot; earlier or external collaboration may exist.",
                "Does not imply complementary methods, findings or willingness to talk.",
                "Score is a ranking aid, not a probability of successful collaboration.",
            ],
        })
    out.sort(key=lambda c: (-c["sharedReferenceCount"], -c["score"], c["id"]))
    return out[:MAX_CANDIDATES]


def _h(s: str) -> float:
    return int(hashlib.sha256(s.encode()).hexdigest()[:8], 16) / 0xFFFFFFFF


def build_layout(norm: dict) -> dict:
    """Deterministic navigation layout: topic fields as anchors on a circle, works jittered
    around their primary field anchor, researchers at the mean of their works."""
    works, topics = norm["works"], norm["topics"]
    fields = sorted({(topics[t["topicId"]]["field"] or "Unclassified") for w in works.values() for t in w["topics"][:1]} | {"Unclassified"})
    anchors = {f: (0.62 * math.cos(2 * math.pi * i / len(fields)), 0.62 * math.sin(2 * math.pi * i / len(fields)))
               for i, f in enumerate(fields)}
    layout = {}
    for wid, w in sorted(works.items()):
        f = (topics[w["topics"][0]["topicId"]]["field"] or "Unclassified") if w["topics"] else "Unclassified"
        ax, ay = anchors[f]
        ang, rad = 2 * math.pi * _h(wid), 0.3 * math.sqrt(_h(wid + "r"))
        layout[wid] = [round(ax + rad * math.cos(ang), 4), round(ay + rad * math.sin(ang), 4)]
    for rid, p in sorted(norm["researchers"].items()):
        xs = [layout[w] for w in p["workIds"] if w in layout]
        mx = sum(x for x, _ in xs) / len(xs)
        my = sum(y for _, y in xs) / len(xs)
        j = 0.04 * (_h(rid) - 0.5)
        layout[rid] = [round(mx + j, 4), round(my - j, 4)]
    return layout


def build_snapshot(raw_dir: Path, cfg: dict) -> dict:
    manifest, raw_works = load_raw(raw_dir)
    large = cfg["largeAuthorListThreshold"]
    norm = normalize(manifest, raw_works, large)
    edges, references, candidates, stats = build_graph(norm, large)
    works = [norm["works"][k] for k in sorted(norm["works"])]
    researchers = [norm["researchers"][k] for k in sorted(norm["researchers"])]
    missing = {
        "worksWithoutAbstract": sum(w["abstractStatus"] == "missing" for w in works),
        "worksWithoutTopics": sum(not w["topics"] for w in works),
        "worksWithoutReferences": sum(w["referencesStatus"] == "missing" for w in works),
        "worksWithEmptyReferences": sum(w["referencesStatus"] == "empty" for w in works),
        "authorshipsWithoutResearcherId": sum(a["researcherId"] is None for w in works for a in w["authorships"]),
        "worksWithTruncatedAuthors": sum(w["authorsTruncated"] for w in works),
        "worksWithLargeAuthorLists": sum(w["largeAuthorList"] for w in works),
        "externalUnresolvedReferences": sum(r["status"] == "external_unresolved" for r in references),
    }
    counts = {"works": len(works), "researchers": len(researchers), "institutions": len(norm["institutions"]),
              "topics": len(norm["topics"]), "references": len(references), "edges": len(edges),
              "candidates": len(candidates), **{f"edges.{t}": sum(e["type"] == t for e in edges)
              for t in sorted({e["type"] for e in edges})}, **stats}
    identity = {"pipeline": PIPELINE_VERSION, "schema": SCHEMA_VERSION, "config": cfg,
                "workHashes": manifest.get("workHashes", {}), "status": manifest["status"]}
    snap_id = "snap-" + hashlib.sha256(json.dumps(identity, sort_keys=True).encode()).hexdigest()[:16]
    meta = {
        "id": snap_id, "schemaVersion": SCHEMA_VERSION, "collectionId": cfg["id"], "label": cfg["label"],
        "synthetic": bool(manifest.get("synthetic")), "provider": manifest["provider"],
        "attribution": manifest.get("attribution", ""), "query": manifest.get("query", {}),
        "retrievedAt": manifest.get("retrievedAt"), "status": manifest["status"],
        "providerTotal": manifest.get("providerTotal"), "maxWorks": cfg["maxWorks"],
        "counts": counts, "missingness": missing,
        "methods": [
            {"id": COAUTHOR_METHOD, "label": "Coauthorship", "description": "Two researcher IDs listed on the same work. Works above the large-author threshold are not expanded into pairs.", "params": {"largeAuthorListThreshold": large}},
            {"id": COUPLING_METHOD, "label": "Shared references (bibliographic coupling)", "description": "Jaccard overlap of reference-ID sets, computed with an inverted index. References cited by more than maxRefDocFreq in-corpus works are ignored as generic. Top-k per work.", "params": {"minShared": MIN_SHARED_REFS, "maxRefDocFreq": MAX_REF_DOC_FREQ, "topK": TOP_K_COUPLING}},
            {"id": CANDIDATE_METHOD, "label": "Possible conversations", "description": "Researcher pairs on different coupled works with no shared publication in this snapshot. Hypotheses only.", "params": {"minShared": MIN_SHARED_REFS, "maxCandidates": MAX_CANDIDATES}},
        ],
        "warnings": manifest.get("warnings", []) + norm["warnings"]
        + ([f"Collection status: {manifest['status']}. {manifest.get('statusDetail', '')}".strip()] if manifest["status"] != "complete" else []),
    }
    return {"meta": meta, "works": works, "researchers": researchers,
            "institutions": [norm["institutions"][k] for k in sorted(norm["institutions"])],
            "topics": [norm["topics"][k] for k in sorted(norm["topics"])],
            "references": references, "edges": edges, "candidates": candidates, "layout": build_layout(norm)}


def write_snapshot(snapshot: dict, out: Path) -> None:
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(snapshot, sort_keys=True, ensure_ascii=False, separators=(",", ":")))
