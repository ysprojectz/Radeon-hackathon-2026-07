#!/usr/bin/env bash
# One-shot bring-up for a fresh/relaunched Radeon Cloud instance (AMD OneClick
# Base image). Automates everything that had to be repeated manually on every
# relaunch across Days 1-4 (see SKILL.md §6 for the full history/why of each
# step) — this is genuinely untested end-to-end as a single script (each step
# individually is proven, but this exact sequential run hasn't been), so
# treat the first real run as a verification pass, not a guarantee.
#
# Run this FROM THE JUPYTERLAB TERMINAL on a fresh instance (not over SSH —
# sshd isn't running yet at the start, that's Phase 1 below). Once Phase 1
# completes you can also finish the rest over SSH if you'd rather.
#
# Usage: bash bootstrap_instance.sh [--agent-c] [--tools]
#   --agent-c   also launch Agent C (Qwen2.5-7B-Instruct-AWQ, port 8001).
#               Omit for Agent B only.
#   --tools     enable vLLM's OpenAI-compatible tool-calling parser (Hermes,
#               works for Qwen2.5-Instruct). Required on the SERVER side for
#               services/reasoning_engine/app/tools.py's local tool-calling
#               feature to function — that feature is separately gated off by
#               default on the app side too (LOCAL_LLM_TOOLS_ENABLED=false),
#               so this flag alone does not turn tool-calling on end-to-end.
#               Not yet live-GPU verified as of 2026-07-24 — see SKILL.md §9.

set -euo pipefail

WANT_AGENT_C=0
WANT_TOOLS=0
for arg in "$@"; do
  [[ "$arg" == "--agent-c" ]] && WANT_AGENT_C=1
  [[ "$arg" == "--tools" ]] && WANT_TOOLS=1
done

TOOL_FLAGS=""
if [[ "$WANT_TOOLS" == "1" ]]; then
  TOOL_FLAGS="--enable-auto-tool-choice --tool-call-parser hermes"
  echo "Tool-calling parser ENABLED on the vLLM server(s) (--tools passed)."
fi

echo "=== Phase 1: sshd (only needed once per relaunch; the platform's SSH-access"
echo "    toggle just opens the port, nothing listens behind it by default) ==="
if ! pgrep -x sshd > /dev/null 2>&1; then
  apt-get update -qq
  apt-get install -y -qq openssh-server
  mkdir -p /run/sshd
  /usr/sbin/sshd
  echo "sshd started."
else
  echo "sshd already running, skipping."
fi

echo ""
echo "=== Phase 2: environment (HF mirror, ROCm attention backend, flash_attn) ==="
source /opt/venv/bin/activate
mkdir -p /workspace/persist/hf_cache /workspace/persist/logs
export HF_HOME=/workspace/persist/hf_cache
export HF_ENDPOINT=https://hf-mirror.com
export VLLM_ATTENTION_BACKEND=TRITON_ATTN
pip uninstall -y flash_attn > /dev/null 2>&1 || true
echo "HF_HOME=$HF_HOME"
echo "HF_ENDPOINT=$HF_ENDPOINT (huggingface.co is blocked from this instance — GFW-style block on that specific domain)"
echo "VLLM_ATTENTION_BACKEND=$VLLM_ATTENTION_BACKEND"

echo ""
echo "=== Phase 3: launch vLLM server(s) ==="
echo "Killing any stray vllm processes first (avoids the GPU-memory-conflict"
echo "issue found 2026-07-24 — orphaned EngineCore subprocesses survive a plain"
echo "'pkill -f vllm serve' since they rename their own process title)..."
pkill -9 -f "vllm serve" 2>/dev/null || true
pkill -9 -f "VLLM::EngineCore" 2>/dev/null || true
sleep 2

# Agent B's VRAM budget depends on whether Agent C is also launching. The
# Phase 3 sweep (2026-07-24, bench/phase3_optimize.sh) confirmed 0.85 is a
# clean ~9% throughput win over 0.5 for Agent B running ALONE (9.5/28.4/56.5
# tok/s vs 8.7/25.94/51.68 at concurrency 1/4/8) with no accuracy risk (this
# flag only affects KV-cache headroom, not weights/quantization). That
# headroom isn't available once Agent C also needs VRAM.
#
# CORRECTED 2026-07-24 (later same session): the previously-documented 0.5/0.6
# dual-agent split actually FAILED for real on a fresh reproduction — Agent B
# at 0.5 left only ~22GB free, but Agent C's 0.6 ceiling needs 28.8GB of a
# 48GB total, so Agent C's engine core crashed with "No available memory for
# the cache blocks." (0.5+0.6=1.1 was never safely under 1.0 to begin with;
# the earlier "verified" note should not have been trusted without re-testing
# it.) 0.45/0.4 worked on that instance, but 0.4 for Agent C is NOT a locked
# value — see the CORRECTED 2026-08-01 note above Agent C's launch below,
# where 0.4 failed on a later fresh instance and 0.30 was what actually fit.
AGENT_B_GPU_UTIL="0.85"
[[ "$WANT_AGENT_C" == "1" ]] && AGENT_B_GPU_UTIL="0.45"

# --max-model-len bumped from 8192 to 12288, found 2026-07-24 (real full-
# pipeline test): a genuine claim's prompt (regulatory + company clause
# context) plus reasoning.py's fixed MAX_TOKENS=4096 output request can
# exceed 8192, causing an instant 400 BadRequestError on EVERY local call —
# which the pipeline silently swallows as a failover to rules-only mode,
# producing a false-positive agent_agreement_score=1.0 indistinguishable
# from a genuine dual-agent success (same failure shape as the Day 4 bug).
# 12288 needs --gpu-memory-utilization >= 0.5 to fit (vLLM's own error
# message reports the max feasible length at a given utilization if this
# ever needs re-tuning) — 0.85 (standalone) and 0.45 (dual-agent) both clear
# that bar with margin to spare.
echo "Starting Agent B (Qwen2.5-14B-Instruct-AWQ, port 8000, ${AGENT_B_GPU_UTIL} VRAM budget)..."
# shellcheck disable=SC2086
nohup vllm serve Qwen/Qwen2.5-14B-Instruct-AWQ --host 0.0.0.0 --port 8000 \
  --max-model-len 12288 --gpu-memory-utilization "$AGENT_B_GPU_UTIL" $TOOL_FLAGS \
  > /workspace/persist/logs/vllm_agentB.log 2>&1 &
disown

if [[ "$WANT_AGENT_C" == "1" ]]; then
  # CORRECTED 2026-08-01: --gpu-memory-utilization is NOT an additive split
  # across processes — vLLM checks target_ceiling (fraction x total VRAM)
  # <= actual free memory at THAT process's own startup time, not a share
  # of total device capacity. Re-verified on a fresh instance: Agent B at
  # 0.45 was actually using ~56.5% of the 48GB pool once loaded (27.13GiB),
  # leaving only ~16.11GiB free for Agent C. 0.4 failed ("No available
  # memory for the cache blocks"); 0.85 failed with a clearer error
  # confirming the free-memory math. 0.30 (0.30*48=14.4GiB ceiling, under
  # the ~16.11GiB actually free) succeeded, 7.14GiB KV cache. This is the
  # value that fit THIS instance's actual free memory after Agent B loaded,
  # not a portable constant — if Agent B ends up using a different share of
  # VRAM on a future instance, re-check free memory via
  # `rocm-smi --showmeminfo vram` before assuming 0.30 still fits.
  echo "Starting Agent C (Qwen2.5-7B-Instruct-AWQ, port 8001, 30% VRAM budget)..."
  # shellcheck disable=SC2086
  nohup vllm serve Qwen/Qwen2.5-7B-Instruct-AWQ --host 0.0.0.0 --port 8001 \
    --max-model-len 16384 --gpu-memory-utilization 0.30 $TOOL_FLAGS \
    > /workspace/persist/logs/vllm_agentC.log 2>&1 &
  disown
fi

echo ""
echo "=== Phase 4: wait for readiness ==="
wait_for_server() {
  local logfile="$1" label="$2"
  echo -n "Waiting for $label..."
  for _ in $(seq 1 120); do
    if grep -qE "Application startup complete|Uvicorn running" "$logfile" 2>/dev/null; then
      echo " ready."
      return 0
    fi
    if grep -qE "Traceback|ERROR" "$logfile" 2>/dev/null; then
      echo " FAILED — see $logfile"
      return 1
    fi
    sleep 5
    echo -n "."
  done
  echo " timed out after 10 minutes — check $logfile"
  return 1
}

wait_for_server /workspace/persist/logs/vllm_agentB.log "Agent B (port 8000)"
if [[ "$WANT_AGENT_C" == "1" ]]; then
  wait_for_server /workspace/persist/logs/vllm_agentC.log "Agent C (port 8001)"
fi

echo ""
echo "=== Done ==="
echo "From your Mac, tunnel in with:"
if [[ "$WANT_AGENT_C" == "1" ]]; then
  echo "  ssh -N -L 8000:localhost:8000 -L 8001:localhost:8001 -p <current-port> root@<current-host>"
else
  echo "  ssh -N -L 8000:localhost:8000 -p <current-port> root@<current-host>"
fi
echo "(port and host always change on relaunch — copy the current values from the Active Instance panel)"
