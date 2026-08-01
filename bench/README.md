# Benchmark Harness

Measures tokens/sec, time-to-first-token (TTFT), and requests/sec at 1/4/8
concurrency against any OpenAI-compatible LLM endpoint (vLLM, Ollama, llama.cpp).
Built for Phase 2 of the AMD AI DevMaster Hackathon submission — see
`SKILL.md` / Victory Bible §6 in the Hackathon Project folder for full context.

## Usage

Run **on the Radeon instance** (or through the SSH tunnel to it) — this
measures GPU-side throughput, not client-side network latency:

```bash
source /opt/venv/bin/activate
python3 bench/benchmark.py \
    --base-url http://localhost:8000/v1 \
    --model Qwen/Qwen2.5-14B-Instruct-AWQ \
    --label "Agent B (14B, baseline)"
```

Run again against Agent C's own server/port once it's up:

```bash
python3 bench/benchmark.py \
    --base-url http://localhost:8001/v1 \
    --model Qwen/Qwen2.5-7B-Instruct-AWQ \
    --label "Agent C (7B)"
```

Each run writes a timestamped JSON artifact and a self-contained HTML chart
(no plotting library dependency — inline SVG) to `bench/results/`.

## Verified

The harness itself was smoke-tested locally against a mock OpenAI-compatible
streaming server (not against real GPU hardware — that step is still pending
Radeon instance access). It correctly streams SSE chunks, computes TTFT from
the first content delta, reads `usage.completion_tokens` from the final
chunk, and produces both output files. Numbers from a live vLLM run are the
first real Phase 2 Jul 24 deliverable once the instance is back up.

## Re-baselining

Day 1's ~8.4 tok/s baseline was measured on an instance since destroyed —
that number does NOT carry over to a new instance. Always re-run this harness
against the *current* instance before any Phase 3 optimization work, per
`SKILL.md` §6.

## Phase 3 optimization sweep — RUN FOR REAL, July 24 (results in `results/*phase3*`)

`phase3_optimize.sh` automates the serving-flag sweep this harness feeds
into. Ran clean start-to-finish against live hardware (instance
`u-9581-6bb2323d`), ~35 min total for 5 configs. **Honest results, not
oversold:**

| Config | Concurrency 1 | Concurrency 4 | Concurrency 8 |
|---|---|---|---|
| `--max-num-seqs 256 --gpu-memory-utilization 0.85` | 9.5 tok/s | 28.4 tok/s | 56.47 tok/s |
| `--max-num-seqs 128 --gpu-memory-utilization 0.85` | 9.5 tok/s | 28.32 tok/s | 56.41 tok/s |
| `--max-num-seqs 64 --gpu-memory-utilization 0.85` | 9.51 tok/s | 28.38 tok/s | 56.52 tok/s |
| `--max-num-seqs 256 --gpu-memory-utilization 0.90` | 9.48 tok/s | 28.31 tok/s | 56.35 tok/s |
| `--max-num-seqs 256 --gpu-memory-utilization 0.95` | 9.5 tok/s | 28.32 tok/s | 56.38 tok/s |

**What this actually shows:**
- **`--max-num-seqs` made zero measurable difference** across 64/128/256 at
  concurrency ≤8 — that ceiling simply isn't binding at these concurrency
  levels. Not a useful lever to tune further without testing much higher
  concurrency than this harness currently drives (it tests 1/4/8 only).
- **`--gpu-memory-utilization` above 0.85 made zero further difference**
  (0.85 vs 0.90 vs 0.95 are statistically indistinguishable) — 0.85 already
  gives enough KV-cache headroom for this workload; more VRAM allocated
  past that point sits idle. **0.85 is the value now baked into
  `bootstrap_instance.sh` for standalone Agent B** (kept conservative rather
  than pushed to 0.95, since there's no measured upside and less margin).
- **The one real, actionable win: raising `--gpu-memory-utilization` from
  the Day 4 dual-agent-safe 0.5 to 0.85 for Agent B running ALONE** gained
  ~9% throughput at every concurrency level (8.7→9.5 tok/s at concurrency 1,
  51.68→56.47 at concurrency 8) — extra KV-cache headroom, no accuracy risk
  since this flag never touches weights/quantization. **This does not carry
  over to the dual-agent (Agent B + Agent C) config** — that headroom isn't
  available once Agent C also needs VRAM, so the proven 0.5/0.6 split stays
  for the actual dual-agent demo; raising it further with both agents
  resident is untested and not assumed safe.
- Aggregate throughput plateaus at ~56.4-56.5 tok/s at concurrency 8 across
  every config tested — this looks like a compute-bound ceiling for the 14B
  model at 8-way batching on this GPU, not something these particular
  serving flags can push past. Remaining Bible §6.2 levers not yet tried:
  prompt economy (trim system-prompt/context tokens) and testing
  meaningfully higher concurrency than 8.
