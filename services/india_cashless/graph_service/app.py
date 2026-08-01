"""
Graph Service — India Cashless Claim Event Trail + RAG Explainability
=====================================================================
Ported from claimaura/services/graph-service/app.py with:
  - Multi-market support (INDIA primary, GCC secondary)
  - Kafka consumer for claim-events topic (optional)
  - Market-aware natural language explanation via /query/{claim_id}
  - Persistent graph via /data/graph.json (Phase 3: migrate to PostgreSQL)
"""
from __future__ import annotations

import datetime
import json
import os
import threading
from typing import Any, Dict, List, Optional

import networkx as nx
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

app = FastAPI(title="India Cashless Graph Service", version="1.0.0")

G = nx.DiGraph()

_MARKET_REGULATORY_BODY = {
    "UAE": "DHA/DOH", "KSA": "CCHI", "INDIA": "IRDAI",
    "BAHRAIN": "NHRA", "OMAN": "MOH Oman", "QATAR": "MOPH", "KUWAIT": "MOH Kuwait",
}
_MARKET_CURRENCY = {
    "UAE": "AED", "KSA": "SAR", "INDIA": "INR",
    "BAHRAIN": "BHD", "OMAN": "OMR", "QATAR": "QAR", "KUWAIT": "KWD",
}


class Event(BaseModel):
    claim_id: str
    event_type: str
    data: Optional[Dict[str, Any]] = None
    timestamp: Optional[str] = None
    market_region: Optional[str] = None


def _process_event(claim_id: str, event_type: str, data: dict,
                   timestamp: str = None, market_region: str = "INDIA"):
    ts = timestamp or datetime.datetime.now(datetime.timezone.utc).replace(tzinfo=None).isoformat()
    if not G.has_node(claim_id):
        G.add_node(claim_id, type="Claim", created_at=ts, status="INITIAL",
                   market_region=market_region)

    event_node_id = f"event_{event_type}_{ts}_{claim_id}"
    G.add_node(event_node_id, type="Event", event_type=event_type,
               timestamp=ts, market_region=market_region, **(data or {}))
    G.add_edge(event_node_id, claim_id, relation="PART_OF")

    if data:
        if "patient_id" in data:
            pid = data["patient_id"]
            if not G.has_node(pid):
                G.add_node(pid, type="Patient")
            G.add_edge(claim_id, pid, relation="FOR_PATIENT")
        if "diagnosis" in data:
            for diag in data["diagnosis"]:
                did = f"diag_{diag['code']}"
                if not G.has_node(did):
                    G.add_node(did, type="Diagnosis", code=diag["code"],
                               display=diag.get("display", ""))
                G.add_edge(claim_id, did, relation="HAS_DIAGNOSIS")
        if "provider_code" in data:
            prov_id = f"provider_{data['provider_code']}"
            if not G.has_node(prov_id):
                G.add_node(prov_id, type="Provider",
                           code=data["provider_code"],
                           name=data.get("provider_name", ""))
            G.add_edge(claim_id, prov_id, relation="TREATED_AT")

    G.nodes[claim_id]["status"] = event_type
    G.nodes[claim_id]["last_updated"] = ts
    if market_region and market_region != "UNKNOWN":
        G.nodes[claim_id]["market_region"] = market_region
    _save_graph()


def _start_kafka_consumer():
    kafka_url = os.getenv("KAFKA_BOOTSTRAP_SERVERS", "").strip()
    if not kafka_url:
        print("[GraphService] KAFKA_BOOTSTRAP_SERVERS not set — Kafka consumer disabled")
        return

    def _consume():
        try:
            from confluent_kafka import Consumer, KafkaError
            conf = {"bootstrap.servers": kafka_url, "group.id": "graph-service-india",
                    "auto.offset.reset": "earliest", "enable.auto.commit": True}
            consumer = Consumer(conf)
            consumer.subscribe(["claim-events"])
            print(f"[GraphService] Kafka consumer started on {kafka_url}")
            while True:
                msg = consumer.poll(timeout=1.0)
                if msg is None:
                    continue
                if msg.error():
                    continue
                try:
                    event = json.loads(msg.value().decode("utf-8"))
                    _process_event(
                        claim_id=event.get("claim_id", "unknown"),
                        event_type=event.get("event_type", "UNKNOWN"),
                        data=event.get("data", {}),
                        timestamp=event.get("timestamp"),
                        market_region=event.get("market_region", "INDIA"),
                    )
                except Exception as exc:
                    print(f"[GraphService] Kafka message error: {exc}")
        except Exception as exc:
            print(f"[GraphService] Kafka consumer failed: {exc}")

    t = threading.Thread(target=_consume, daemon=True, name="kafka-graph-consumer")
    t.start()


@app.on_event("startup")
def load_graph():
    if os.path.exists("/data/graph.json"):
        try:
            with open("/data/graph.json") as f:
                global G
                G = nx.node_link_graph(json.load(f))
                print("[GraphService] Graph loaded from /data/graph.json")
        except Exception as exc:
            print(f"[GraphService] Failed to load graph: {exc}")
    _start_kafka_consumer()


def _save_graph():
    try:
        os.makedirs("/data", exist_ok=True)
        with open("/data/graph.json", "w") as f:
            json.dump(nx.node_link_data(G), f)
    except Exception as exc:
        print(f"[GraphService] Failed to save graph: {exc}")


@app.post("/event")
async def add_event(event: Event):
    _process_event(
        claim_id=event.claim_id,
        event_type=event.event_type,
        data=event.data,
        timestamp=event.timestamp,
        market_region=event.market_region or "INDIA",
    )
    return {"status": "success"}


@app.get("/graph/{claim_id}")
async def get_claim_graph(claim_id: str):
    if not G.has_node(claim_id):
        raise HTTPException(status_code=404, detail="Claim not found")
    nodes = {claim_id}
    edges = []
    for n in G.neighbors(claim_id):
        nodes.add(n)
        edges.append({"source": claim_id, "target": n,
                      "relation": G.edges[claim_id, n]["relation"]})
    for p in G.predecessors(claim_id):
        nodes.add(p)
        edges.append({"source": p, "target": claim_id,
                      "relation": G.edges[p, claim_id]["relation"]})
    return {"nodes": [{"id": n, **G.nodes[n]} for n in nodes], "edges": edges}


@app.get("/query/{claim_id}")
async def query_claim(claim_id: str):
    if not G.has_node(claim_id):
        raise HTTPException(status_code=404, detail="Claim not found")

    claim_node = G.nodes[claim_id]
    status = claim_node.get("status", "UNKNOWN")
    market = claim_node.get("market_region", "INDIA")
    currency = _MARKET_CURRENCY.get(market, "INR")
    regulator = _MARKET_REGULATORY_BODY.get(market, "IRDAI")

    events = sorted(
        [G.nodes[n] for n in G.predecessors(claim_id) if G.nodes[n].get("type") == "Event"],
        key=lambda x: x.get("timestamp", ""),
    )
    diagnoses = [
        G.nodes[n].get("display", G.nodes[n].get("code", ""))
        for n in G.neighbors(claim_id) if G.nodes[n].get("type") == "Diagnosis"
    ]
    providers = [
        G.nodes[n].get("name", G.nodes[n].get("code", ""))
        for n in G.neighbors(claim_id) if G.nodes[n].get("type") == "Provider"
    ]

    explanation = f"Claim {claim_id} [{market}] is currently in state '{status}'."
    if diagnoses:
        explanation += f" Diagnosis: {', '.join(d for d in diagnoses if d)}."
    if providers:
        explanation += f" Provider: {', '.join(p for p in providers if p)}."

    for event in events:
        etype = event.get("event_type", "")
        if etype in ("DOCUMENT_PROCESSED", "FHIR_EXTRACTED", "OCR_COMPLETED"):
            explanation += " Clinical document processed and structured into FHIR."
        elif etype == "CONSENT_CHECKED":
            valid = event.get("valid", True)
            explanation += f" ABDM patient consent {'verified' if valid else 'not found — claim blocked'}."
        elif etype == "RULES_EVALUATED":
            allowed = event.get("allowed", True)
            if not allowed:
                reasons = event.get("denial_reasons", [])
                reason_str = "; ".join(reasons) if reasons else "policy rule violation"
                explanation += f" Denied under {regulator} rules: {reason_str}."
            else:
                explanation += f" All {regulator} IRDAI business rules passed."
        elif etype == "FWA_SCORED":
            if event.get("is_anomaly"):
                explanation += " FWA anomaly detected — routed to manual review."
            else:
                explanation += " FWA check passed — no anomaly detected."
        elif etype == "SETTLEMENT_CALCULATED":
            amount = event.get("total_plan_payment", 0)
            if amount:
                explanation += f" Settlement calculated: {currency} {float(amount):,.2f}."
        elif etype == "HITL_ROUTED":
            reason = event.get("trigger", "review required")
            explanation += f" Routed to human review: {reason}."
        elif etype == "HITL_DECIDED":
            decision = event.get("decision", "decided")
            explanation += f" Human reviewer decision: {decision}."
        elif etype == "AUTO_APPROVED":
            nhcx_ref = event.get("nhcx_ref", "")
            explanation += f" Pre-authorization approved{' (NHCX ref: ' + nhcx_ref + ')' if nhcx_ref else ''}."
        elif etype == "NHCX_SUBMITTED":
            explanation += f" Submitted to NHCX (ref: {event.get('nhcx_ref', 'pending')})."
        elif etype == "DUPLICATE_DETECTED":
            explanation += f" Duplicate of claim {event.get('original_ref', 'unknown')}."
        elif etype == "REGULATORY_VIOLATION":
            clause = event.get("clause_ref", "unknown clause")
            explanation += f" {regulator} regulatory violation: {clause}."

    return {
        "claim_id": claim_id,
        "market_region": market,
        "status": status,
        "explanation": explanation,
        "event_trail": [e["event_type"] for e in events],
        "diagnoses": diagnoses,
        "providers": providers,
    }


@app.get("/health")
async def health():
    return {"status": "healthy", "nodes": G.number_of_nodes(), "edges": G.number_of_edges()}
