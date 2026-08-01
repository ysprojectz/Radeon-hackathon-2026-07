#!/usr/bin/env bash
# Seeds the running demo stack with the testing_samples/ claims (India-only)
# so a judge sees real adjudication results immediately after bring-up,
# instead of an empty UI. Run after `docker compose up` reports api_gateway
# healthy.
#
# Uses the built-in default ADJUSTER demo account (services/api_gateway/app/
# user_store.py auto-seeds it on first startup — adjuster@claims-engine.local,
# password overridable via ADJUSTER_PASSWORD env var, defaults to Adjuster@2024!).
# ADJUSTER is a WRITE_ROLE and — unlike ADMIN — isn't in MFA_REQUIRED_ROLES, so a
# single login call is enough for this demo script.
#
# Usage: ./deploy/radeon/seed.sh [API_BASE_URL]
set -euo pipefail

API_BASE_URL="${1:-http://localhost:8080}"
DEMO_EMAIL="${ADJUSTER_EMAIL:-adjuster@claims-engine.local}"
DEMO_PASSWORD="${ADJUSTER_PASSWORD:-Adjuster@2024!}"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SAMPLES_DIR="$REPO_ROOT/testing_samples"

if [[ ! -d "$SAMPLES_DIR" ]]; then
  echo "testing_samples/ not found at $SAMPLES_DIR" >&2
  exit 1
fi

echo "Waiting for $API_BASE_URL/api/v1/health ..."
for i in $(seq 1 30); do
  if curl -sf "$API_BASE_URL/api/v1/health" > /dev/null 2>&1; then
    break
  fi
  sleep 2
done

echo "Logging in as $DEMO_EMAIL ..."
TOKEN=$(curl -sf -X POST "$API_BASE_URL/api/v1/auth/login" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  --data-urlencode "username=$DEMO_EMAIL" \
  --data-urlencode "password=$DEMO_PASSWORD" \
  | python3 -c "import json,sys; print(json.load(sys.stdin)['access_token'])")

if [[ -z "$TOKEN" ]]; then
  echo "Login failed — no access_token returned. Check ADJUSTER_PASSWORD matches the api_gateway container's env." >&2
  exit 1
fi

count=0
for f in "$SAMPLES_DIR"/*.json; do
  ref=$(python3 -c "import json,sys; print(json.load(open(sys.argv[1]))['claim_reference'])" "$f")
  echo "Submitting $ref ..."
  curl -sf -X POST "$API_BASE_URL/api/v1/claims" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $TOKEN" \
    --data @"$f" > /dev/null && count=$((count + 1)) || echo "  -> failed: $ref"
done

total=$(ls "$SAMPLES_DIR"/*.json 2>/dev/null | wc -l | tr -d ' ')
echo "Seeded $count/$total claims. Open the UI to view adjudication results."
