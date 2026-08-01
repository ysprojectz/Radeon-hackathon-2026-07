#!/usr/bin/env bash
# Phase 3 optimization sweep (Victory Bible Phase 3, Aug 1-3) — Agent B only,
# standalone (stop Agent C first if it's running, so this can use more VRAM
# than the dual-agent 0.5/0.6 split without contending for it).
#
# Sweeps vLLM serving flags in the order the Bible's §6.2 "Optimization
# Levers" ranks by effort/payoff (quantization is already applied — AWQ is
# the Day-1 baseline, not a lever to test here; continuous batching is
# already measured via the concurrency 1/4/8 numbers in bench/results/) —
# this script covers the next lever down: --max-num-seqs and
# --gpu-memory-utilization, which aren't runtime-adjustable and need a
# relaunch between each config to actually test.
#
# Written 2026-07-24 without GPU access — every individual step (relaunch
# pattern, benchmark harness call) is proven from bootstrap_instance.sh and
# the Day 4 live benchmark run, but this exact sweep has not been run
# start-to-finish. Treat the first real run as verification, budget ~15-20
# min of GPU-hour credit for it (5 configs x ~2-3 min each incl. reload).
#
# Usage: bash bench/phase3_optimize.sh
# Run from the repo root, ON the Radeon instance, with /opt/venv activated.

set -euo pipefail

MODEL="Qwen/Qwen2.5-14B-Instruct-AWQ"
PORT=8000
LOGFILE=/workspace/persist/logs/vllm_phase3_sweep.log
RESULTS_DIR="$(dirname "$0")/results"

mkdir -p "$(dirname "$LOGFILE")" "$RESULTS_DIR"

# (max-num-seqs, gpu-memory-utilization) — vLLM's default max-num-seqs is 256;
# lower values reduce batching parallelism (worse throughput, less VRAM for
# KV cache), higher raise the ceiling on concurrent requests the engine will
# batch together. 0.85/0.90 push past the dual-agent-safe 0.5 split since
# Agent C is assumed stopped for this standalone sweep.
CONFIGS=(
  "256 0.85"   # vLLM's own default max-num-seqs, moderate VRAM headroom
  "128 0.85"   # halved batching ceiling — check if throughput actually drops
  "64 0.85"    # further halved — expect concurrency-8 numbers to suffer most
  "256 0.90"   # default batching, push VRAM utilization higher
  "256 0.95"   # default batching, maximum safe VRAM utilization
)

kill_vllm() {
  pkill -9 -f "vllm serve" 2>/dev/null || true
  pkill -9 -f "VLLM::EngineCore" 2>/dev/null || true
  sleep 2
}

wait_for_server() {
  echo -n "  waiting for server..."
  for _ in $(seq 1 90); do
    if grep -qE "Application startup complete|Uvicorn running" "$LOGFILE" 2>/dev/null; then
      echo " ready."
      return 0
    fi
    if grep -qE "Traceback|ERROR" "$LOGFILE" 2>/dev/null; then
      echo " FAILED — see $LOGFILE"
      return 1
    fi
    sleep 5
    echo -n "."
  done
  echo " timed out after 7.5 min — check $LOGFILE"
  return 1
}

echo "=== Phase 3 sweep: ${#CONFIGS[@]} configs, Agent B (${MODEL}) only ==="
echo "Make sure Agent C is stopped before running this — this sweep assumes"
echo "the full GPU is available to Agent B alone."
echo ""

for cfg in "${CONFIGS[@]}"; do
  read -r max_seqs gpu_util <<< "$cfg"
  label="maxseqs${max_seqs}_util${gpu_util}"
  echo "--- Config: --max-num-seqs ${max_seqs} --gpu-memory-utilization ${gpu_util} ---"

  kill_vllm
  : > "$LOGFILE"
  nohup vllm serve "$MODEL" --host 0.0.0.0 --port "$PORT" \
    --max-model-len 8192 --gpu-memory-utilization "$gpu_util" --max-num-seqs "$max_seqs" \
    > "$LOGFILE" 2>&1 &
  disown

  if ! wait_for_server; then
    echo "  SKIPPING this config (server failed to come up) — check $LOGFILE before continuing"
    continue
  fi

  python3 "$(dirname "$0")/benchmark.py" \
    --base-url "http://localhost:${PORT}/v1" \
    --model "$MODEL" \
    --label "Phase3 Agent B ${label}" \
    --output-dir "$RESULTS_DIR"

  echo ""
done

kill_vllm
echo "=== Sweep complete. Compare bench/results/*Phase3*.json for the winning config. ==="
echo "Once a config is chosen: (1) bake its flags into bootstrap_instance.sh,"
echo "(2) re-run the 15-claim testing_samples suite to confirm accuracy didn't"
echo "regress (these flags don't touch quantization/weights, but verify anyway"
echo "per the Bible's evidence-discipline rule), (3) log the winning numbers in"
echo "SKILL.md §6 and the Day 5+ Hack_Prep log, per the logging-discipline rule."
