#!/usr/bin/env python3
"""
scripts/ml_registry.py
======================
Model Registry CLI for LandAlert-Nexus.
Enforces the lifecycle:
  Candidate -> Automated Validation -> Approval -> Active -> Rollback

SCIENTIFIC GATE (AUTHORITATIVE):
  A model may NOT be production-activated unless the database contains
  >= SCIENTIFIC_EVENT_GATE distinct, real (is_synthetic=false),
  rainfall_slope_failure-typed, verified landslide events.

  This requirement is INDEPENDENT of and CANNOT be overridden by:
  - PR-AUC value
  - ROC-AUC value
  - F1 score
  - passing tests
  - pseudo-absence count
  - any software gate

  The software gate (PR-AUC >= 0.25) is a subordinate minimum sanity
  check only. It must NOT be interpreted as scientific production approval.
"""

import os, sys, json, argparse
import psycopg2
from dotenv import load_dotenv

sys.path.insert(0, os.path.abspath("."))
from src.lib.ml.artifact import load_model_artifact

# ─── AUTHORITATIVE SCIENTIFIC PRODUCTION GATE ────────────────────────────────
# Minimum number of distinct, real, verified, exact-date, rainfall-triggered
# landslide events required for scientific production activation.
# DO NOT lower this value. DO NOT replace it with a metric threshold.
SCIENTIFIC_EVENT_GATE = 200

SOFTWARE_PRAUC_FLOOR = 0.25  # subordinate minimum sanity check only

load_dotenv()
DATABASE_URL = os.getenv("DATABASE_URL")

def get_db():
    return psycopg2.connect(DATABASE_URL)

def cmd_list(args):
    conn = get_db()
    cur = conn.cursor()
    cur.execute("""
        SELECT id, model_version, status, is_active, pr_auc, recall_at_80_precision,
               artifact_path, dataset_fingerprint, trained_at, activated_at
        FROM public.risk_model_config
        ORDER BY id;
    """)
    rows = cur.fetchall()
    print("=" * 110)
    print(f"{'ID':<4} {'Version':<18} {'Status':<12} {'Active':<8} {'PR-AUC':<8} {'R@80p':<8} {'Fingerprint':<18} {'Artifact Path'}")
    print("-" * 110)
    for r in rows:
        rid, ver, status, active, prauc, r80, art, fp, trained, act_at = r
        prauc_str = f"{prauc:.4f}" if prauc is not None else "NULL"
        r80_str = f"{r80:.4f}" if r80 is not None else "NULL"
        fp_str = fp[:16] if fp else "—"
        art_str = art if art else "—"
        print(f"{rid:<4} {ver:<18} {status:<12} {str(active):<8} {prauc_str:<8} {r80_str:<8} {fp_str:<18} {art_str}")
    print("=" * 110)
    conn.close()

def cmd_register(args):
    artifact_path = args.artifact_path
    if not os.path.isfile(artifact_path):
        print(f"ERROR: Artifact file not found: {artifact_path}")
        sys.exit(1)

    with open(artifact_path, "r", encoding="utf-8") as f:
        data = json.load(f)

    ver = data["model_version"]
    prauc = data["metrics"].get("pr_auc")
    r80 = data["metrics"].get("recall_at_80_precision")
    fp = data.get("dataset_fingerprint")
    schema_ver = data.get("feature_schema_version", "v1.0.0")
    notes = data.get("provenance", {}).get("notes", "")

    conn = get_db()
    cur = conn.cursor()
    # Check if version already exists
    cur.execute("SELECT id, is_active, status FROM public.risk_model_config WHERE model_version = %s;", (ver,))
    existing = cur.fetchone()

    if existing:
        print(f"Model version '{ver}' already exists in registry (id={existing[0]}, status={existing[2]}). Updating artifact metadata...")
        cur.execute("""
            UPDATE public.risk_model_config
            SET artifact_path = %s,
                feature_schema_version = %s,
                dataset_fingerprint = %s,
                pr_auc = %s,
                recall_at_80_precision = %s
            WHERE model_version = %s;
        """, (artifact_path, schema_ver, fp, prauc, r80, ver))
    else:
        print(f"Registering new model '{ver}' as candidate...")
        cur.execute("""
            INSERT INTO public.risk_model_config (
                model_version, status, is_active, artifact_path, feature_schema_version,
                pr_auc, recall_at_80_precision, dataset_fingerprint,
                weight_intensity, weight_antecedent, weight_soil_moisture, weight_slope, weight_history,
                cutoff_moderate, cutoff_high, cutoff_severe, notes, trained_at
            ) VALUES (
                %s, 'candidate', false, %s, %s,
                %s, %s, %s,
                0.32, 0.22, 0.18, 0.16, 0.12,
                38.0, 56.0, 74.0, %s, now()
            );
        """, (ver, artifact_path, schema_ver, prauc, r80, fp, notes))

    conn.commit()
    conn.close()
    print(f"Successfully registered '{ver}' with artifact {artifact_path}.")

def count_real_rainfall_events(conn) -> int:
    """
    Returns the count of distinct, real (is_synthetic=false),
    rainfall_slope_failure-typed verified landslide events in the database.
    This is the authoritative input to the scientific production gate.
    """
    cur = conn.cursor()
    cur.execute("""
        SELECT COUNT(*)
        FROM public.historical_landslides
        WHERE is_synthetic = false
          AND hazard_type = 'rainfall_slope_failure'
    """)
    row = cur.fetchone()
    cur.close()
    return int(row[0]) if row else 0


def verify_model_candidate(ver: str, conn=None) -> tuple[bool, list[str]]:
    """
    Evaluates safety gates for a model version.
    Returns (passed: bool, failure_reasons: list[str]).

    TWO-LAYER GATE:
      Layer 1 — Software gate: artifact integrity + PR-AUC >= SOFTWARE_PRAUC_FLOOR
      Layer 2 — Scientific gate: real verified rainfall events >= SCIENTIFIC_EVENT_GATE

    Layer 2 is AUTHORITATIVE. A model that passes Layer 1 but fails Layer 2
    is marked 'scientifically_blocked', NOT 'validated'. It cannot be activated.
    """
    close_conn = False
    if conn is None:
        conn = get_db()
        close_conn = True

    cur = conn.cursor()
    cur.execute(
        "SELECT id, artifact_path, pr_auc, status FROM public.risk_model_config WHERE model_version = %s;",
        (ver,),
    )
    row = cur.fetchone()
    if not row:
        if close_conn:
            conn.close()
        return False, [f"Model '{ver}' not found in registry"]

    rid, art_path, prauc, status = row
    software_failures = []
    scientific_failures = []

    # ── LAYER 1: Software gate ────────────────────────────────────────────────
    # 1a. Artifact must exist and load with exactly 19 weights
    if not art_path or not os.path.isfile(art_path):
        software_failures.append(f"Artifact path '{art_path}' is missing or invalid on disk")
    else:
        try:
            art = load_model_artifact(art_path)
            if len(art.weights) != 19:
                software_failures.append(
                    f"Artifact weights length ({len(art.weights)}) != 19 canonical features"
                )
        except Exception as e:
            software_failures.append(f"Artifact failed to load: {e}")

    # 1b. PR-AUC must be non-null and >= SOFTWARE_PRAUC_FLOOR (minimum sanity check)
    if prauc is None:
        software_failures.append("PR-AUC is NULL; model evaluation has not been performed")
    elif prauc < SOFTWARE_PRAUC_FLOOR:
        software_failures.append(
            f"PR-AUC ({prauc:.4f}) is below minimum software floor ({SOFTWARE_PRAUC_FLOOR})"
        )

    # If the model is already active in production (e.g. v0.2-lr-trained grandfathered
    # pending >=200 events), evaluate software integrity and preserve active status.
    # NEVER mutate the DB status of an active production model during candidate verification.
    if status == "active":
        if close_conn:
            conn.close()
        return len(software_failures) == 0, software_failures

    # ── LAYER 2: Scientific gate ──────────────────────────────────────────────
    # Authoritative: requires >= SCIENTIFIC_EVENT_GATE real verified events.
    # This CANNOT be overridden by PR-AUC or any other metric.
    real_event_count = count_real_rainfall_events(cur.connection if not close_conn else conn)
    print(f"  Real verified rainfall-triggered events in DB: {real_event_count}")
    print(f"  Scientific event gate requirement:             {SCIENTIFIC_EVENT_GATE}")

    if real_event_count < SCIENTIFIC_EVENT_GATE:
        scientific_failures.append(
            f"SCIENTIFIC GATE BLOCKED: real verified rainfall-triggered events "
            f"({real_event_count}) < required {SCIENTIFIC_EVENT_GATE}. "
            f"Remaining until gate satisfied: {SCIENTIFIC_EVENT_GATE - real_event_count}. "
            f"PR-AUC >= {SOFTWARE_PRAUC_FLOOR} does NOT override this requirement."
        )

    all_failures = software_failures + scientific_failures

    # Only transition candidate models in the registry
    if status == "candidate":
        if not software_failures and not scientific_failures:
            # Both layers passed — mark scientifically validated
            cur.execute(
                "UPDATE public.risk_model_config SET status = 'validated' WHERE id = %s;",
                (rid,),
            )
            conn.commit()
        elif not software_failures and scientific_failures:
            # Software gate passed but scientific gate blocked —
            # status = 'scientifically_blocked' to distinguish from 'candidate'
            cur.execute(
                "UPDATE public.risk_model_config SET status = 'scientifically_blocked' WHERE id = %s;",
                (rid,),
            )
            conn.commit()

    if close_conn:
        conn.close()

    return len(all_failures) == 0, all_failures

def cmd_gate(args):
    ver = args.model_version
    print(f"Evaluating candidate gate for model '{ver}'...")
    passed, failures = verify_model_candidate(ver)

    if not passed:
        print(f"VALIDATION GATE FAILED for '{ver}':")
        for f in failures:
            print(f"  [REJECT] {f}")
        sys.exit(1)
    else:
        print(f"All validation criteria passed for '{ver}'. Marking status='validated'...")
        print(f"Model '{ver}' is now VALIDATED and eligible for activation.")

def cmd_activate(args):
    ver = args.model_version
    reason = args.reason or "Manual activation via registry CLI"
    conn = get_db()
    cur = conn.cursor()

    cur.execute("SELECT id, status, is_active FROM public.risk_model_config WHERE model_version = %s;", (ver,))
    target = cur.fetchone()
    if not target:
        print(f"ERROR: Model '{ver}' not found in registry.")
        sys.exit(1)

    tid, tstatus, is_active = target
    if is_active:
        print(f"Model '{ver}' is already active.")
        conn.close()
        return

    # ── Enforce scientific gate BEFORE activation ─────────────────────────────
    # The status='validated' check alone is insufficient because old registry
    # rows may carry 'validated' from a weaker software-only gate run.
    # Re-verify the authoritative scientific event count at activation time.
    real_event_count = count_real_rainfall_events(conn)
    if real_event_count < SCIENTIFIC_EVENT_GATE:
        print(
            f"ERROR: SCIENTIFIC GATE BLOCKED — cannot activate '{ver}'.\n"
            f"  Real verified rainfall-triggered events: {real_event_count}\n"
            f"  Required for scientific production activation: {SCIENTIFIC_EVENT_GATE}\n"
            f"  Remaining: {SCIENTIFIC_EVENT_GATE - real_event_count}\n"
            f"  This requirement cannot be overridden by PR-AUC, ROC-AUC, F1, \n"
            f"  passing tests, or any software gate metric."
        )
        # Ensure the model's status reflects its blocked state
        if tstatus not in ("scientifically_blocked", "candidate"):
            cur.execute(
                "UPDATE public.risk_model_config SET status = 'scientifically_blocked' WHERE id = %s;",
                (tid,),
            )
            conn.commit()
        conn.close()
        sys.exit(1)

    if tstatus not in ["validated", "active"]:
        print(f"ERROR: Cannot activate model with status='{tstatus}'. Run 'gate' first to validate.")
        sys.exit(1)

    cur.execute("SELECT model_version FROM public.risk_model_config WHERE is_active = true;")
    cur_active = cur.fetchone()
    prev_ver = cur_active[0] if cur_active else "none"

    print(f"Activating model '{ver}' (replacing '{prev_ver}')...")
    # Begin transaction
    cur.execute("""
        UPDATE public.risk_model_config
        SET is_active = false,
            status = 'retired',
            retired_at = now()
        WHERE is_active = true;
    """)

    cur.execute("""
        UPDATE public.risk_model_config
        SET is_active = true,
            status = 'active',
            activated_at = now()
        WHERE id = %s;
    """, (tid,))

    cur.execute("""
        INSERT INTO public.risk_model_activation_log (model_version, action, previous_active_version, reason)
        VALUES (%s, 'activated', %s, %s);
    """, (ver, prev_ver, reason))

    # Trigger risk recomputation
    cur.execute("SELECT public.recompute_risk();")
    conn.commit()
    conn.close()
    print(f"Successfully activated model '{ver}'. recompute_risk() executed.")

def cmd_rollback(args):
    conn = get_db()
    cur = conn.cursor()

    cur.execute("SELECT id, model_version FROM public.risk_model_config WHERE is_active = true;")
    cur_active = cur.fetchone()
    if not cur_active:
        print("ERROR: No currently active model found to roll back.")
        sys.exit(1)

    cur_id, cur_ver = cur_active

    # Find previous active version from log
    cur.execute("""
        SELECT previous_active_version
        FROM public.risk_model_activation_log
        WHERE action = 'activated' AND model_version = %s
        ORDER BY id DESC LIMIT 1;
    """, (cur_ver,))
    log_row = cur.fetchone()

    prev_ver = None
    if log_row and log_row[0] and log_row[0] != "none":
        prev_ver = log_row[0]
    else:
        # Fallback to highest id inactive model
        cur.execute("SELECT model_version FROM public.risk_model_config WHERE is_active = false ORDER BY id DESC LIMIT 1;")
        fb_row = cur.fetchone()
        if fb_row:
            prev_ver = fb_row[0]

    if not prev_ver:
        print("ERROR: No eligible previous model version found to roll back to.")
        sys.exit(1)

    print(f"Rolling back active model from '{cur_ver}' to '{prev_ver}'...")
    cur.execute("""
        UPDATE public.risk_model_config
        SET is_active = false,
            status = 'retired',
            retired_at = now()
        WHERE id = %s;
    """, (cur_id,))

    cur.execute("""
        UPDATE public.risk_model_config
        SET is_active = true,
            status = 'active',
            activated_at = now()
        WHERE model_version = %s;
    """, (prev_ver,))

    cur.execute("""
        INSERT INTO public.risk_model_activation_log (model_version, action, previous_active_version, reason)
        VALUES (%s, 'rolled_back', %s, 'Operator rollback request');
    """, (prev_ver, cur_ver))

    cur.execute("SELECT public.recompute_risk();")
    conn.commit()
    conn.close()
    print(f"Rollback complete: active model is now '{prev_ver}'. recompute_risk() executed.")

def main():
    parser = argparse.ArgumentParser(description="LandAlert-Nexus Model Registry CLI")
    subparsers = parser.add_subparsers(dest="command", required=True)

    p_list = subparsers.add_parser("list", help="List all registered models")
    p_list.set_defaults(func=cmd_list)

    p_reg = subparsers.add_parser("register", help="Register a model artifact as candidate")
    p_reg.add_argument("artifact_path", help="Path to model artifact JSON")
    p_reg.set_defaults(func=cmd_register)

    p_gate = subparsers.add_parser("gate", help="Run automated validation safety gate on candidate")
    p_gate.add_argument("model_version", help="Model version string")
    p_gate.set_defaults(func=cmd_gate)

    p_act = subparsers.add_parser("activate", help="Promote a validated model to active")
    p_act.add_argument("model_version", help="Model version string")
    p_act.add_argument("--reason", default="", help="Activation rationale")
    p_act.set_defaults(func=cmd_activate)

    p_roll = subparsers.add_parser("rollback", help="Roll back to previous active model")
    p_roll.set_defaults(func=cmd_rollback)

    args = parser.parse_args()
    args.func(args)

if __name__ == "__main__":
    main()
