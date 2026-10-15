"""Pipeline tests. Run: PYTHONPATH=pipeline python3 -m unittest discover -s tests"""

import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "pipeline"))

from atlas.build import build_snapshot, write_snapshot  # noqa: E402
from atlas.client import CollectionStop, OpenAlexClient, Response, redact_url  # noqa: E402
from atlas.collect import collect  # noqa: E402

FIX_RAW = ROOT / "tests/fixtures/synthetic_raw"
FIX_CFG = json.loads((ROOT / "tests/fixtures/synthetic.json").read_text())
BASEL = json.loads((ROOT / "configs/collections/basel.json").read_text())


class SnapshotTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.s = build_snapshot(FIX_RAW, FIX_CFG)
        cls.works = {w["id"]: w for w in cls.s["works"]}

    def test_marked_synthetic(self):
        self.assertTrue(self.s["meta"]["synthetic"])
        self.assertEqual(self.s["meta"]["provider"], "SYNTHETIC FIXTURE")

    def test_duplicate_ids_collapsed_with_warning(self):
        self.assertEqual(len(self.works), 36)
        self.assertTrue(any("Duplicate work id" in w for w in self.s["meta"]["warnings"]))

    def test_namesakes_not_merged(self):
        names = [r for r in self.s["researchers"] if r["name"] == "Test Person A"]
        self.assertEqual(sorted(r["id"] for r in names), ["SYNA01", "SYNA19"])

    def test_missing_author_id_kept_explicit(self):
        auths = [a for a in self.works["SYNW008"]["authorships"] if a["rawName"] == "Unidentified Contributor"]
        self.assertEqual(auths[0]["researcherId"], None)
        self.assertEqual(self.s["meta"]["missingness"]["authorshipsWithoutResearcherId"], 1)

    def test_missing_abstract_and_reference_states(self):
        self.assertEqual(self.works["SYNW004"]["abstractStatus"], "missing")
        self.assertIsNone(self.works["SYNW004"]["abstract"])
        self.assertEqual(self.works["SYNW006"]["referencesStatus"], "empty")
        self.assertEqual(self.works["SYNW007"]["referencesStatus"], "missing")

    def test_reference_stubs(self):
        refs = {r["id"]: r for r in self.s["references"]}
        self.assertEqual(refs["SYNR01"]["status"], "external_unresolved")
        self.assertIsNone(refs["SYNR01"]["sourceUrl"])  # no fabricated link
        in_corpus = [r for r in refs.values() if r["status"] == "in_corpus"]
        self.assertTrue(in_corpus and all(r["id"] in self.works for r in in_corpus))

    def test_large_author_list_not_expanded(self):
        big = self.works["SYNW010"]
        self.assertTrue(big["largeAuthorList"] and big["authorsTruncated"])
        for e in self.s["edges"]:
            if e["type"] in ("COAUTHORED", "CONVERSATION_CANDIDATE"):
                self.assertNotIn("SYNW010", e["evidence"]["workIds"])
        self.assertEqual(self.s["meta"]["counts"]["coauthorCliquesSkipped"], 1)

    def test_no_dangling_ids(self):
        ids = set(self.works) | {r["id"] for r in self.s["researchers"]} | {t["id"] for t in self.s["topics"]}
        for e in self.s["edges"]:
            self.assertIn(e["source"], ids, e["id"])
            self.assertIn(e["target"], ids, e["id"])
            for w in e["evidence"]["workIds"]:
                self.assertIn(w, self.works)
        for nid in self.s["layout"]:
            self.assertIn(nid, ids)

    def test_provenance_complete(self):
        for w in self.s["works"]:
            p = w["provenance"]
            self.assertTrue(p["sourceId"] and p["retrievedAt"] and len(p["contentHash"]) == 64)

    def test_shared_reference_computation(self):
        for e in self.s["edges"]:
            if e["type"] != "SHARES_REFERENCES":
                continue
            a, b = self.works[e["source"]], self.works[e["target"]]
            shared = set(a["referenceIds"]) & set(b["referenceIds"])
            self.assertTrue(set(e["evidence"]["referenceIds"]) <= shared)
            self.assertEqual(e["evidence"]["overlap"], len(e["evidence"]["referenceIds"]))
            self.assertGreaterEqual(e["evidence"]["overlap"], 2)
            union = set(a["referenceIds"]) | set(b["referenceIds"])
            self.assertAlmostEqual(e["evidence"]["score"], round(len(e["evidence"]["referenceIds"]) / len(union), 4))

    def test_candidates_have_real_paths_and_no_coauthors(self):
        co = {(e["source"], e["target"]) for e in self.s["edges"] if e["type"] == "COAUTHORED"}
        for c in self.s["candidates"]:
            self.assertNotEqual(c["a"], c["b"])
            self.assertNotIn((c["a"], c["b"]), co)
            for p in c["supportingPairs"]:
                wa, wb = self.works[p["workA"]], self.works[p["workB"]]
                self.assertIn(c["a"], {x["researcherId"] for x in wa["authorships"]})
                self.assertIn(c["b"], {x["researcherId"] for x in wb["authorships"]})
                for r in p["sharedReferenceIds"]:
                    self.assertIn(r, wa["referenceIds"])
                    self.assertIn(r, wb["referenceIds"])

    def test_candidates_exclude_large_list_coauthors(self):
        big = {a["researcherId"] for a in self.works["SYNW010"]["authorships"] if a["researcherId"]}
        for c in self.s["candidates"]:
            self.assertFalse(c["a"] in big and c["b"] in big, c["id"])

    def test_top_k_coupling_per_work(self):
        from collections import Counter
        n = Counter(w for e in self.s["edges"] if e["type"] == "SHARES_REFERENCES" for w in (e["source"], e["target"]))
        self.assertLessEqual(max(n.values()), 5)

    def test_deterministic_offline_rebuild(self):
        with tempfile.TemporaryDirectory() as d:
            a, b = Path(d, "a.json"), Path(d, "b.json")
            write_snapshot(build_snapshot(FIX_RAW, FIX_CFG), a)
            write_snapshot(build_snapshot(FIX_RAW, FIX_CFG), b)
            self.assertEqual(a.read_bytes(), b.read_bytes())

    def test_committed_fixture_export_is_current(self):
        committed = ROOT / "public/fixtures/synthetic/graph.json"
        with tempfile.TemporaryDirectory() as d:
            out = Path(d, "g.json")
            write_snapshot(build_snapshot(FIX_RAW, FIX_CFG), out)
            self.assertEqual(out.read_bytes(), committed.read_bytes())


def page(results, count, next_cursor=None):
    return Response(200, {"x-ratelimit-remaining-usd": "0.5"},
                    json.dumps({"meta": {"count": count, "next_cursor": next_cursor}, "results": results}).encode())


INST = page([{"id": "https://openalex.org/I1", "display_name": "University of Basel", "ror": BASEL["institution"]["expectedRorHint"]}], 1)


def fake_work(i):
    return {"id": f"https://openalex.org/W{i}", "display_name": f"w{i}", "authorships": [], "referenced_works": []}


class ClientTests(unittest.TestCase):
    def cfg(self, **kw):
        return dict(BASEL, **kw)

    def test_secret_key_never_in_urls_logs_or_cache(self):
        seen = []

        def transport(url, headers, timeout):
            seen.append((url, headers))
            return INST if "/institutions" in url else page([fake_work(1)], 1)

        with tempfile.TemporaryDirectory() as d:
            client = OpenAlexClient(Path(d, "c"), api_key="SECRET123", transport=transport, sleep=lambda s: None)
            m = collect(self.cfg(), Path(d, "raw"), Path(d, "c"), client=client)
            self.assertEqual(m["status"], "complete")
            self.assertTrue(all("SECRET123" not in u for u, _ in seen))
            self.assertEqual(seen[0][1]["Authorization"], "Bearer SECRET123")
            for f in Path(d).rglob("*"):
                if f.is_file():
                    self.assertNotIn("SECRET123", f.read_text(), f)
        self.assertNotIn("abc", redact_url("https://x/y?api_key=abc&q=1"))

    def test_retry_then_cache_then_offline_resume(self):
        calls = {"n": 0}

        def transport(url, headers, timeout):
            calls["n"] += 1
            if calls["n"] == 1:
                return Response(503, {}, b"busy")
            return INST if "/institutions" in url else page([fake_work(1), fake_work(2)], 2)

        with tempfile.TemporaryDirectory() as d:
            c1 = OpenAlexClient(Path(d, "c"), api_key=None, transport=transport, sleep=lambda s: None)
            m1 = collect(self.cfg(), Path(d, "raw"), Path(d, "c"), client=c1)
            self.assertEqual((m1["status"], len(m1["workHashes"])), ("complete", 2))
            c2 = OpenAlexClient(Path(d, "c"), offline=True, transport=None, sleep=lambda s: None)
            m2 = collect(self.cfg(), Path(d, "raw2"), Path(d, "c"), client=c2)
            self.assertEqual(m2["workHashes"], m1["workHashes"])
            self.assertEqual(c2.cache_hits, 2)

    def test_exhausted_budget_stops_without_retry(self):
        calls = []

        def transport(url, headers, timeout):
            calls.append(url)
            return Response(429, {"retry-after": "13000", "x-ratelimit-remaining-usd": "0"}, b'{"error":"Rate limit exceeded"}')

        with tempfile.TemporaryDirectory() as d:
            client = OpenAlexClient(Path(d, "c"), api_key=None, transport=transport, sleep=lambda s: None)
            m = collect(self.cfg(), Path(d, "raw"), Path(d, "c"), client=client)
        self.assertEqual(m["status"], "rate_limited")
        self.assertEqual(len(calls), 1)

    def test_auth_blocked_and_cap_reached(self):
        with tempfile.TemporaryDirectory() as d:
            client = OpenAlexClient(Path(d, "c"), transport=lambda u, h, t: Response(403, {}, b"key_not_activated"), sleep=lambda s: None)
            self.assertEqual(collect(self.cfg(), Path(d, "r"), Path(d, "c"), client=client)["status"], "auth_blocked")

        def transport(url, headers, timeout):
            return INST if "/institutions" in url else page([fake_work(i) for i in range(5)], 500, "next")

        with tempfile.TemporaryDirectory() as d:
            client = OpenAlexClient(Path(d, "c"), api_key="k", transport=transport, sleep=lambda s: None)
            m = collect(self.cfg(maxWorks=3), Path(d, "r"), Path(d, "c"), client=client)
            self.assertEqual((m["status"], len(m["workHashes"])), ("cap_reached", 3))

    def test_keyless_first_page_only_is_partial(self):
        def transport(url, headers, timeout):
            self.assertNotIn("cursor", url)
            return INST if "/institutions" in url else page([fake_work(1)], 900)

        with tempfile.TemporaryDirectory() as d:
            client = OpenAlexClient(Path(d, "c"), api_key=None, transport=transport, sleep=lambda s: None)
            m = collect(self.cfg(), Path(d, "r"), Path(d, "c"), client=client)
        self.assertEqual(m["status"], "partial")

    def test_http_date_retry_after_and_bad_json_are_classified(self):
        with tempfile.TemporaryDirectory() as d:
            client = OpenAlexClient(Path(d, "c"), transport=lambda u, h, t: Response(429, {"retry-after": "Wed, 21 Oct 2026 07:28:00 GMT"}, b"x"), sleep=lambda s: None)
            self.assertEqual(collect(self.cfg(), Path(d, "r"), Path(d, "c"), client=client)["status"], "rate_limited")
            client = OpenAlexClient(Path(d, "c2"), transport=lambda u, h, t: Response(200, {}, b"<html>"), sleep=lambda s: None)
            self.assertEqual(collect(self.cfg(), Path(d, "r2"), Path(d, "c2"), client=client)["status"], "partial")

    def test_offline_without_cache_fails_safely(self):
        with tempfile.TemporaryDirectory() as d:
            client = OpenAlexClient(Path(d, "c"), offline=True, transport=None)
            with self.assertRaises(CollectionStop):
                client.get_json("/works", {"page": "1"})


class PublicationTests(unittest.TestCase):
    def test_no_credentials_or_synthetic_in_public_data(self):
        for f in (ROOT / "public/data").rglob("*.json"):
            text = f.read_text()
            self.assertNotIn("api_key=", text)
            self.assertNotIn("Bearer ", text)
            self.assertNotIn("example.invalid", text, f"synthetic records leaked into {f}")


if __name__ == "__main__":
    unittest.main()
