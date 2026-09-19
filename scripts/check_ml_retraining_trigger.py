#!/usr/bin/env python3
"""
scripts/check_ml_retraining_trigger.py
======================================
Automated monitoring check for LandAlert-Nexus ML retraining lifecycle.
Evaluates whether new field-verified landslide events ingested into
public.historical_landslides exceed the retraining threshold (>=200 new events)
relative to the active production model's training baseline.

Usage:
    python3 scripts/check_ml_retraining_trigger.py
    python3 scripts/check_ml_retraining_trigger.py --exit-code
"""

import os
import sys
import json
import argparse
import psycopg2
from dotenv import load_dotenv

load_dotenv()
DATABASE_URL = (os.getenv("DATABASE_URL") or "").strip()
RETRAINING_THRESHOLD = 200


def main():
    parser = argparse.ArgumentParser(description="Check ML retraining trigger status")
    parser.add_argument(
        "--exit-code",
        action="store_true",
        help="Exit with code 2 if retraining is recommended (for CI/CD pipelines)",
    )
    args = parser.parse_args()

    if not DATABASE_URL:
        print("ERROR: DATABASE_URL not configured.")
        sys.exit(1)

    try:
        conn = psycopg2.connect(DATABASE_URL, connect_timeout=5)
    except Exception as exc:
        print(f"ERROR: Cannot connect to database: {exc}")
        sys.exit(1)

    cur = conn.cursor()
    cur.execute("""
        SELECT model_version, artifact_path, trained_at, status
        FROM public.risk_model_config
        WHERE is_active = true
        LIMIT 1;
    """)
    row = cur.fetchone()

    if not row:
        print("[WARNING] No active production model found in public.risk_model_config.")
        conn.close()
        sys.exit(0)

    model_ver, art_path, trained_at, status = row

    # Count current real verified landslide events
    cur.execute("""
        SELECT COUNT(*)
        FROM public.historical_landslides
        WHERE is_synthetic = false
          AND hazard_type = 'rainfall_slope_failure';
    """)
    current_events_count = int(cur.fetchone()[0])
    cur.close()
    conn.close()

    # Read training sample counts from artifact if available
    trained_baseline = None
    trained_positives = None
    if art_path and os.path.isfile(art_path):
        try:
            with open(art_path, "r", encoding="utf-8") as f:
                art_data = json.load(f)
            counts = art_data.get("sample_counts", {})
            trained_baseline = counts.get("raw_db_events")
            trained_positives = counts.get("positives")
        except Exception:
            pass

    print("=" * 65)
    print("  LandAlert-Nexus ML Continuous Retraining Monitor")
    print("=" * 65)
    print(f"  Active Model:            {model_ver} ({status})")
    print(f"  Artifact:                {art_path or 'N/A'}")
    print(f"  Last Trained:            {trained_at or 'Unknown'}")
    print(f"  Current Real Events:     {current_events_count:,}")
    if trained_baseline is not None:
        print(f"  Trained Event Baseline:  {trained_baseline:,}")
    elif trained_positives is not None:
        print(f"  Trained Event Instances: {trained_positives:,}")
    print(f"  Retraining Threshold:    >= {RETRAINING_THRESHOLD} new events")
    print("-" * 65)

    delta = None
    if trained_baseline is not None:
        delta = current_events_count - trained_baseline
    elif trained_positives is not None:
        delta = current_events_count - trained_positives

    if delta is not None and delta >= RETRAINING_THRESHOLD:
        print(f"  STATUS: [RETRAINING RECOMMENDED] 🔔")
        print(f"  Delta: +{delta:,} events since model artifact training baseline.")
        print("  Action: Run `python3 -m src.lib.ml.train_v05` to retrain ensemble.")
        if args.exit_code:
            sys.exit(2)
    else:
        delta_str = f"+{delta:,}" if delta is not None else "0"
        print(f"  STATUS: [OK - MODEL UP TO DATE] ✓ (delta: {delta_str})")

    print("=" * 65)


if __name__ == "__main__":
    main()
