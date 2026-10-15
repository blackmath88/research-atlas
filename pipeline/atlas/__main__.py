"""CLI: python3 -m atlas {collect,build,index} (run with PYTHONPATH=pipeline)."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from .build import build_snapshot, write_snapshot
from .collect import collect

ROOT = Path(__file__).resolve().parents[2]


def main() -> None:
    ap = argparse.ArgumentParser(prog="atlas")
    sub = ap.add_subparsers(dest="cmd", required=True)
    c = sub.add_parser("collect", help="Fetch bounded OpenAlex records (cached, resumable).")
    c.add_argument("config")
    c.add_argument("--offline", action="store_true", help="Use cached responses only.")
    b = sub.add_parser("build", help="Offline rebuild from data/raw to a static snapshot.")
    b.add_argument("config")
    b.add_argument("--raw", help="Raw snapshot directory (default data/raw/<id>).")
    b.add_argument("--out", help="Output graph.json (default public/data/<id>/graph.json).")
    sub.add_parser("index", help="Write public/data/collections.json from configs and published snapshots.")
    args = ap.parse_args()

    if args.cmd == "index":
        entries = []
        for cfg_path in sorted((ROOT / "configs/collections").glob("*.json")):
            cfg = json.loads(cfg_path.read_text())
            graph = ROOT / "public/data" / cfg["id"] / "graph.json"
            entries.append({
                "id": cfg["id"], "label": cfg["label"],
                "availability": "published" if graph.exists() else "not_collected",
                "snapshotPath": f"./data/{cfg['id']}/graph.json" if graph.exists() else None,
                "synthetic": False,
                "note": "Real OpenAlex snapshot." if graph.exists() else
                "Not collected yet: OpenAlex collection is blocked (see docs/BUILD_LEDGER.md).",
            })
        out = ROOT / "public/data/collections.json"
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text(json.dumps({"schemaVersion": 1, "collections": entries}, indent=2) + "\n")
        print(out)
        return

    cfg = json.loads(Path(args.config).read_text())
    if args.cmd == "collect":
        m = collect(cfg, ROOT / "data/raw" / cfg["id"], ROOT / "data/cache" / cfg["id"], offline=args.offline)
        print(json.dumps({k: m[k] for k in ("status", "statusDetail", "providerTotal", "cacheHits")} | {"works": len(m["workHashes"])}, indent=2))
    else:
        raw = Path(args.raw) if args.raw else ROOT / "data/raw" / cfg["id"]
        out = Path(args.out) if args.out else ROOT / "public/data" / cfg["id"] / "graph.json"
        snap = build_snapshot(raw, cfg)
        write_snapshot(snap, out)
        print(json.dumps({"out": str(out), "snapshot": snap["meta"]["id"], **snap["meta"]["counts"]}, indent=2))


if __name__ == "__main__":
    main()
