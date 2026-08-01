#!/usr/bin/env python3
"""
Seed script — loads fixture data (policies, clauses, members, providers)
into PostgreSQL so the UI and demo endpoints have real reference data.

Run inside the claims_api container:
    python scripts/seed_db.py

Or from the host via:
    docker exec -i claims_api python scripts/seed_db.py
"""

import json
import os
import sys
import uuid
from pathlib import Path

import psycopg2
from psycopg2.extras import Json, execute_values

# ── Connection ────────────────────────────────────────────────────────────────
DATABASE_URL = os.environ.get(
    "DATABASE_URL",
    "postgresql://claims_admin:claimspass@postgres:5432/claims_engine",
)

# Strip asyncpg prefix if present
db_url = DATABASE_URL.replace("postgresql+asyncpg://", "postgresql://")

# ── Fixture paths ─────────────────────────────────────────────────────────────
BASE = Path(__file__).parent.parent
POLICIES_FILE  = BASE / "tests/fixtures/sample_policies/policies.json"
CLAUSES_FILE   = BASE / "tests/fixtures/sample_policies/clauses.json"
MEMBERS_FILE   = BASE / "tests/fixtures/sample_claims/members.json"
PROVIDERS_FILE = BASE / "tests/fixtures/sample_claims/providers.json"


def connect():
    return psycopg2.connect(db_url)


def seed_policies(cur, policies: list) -> int:
    inserted = 0
    for p in policies:
        cur.execute(
            """
            INSERT INTO policies (
                id, policy_number, policy_name, carrier_name,
                tier, market_region, currency,
                effective_date, termination_date, annual_limit,
                individual_deductible, family_deductible,
                oop_max_individual, oop_max_family,
                outpatient_copay_pct, outpatient_copay_max,
                inpatient_copay_flat, inpatient_copay_annual_max,
                pharmacy_copay_pct, diagnostic_copay_pct,
                room_rent_limit_type, room_rent_daily_limit,
                ped_waiting_period_months, maternity_waiting_period_months,
                network_name,
                requires_preauth_inpatient, requires_preauth_daycare,
                status, benefit_summary
            ) VALUES (
                %s, %s, %s, %s,
                %s, %s, %s,
                %s, %s, %s,
                %s, %s,
                %s, %s,
                %s, %s,
                %s, %s,
                %s, %s,
                %s, %s,
                %s, %s,
                %s,
                %s, %s,
                'ACTIVE', %s
            )
            ON CONFLICT (policy_number) DO UPDATE SET
                policy_name  = EXCLUDED.policy_name,
                benefit_summary = EXCLUDED.benefit_summary,
                updated_at   = NOW()
            """,
            (
                p["id"],
                p["policy_number"],
                p["policy_name"],
                p["carrier_name"],
                p["tier"],
                p["market_region"],
                p["currency"],
                p["effective_date"],
                p.get("termination_date"),
                p["annual_limit"],
                p.get("individual_deductible", 0),
                p.get("family_deductible", 0),
                p.get("oop_max_individual", 0),
                p.get("oop_max_family", 0),
                p.get("outpatient_copay_pct", 20),
                p.get("outpatient_copay_max", 0),
                p.get("inpatient_copay_flat", 0),
                p.get("inpatient_copay_annual_max", 0),
                p.get("pharmacy_copay_pct", 30),
                p.get("diagnostic_copay_pct", 20),
                p.get("room_rent_limit_type", "ANY"),
                p.get("room_rent_daily_limit", 0),
                p.get("ped_waiting_period_months", 6),
                p.get("maternity_waiting_period_months", 24),
                p.get("network_name", "STANDARD"),
                p.get("requires_preauth_inpatient", True),
                p.get("requires_preauth_daycare", True),
                Json(p.get("benefit_summary")),
            ),
        )
        inserted += 1
    return inserted


def seed_clauses(cur, clauses_map: dict) -> int:
    inserted = 0
    for policy_id, clause_list in clauses_map.items():
        for c in clause_list:
            cur.execute(
                """
                INSERT INTO policy_clauses (
                    id, policy_id, clause_type, section_reference, title,
                    full_text, structured_data, applicable_claim_types
                ) VALUES (
                    %s, %s, %s, %s, %s,
                    %s, %s, %s
                )
                ON CONFLICT DO NOTHING
                """,
                (
                    str(uuid.uuid4()),
                    policy_id,
                    c["clause_type"],
                    c.get("section_reference", ""),
                    c["title"],
                    c["full_text"],
                    Json(c.get("structured_data", {})),
                    Json(c.get("applicable_claim_types")),
                ),
            )
            inserted += 1
    return inserted


def seed_members(cur, members: list, policies: list) -> int:
    # Build policy_id → id map from fixture (already have UUIDs in policies list)
    inserted = 0
    for m in members:
        # Convert dob field name
        dob = m.get("dob") or m.get("date_of_birth")
        coverage_start = m.get("coverage_start")
        cur.execute(
            """
            INSERT INTO members (
                id, member_number, emirates_id, first_name, last_name,
                date_of_birth, gender, nationality,
                policy_id, group_number, market_region,
                deductible_met, oop_met, inpatient_copay_ytd,
                coverage_start, is_active
            ) VALUES (
                %s, %s, %s, %s, %s,
                %s, %s, %s,
                %s, %s, %s,
                %s, %s, %s,
                %s, TRUE
            )
            ON CONFLICT (member_number) DO UPDATE SET
                deductible_met     = EXCLUDED.deductible_met,
                oop_met            = EXCLUDED.oop_met,
                inpatient_copay_ytd = EXCLUDED.inpatient_copay_ytd,
                updated_at         = NOW()
            """,
            (
                str(uuid.uuid4()),
                m["member_number"],
                m.get("emirates_id"),
                m["first_name"],
                m["last_name"],
                dob,
                m.get("gender", "UNKNOWN"),
                m.get("nationality"),
                m.get("policy_id"),
                m.get("group_number"),
                m.get("market_region", "UAE"),
                m.get("deductible_met", 0),
                m.get("oop_met", 0),
                m.get("inpatient_copay_ytd", 0),
                coverage_start,
            ),
        )
        inserted += 1
    return inserted


def seed_providers(cur, providers: list) -> int:
    inserted = 0
    for p in providers:
        cur.execute(
            """
            INSERT INTO providers (
                id, provider_code, name, facility_type,
                city, emirate_state, country, market_region,
                network_tier, is_coe, fee_schedule, is_active
            ) VALUES (
                %s, %s, %s, %s,
                %s, %s, %s, %s,
                %s, %s, %s, TRUE
            )
            ON CONFLICT (provider_code) DO UPDATE SET
                name         = EXCLUDED.name,
                fee_schedule = EXCLUDED.fee_schedule
            """,
            (
                str(uuid.uuid4()),
                p["provider_code"],
                p["name"],
                p.get("facility_type", "HOSPITAL"),
                p.get("city", ""),
                p.get("emirate_state", ""),
                p.get("country", ""),
                p.get("market_region", "UAE"),
                p.get("network_tier", "NETWORK"),
                p.get("is_coe", False),
                Json(p.get("fee_schedule", {})),
            ),
        )
        inserted += 1
    return inserted


def main():
    print("=== Claims Engine — Database Seed ===\n")

    # Load fixtures
    policies  = json.loads(POLICIES_FILE.read_text())
    clauses   = json.loads(CLAUSES_FILE.read_text())
    members   = json.loads(MEMBERS_FILE.read_text())
    providers = json.loads(PROVIDERS_FILE.read_text())

    print(f"Fixtures loaded:")
    print(f"  Policies  : {len(policies)}")
    print(f"  Clause sets: {len(clauses)} policies with clauses")
    print(f"  Members   : {len(members)}")
    print(f"  Providers : {len(providers)}\n")

    conn = connect()
    try:
        with conn:
            with conn.cursor() as cur:
                n = seed_policies(cur, policies)
                print(f"✓ Policies   : {n} upserted")

                n = seed_clauses(cur, clauses)
                print(f"✓ Clauses    : {n} upserted")

                n = seed_members(cur, members, policies)
                print(f"✓ Members    : {n} upserted")

                n = seed_providers(cur, providers)
                print(f"✓ Providers  : {n} upserted")

        # Verify
        conn2 = connect()
        with conn2:
            with conn2.cursor() as cur:
                cur.execute("SELECT COUNT(*) FROM policies")
                p_count = cur.fetchone()[0]
                cur.execute("SELECT COUNT(*) FROM policy_clauses")
                c_count = cur.fetchone()[0]
                cur.execute("SELECT COUNT(*) FROM members")
                m_count = cur.fetchone()[0]
                cur.execute("SELECT COUNT(*) FROM providers")
                prov_count = cur.fetchone()[0]
        conn2.close()

        print(f"\n=== Verification ===")
        print(f"  policies        : {p_count}")
        print(f"  policy_clauses  : {c_count}")
        print(f"  members         : {m_count}")
        print(f"  providers       : {prov_count}")
        print("\n✅ Seed complete — UI should now show real data!")

    except Exception as e:
        print(f"\n❌ Error: {e}", file=sys.stderr)
        raise
    finally:
        conn.close()


if __name__ == "__main__":
    main()
