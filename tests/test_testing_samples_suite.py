"""
Phase 1 exit check (Victory Bible, Wed Jul 23): run all 15 testing_samples/
claims through the local pipeline and confirm >=13/15 adjudicate without
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


def test_at_least_thirteen_of_fifteen_pass(pipeline):
    # 16th fixture added 2026-07-25: CLM-INDIA-2026-REIMB01, a genuine
    # reimbursement-flow claim (is_cashless: false, no preauth_number) closing
    # the coverage gap where all prior 15 fixtures defaulted to is_cashless
    # unset — see CODING_AGENT_BRIEF.md Task 3.
    assert len(SAMPLE_FILES) == 16, "expected exactly 16 testing_samples fixtures"
    passed = 0
    for sample_path in SAMPLE_FILES:
        claim = json.loads(Path(sample_path).read_text())
        try:
            result = pipeline.adjudicate(claim, db_session=None)
            if not result.get("error") and result.get("status") in ("SETTLED", "HITL_PENDING"):
                passed += 1
        except Exception:
            pass
    assert passed >= 13, f"only {passed}/16 claims adjudicated cleanly, need >=13"
