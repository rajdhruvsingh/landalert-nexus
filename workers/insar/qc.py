"""
workers/insar/qc.py
===================
Scientific Quality Control (QC) for InSAR Ground Deformation Products.

Evaluates interferometric products against documented operational thresholds:
1. Mean Coherence threshold (>= 0.40).
2. Valid unwrapped pixel percentage (>= 20%).
3. Temporal baseline span (>= 60 days for linear rate inversion).
4. Minimum acquisition count (>= 3 epochs for time series).
5. Tropical canopy decorrelation detection (e.g. dense forests in Arunachal/Meghalaya).
"""

import logging
from typing import Dict, Any, Tuple, Optional

logger = logging.getLogger("insar_worker.qc")

MIN_COHERENCE_THRESHOLD = 0.40
HIGH_COHERENCE_THRESHOLD = 0.65
MIN_VALID_PIXEL_PCT = 20.0
MIN_TEMPORAL_BASELINE_DAYS = 60
MIN_ACQUISITION_COUNT = 3


class QualityController:
    @staticmethod
    def evaluate_interferogram(
        mean_coherence: float,
        valid_pixel_pct: float,
        temporal_baseline_days: int,
        is_dense_canopy: bool = False,
    ) -> Tuple[bool, str, Optional[str]]:
        """
        Validates whether an InSAR interferogram / displacement measurement meets scientific standards.
        Returns: (is_valid, quality_level, failure_reason)
        """
        # 1. Canopy decorrelation check
        if is_dense_canopy and mean_coherence < 0.35:
            logger.warning("QC_REJECT: Severe phase decorrelation due to dense subtropical canopy.")
            return False, "UNAVAILABLE", "SAR_DECORRELATION_DENSE_CANOPY"

        # 2. Minimum coherence check
        if mean_coherence < MIN_COHERENCE_THRESHOLD:
            logger.warning(
                f"QC_REJECT: Mean coherence {mean_coherence:.3f} below operational threshold {MIN_COHERENCE_THRESHOLD}."
            )
            return False, "UNAVAILABLE", "LOW_COHERENCE"

        # 3. Valid pixel coverage check
        if valid_pixel_pct < MIN_VALID_PIXEL_PCT:
            logger.warning(
                f"QC_REJECT: Valid pixel percentage {valid_pixel_pct:.1f}% below minimum {MIN_VALID_PIXEL_PCT}%."
            )
            return False, "UNAVAILABLE", "INSUFFICIENT_VALID_PIXELS"

        # 4. Temporal baseline check
        if temporal_baseline_days < MIN_TEMPORAL_BASELINE_DAYS:
            logger.warning(
                f"QC_REJECT: Temporal baseline {temporal_baseline_days} days insufficient for velocity rate."
            )
            return False, "LOW", "TEMPORAL_BASELINE_INSUFFICIENT"

        # Determine quality rating
        quality = "HIGH" if mean_coherence >= HIGH_COHERENCE_THRESHOLD else "MODERATE"
        return True, quality, None

    @staticmethod
    def evaluate_timeseries(
        acquisitions_count: int,
        timespan_days: int,
        mean_coherence: float,
    ) -> Tuple[bool, str]:
        """
        Validates multi-temporal epoch network for SBAS/PS displacement inversion.
        """
        if acquisitions_count < MIN_ACQUISITION_COUNT:
            return False, "INSUFFICIENT_ACQUISITIONS"
        if timespan_days < MIN_TEMPORAL_BASELINE_DAYS:
            return False, "TEMPORAL_BASELINE_INSUFFICIENT"
        if mean_coherence < MIN_COHERENCE_THRESHOLD:
            return False, "LOW_COHERENCE"
        return True, "VALID"
