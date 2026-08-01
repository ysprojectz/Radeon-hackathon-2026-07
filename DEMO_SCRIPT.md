# Demo Video Script — ACOS (Autonomous Claims Operating System) — Health Claims Arbiter
### Sovereign AI adjudication for India's NHCX ecosystem

**Track 2, Yuvaraj S — AMD AI DevMaster Hackathon 2026**
Target length: 4:35–4:50 (revised 2026-07-25 to add the live OCR segment;
was 4:15–4:30). English narration throughout.

> Supersedes the Victory Bible §12.8 voiceover script, which predates
> tool-calling being built and live-GPU verified. This version reflects the
> project's actual current, verified capabilities — every number and claim
> below is reproducible from a script in the repo (see `SPEC.md` §8 Evidence
> Discipline). India-only narrative per `SKILL.md` §1.11 — no GCC/UAE content.

---

## [0:00–0:30] The Problem (30s)

**Show:** Title card / static slide, no screen recording yet.

**Say:**
> "India's health insurance market is projected to reach 322 billion dollars
> by 2034. At national scale, IRDAI's March 2026 mandate requires cashless
> claims to get final authorization within three hours of discharge — a
> window no manual claims desk can consistently meet.
>
> The obvious shortcut — bolting a cloud LLM onto NHCX, India's claims
> exchange — creates a sovereignty contradiction. NHCX is built as an
> encrypted router that never reads patient data. Sending that same data to
> a foreign cloud API defeats the entire design.
>
> ACOS runs its entire AI adjudication layer on a single AMD Radeon GPU,
> inside the hospital. Sovereign, auditable, and fast enough to meet the
> mandate."

---

## [0:30–1:00] Hardware Proof (30s)

**Show, in order:**
1. Radeon Cloud Active Instance panel (GPU model, VRAM visible)
2. Terminal: `rocm-smi` output
3. Terminal: provider config confirming all cloud providers disabled

**Say:**
> "Everything you're about to see runs on this card — AMD Radeon PRO-class
> GPU, gfx1100, 48 gigabytes of VRAM. No OpenAI, no Anthropic, no Groq —
> confirmed disabled in the running configuration."

---

## [1:00–1:35] Live OCR Intake (35s)

**Show, in order:**
1. Drag-and-drop `testing_samples/upload_test_pdfs/04_India_inpatient_room_rent_cap.pdf`
   (City General Hospital, Chennai, INR 1,30,500, room-rent-above-cap) into the local UI at
   `localhost:3000/submit`, Market set to India
2. OCR extraction happening live — confidence score, extracted fields
   (patient, provider, INR amount) populating on screen
3. Extracted claim data flowing straight into the same adjudication pipeline
   used for the JSON claims — no separate code path

**Say:**
> "Claims don't have to start as clean JSON. Here's a real scanned hospital
> bill — OCR extracts patient, provider, and billed amount live, right here
> on this GPU, no cloud vision API. From this point on it's the exact same
> adjudication pipeline as every other claim in this demo."

*(Decision, 2026-07-25: live OCR is featured rather than JSON-only, after
weighing the demo-risk tradeoff in `CLEAN_EXTRACT_CHECKLIST.md` — see
Recording Notes below for the rehearsal requirement this adds.)*

---

## [1:35–2:35] Golden-Path Claim (60s)

**Show, in order:**
1. The claim from the OCR step above (or a second India claim submitted
   directly through the HTTP API, for a controlled JSON comparison)
2. Agent A (deterministic rules engine) verdict appearing
3. Agent B — local LLM analysis with a cited policy clause
4. Agent C — independent cross-validator, a genuinely different model,
   showing its own confidence/reasoning
5. The computed agreement score — showing real variance (not a suspicious
   flat 1.0)
6. Terminal, side-by-side: `grep -c 'POST /v1/chat/completions'
   vllm_agentB.log` and the same for Agent C, before and after — both
   counts increasing together

**Say:**
> "Two independent local models — not one model role-playing as two. Here's
> the proof: server-side request counts on both vLLM instances, not
> application logs that could be misleading. Submit one claim, watch both
> counts increase. This is genuine dual-agent cross-validation, verified the
> only way that can't be faked."

---

## [2:35–3:05] Tool Invocation Proof (30s)

**Show:**
1. A claim with an ambiguous diagnosis code that triggers a tool call
2. The `tool_calls` field in the raw vLLM response — real, not simulated
3. The tool's result (e.g. from `check_waiting_period_status`) being
   correctly incorporated into the final answer

**Say:**
> "This isn't scripted orchestration — it's genuine function-calling. The
> model itself decides to call ACOS's own rules engine as a tool mid-
> analysis, and incorporates the real result. Twenty-five unit tests, plus
> live-GPU verification on real hardware — confirmed via the same
> server-side request-count method."

---

## [3:05–3:35] Multi-Turn Memory + Retrieval (30s)

**Show:**
1. Chat UI: ask about a specific claim by reference
2. Follow-up: "Why was line 3 reduced?" — answer cites the earlier
   conversation context
3. Follow-up: "Which clause applies to the room-rent deduction?" — answer
   cites the actual policy clause text

**Say:**
> "Multi-turn memory carries claim context across the conversation. Policy
> clause retrieval — keyword and metadata-filtered, not vector search, and
> we say so precisely — grounds every answer in the real policy document,
> not a hallucinated citation."

---

## [3:35–4:05] HITL + Audit Trail (30s)

**Show:**
1. A claim where the agreement score falls below threshold, routing to
   human review
2. A human reviewer approving it; settlement recommendation generated
3. The audit trail entry for that decision — hash-chained

**Say:**
> "When the two agents disagree below threshold, a human decides — never a
> silent auto-approval. Every decision, human or AI, is hashed into an
> immutable audit trail."

---

## [4:05–4:35] Benchmark Evidence (30s)

**Show:** `bench/results/` HTML chart on screen (the real chart, not a
mockup).

**Say:**
> "Real numbers, from a real GPU session. Agent B: 8.7 tokens per second at
> concurrency one, scaling to 51.68 at concurrency eight — nearly six times
> the throughput from vLLM's continuous batching alone, no code changes
> required. Agent C, the smaller model: 15.34 up to 91 tokens per second.
> Every number here regenerates from one script in this repository."

---

## [4:35–4:50] Close (15s)

**Say:**
> "One affordable AMD Radeon GPU. Two independent local agents. An
> IRDAI-compliant audit trail on every decision. Patient data never leaves
> the building. ACOS — the Autonomous Claims Operating System, your Health
> Claims Arbiter — sovereign AI adjudication for India's NHCX ecosystem."

---

## Recording Notes

- **OCR live-PDF-upload demo — DECIDED 2026-07-25 (Yuvaraj): feature it.**
  The `[1:00–1:35]` segment above uses
  `testing_samples/upload_test_pdfs/04_India_inpatient_room_rent_cap.pdf`
  (India-only, room-rent-cap scenario — ties into the same room-rent
  sub-limit narrative as `16_CLM-INDIA-2026-REIMB01.json`). Confirmed via
  code inspection (not assumed): the demo stack's `api_gateway` container
  builds from the root `Dockerfile`, which installs `tesseract-ocr` (apt)
  and `pdfplumber`/`pytesseract` (`requirements.txt`) — OCR dependencies
  are already present in the demo stack image, nothing extra to install.
  **Before recording:** do at least one full dry run of this exact PDF
  through the exact demo-stack container (not a bare local venv, which
  won't have `tesseract-ocr` installed) to confirm OCR confidence and
  extracted fields render as expected and within the 35s segment budget —
  this is the one segment in the whole script with genuine live-failure
  risk (OCR misread, timing overrun), so it's the one to rehearse hardest.
  If it doesn't hold up in rehearsal, fall back to the JSON-only golden
  path and drop this segment — the rest of the script doesn't depend on it.
- Every number cited above is from `bench/results/*.json` (Agent B
  `20260724T072921Z_phase3_agent_b_maxseqs256_util0_85.json` and earlier
  baseline runs) and the server-side request-log method documented in
  `README.md`'s "Verifying Genuine Dual-Agent Execution" section — do not
  substitute different numbers without re-running the actual scripts.
- India-only: no GCC/UAE claim, screen, or terminology appears anywhere in
  this script, per `SKILL.md` §1.11 (locked July 25).
- Recording checklist before finalizing: confirm the live instance is up,
  confirm `bootstrap_instance.sh --agent-c --tools` was used (not manual
  flags that might drift from the locked values), do one full dry run with
  a stopwatch before the real take.
