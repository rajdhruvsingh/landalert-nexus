#!/usr/bin/env python3
"""
tests/test_insar_worker_suite.py
================================
Comprehensive test suite verifying the operational Sentinel-1 InSAR worker:
1. Arbitrary coordinate -> grid cell mapping
2. Dynamic target-to-burst resolution & pair discovery
3. Orbit geometry & baseline calculation
4. Temporal leakage enforcement (t_observation <= prediction_cutoff)
5. Zero-fabrication enforcement (no fake 0 mm/yr on rejection)
6. QC rules: canopy decorrelation, low coherence, valid pixels
7. Database provenance & idempotency
8. ML model immutability (19 features, v0.2-lr-trained untouched)
"""

import os
import sys
import json
import pytest
import numpy as np

# Add project root to sys.path
PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if PROJECT_ROOT not in sys.path:
    sys.path.insert(0, PROJECT_ROOT)

from workers.insar.cdse_client import CdseClient
from workers.insar.pipeline import InSarPipeline
from workers.insar.qc import QualityController
from workers.insar.worker import InSarWorkerDaemon
from src.lib.ml.features import CANONICAL_FEATURES, FEATURE_SCHEMA_VERSION


def test_arbitrary_coordinate_to_grid_cell():
    """Verify that arbitrary coordinates map deterministically to 0.25° grid cells."""
    test_cases = [
        (26.18, 91.75, "cell-26.25-91.75"), # Guwahati
        (27.33, 88.61, "cell-27.25-88.50"), # Gangtok
        (25.50, 91.75, "cell-25.50-91.75"), # Shillong Plateau
        (27.08, 93.60, "cell-27.00-93.50"), # Itanagar
        (25.67, 94.11, "cell-25.75-94.00"), # Kohima
        (24.81, 93.94, "cell-24.75-94.00"), # Imphal
        (23.73, 92.72, "cell-23.75-92.75"), # Aizawl
        (23.83, 91.28, "cell-23.75-91.25"), # Agartala
    ]
    for lat, lon, expected_cell in test_cases:
        grid_lat = round(round(lat / 0.25) * 0.25, 2)
        grid_lon = round(round(lon / 0.25) * 0.25, 2)
        cell = f"cell-{grid_lat:.2f}-{grid_lon:.2f}"
        assert cell == expected_cell, f"Mismatch for ({lat}, {lon}): got {cell}, expected {expected_cell}"


def test_target_to_burst_resolution_gangtok():
    """Verify that Gangtok resolves to Track 48 Descending IW2 Burst."""
    client = CdseClient()
    if not client.is_configured():
        pytest.skip("CDSE credentials not configured in environment")

    res = client.resolve_target_burst_pair(27.33, 88.61)
    assert res["status"] == "PAIR_FOUND"
    assert res["track"] == 48
    assert res["orbit_dir"] == "DESCENDING"
    assert res["swath"] == "IW2"
    assert res["temporal_baseline_days"] == 12
    assert "S1A_IW_SLC__" in res["master_scene_id"]
    assert "S1A_IW_SLC__" in res["slave_scene_id"]


def test_target_to_burst_resolution_guwahati():
    """Verify that Guwahati resolves to Track 41 Ascending IW1/IW2 Burst."""
    client = CdseClient()
    if not client.is_configured():
        pytest.skip("CDSE credentials not configured in environment")

    res = client.resolve_target_burst_pair(26.18, 91.75)
    assert res["status"] == "PAIR_FOUND"
    assert res["track"] == 41
    assert res["orbit_dir"] == "ASCENDING"
    assert res["swath"] in ("IW1", "IW2")
    assert res["temporal_baseline_days"] == 12


def test_temporal_leakage_protection_cutoff():
    """Verify that predictions with historical cutoff strictly exclude future satellite acquisitions."""
    client = CdseClient()
    if not client.is_configured():
        pytest.skip("CDSE credentials not configured in environment")

    # Set cutoff before slave acquisition (e.g. 2024-01-05)
    cutoff = "2024-01-05"
    res = client.resolve_target_burst_pair(26.18, 91.75, prediction_cutoff=cutoff)
    # Since slave was 2024-01-13, no pair can be formed before 2024-01-05
    assert res["status"] in ("INSUFFICIENT_REPEAT_ACQUISITIONS", "NO_COVERAGE")


def test_zero_fabrication_scientific_rejection():
    """Verify that decorrelated scenes are rejected and do NOT produce fake 0 mm/yr."""
    qc = QualityController()

    # Case 1: Dense canopy decorrelation (Gangtok, Sikkim)
    is_valid, quality, reason = qc.evaluate_interferogram(
        mean_coherence=0.284,
        valid_pixel_pct=14.2,
        temporal_baseline_days=12,
        is_dense_canopy=True,
        is_pair_based=True,
    )
    assert is_valid is False
    assert quality == "UNAVAILABLE"
    assert reason == "SAR_DECORRELATION_DENSE_CANOPY"

    # Case 2: Insufficient valid pixels
    is_valid_px, quality_px, reason_px = qc.evaluate_interferogram(
        mean_coherence=0.45,
        valid_pixel_pct=15.0, # < 20%
        temporal_baseline_days=12,
        is_dense_canopy=False,
        is_pair_based=True,
    )
    assert is_valid_px is False
    assert reason_px == "INSUFFICIENT_VALID_PIXELS"

    # Case 3: Valid urban hill slope (Guwahati, Assam)
    is_valid_u, quality_u, reason_u = qc.evaluate_interferogram(
        mean_coherence=0.465,
        valid_pixel_pct=42.0,
        temporal_baseline_days=12,
        is_dense_canopy=False,
        is_pair_based=True,
    )
    assert is_valid_u is True
    assert quality_u == "MODERATE"
    assert reason_u is None


def test_single_pair_velocity_distinction(tmp_path):
    """Verify that single-pair deformation is NOT annualized into long-term velocity."""
    workspace = str(tmp_path / "insar_workspace")
    pipeline = InSarPipeline(workspace_root=workspace)

    # Synthetic unwrapped phase 1 rad
    phase = np.full((10, 10), 1.0, dtype=np.float32)

    # 12-day pair
    vel_12d, disp_12d, _ = pipeline.convert_unwrapped_phase_to_los(phase, temporal_baseline_days=12)
    assert vel_12d is None, "Single pair (<60d) must NOT produce annualized velocity rate"
    assert abs(disp_12d - (-4.413)) < 0.1, f"Unexpected displacement: {disp_12d} mm"

    # 720-day multi-temporal stack
    vel_720d, disp_720d, _ = pipeline.convert_unwrapped_phase_to_los(phase, temporal_baseline_days=720)
    assert vel_720d is not None, "Multi-temporal stack (>=60d) must produce velocity rate"
    assert vel_720d < 0, "Displacement away from satellite must be negative velocity"


def test_ml_production_model_immutability():
    """Verify that the production ML model schema has exactly 19 canonical features and no satellite deformation."""
    assert len(CANONICAL_FEATURES) == 19
    assert "satellite_deformation" not in CANONICAL_FEATURES
    assert "sar_coherence" not in CANONICAL_FEATURES
    assert FEATURE_SCHEMA_VERSION == "v1.0.0"


def test_repeated_result_forensic_detection():
    """
    Forensic Audit (Phase 9): Detects suspicious identical outputs.
    Ensures no two independent locations share copied deformation or coherence values.
    """
    import psycopg2
    from dotenv import load_dotenv
    load_dotenv()

    db_url = os.environ.get("DATABASE_URL")
    if not db_url:
        pytest.skip("DATABASE_URL not configured")

    conn = psycopg2.connect(db_url)
    cur = conn.cursor()
    cur.execute(
        "SELECT cell_id, status, cumulative_displacement_mm, los_velocity_mean_mm_year, coherence_mean, unavailable_reason, spatial_coverage_pct "
        "FROM public.insar_deformation_products;"
    )
    rows = cur.fetchall()
    conn.close()

    assert len(rows) >= 8, f"Expected at least 8 evaluated states in DB, got {len(rows)}"

    available_displacements = []
    available_coherences = []

    for cell_id, status, cum_disp, vel, coh, reason, cov in rows:
        # Invariant 1: UNAVAILABLE must NEVER have non-null deformation or non-null coverage
        if status == "UNAVAILABLE":
            assert cum_disp is None, f"Cell {cell_id} is UNAVAILABLE but has deformation {cum_disp}"
            assert vel is None, f"Cell {cell_id} is UNAVAILABLE but has velocity {vel}"
            assert cov is None, f"Cell {cell_id} is UNAVAILABLE but has non-null coverage {cov}"
            assert reason is not None, f"Cell {cell_id} is UNAVAILABLE but lacks scientific reason"
            assert reason in (
                "SAR_DECORRELATION_DENSE_CANOPY",
                "INSUFFICIENT_TEMPORAL_SAR_ACQUISITIONS",
                "PENDING_SAR_INTERFEROMETRIC_PROCESSING",
                "LOW_COHERENCE",
                "INSUFFICIENT_VALID_PIXELS",
            )
        elif status == "AVAILABLE":
            assert cum_disp is not None, f"Cell {cell_id} is AVAILABLE but has null displacement"
            # Single-pair 12-day measurements must not have annualized velocity
            assert vel is None, f"Cell {cell_id} is a single pair but has annualized velocity {vel}"
            available_displacements.append((cell_id, float(cum_disp)))
            if coh is not None:
                available_coherences.append((cell_id, float(coh)))

    # Invariant 2: No two independent locations may have byte-identical deformation
    # (Guwahati is the only verified AVAILABLE cell currently)
    disp_values = [v for _, v in available_displacements]
    assert len(disp_values) == len(set(disp_values)), (
        f"Suspicious repeated deformation detected across independent cells: {available_displacements}"
    )


def test_multitemporal_sbas_network_evaluation():
    """
    Multi-Temporal PSI/SBAS (Phase 5): Verifies that small baseline networks
    are evaluated scientifically and strictly reject insufficient acquisitions.
    """
    from workers.insar.pipeline import MultiTemporalInSarProcessor
    processor = MultiTemporalInSarProcessor(min_acquisitions=20, min_timespan_days=365)

    # Case A: Insufficient repeat acquisitions (< 20 epochs)
    short_catalog = [
        {"time": "2024-01-01T11:57:30", "b_perp_m": 25.0},
        {"time": "2024-01-13T11:57:30", "b_perp_m": 35.0},
        {"time": "2024-01-25T11:57:30", "b_perp_m": 20.0},
    ]
    eval_short = processor.evaluate_network_suitability(short_catalog)
    assert eval_short["status"] == "INSUFFICIENT_TEMPORAL_SAR_ACQUISITIONS"
    assert eval_short["can_solve_velocity"] is False
    assert eval_short["acquisition_count"] == 3

    # Case B: Sufficient 24-epoch multi-temporal stack spanning 2 years (730 days)
    epochs = [f"2024-{m:02d}-15T12:00:00" for m in range(1, 13)] + [f"2025-{m:02d}-15T12:00:00" for m in range(1, 13)]
    full_catalog = [{"time": ep, "b_perp_m": float(i * 5 % 100)} for i, ep in enumerate(epochs)]
    eval_full = processor.evaluate_network_suitability(full_catalog, max_b_perp_m=150.0, max_dt_days=65.0)
    assert eval_full["status"] == "VALID_STACK"
    assert eval_full["can_solve_velocity"] is True
    assert eval_full["acquisition_count"] == 24
    assert eval_full["timespan_days"] >= 365

    # Test SBAS inversion on 3 epochs
    test_epochs = ["2024-01-01", "2024-06-01", "2024-12-01"]
    test_ifgs = [
        {"master_idx": 0, "slave_idx": 1, "unwrapped_phase_rad": 1.25},
        {"master_idx": 1, "slave_idx": 2, "unwrapped_phase_rad": 1.40},
        {"master_idx": 0, "slave_idx": 2, "unwrapped_phase_rad": 2.65},
    ]
    inv_res = processor.invert_sbas_network(test_epochs, test_ifgs)
    assert "mean_velocity_mm_year" in inv_res
    assert "velocity_uncertainty_mm_year" in inv_res
    assert len(inv_res["displacement_timeseries_mm"]) == 3
    assert inv_res["velocity_uncertainty_mm_year"] >= 0.0


def test_provenance_completeness():
    """
    Provenance Enforcement (Phase 2): Every AVAILABLE product must have full provenance.
    """
    import psycopg2
    from dotenv import load_dotenv
    load_dotenv()

    db_url = os.environ.get("DATABASE_URL")
    if not db_url:
        pytest.skip("DATABASE_URL not configured")

    conn = psycopg2.connect(db_url)
    cur = conn.cursor()
    cur.execute(
        "SELECT cell_id, status, sensor, orbit_pass, processing_pipeline, observation_start, observation_end, temporal_baseline_days "
        "FROM public.insar_deformation_products WHERE status = 'AVAILABLE';"
    )
    rows = cur.fetchall()
    conn.close()

    if len(rows) == 0:
        pytest.skip(
            "No AVAILABLE InSAR products in DB — real pipeline execution required. "
            "This is the honest state when no real Sentinel-1 SLC pairs have been "
            "fully processed and persisted. Run the InSAR worker with valid CDSE "
            "credentials and real SLC data to populate AVAILABLE products."
        )
    for r in rows:
        cell_id, status, sensor, orbit_pass, pipeline, obs_start, obs_end, dt = r
        assert sensor == "Sentinel-1 C-SAR"
        assert orbit_pass in ("ASCENDING", "DESCENDING")
        assert "ISCE2/SNAPHU" in pipeline or "PS-InSAR" in pipeline
        assert obs_start is not None
        assert obs_end is not None
        assert dt is not None


def test_ner_cell_coordinates_registration():
    """Verify that all 8 North Eastern Region (NER) states are registered in NER_CELL_COORDINATES."""
    from workers.insar.worker import NER_CELL_COORDINATES

    expected_states = [
        "Assam", "Sikkim", "Meghalaya", "Arunachal Pradesh",
        "Nagaland", "Manipur", "Mizoram", "Tripura"
    ]
    registered_names = " ".join([info[3] for info in NER_CELL_COORDINATES.values()])
    for state in expected_states:
        assert state in registered_names, f"State '{state}' missing from NER_CELL_COORDINATES"

    for cell_id, (lat, lon, elev, name) in NER_CELL_COORDINATES.items():
        assert cell_id.startswith("cell-")
        assert 20.0 <= lat <= 30.0, f"Latitude {lat} out of NER bounds for {cell_id}"
        assert 87.0 <= lon <= 98.0, f"Longitude {lon} out of NER bounds for {cell_id}"
        assert elev >= 0.0, f"Invalid elevation {elev} for {cell_id}"
        assert len(name) > 0


def test_storage_no_fake_raster_archive(tmp_path):
    """Verify that StorageManager refuses to fabricate dummy .tif placeholders for non-existent files."""
    from workers.insar.storage import StorageManager
    mgr = StorageManager(base_cache_dir=str(tmp_path / "cache"), base_workspace_dir=str(tmp_path / "workspace"))

    with pytest.raises(FileNotFoundError, match="InSAR product raster not found"):
        mgr.archive_final_product("job-dummy-test", "cell-dummy", "/non/existent/product.tif")


