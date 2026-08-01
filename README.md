# ACOS (Autonomous Claims Operating System) — Health Claims Arbiter
### Sovereign AI adjudication for India's NHCX ecosystem
**AMD AI DevMaster Hackathon (Track 2)**

Track 2: Development & Local Deployment of Private AI Agents
Participant: Yuvaraj S (solo) · Chennai, India
Deadline: August 6, 2026, 9:29 PM IST

---

## What this is

ACOS is a health-insurance claims adjudication platform — personally designed,
built, and deployed to AWS/EKS by Yuvaraj S as a self-directed engineering
exercise to learn real cloud infrastructure. **It is a personal project, not a
commercial product**: it has never been marketed or delivered to a real client,
and every piece of data anywhere in this repository and its demo is synthetic.

For this hackathon, its AI intelligence layer — two independent LLM agents
that cross-validate every insurance claim line-item — has been adapted to run
entirely on a single AMD Radeon GPU via vLLM, instead of calling cloud LLM APIs.

**Why it matters:** India's NHCX is digitizing claims nationally under IRDAI's
March 2026 mandate requiring 3-hour cashless authorization. A cloud LLM bolted
onto NHCX re-exports patient data — defeating NHCX's own encrypted design.
ACOS proves that AI-assisted adjudication and data sovereignty can coexist on
one affordable GPU card, inside the hospital.

> This repository is a clean extract prepared for the AMD AI DevMaster
> submission, containing only the components adapted for local Radeon inference.
> It derives from a larger pre-existing personal project (ACOS) not otherwise
> open-sourced.

---

## What's original to this hackathon vs. pre-existing

**Pre-existing** (built before July 2026, brought in as the foundation):
- The ACOS claims pipeline: intake, rules engine (R1–R11), dual-agent validator
  architecture, HITL routing, settlement calculation, NHCX/FHIR integration,
  audit trail, RBAC/auth.
- The dual-agent architecture itself (Agent A rules + Agent B/C LLM
  cross-validation) — originally calling Groq and Anthropic's cloud APIs.

**Built specifically for this hackathon:**
- Local vLLM serving of *both* Agent B and Agent C on AMD Radeon — replacing
  the original cloud calls entirely.
- Fix for a routing gap where Agent C silently fell back to Groq (cloud) whenever
  Agent B was already local. Agent C now uses its own independent local model/server.
- Genuine function-calling for all three tools (`check_waiting_period_status`,
  `lookup_denial_code`, `search_additional_policy_clauses`) — live-GPU verified.
- Benchmark harness (`bench/`) and Phase 3 optimization sweep results.
- Radeon deployment profile (`deploy/radeon/`) — docker-compose demo stack,
  one-command bring-up, bootstrap automation.
- 15 ground-truth test claims (`testing_samples/`) rebuilt for this submission.

---

## Architecture

See `SPEC.md` §2 for the full agent architecture diagram and core-capability
breakdown. Short version:

```
Claim intake → Agent A (rules) → Agent B + Agent C (local LLMs, parallel)
→ dual-agent agreement scoring → HITL routing → settlement calculation → audit trail
```

Two independent LLMs, two separate vLLM instances, one AMD Radeon GPU.

---

## Environment Setup

**Hardware:** AMD Radeon PRO-class GPU · Device ID 0x744b · gfx1100 (RDNA3)
· 48GB VRAM · ROCm 7.2.1 · Ubuntu 24.04

```bash
# STEP 1: Activate the pre-built environment (do NOT pip install from scratch)
source /opt/venv/bin/activate

# STEP 2: Required exports before any vLLM launch
export HF_HOME=/workspace/persist/hf_cache
export HF_ENDPOINT=https://hf-mirror.com       # huggingface.co blocked on this host
export VLLM_ATTENTION_BACKEND=TRITON_ATTN      # force ROCm-native Triton backend
pip uninstall -y flash_attn                     # CUDA-only build, must be removed

# STEP 3: Agent B (primary, port 8000)
vllm serve Qwen/Qwen2.5-14B-Instruct-AWQ \
  --host 0.0.0.0 --port 8000 \
  --max-model-len 12288 \              # 8192 causes silent context-overflow failures
  --gpu-memory-utilization 0.45 \      # dual-agent safe split, empirically verified
  --enable-auto-tool-choice --tool-call-parser hermes

# STEP 4: Agent C (independent cross-validator, port 8001)
vllm serve Qwen/Qwen2.5-7B-Instruct-AWQ \
  --host 0.0.0.0 --port 8001 \
  --max-model-len 16384 \
  --gpu-memory-utilization 0.40 \
  --enable-auto-tool-choice --tool-call-parser hermes
```

**Or use the automated bootstrap (recommended):**
```bash
bash deploy/radeon/bootstrap_instance.sh --agent-c --tools
```
This handles sshd setup, all exports, flash_attn removal, stale-process cleanup,
and launches both agents with the correct, verified flags.

---

## Startup Guide (full demo stack)

```bash
# 1. Copy and edit the env file
cp deploy/radeon/.env.example deploy/radeon/.env

# 2. Start Colima (or Docker Desktop)
colima start

# 3. Build and start the stack
docker compose -f deploy/radeon/docker-compose.yml up --build -d

# 4. Apply database migrations (NOT automatic — must run this)
for f in database/migrations/*.sql; do
  docker compose -f deploy/radeon/docker-compose.yml \
    exec -T postgres psql -U claims_os -d claims_os < "$f"
done
# Note: harmless errors on migrations 030/031/033 (missing claims_admin role) are expected

# 5. Seed reference data and test claims (India-only)
docker compose -f deploy/radeon/docker-compose.yml \
  exec api_gateway python scripts/seed_db.py
./deploy/radeon/seed.sh

# 6. Open the UI
open http://localhost:3000
```

**Port mapping:**

| Service | Host port |
|---|---|
| claims_ui (Next.js) | 3000 |
| api_gateway (FastAPI) | 8080 |
| postgres | 5433 |
| redis | 6380 |
| vLLM Agent B | 8000 (Radeon host) |
| vLLM Agent C | 8001 (Radeon host) |

**SSH tunnel (required to connect local ACOS to remote vLLM):**
```bash
ssh -N -L 8000:localhost:8000 -L 8001:localhost:8001 -p <port> root@<host>
```
vLLM ports are not publicly exposed — only the SSH port is.

---

## Dependency List

- Python 3.12, `requirements.txt` (FastAPI, openai-sdk, psycopg2, redis, bcrypt, pytest)
- Node 20 / Next.js (`claims-ui/package.json`)
- vLLM 0.16.1.dev0, ROCm 7.2.1, PyTorch 2.9.1+rocm7.2.1, Triton 3.5.1
- PostgreSQL 16, Redis 7 (optional — pipeline degrades gracefully without them)
- Colima or Docker Desktop (for the demo stack)

---

## Benchmarks

All numbers measured on AMD Radeon PRO-class GPU (gfx1100, 48GB VRAM, ROCm 7.2.1).
Reproducible via `python3 bench/benchmark.py`. Results stored in `bench/results/`.

### Baseline Throughput (dual-agent, 0.45/0.4 GPU split)

| Model | Concurrency 1 | Concurrency 4 | Concurrency 8 |
|---|---|---|---|
| Agent B (Qwen2.5-14B-AWQ) | 8.7 tok/s | 25.94 tok/s | 51.68 tok/s |
| Agent C (Qwen2.5-7B-AWQ) | 15.34 tok/s | 46.05 tok/s | **91.01 tok/s** |

**Headline:** vLLM continuous batching delivers nearly **6x** aggregate throughput
vs. sequential baseline — the primary optimization lever, with no code changes required.

### Phase 3 Optimization Sweep (Agent B solo, varying flags)

| Config | Concurrency 1 | Concurrency 4 | Concurrency 8 |
|---|---|---|---|
| Best config (256 seqs, 0.85 util) | 9.5 tok/s | 28.4 tok/s | **56.47 tok/s** |

**Honest result:** raising `--gpu-memory-utilization` from 0.45 to 0.85 when
running Agent B alone gives ~+9% throughput. `--max-num-seqs` made zero
measurable difference. Full sweep results in `bench/results/`.

---

## Running the Test Suite

```bash
pip install -r requirements.txt
export JWT_SECRET_KEY=ci-acos-jwt-secret-000000000000000000000000000000000000000000000000000000
export ENVIRONMENT=test

# Phase 1 / local-LLM regression subset (51/51 passing)
pytest tests/test_testing_samples_suite.py \
       tests/test_agent_c_local_secondary.py \
       tests/test_tool_calling.py -v

# Full suite (excluding 2 files requiring a live server)
pytest tests/ \
  --ignore=tests/test_advance_claim.py \
  --ignore=tests/test_upload_real.py -q
```

CI runs the eval suite automatically on every push via
`.github/workflows/hackathon-eval-suite.yml` — no secrets required.

---

## Verifying Genuine Dual-Agent Execution

A normal-looking API response is NOT sufficient proof. Use server-side vLLM
request-log counts before and after submitting a claim:

```bash
# Before
grep -c 'POST /v1/chat/completions' /workspace/persist/logs/vllm_agentB.log
grep -c 'POST /v1/chat/completions' /workspace/persist/logs/vllm_agentC.log

# Submit claim, then check after
grep -c 'POST /v1/chat/completions' /workspace/persist/logs/vllm_agentB.log
grep -c 'POST /v1/chat/completions' /workspace/persist/logs/vllm_agentC.log
# Both counts must increase — by the same number, matching claims that triggered LLM analysis
```

Real evidence from this project: a 15-claim batch where 9 triggered the LLM
advisory gate moved both Agent B and Agent C counts by exactly +9 each.

---

## License

Apache License 2.0 — see `LICENSE`.

Third-party models and frameworks (open-source, permitted per contest rules,
not implied as self-built):
- **Qwen2.5-14B-Instruct-AWQ** and **Qwen2.5-7B-Instruct-AWQ** — Alibaba Cloud Qwen team, Apache 2.0
- **vLLM** — vLLM project, Apache 2.0
- **ROCm** — AMD, various open licenses

---

## Demo Credentials (demo-only, not real secrets)

Corrected 2026-07-25 — verified directly against the actual seed list in
`services/api_gateway/app/user_store.py::_seed_users()`, not assumed. The
previous table had a wrong email/password for Senior Adjuster and listed a
"Medical Director" account that was never actually seeded.

| Role | Email | Password |
|---|---|---|
| Admin (MFA required) | admin@claims-engine.local | Admin@2024! |
| Adjuster | adjuster@claims-engine.local | Adjuster@2024! |
| Senior Adjuster (MFA required) | reviewer@claims-engine.local | Reviewer@2024! |
| Compliance Officer | compliance@claims-engine.local | Compliance@2024! |

Only these 4 roles are seeded. "Medical Director" is a valid RBAC role in
the codebase (`MFA_REQUIRED_ROLES` includes it) but has no demo account —
create one via the Admin console if a demo needs it.

These are obviously-demo credentials embedded in `user_store.py` for testing
purposes. They are not real secrets and are not used in any production system.
