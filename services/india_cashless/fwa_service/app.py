"""
FWA Service — Fraud, Waste, and Abuse Detection
================================================
Isolation Forest ML model for anomaly scoring of India cashless claims.
Ported from claimaura/services/fwa-service/app.py.

Train the model:
    python train.py

The trained model is saved to models/iforest.pkl.
If no model exists, the service returns a safe default (is_anomaly=False)
so the pipeline is not blocked in development.
"""
from __future__ import annotations

import os
from typing import Optional

import numpy as np
from fastapi import FastAPI
from pydantic import BaseModel

app = FastAPI(title="FWA Service — India Cashless", version="1.0.0")

_clf = None
_MODEL_PATH = os.getenv("FWA_MODEL_PATH", "models/iforest.pkl")


def _load_model():
    global _clf
    if os.path.exists(_MODEL_PATH):
        try:
            import joblib
            _clf = joblib.load(_MODEL_PATH)
            print(f"[FWA] Model loaded from {_MODEL_PATH}")
        except Exception as exc:
            print(f"[FWA] Failed to load model: {exc}")
    else:
        print(f"[FWA] No model at {_MODEL_PATH} — using heuristic fallback")


@app.on_event("startup")
def startup():
    _load_model()


class ClaimFeatures(BaseModel):
    claim_amount: float
    days_since_inception: int
    number_of_diagnoses: int


@app.post("/score")
async def score_claim(features: ClaimFeatures):
    """
    Score a claim for FWA anomaly.
    Returns is_anomaly=True if the Isolation Forest flags the claim.
    Falls back to a simple heuristic if no model is trained.
    """
    if _clf is not None:
        try:
            data = np.array([[
                features.claim_amount,
                features.days_since_inception,
                features.number_of_diagnoses,
            ]])
            prediction = _clf.predict(data)
            anomaly_score = float(_clf.decision_function(data)[0])
            return {
                "is_anomaly": bool(prediction[0] == -1),
                "anomaly_score": anomaly_score,
                "model": "isolation_forest",
            }
        except Exception as exc:
            print(f"[FWA] Model inference failed: {exc}")

    # Heuristic fallback: flag if claim > INR 5L and < 30 days since inception
    is_anomaly = (
        features.claim_amount > 500_000
        and features.days_since_inception < 30
    )
    return {
        "is_anomaly": is_anomaly,
        "anomaly_score": -0.5 if is_anomaly else 0.1,
        "model": "heuristic_fallback",
    }


@app.get("/health")
async def health():
    return {"status": "healthy", "model_loaded": _clf is not None}
