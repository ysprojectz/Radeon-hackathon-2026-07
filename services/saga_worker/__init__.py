"""
Feature-flagged claim saga worker scaffold.

The synchronous claim intake path remains authoritative. This package provides
additive producer/worker primitives that can be enabled for Phase 2 saga
experiments without changing Kubernetes or breaking the current request flow.
"""

