# Landslide Early Warning ML Layer — Operations Runbook

**Project**: Himalaya Sentinel / landalert-nexus (SIH26001)  
**Audience**: ML Engineers, DevOps, System Administrators, Hackathon Judges  
**Prerequisites**: Python 3.10+, PostgreSQL / Supabase, Node.js 20+

---

## 1. Quick Reference: Common Operator Commands

| Task                 | Command                                                            | Description                                                                    |
| :------------------- | :----------------------------------------------------------------- | :----------------------------------------------------------------------------- |
| **Run All Tests**    | `./scripts/run_all_ml_tests.sh`                                    | Executes full TS, Python, leakage, validation, and monitoring suites           |
| **Validate Data**    | `python3 scripts/validate_data_pipeline.py`                        | Audits real/synthetic isolation, GLOF exclusion, weather integrity             |
| **Full Evaluation**  | `python3 scripts/ml_validation_full.py`                            | Runs 5-fold Spatial CV, baselines, ablation, bootstrap intervals               |
| **Train Artifact**   | `python3 scripts/train_and_export_artifact.py`                     | Trains Logistic Regression, serializes to `models/v0.2-lr-trained.json`        |
| **List Models**      | `python3 scripts/ml_registry.py list`                              | Displays all registered models in `public.risk_model_config`                   |
| **Audit/Gate Model** | `python3 scripts/ml_registry.py gate <version>`                    | Runs artifact and metric checks to promote `candidate` to `validated`          |
| **Activate Model**   | `python3 scripts/ml_registry.py activate <version> --reason "..."` | Explicitly switches active model with audit log entry                          |
| **Rollback Model**   | `python3 scripts/ml_registry.py rollback --reason "..."`           | Restores previous active model without data loss                               |
| **Health Monitor**   | `python3 scripts/ml_monitor.py`                                    | Checks weather age, soil moisture fallback rate, prediction drift              |
| **Run Retraining**   | `python3 scripts/ml_retrain.py`                                    | Gated retraining pipeline (requires $\ge 10$ new verified events or `--force`) |
| **Live Ingest**      | `npm run dev` (via UI button) or RPC `recompute_risk()`            | Updates live rainfall/soil moisture and recalculates zone risk                 |

---

## 2. Training Workflow

### When to Train

- A minimum of 10 new verified real landslide events are entered into `public.historical_landslides`.
- Pre-monsoon seasonal recalibration (using `--force`).
- Updates to published IMD / GSI regional rainfall thresholds.

### Step-by-Step Training Execution

1. Ensure the PostgreSQL database is populated and `DATABASE_URL` is configured:
   ```bash
   export DATABASE_URL="postgresql://localhost/landalert"
   ```
2. Validate data pipeline integrity:
   ```bash
   python3 scripts/validate_data_pipeline.py
   ```
3. Run the training and artifact export script:
   ```bash
   python3 scripts/train_and_export_artifact.py
   ```
   _Output_: Generates serialized JSON artifact in `models/v0.2-lr-trained.json` containing weights, scaler means, cutoffs, metrics, and dataset SHA-256 fingerprint.

---

## 3. Evaluation & Validation Workflow

### Running the Full Scientific Evaluation

Execute the comprehensive spatial evaluation suite:

```bash
python3 scripts/ml_validation_full.py
```

This script computes:

1. Spatial GroupKFold Cross-Validation across distinct districts.
2. Baselines (Random Guessing, Continuous Ratio, Binary Sikkim I-D Threshold).
3. Candidate comparisons (Logistic Regression vs Random Forest).
4. Feature ablation analysis (Groups A, B, C, D).
5. 1,000-iteration bootstrap 95% confidence intervals.
6. Per-fold metrics and confusion matrices.

### Leakage Regression Guards

Verify that temporal and spatial boundaries remain airtight:

```bash
python3 scripts/test_ml_leakage.py
```

_Guarantees_: Confirms that no observation on or after event day $T$ can enter training matrices.

---

## 4. Model Registry Management

Model lifecycle is governed by the state machine:
$$\text{candidate} \xrightarrow{\text{gate}} \text{validated} \xrightarrow{\text{activate}} \text{active} \xrightarrow{\text{rollback}} \text{retired}$$

### Registering a Candidate Model

```bash
python3 scripts/ml_registry.py register \
  --version "v0.3-lr-monsoon2026" \
  --artifact "models/v0.3-lr-monsoon2026.json" \
  --notes "Trained on post-monsoon verified inventory"
```

### Validating Through the Safety Gate

The safety gate verifies:

- Artifact file exists on disk and has valid JSON syntax
- Feature schema matches `v1.0.0` (all 19 canonical features present)
- PR-AUC and Recall@80% metrics are positive and recorded
- Positive training count is $\ge 5$

Run the gate:

```bash
python3 scripts/ml_registry.py gate v0.3-lr-monsoon2026
```

### Explicit Model Activation

Under Rule 13, **no script or pipeline is permitted to automatically activate a candidate model**. Activation requires an explicit operator command with a reason:

```bash
python3 scripts/ml_registry.py activate v0.3-lr-monsoon2026 \
  --reason "Approved after Spatial CV PR-AUC improved from 0.59 to 0.64" \
  --by "Lead ML Engineer"
```

This updates `public.risk_model_config`, activates the row, sets previous models to `is_active = false`, triggers `recompute_risk()` across all 15 zones, and writes an entry to `public.model_activation_log`.

### Emergency Rollback

If an active model exhibits unexpected anomalies in production, roll back immediately to the previous active version:

```bash
python3 scripts/ml_registry.py rollback \
  --reason "False alarm spike in Papum Pare district" \
  --by "On-call Engineer"
```

---

## 5. Production Inference & Application Consumption

### Standalone Python Inference

To run inference for any monitored zone using the canonical engine:

```python
from src.lib.ml.inference import LandslideRiskInferenceEngine

engine = LandslideRiskInferenceEngine()
result = engine.predict_zone(zone_id=1)
print(f"Risk Score: {result['risk_score']}/100 ({result['risk_level']})")
print(f"Narrative:  {result['explanation_narrative']}")
```

### Real-Time Application Stack

In normal web application operation:

1. `src/lib/monitoring.functions.ts` invokes PostgreSQL `recompute_risk()`.
2. `recompute_risk()` reads the active row of `public.risk_model_config`.
3. Zone briefs and dashboard display:
   - Dynamic explanation narrative
   - Active model version chip
   - Soil moisture status badge (`✓ Observed ERA5-Land` or `⚠ Fallback proxy (50%)`)
   - Explicit scientific limitation note (`Data-Limited Validation, N=8 real landslides`)

---

## 6. Continuous Monitoring Runbook

Run the automated health and drift monitor:

```bash
python3 scripts/ml_monitor.py
```

Or output structured JSON for external observability tools (Datadog, Prometheus, CloudWatch):

```bash
python3 scripts/ml_monitor.py --json
```

### Alert Thresholds & Troubleshooting

1. **`stale_weather_zones_count > 0`**:
   - _Cause_: Open-Meteo API connection failure or cron ingestion delay.
   - _Remedy_: Run `ingestLiveRainfallImpl()` via console or inspect API rate limits.
2. **`soil_moisture fallback_percentage == 100%`**:
   - _Cause_: ERA5-Land endpoint returned missing layers for target coordinates.
   - _Remedy_: Fallback 50% activates automatically; verify UI displays fallback indicator.
3. **`new_verified_positives >= 10`**:
   - _Action_: Monitoring report flags `RETRAIN TRIGGER RECOMMENDED`. Run `scripts/ml_retrain.py`.
