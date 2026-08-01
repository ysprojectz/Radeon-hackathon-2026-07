#!/usr/bin/env python3
"""
Benchmark harness v1 — Radeon local vLLM inference (Victory Bible Phase 2, Jul 24).

Measures tokens/sec, time-to-first-token (TTFT), and requests/sec at 1/4/8
concurrency against any OpenAI-compatible endpoint (vLLM, Ollama, llama.cpp).
Emits a JSON artifact and a self-contained HTML chart — no plotting deps.

Usage:
    source /opt/venv/bin/activate   # on the Radeon instance
    python3 bench/benchmark.py \
        --base-url http://localhost:8000/v1 \
        --model Qwen/Qwen2.5-14B-Instruct-AWQ \
        --label "Agent B (14B, baseline)"

    # Second model / second server, same harness:
    python3 bench/benchmark.py \
        --base-url http://localhost:8001/v1 \
        --model Qwen/Qwen2.5-7B-Instruct-AWQ \
        --label "Agent C (7B)"

Notes:
    - Run this ON the Radeon instance (or tunnel both ports there) — it measures
      real GPU-side throughput, not client-side network latency.
    - Re-run after every optimization change (Phase 3) and diff against the
      Day-1 baseline (~8.4 tok/s, unoptimized, on a since-destroyed instance —
      that number does NOT carry over; always re-baseline on the current
      instance first, per SKILL.md §6).
"""
from __future__ import annotations

import argparse
import asyncio
import json
import statistics
import time
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from openai import AsyncOpenAI

DEFAULT_PROMPT = (
    "You are a health-insurance claims adjudication assistant. A member submitted "
    "an outpatient claim: office visit (CPT 99214, INR 2500), chest X-ray (CPT 71046, "
    "INR 3000), complete blood count (CPT 85025, INR 2000). The policy covers "
    "consultations and diagnostics at 80% after a 20% copay, subject to network tier "
    "NETWORK. Analyze coverage per line item and return a structured JSON verdict "
    "with coverage_status, confidence, and a one-sentence rationale for each line."
)

CONCURRENCY_LEVELS = (1, 4, 8)
REQUESTS_PER_LEVEL = 6  # small, deliberate — keeps GPU-hour usage low on metered credits


@dataclass
class RequestResult:
    ttft_s: float
    total_s: float
    completion_tokens: int
    prompt_tokens: int
    ok: bool
    error: Optional[str] = None


@dataclass
class ConcurrencyResult:
    concurrency: int
    requests: list = field(default_factory=list)  # list[RequestResult]
    wall_time_s: float = 0.0

    def to_summary(self) -> dict:
        ok_reqs = [r for r in self.requests if r.ok]
        n_ok = len(ok_reqs)
        n_fail = len(self.requests) - n_ok
        total_completion_tokens = sum(r.completion_tokens for r in ok_reqs)
        return {
            "concurrency": self.concurrency,
            "requests_sent": len(self.requests),
            "requests_ok": n_ok,
            "requests_failed": n_fail,
            "wall_time_s": round(self.wall_time_s, 3),
            "requests_per_sec": round(n_ok / self.wall_time_s, 3) if self.wall_time_s else 0.0,
            "tokens_per_sec_aggregate": round(total_completion_tokens / self.wall_time_s, 2) if self.wall_time_s else 0.0,
            "ttft_p50_s": round(statistics.median([r.ttft_s for r in ok_reqs]), 3) if ok_reqs else None,
            "ttft_p95_s": round(_percentile([r.ttft_s for r in ok_reqs], 95), 3) if ok_reqs else None,
            "avg_completion_tokens": round(total_completion_tokens / n_ok, 1) if n_ok else 0,
        }


def _percentile(values: list, pct: float) -> float:
    if not values:
        return 0.0
    values = sorted(values)
    idx = min(len(values) - 1, int(round((pct / 100) * (len(values) - 1))))
    return values[idx]


async def _run_one_request(client: AsyncOpenAI, model: str, prompt: str) -> RequestResult:
    start = time.perf_counter()
    first_token_time: Optional[float] = None
    completion_tokens = 0
    prompt_tokens = 0
    try:
        stream = await client.chat.completions.create(
            model=model,
            messages=[{"role": "user", "content": prompt}],
            temperature=0,
            max_tokens=512,
            stream=True,
            stream_options={"include_usage": True},
        )
        async for chunk in stream:
            if chunk.choices and chunk.choices[0].delta and chunk.choices[0].delta.content:
                if first_token_time is None:
                    first_token_time = time.perf_counter()
                completion_tokens += 1  # refined below if usage is reported
            if getattr(chunk, "usage", None):
                completion_tokens = chunk.usage.completion_tokens or completion_tokens
                prompt_tokens = chunk.usage.prompt_tokens or prompt_tokens
        end = time.perf_counter()
        ttft = (first_token_time or end) - start
        return RequestResult(
            ttft_s=ttft, total_s=end - start,
            completion_tokens=completion_tokens or 1, prompt_tokens=prompt_tokens,
            ok=True,
        )
    except Exception as e:
        end = time.perf_counter()
        return RequestResult(
            ttft_s=end - start, total_s=end - start,
            completion_tokens=0, prompt_tokens=0, ok=False, error=str(e),
        )


async def _run_concurrency_level(client: AsyncOpenAI, model: str, prompt: str, concurrency: int, n_requests: int) -> ConcurrencyResult:
    result = ConcurrencyResult(concurrency=concurrency)
    start = time.perf_counter()
    for batch_start in range(0, n_requests, concurrency):
        batch = [
            _run_one_request(client, model, prompt)
            for _ in range(min(concurrency, n_requests - batch_start))
        ]
        result.requests.extend(await asyncio.gather(*batch))
    result.wall_time_s = time.perf_counter() - start
    return result


async def run_benchmark(base_url: str, model: str, api_key: str, label: str, prompt: str) -> dict:
    client = AsyncOpenAI(base_url=base_url, api_key=api_key or "local")
    levels = []
    for concurrency in CONCURRENCY_LEVELS:
        print(f"[bench] {label}: concurrency={concurrency} ...")
        level_result = await _run_concurrency_level(client, model, prompt, concurrency, REQUESTS_PER_LEVEL)
        summary = level_result.to_summary()
        print(f"[bench]   -> {summary['tokens_per_sec_aggregate']} tok/s aggregate, "
              f"{summary['requests_per_sec']} req/s, TTFT p50={summary['ttft_p50_s']}s")
        levels.append(summary)
    return {
        "label": label,
        "base_url": base_url,
        "model": model,
        "run_at_utc": datetime.now(timezone.utc).isoformat(),
        "requests_per_level": REQUESTS_PER_LEVEL,
        "concurrency_levels": list(CONCURRENCY_LEVELS),
        "results": levels,
    }


def _render_html_chart(run: dict, out_path: Path) -> None:
    """Self-contained bar chart (inline SVG) — no plotting library dependency."""
    results = run["results"]
    max_tps = max((r["tokens_per_sec_aggregate"] for r in results), default=1) or 1
    bar_w, gap, chart_h = 90, 40, 260
    bars = []
    for i, r in enumerate(results):
        h = (r["tokens_per_sec_aggregate"] / max_tps) * chart_h
        x = i * (bar_w + gap) + gap
        y = chart_h - h + 40
        bars.append(f'''
          <rect x="{x}" y="{y}" width="{bar_w}" height="{h}" fill="#dc2626" rx="4"/>
          <text x="{x + bar_w/2}" y="{y - 8}" text-anchor="middle" font-size="14" font-family="monospace">{r["tokens_per_sec_aggregate"]}</text>
          <text x="{x + bar_w/2}" y="{chart_h + 60}" text-anchor="middle" font-size="13" font-family="monospace">c={r["concurrency"]}</text>
        ''')
    svg_w = len(results) * (bar_w + gap) + gap
    html = f"""<!doctype html><html><head><meta charset="utf-8">
<title>ACOS Radeon Benchmark — {run['label']}</title>
<style>
  body {{ font-family: -apple-system, sans-serif; background:#0b0b0c; color:#eee; padding:2rem; }}
  h1 {{ font-size: 1.2rem; }} table {{ border-collapse: collapse; margin-top: 1.5rem; }}
  td, th {{ border: 1px solid #333; padding: 6px 12px; font-size: 0.85rem; text-align: right; }}
  th {{ text-align: center; background:#1a1a1c; }}
</style></head><body>
<h1>{run['label']} — {run['model']}</h1>
<p style="opacity:0.7">{run['base_url']} · {run['run_at_utc']}</p>
<svg width="{svg_w}" height="{chart_h + 90}" style="background:#111;border-radius:8px">
{''.join(bars)}
</svg>
<table>
<tr><th>Concurrency</th><th>tok/s (aggregate)</th><th>req/s</th><th>TTFT p50 (s)</th><th>TTFT p95 (s)</th><th>OK/Sent</th></tr>
{''.join(f"<tr><td>{r['concurrency']}</td><td>{r['tokens_per_sec_aggregate']}</td><td>{r['requests_per_sec']}</td><td>{r['ttft_p50_s']}</td><td>{r['ttft_p95_s']}</td><td>{r['requests_ok']}/{r['requests_sent']}</td></tr>" for r in results)}
</table>
</body></html>"""
    out_path.write_text(html)


def main():
    parser = argparse.ArgumentParser(description="ACOS Radeon vLLM benchmark harness")
    parser.add_argument("--base-url", required=True, help="OpenAI-compatible base URL, e.g. http://localhost:8000/v1")
    parser.add_argument("--model", required=True, help="Model name as served by vLLM")
    parser.add_argument("--api-key", default="local")
    parser.add_argument("--label", default="run", help="Human label for this run, e.g. 'Agent B (14B)'")
    parser.add_argument("--prompt-file", default=None, help="Optional path to a custom prompt")
    parser.add_argument("--output-dir", default=str(Path(__file__).parent / "results"))
    args = parser.parse_args()

    prompt = Path(args.prompt_file).read_text() if args.prompt_file else DEFAULT_PROMPT
    run = asyncio.run(run_benchmark(args.base_url, args.model, args.api_key, args.label, prompt))

    out_dir = Path(args.output_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    slug = "".join(c if c.isalnum() else "_" for c in args.label).strip("_").lower()
    json_path = out_dir / f"{stamp}_{slug}.json"
    html_path = out_dir / f"{stamp}_{slug}.html"

    json_path.write_text(json.dumps(run, indent=2))
    _render_html_chart(run, html_path)

    print(f"\n[bench] JSON  -> {json_path}")
    print(f"[bench] Chart -> {html_path}")


if __name__ == "__main__":
    main()
