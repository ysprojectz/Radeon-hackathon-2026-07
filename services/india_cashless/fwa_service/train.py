"""
FWA Model Training Script
=========================
Trains an Isolation Forest on synthetic India cashless claim data.
Run once to produce models/iforest.pkl before starting the FWA service.

Usage:
    python train.py

Replace the synthetic data with real India claim samples for production.
"""
import os
import numpy as np

os.makedirs("models", exist_ok=True)

# Synthetic training data: [claim_amount, days_since_inception, num_diagnoses]
rng = np.random.default_rng(42)
normal_claims = np.column_stack([
    rng.uniform(5_000, 200_000, 1000),   # claim amount INR
    rng.integers(30, 1000, 1000),         # days since inception
    rng.integers(1, 5, 1000),             # number of diagnoses
])
# Inject anomalies: very high amounts in first 30 days
anomalies = np.column_stack([
    rng.uniform(500_000, 2_000_000, 50),
    rng.integers(1, 30, 50),
    rng.integers(1, 10, 50),
])
X = np.vstack([normal_claims, anomalies])

from sklearn.ensemble import IsolationForest
import joblib

clf = IsolationForest(n_estimators=100, contamination=0.05, random_state=42)
clf.fit(X)
joblib.dump(clf, "models/iforest.pkl")
print("Model trained and saved to models/iforest.pkl")
print(f"Training samples: {len(X)} ({len(normal_claims)} normal, {len(anomalies)} anomalies)")
