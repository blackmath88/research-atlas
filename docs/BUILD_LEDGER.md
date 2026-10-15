# Build ledger — first slice (2026-10-15)

## Base and governance

- Base: `main` @ `2021685` (README and BUILD_PLAN only). There were no other branches, no open PRs and no Observatory artifacts in the repo. No AGENTS.md exists in the repo or the workspace.
- Branch: `claude/adoring-volta-09kr1m`.
- Weavr contract (`blackmath88/weavr/docs/CHATGPT-OPERATING-CONTRACT.md`): HTTP 404 on raw, HTTP 403 for the repo. It's private or not reachable from this session, so Weavr governance state could not be inspected. No Mission was dispatched, and BUILD_PLAN.md scope and gates were applied.

## Routing (Orca)

- `ORCA_CLI_COMMAND` and `ORCA_DEV_REPO_ROOT` are unset. `orca`, `orca-dev` and `orca-ide` are not on PATH. The `orchestrate-work` and `route-orca-work` skills are not installed in this environment.
- Result: **Orca routing blocked. No Orca workers were launched.** No local or Mistral route is configured.
- Fallback, labelled honestly: one Claude Code subagent (not Orca) in an isolated git worktree did the UI packet (`src/`, `index.html`, `e2e/`), under a 15-minute soft deadline given in its prompt. That deadline is not enforced by a runtime. The coordinator did the contract, pipeline, lockfile, CI, fixture export, publication and integration directly. Concurrency was at most one worker. Settlement is recorded in the PR.

## OpenAlex access

- Docs verified 2026-10-15 (`help.openalex.org/api/authentication`). Keys are sent as a Bearer header. Keyless requests share a per-IP daily budget. Cursor paging past page 1 needs a key. A free key requires an email-verified account.
- Environment: no `OPENALEX_API_KEY`. Creating a key creates an account for the user, which this task does not authorize.
- Attempt: `python3 -m atlas collect configs/collections/basel.json` made 1 request, got HTTP 429 `Insufficient budget … shared by everyone on your network's IP address … resets at midnight UTC`, and stopped with status `rate_limited`. Evidence: `docs/evidence/openalex-attempt-2026-10-15.json`.
- **Real-data acceptance is BLOCKED.** No real records are published. `public/data/collections.json` lists Basel as `not_collected`. The app only shows data through the clearly labelled synthetic fixture at `public/fixtures/`, which tests use.

## Remaining gates (exact)

1. **Real snapshot.** The user provides `OPENALEX_API_KEY` (free key, email-verified), or the shared keyless budget resets (00:00 UTC; keyless gives page 1 only, about 100 works, labelled `partial`). Then run:
   ```
   PYTHONPATH=pipeline python3 -m atlas collect configs/collections/basel.json
   PYTHONPATH=pipeline python3 -m atlas build configs/collections/basel.json
   PYTHONPATH=pipeline python3 -m atlas index
   ```
   Commit `data/raw/basel-2021-2025/` and `public/data/`. Review the institution resolution and warnings. Remove the `example.invalid` guard only if fixtures are moved.
2. **Qualitative review** of up to 10 real conversation candidates. This is impossible without real data.
3. **Independent review** on the integration commit (see the PR).
4. CI has not run on GitHub yet. It is defined in `.github/workflows/ci.yml`.
