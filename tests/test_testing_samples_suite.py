"""
Phase 1 exit check (Victory Bible, Wed Jul 23): run all testing_samples/
claims through the local pipeline and confirm most adjudicate without
errors. Runs rules-engine + settlement only — LLM reasoning gracefully
degrades to rules-only when no provider is configured, which is the
expected state for CI (no GPU/cloud keys available there).
"""
import glob
import json
import os
from pathlib import Path

import pytest

os.environ.setdefault("LLM_ENABLED", "false")

from services.api_gateway.app.pipeline import ClaimPipeline

REPO_ROOT = Path(__file__).parent.parent
SAMPLE_FILES = sorted(glob.glob(str(REPO_ROOT / "testing_samples" / "*.json")))


@pytest.fixture(scope="module")
def pipeline():
    return ClaimPipeline()


@pytest.mark.parametrize("sample_path", SAMPLE_FILES, ids=[Path(p).stem for p in SAMPLE_FILES])
def test_sample_claim_adjudicates_without_error(pipeline, sample_path):
    claim = json.loads(Path(sample_path).read_text())
    result = pipeline.adjudicate(claim, db_session=None)
    assert not result.get("error"), f"{sample_path} failed: {result.get('error')}"
    assert result.get("status") in ("SETTLED", "HITL_PENDING"), (
        f"{sample_path} produced unexpected status: {result.get('status')}"
    )


def test_most_samples_pass(pipeline):
    # 2026-08-02: non-India (UAE/KSA) fixtures removed per the India-only
    # submission scope, leaving 10 India fixtures. Threshold scaled down
    # from the original 13/16 (81%) to keep the same tolerance.
    assert len(SAMPLE_FILES) == 10, "expected exactly 10 testing_samples fixtures"
    passed = 0
    for sample_path in SAMPLE_FILES:
        claim = json.loads(Path(sample_path).read_text())
        try:
            result = pipeline.adjudicate(claim, db_session=None)
            if not result.get("error") and result.get("status") in ("SETTLED", "HITL_PENDING"):
                passed += 1
        except Exception:
            pass
    assert passed >= 8, f"only {passed}/10 claims adjudicated cleanly, need >=8"
