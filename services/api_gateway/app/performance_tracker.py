"""
Performance Tracker
===================
Tracks timing for each stage of the claims processing pipeline.
Stores last 100 performance metrics in memory for analysis.
"""
import time
import threading
from collections import deque
from typing import Dict, Optional, List
from dataclasses import dataclass, field, asdict
from datetime import datetime


@dataclass
class PerformanceMetrics:
    """Performance metrics for a single claim processing run."""
    claim_reference: str
    start_time: float
    end_time: float = 0.0
    total_time: float = 0.0

    # Stage timings
    ocr_time: float = 0.0
    rules_engine_time: float = 0.0
    llm_primary_time: float = 0.0
    llm_secondary_time: float = 0.0
    llm_parallel_speedup: float = 1.0
    settlement_time: float = 0.0
    db_time: float = 0.0

    # Metadata
    claim_type: str = ""
    market_region: str = ""
    dual_agent_used: bool = False
    parallel_llm_used: bool = False
    ocr_cached: bool = False

    # Current stage tracking
    _stage_start: float = field(default=0.0, repr=False)
    _current_stage: str = field(default="", repr=False)

    def to_dict(self) -> dict:
        """Convert to dictionary."""
        return {
            'claim_reference': self.claim_reference,
            'total_time': round(self.total_time, 2),
            'breakdown': {
                'ocr': round(self.ocr_time, 2),
                'rules_engine': round(self.rules_engine_time, 2),
                'llm_primary': round(self.llm_primary_time, 2),
                'llm_secondary': round(self.llm_secondary_time, 2),
                'settlement': round(self.settlement_time, 2),
                'database': round(self.db_time, 2),
            },
            'optimizations': {
                'parallel_llm_used': self.parallel_llm_used,
                'parallel_speedup': round(self.llm_parallel_speedup, 1),
                'ocr_cached': self.ocr_cached,
                'dual_agent_used': self.dual_agent_used,
            },
            'metadata': {
                'claim_type': self.claim_type,
                'market_region': self.market_region,
                'timestamp': datetime.fromtimestamp(self.start_time).isoformat(),
            }
        }


class PerformanceTracker:
    """
    Thread-safe performance tracking for claims pipeline.
    Stores last 100 metrics in memory.
    """

    def __init__(self, max_history: int = 100):
        self.max_history = max_history
        self._history: deque = deque(maxlen=max_history)
        self._lock = threading.Lock()
        self._current_metrics: Dict[str, PerformanceMetrics] = {}

    def start(self, claim_reference: str, claim_type: str = "", market_region: str = "") -> PerformanceMetrics:
        """Start tracking a new claim processing run."""
        metrics = PerformanceMetrics(
            claim_reference=claim_reference,
            start_time=time.perf_counter(),
            claim_type=claim_type,
            market_region=market_region
        )

        with self._lock:
            self._current_metrics[claim_reference] = metrics

        return metrics

    def start_stage(self, claim_reference: str, stage: str):
        """Mark the start of a pipeline stage."""
        with self._lock:
            if claim_reference in self._current_metrics:
                metrics = self._current_metrics[claim_reference]
                metrics._current_stage = stage
                metrics._stage_start = time.perf_counter()

    def end_stage(self, claim_reference: str, stage: str):
        """Mark the end of a pipeline stage."""
        with self._lock:
            if claim_reference not in self._current_metrics:
                return

            metrics = self._current_metrics[claim_reference]
            if metrics._stage_start == 0:
                return

            elapsed = time.perf_counter() - metrics._stage_start

            # Map stage to metric field
            stage_map = {
                'ocr': 'ocr_time',
                'rules_engine': 'rules_engine_time',
                'llm_primary': 'llm_primary_time',
                'llm_secondary': 'llm_secondary_time',
                'settlement': 'settlement_time',
                'database': 'db_time',
            }

            if stage in stage_map:
                setattr(metrics, stage_map[stage], elapsed)

            metrics._stage_start = 0
            metrics._current_stage = ""

    def set_metadata(self, claim_reference: str, **kwargs):
        """Set metadata fields on the metrics."""
        with self._lock:
            if claim_reference in self._current_metrics:
                metrics = self._current_metrics[claim_reference]
                for key, value in kwargs.items():
                    if hasattr(metrics, key):
                        setattr(metrics, key, value)

    def finish(self, claim_reference: str) -> Optional[PerformanceMetrics]:
        """Finish tracking and store in history."""
        with self._lock:
            if claim_reference not in self._current_metrics:
                return None

            metrics = self._current_metrics[claim_reference]
            metrics.end_time = time.perf_counter()
            metrics.total_time = metrics.end_time - metrics.start_time

            # Store in history
            self._history.append(metrics)

            # Remove from current tracking
            del self._current_metrics[claim_reference]

            return metrics

    def get_history(self, limit: int = None) -> List[dict]:
        """Get recent performance metrics."""
        with self._lock:
            history = list(self._history)
            if limit:
                history = history[-limit:]
            return [m.to_dict() for m in history]

    def get_stats(self) -> dict:
        """Get aggregate statistics."""
        with self._lock:
            if not self._history:
                return {
                    'total_claims': 0,
                    'average_time': 0,
                    'min_time': 0,
                    'max_time': 0,
                }

            times = [m.total_time for m in self._history]
            parallel_count = sum(1 for m in self._history if m.parallel_llm_used)
            cached_count = sum(1 for m in self._history if m.ocr_cached)

            return {
                'total_claims': len(self._history),
                'average_time': round(sum(times) / len(times), 2),
                'min_time': round(min(times), 2),
                'max_time': round(max(times), 2),
                'optimizations': {
                    'parallel_llm_used': parallel_count,
                    'ocr_cached': cached_count,
                },
                'average_breakdown': {
                    'ocr': round(sum(m.ocr_time for m in self._history) / len(self._history), 2),
                    'rules_engine': round(sum(m.rules_engine_time for m in self._history) / len(self._history), 2),
                    'llm_primary': round(sum(m.llm_primary_time for m in self._history) / len(self._history), 2),
                    'llm_secondary': round(sum(m.llm_secondary_time for m in self._history) / len(self._history), 2),
                    'settlement': round(sum(m.settlement_time for m in self._history) / len(self._history), 2),
                    'database': round(sum(m.db_time for m in self._history) / len(self._history), 2),
                }
            }


# Global tracker instance
_tracker = PerformanceTracker()


def get_tracker() -> PerformanceTracker:
    """Get the global performance tracker instance."""
    return _tracker
