"""
tests/test_scientific_gate.py
==============================
Regression tests for:
1. Authoritative scientific gate enforcement (>= 200 real events required)
2. Model-version consistency (registry active model == actual inference model)
3. DB fallback semantics (preserves original model version and timestamp)
4. Scientific gate cannot be bypassed by PR-AUC, software gate, or status='validated'
5. scientifically_blocked models cannot be activated

These tests enforce invariants that MUST hold regardless of PR-AUC,
test passage, or software gate state.
"""

import os
import sys
import json
import unittest
from unittest.mock import MagicMock, patch, PropertyMock

# Ensure repo root is on path
sys.path.insert(0, os.path.abspath("."))


# ---------------------------------------------------------------------------
# Section 1: Scientific gate constants and count_real_rainfall_events
# ---------------------------------------------------------------------------

class TestScientificGateConstants(unittest.TestCase):
    """SCIENTIFIC_EVENT_GATE must be exactly 200 and must not be lowered."""

    def test_scientific_event_gate_value(self):
        from scripts.ml_registry import SCIENTIFIC_EVENT_GATE
        self.assertEqual(
            SCIENTIFIC_EVENT_GATE, 200,
            "SCIENTIFIC_EVENT_GATE must be exactly 200. "
            "Do NOT lower this value. It is the authoritative scientific production requirement."
        )

    def test_software_prauc_floor_value(self):
        from scripts.ml_registry import SOFTWARE_PRAUC_FLOOR
        # Floor must be non-zero (sanity check) but cannot override scientific gate
        self.assertGreater(SOFTWARE_PRAUC_FLOOR, 0.0)
        self.assertLess(SOFTWARE_PRAUC_FLOOR, 1.0)

    def test_scientific_gate_greater_than_current_event_count(self):
        """Current real event count (22) is below 200 — gate must be BLOCKED."""
        from scripts.ml_registry import SCIENTIFIC_EVENT_GATE
        CURRENT_REAL_EVENTS = 22  # forensically verified event count
        self.assertLess(
            CURRENT_REAL_EVENTS, SCIENTIFIC_EVENT_GATE,
            f"Real event count ({CURRENT_REAL_EVENTS}) is below gate ({SCIENTIFIC_EVENT_GATE}). "
            "Scientific gate must be BLOCKED."
        )


# ---------------------------------------------------------------------------
# Section 2: verify_model_candidate scientific gate logic (mocked DB)
# ---------------------------------------------------------------------------

class TestVerifyModelCandidateScientificGate(unittest.TestCase):
    """
    verify_model_candidate() must mark models 'scientifically_blocked'
    when event count < 200, even if the software gate (PR-AUC) passes.
    """

    def _make_mock_conn(self, event_count: int, pr_auc: float = 0.94,
                        artifact_path: str = "models/v0.2-lr-trained.json"):
        """Build a mock psycopg2 connection that returns the given parameters."""
        conn = MagicMock()
        cur = MagicMock()
        conn.cursor.return_value = cur

        # fetchone calls: first for the model row, second for COUNT(*) events
        cur.fetchone.side_effect = [
            (1, artifact_path, pr_auc, "candidate"),  # registry row
            (event_count,),                            # event count
        ]
        cur.connection = conn
        return conn, cur

    @patch("scripts.ml_registry.os.path.isfile", return_value=True)
    @patch("scripts.ml_registry.load_model_artifact")
    def test_scientific_gate_blocks_when_events_below_200(self, mock_load, mock_isfile):
        """Software gate passes, scientific gate must block."""
        mock_artifact = MagicMock()
        mock_artifact.weights = [0.0] * 19
        mock_load.return_value = mock_artifact

        conn, cur = self._make_mock_conn(event_count=22, pr_auc=0.9399)

        from scripts.ml_registry import verify_model_candidate
        # Patch get_db to avoid real DB call
        with patch("scripts.ml_registry.get_db", return_value=conn):
            # We call with explicit conn to use mock
            # Directly test the logic by calling with our mock conn
            passed, failures = verify_model_candidate("v0.3-lr-trained", conn=conn)

        self.assertFalse(passed, "Scientific gate must block when events < 200.")
        self.assertTrue(
            any("SCIENTIFIC GATE BLOCKED" in f for f in failures),
            f"Expected 'SCIENTIFIC GATE BLOCKED' in failures, got: {failures}"
        )

    @patch("scripts.ml_registry.os.path.isfile", return_value=True)
    @patch("scripts.ml_registry.load_model_artifact")
    def test_pr_auc_above_floor_does_not_override_scientific_gate(self, mock_load, mock_isfile):
        """PR-AUC = 0.9399 >> 0.25 CANNOT override the scientific gate."""
        mock_artifact = MagicMock()
        mock_artifact.weights = [0.0] * 19
        mock_load.return_value = mock_artifact

        conn, cur = self._make_mock_conn(event_count=22, pr_auc=0.9399)

        from scripts.ml_registry import verify_model_candidate, SOFTWARE_PRAUC_FLOOR
        with patch("scripts.ml_registry.get_db", return_value=conn):
            passed, failures = verify_model_candidate("v0.3-lr-trained", conn=conn)

        # PR-AUC is well above floor — software gate would pass
        self.assertGreater(0.9399, SOFTWARE_PRAUC_FLOOR)
        # But scientific gate blocks
        self.assertFalse(passed)

    @patch("scripts.ml_registry.os.path.isfile", return_value=True)
    @patch("scripts.ml_registry.load_model_artifact")
    def test_passes_when_events_at_or_above_200(self, mock_load, mock_isfile):
        """Both gates pass when event count >= 200 and artifact is valid."""
        mock_artifact = MagicMock()
        mock_artifact.weights = [0.0] * 19
        mock_load.return_value = mock_artifact

        conn, cur = self._make_mock_conn(event_count=200, pr_auc=0.70)

        from scripts.ml_registry import verify_model_candidate
        with patch("scripts.ml_registry.get_db", return_value=conn):
            passed, failures = verify_model_candidate("v-hypothetical", conn=conn)

        self.assertTrue(passed, f"Should pass at exactly 200 events. Failures: {failures}")

    def test_scientific_gate_is_not_just_prauc_check(self):
        """Confirm gate is event-count based, not metric based."""
        from scripts.ml_registry import SCIENTIFIC_EVENT_GATE
        # The gate constant must be an integer (event count), not a float (metric)
        self.assertIsInstance(SCIENTIFIC_EVENT_GATE, int)
        self.assertNotIsInstance(SCIENTIFIC_EVENT_GATE, float)


# ---------------------------------------------------------------------------
# Section 3: Registry state — v0.3 must be scientifically_blocked
# ---------------------------------------------------------------------------

class TestRegistryState(unittest.TestCase):
    """Registry must reflect the correct scientific state."""

    @classmethod
    def setUpClass(cls):
        """Connect to real DB. Skip entire class if not available."""
        from dotenv import load_dotenv
        load_dotenv()
        import psycopg2
        db_url = os.getenv("DATABASE_URL")
        if not db_url:
            raise unittest.SkipTest("DATABASE_URL not configured")
        try:
            cls.conn = psycopg2.connect(db_url, connect_timeout=3)
        except Exception:
            raise unittest.SkipTest("Database not reachable")

    @classmethod
    def tearDownClass(cls):
        if hasattr(cls, "conn"):
            cls.conn.close()

    def test_exactly_one_active_model(self):
        """Registry must have exactly one is_active=TRUE model at all times."""
        cur = self.conn.cursor()
        cur.execute("SELECT COUNT(*) FROM public.risk_model_config WHERE is_active = true")
        count = cur.fetchone()[0]
        cur.close()
        self.assertEqual(count, 1, f"Expected exactly 1 active model, found {count}")

    def test_v0_3_is_not_active(self):
        """v0.3-lr-trained must NOT be is_active=TRUE (scientific gate BLOCKED at 22/200)."""
        cur = self.conn.cursor()
        cur.execute(
            "SELECT is_active, status FROM public.risk_model_config WHERE model_version = 'v0.3-lr-trained'"
        )
        row = cur.fetchone()
        cur.close()
        if row is None:
            self.skipTest("v0.3-lr-trained not found in registry")
        is_active, status = row
        self.assertFalse(is_active,
            "v0.3-lr-trained must NOT be is_active=TRUE. Scientific gate BLOCKED at 22/200 events.")
        self.assertEqual(status, "scientifically_blocked",
            f"v0.3-lr-trained must have status='scientifically_blocked', got '{status}'")

    def test_v0_2_is_active_production_model(self):
        """v0.2-lr-trained must be the sole active production model."""
        cur = self.conn.cursor()
        cur.execute(
            "SELECT is_active, status FROM public.risk_model_config WHERE model_version = 'v0.2-lr-trained'"
        )
        row = cur.fetchone()
        cur.close()
        if row is None:
            self.skipTest("v0.2-lr-trained not found in registry")
        is_active, status = row
        self.assertTrue(is_active, "v0.2-lr-trained must be is_active=TRUE (authorized production model).")
        self.assertEqual(status, "active", f"v0.2-lr-trained status must be 'active', got '{status}'")

    def test_active_model_has_valid_artifact_on_disk(self):
        """The active model's artifact_path must exist on disk."""
        cur = self.conn.cursor()
        cur.execute(
            "SELECT model_version, artifact_path FROM public.risk_model_config WHERE is_active = true"
        )
        row = cur.fetchone()
        cur.close()
        self.assertIsNotNone(row, "No active model found")
        ver, art_path = row
        self.assertIsNotNone(art_path, f"Active model '{ver}' has NULL artifact_path")
        self.assertTrue(
            os.path.isfile(art_path),
            f"Active model '{ver}' artifact '{art_path}' not found on disk"
        )

    def test_real_event_count_below_scientific_gate(self):
        """Verifies the current event count is below 200 (gate state is BLOCKED)."""
        from scripts.ml_registry import SCIENTIFIC_EVENT_GATE, count_real_rainfall_events
        count = count_real_rainfall_events(self.conn)
        self.assertLess(
            count, SCIENTIFIC_EVENT_GATE,
            f"If count >= {SCIENTIFIC_EVENT_GATE}, the scientific gate may now be satisfiable. "
            "Re-run verify_model_candidate() and consider promotion."
        )
        # Also assert the count hasn't been fabricated (no impossible value)
        self.assertGreater(count, 0, "Real event count must be positive")


# ---------------------------------------------------------------------------
# Section 4: Inference engine reads correct (active) model from registry
# ---------------------------------------------------------------------------

class TestInferenceEngineModelVersion(unittest.TestCase):
    """
    The inference engine must use the registry-active model artifact,
    not a hardcoded path. The model_version in the result must match
    the registry's active model.
    """

    @classmethod
    def setUpClass(cls):
        from dotenv import load_dotenv
        load_dotenv()
        import psycopg2
        db_url = os.getenv("DATABASE_URL")
        if not db_url:
            raise unittest.SkipTest("DATABASE_URL not configured")
        try:
            cls.conn = psycopg2.connect(db_url, connect_timeout=3)
        except Exception:
            raise unittest.SkipTest("Database not reachable")

    @classmethod
    def tearDownClass(cls):
        if hasattr(cls, "conn"):
            cls.conn.close()

    def test_active_registry_model_matches_inference_engine_default(self):
        """
        The artifact path returned by get_active_artifact_path_from_registry()
        must correspond to the same model_version as the registry's active row.
        """
        import psycopg2
        from src.lib.ml.inference import get_active_artifact_path_from_registry
        from src.lib.ml.artifact import load_model_artifact

        # Get active model from registry
        cur = self.conn.cursor()
        cur.execute(
            "SELECT model_version, artifact_path FROM public.risk_model_config WHERE is_active = true"
        )
        row = cur.fetchone()
        cur.close()
        if row is None:
            self.skipTest("No active model in registry")

        registry_ver, registry_art_path = row

        # Get artifact path from the function inference engine uses
        resolved_path = get_active_artifact_path_from_registry()

        # The resolved path must match the registry artifact path
        self.assertEqual(
            os.path.normpath(resolved_path),
            os.path.normpath(registry_art_path),
            f"Inference engine resolved '{resolved_path}' but registry says '{registry_art_path}'"
        )

        # Load the artifact and verify model_version matches registry
        artifact = load_model_artifact(resolved_path)
        self.assertEqual(
            artifact.model_version, registry_ver,
            f"Artifact model_version='{artifact.model_version}' != registry active='{registry_ver}'. "
            "Silent model version mismatch detected."
        )

    def test_v0_3_artifact_cannot_be_loaded_as_production(self):
        """
        v0.3 is scientifically_blocked. The inference engine must not use it.
        get_active_artifact_path_from_registry() must NOT return the v0.3 path.
        """
        from src.lib.ml.inference import get_active_artifact_path_from_registry
        resolved_path = get_active_artifact_path_from_registry()
        self.assertNotIn(
            "v0.3", resolved_path,
            f"Inference engine resolved '{resolved_path}' which contains 'v0.3'. "
            "v0.3 is scientifically_blocked and must not be used for production inference."
        )

    def test_v0_2_artifact_is_current_production_model(self):
        """v0.2 must be the artifact used for production inference."""
        from src.lib.ml.inference import get_active_artifact_path_from_registry
        resolved_path = get_active_artifact_path_from_registry()
        self.assertIn(
            "v0.2", resolved_path,
            f"Expected v0.2 artifact path, got '{resolved_path}'"
        )


# ---------------------------------------------------------------------------
# Section 5: DB fallback preserves provenance (no timestamp or version lying)
# ---------------------------------------------------------------------------

class TestDBFallbackSemantics(unittest.TestCase):
    """
    The DB fallback prediction path must:
    - Return status='DEGRADED' (not 'VALID', not 'FRESH')
    - Preserve the original model_version from the cached prediction
    - NOT update inference_timestamp to current time
    - NOT claim a v0.3 result when the actual inference used v0.2
    """

    def test_fallback_status_is_degraded_not_valid(self):
        """
        A DB fallback result must NEVER have status='VALID'.
        'VALID' implies fresh Python inference, which the fallback is not.
        """
        # This test inspects the source code for the invariant
        with open("src/lib/ml.service.ts", "r") as f:
            content = f.read()

        # Find the getDatabaseFallbackPrediction function
        fallback_idx = content.find("getDatabaseFallbackPrediction")
        self.assertGreater(fallback_idx, 0, "getDatabaseFallbackPrediction not found in ml.service.ts")

        # Extract the function body
        func_body = content[fallback_idx:fallback_idx + 3000]

        # The status within the DB fallback path must be DEGRADED, not VALID
        # (The in-memory lastKnown path may use STALE which is acceptable)
        self.assertNotIn(
            'status: "VALID"', func_body,
            "DB fallback path must NOT return status='VALID'. Use 'DEGRADED' instead."
        )
        self.assertIn(
            'status: "DEGRADED"', func_body,
            "DB fallback path must return status='DEGRADED' to distinguish from fresh inference."
        )

    def test_fallback_preserves_original_model_version(self):
        """
        The DB fallback must use the model_version from the cached prediction
        record, not fabricate a version label from the registry.
        """
        with open("src/lib/ml.service.ts", "r") as f:
            content = f.read()

        # The correct pattern is latestPred?.model_version ?? cfg?.model_version
        self.assertIn(
            "latestPred?.model_version",
            content,
            "DB fallback must use latestPred?.model_version to preserve original prediction provenance."
        )

    def test_fallback_does_not_use_new_date_for_inference_timestamp(self):
        """
        The DB fallback must NOT set inference_timestamp to new Date().toISOString()
        for the main DB-query branch (it would lie about when inference occurred).
        """
        with open("src/lib/ml.service.ts", "r") as f:
            content = f.read()

        # Find the getDatabaseFallbackPrediction function body
        fallback_start = content.find("export async function getDatabaseFallbackPrediction")
        fallback_end = content.find("\nexport ", fallback_start + 10)
        if fallback_end == -1:
            fallback_end = fallback_start + 5000
        func_body = content[fallback_start:fallback_end]

        # The DB-query branch should use latestPred?.prediction_time or zone timestamp
        # NOT new Date().toISOString() for inference_timestamp in the main result object
        self.assertIn(
            "latestPred?.prediction_time",
            func_body,
            "DB fallback must preserve original prediction_time, not generate a new current timestamp."
        )


# ---------------------------------------------------------------------------
# Section 6: PR-AUC discrepancy documentation
# ---------------------------------------------------------------------------

class TestPRAUCDiscrepancy(unittest.TestCase):
    """
    The PR-AUC discrepancy between 0.9399 (registered) and 0.7109 (audit re-run)
    must be documented and both values must be explainable by methodology.
    Neither value must be fabricated.
    """

    def test_v0_3_registered_prauc_is_cross_validated(self):
        """v0.3 registered PR-AUC must be from GroupKFold cross-validation, not training-set."""
        with open("models/v0.3-lr-trained.json", "r") as f:
            artifact = json.load(f)
        strategy = artifact["metrics"].get("validation_strategy", "")
        self.assertIn(
            "GroupKFold", strategy,
            f"v0.3 PR-AUC must be from cross-validation strategy, got: '{strategy}'"
        )
        self.assertNotIn(
            "training", strategy.lower(),
            "PR-AUC must NOT be from training-set evaluation (that would be inflated/invalid)"
        )

    def test_v0_3_pr_auc_within_plausible_range(self):
        """PR-AUC must be between chance baseline and 1.0."""
        with open("models/v0.3-lr-trained.json", "r") as f:
            artifact = json.load(f)
        pr_auc = artifact["metrics"]["pr_auc"]
        prevalence = artifact["metrics"]["prevalence"]

        # PR-AUC should exceed chance (prevalence)
        self.assertGreater(pr_auc, prevalence,
            f"PR-AUC ({pr_auc}) should exceed chance baseline (prevalence={prevalence:.4f})")
        # PR-AUC cannot exceed 1.0
        self.assertLessEqual(pr_auc, 1.0)
        # PR-AUC cannot be negative
        self.assertGreater(pr_auc, 0.0)

    def test_pr_auc_discrepancy_is_documented_in_migration(self):
        """The PR-AUC discrepancy must be documented in the scientific gate migration."""
        migration_path = (
            "supabase/migrations/20260906180000_enforce_scientific_gate_revert_v0_3.sql"
        )
        with open(migration_path, "r") as f:
            migration_content = f.read()
        self.assertIn("0.9399", migration_content)
        self.assertIn("0.7109", migration_content)
        self.assertIn("GroupKFold", migration_content)


if __name__ == "__main__":
    unittest.main(verbosity=2)
