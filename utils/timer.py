"""Small wall-clock timer for pipeline stage logging."""

from __future__ import annotations

import logging
from time import perf_counter

logger = logging.getLogger(__name__)


class Timer:
    """Logs the time since the previous :meth:`log` call, and in total."""

    def __init__(self, name: str = "timer"):
        self.name = name
        self.start = perf_counter()
        self.last = self.start

    def log(self, label: str) -> float:
        """Log elapsed time since the last call and return it in seconds."""
        now = perf_counter()
        elapsed = now - self.last
        self.last = now
        logger.info("%s took %.4f seconds", label, elapsed)
        return elapsed

    def total(self) -> float:
        """Log and return elapsed time since construction."""
        elapsed = perf_counter() - self.start
        logger.info("%s: total %.4f seconds", self.name, elapsed)
        return elapsed
