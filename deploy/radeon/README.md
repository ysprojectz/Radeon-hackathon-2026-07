# Radeon Demo Stack

One-command bring-up for judge/demo reproducibility — Victory Bible Phase 2,
Jul 26 deliverable. Exit check: cold start to working UI in <=10 minutes.

## What this does — and doesn't — containerize

vLLM/ROCm itself is **not** in this compose file. The AMD OneClick base image
and GPU passthrough are tied to the Radeon Cloud host (see `SKILL.md` §6 in
the Hackathon Project folder) and aren't portable into a generic container.
Run vLLM directly on the host; this stack is the API + UI + datastores, and
reaches the host's vLLM server(s) via `host.docker.internal`.

## Bring-up

```bash
# 1. On the Radeon host (JupyterLab terminal on a fresh instance), bring up
#    Agent B (+ Agent C with --agent-c) in one shot:
bash deploy/radeon/bootstrap_instance.sh --agent-c
# Written 2026-07-24 from individually-proven steps but not yet run start-to-
# finish as one script — if it fails partway, fall back to the manual block
# it automates (SKILL.md §6) and report what broke.
#
# Add --tools to also enable vLLM's tool-calling parser (needed for the local
# tool-invocation feature below), e.g.:
#   bash deploy/radeon/bootstrap_instance.sh --agent-c --tools

# 2. Bring up the demo stack (from your Mac, separate terminal)
cp deploy/radeon/.env.example deploy/radeon/.env   # edit if Agent C is running
docker compose -f deploy/radeon/docker-compose.yml up --build -d

# 3. Apply DB migrations (the compose file does NOT do this automatically —
#    Postgres starts with no schema; found the hard way, see below)
for f in database/migrations/*.sql; do
  docker compose -f deploy/radeon/docker-compose.yml exec -T postgres \
    psql -U claims_os -d claims_os < "$f"
done
# Expect harmless "role claims_admin does not exist" errors on migrations
# 030/031/033 (Operaton/HAPI FHIR/Keycloak schemas) — not needed for this demo.

# 4. Seed reference data + the 15 testing_samples claims (same or new terminal)
docker compose -f deploy/radeon/docker-compose.yml exec api_gateway python scripts/seed_db.py
./deploy/radeon/seed.sh

# 5. Open http://localhost:3000
```

## What's verified vs. not

**Verified end-to-end, July 24** (Colima/Docker became available on the dev Mac):
- `docker compose build` — both images (`radeon-api_gateway`, `radeon-claims_ui`) build cleanly.
- `docker compose up -d` — all 4 containers (`postgres`, `redis`, `api_gateway`, `claims_ui`) reach `healthy` within seconds. `curl localhost:8080/api/v1/health` → `{"status":"healthy"}`. `localhost:3000` loads the real ACOS landing page in a browser.
- **Database migrations are NOT run automatically by this compose file** — the Postgres container starts with no schema. Run all files in `database/migrations/*.sql` against the `postgres` container before `seed_db.py` (e.g. `for f in database/migrations/*.sql; do docker compose -f deploy/radeon/docker-compose.yml exec -T postgres psql -U claims_os -d claims_os < "$f"; done`). Migrations 030/031/033 (Operaton/HAPI FHIR/Keycloak auxiliary schemas) error on a missing `claims_admin` role — expected and harmless, those schemas aren't needed for the core claims demo.
- `scripts/seed_db.py` — works once migrations are applied: 5 policies, 16 clauses, 13 members, 12 providers seeded.
- `seed.sh` — confirmed the documented ADJUSTER login path works for real against a live container. **14/15 claims submitted successfully on first run; found and fixed one real bug**: `pipeline.py`'s room-rent-per-day check (`li.get("days", 0) > 0`) crashed with `TypeError` when a line item's `days` field was explicitly `None` rather than absent — which only happens via the real Pydantic-validated HTTP API path, not direct `pipeline.adjudicate()` calls (why earlier scratchpad testing never caught it). Fixed (`(li.get("days") or 0) > 0`), rebuilt, re-tested: 15/15 now submit successfully (HTTP 201).
- Full regression suite (34 tests) still green after the fix.

**Still not run**: actual live LLM inference through this containerized stack (needs the Radeon instance's vLLM servers reachable via `host.docker.internal`, which needs the instance up — not available at time of this test). Claims processed above fell back to rules-only, which is correct/expected behavior without a local LLM configured, not a bug.

## Local LLM tool invocation (new, 2026-07-24 — opt-in, LIVE-GPU VERIFIED)

Agent B/C can call real tools mid-analysis (`check_waiting_period_status`,
`lookup_denial_code`, `search_additional_policy_clauses` —
`services/reasoning_engine/app/tools.py`) via vLLM's OpenAI-compatible
tool-calling. **Two independent switches both need to be on**, or nothing
changes from today's behavior:

1. **Server side**: launch vLLM with `--enable-auto-tool-choice
   --tool-call-parser hermes` (works for Qwen2.5-Instruct) — pass `--tools`
   to `bootstrap_instance.sh` to add this automatically.
2. **App side**: set `LOCAL_LLM_TOOLS_ENABLED=true` in the environment
   (`deploy/radeon/.env` or the API gateway's env) — defaults to `false`.

Code-complete and covered by 25 unit tests
(`tests/test_agent_c_local_secondary.py`'s sibling `tests/test_tool_calling.py`,
mocking the OpenAI response shape) — full regression suite is 60/60 green
with this wired in but inert by default. **Confirmed live, 2026-07-24, on
instance `u-9581-6bb2323d`**: launched with `--tools`, then ran the actual
`_call_local_with_tools()` method (not a mock) against it — both
`lookup_denial_code` and `check_waiting_period_status` genuinely
round-tripped (server-side vLLM request-log counts confirm it, not just
application logs), and the model correctly incorporated each tool's real
result into its final answer. See `SKILL.md` §6 for the full writeup.

## Ports

| Service | Host port | Notes |
|---|---|---|
| claims_ui | 3000 | Next.js frontend |
| api_gateway | 8080 | maps to container's 8000 |
| postgres | 5433 | maps to container's 5432 (avoids clashing with a local Postgres) |
| redis | 6380 | maps to container's 6379 |
| vLLM (Agent B) | 8000 | runs on the **host**, not in this compose file |
| vLLM (Agent C) | 8001 | runs on the **host**, not in this compose file |
