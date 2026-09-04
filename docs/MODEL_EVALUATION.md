# Model Evaluation — Himalaya Sentinel Risk Engine

> **Status as of this commit**: Hand-tuned baseline (v0.1-hand-tuned).  
> `pr_auc` and `recall_at_80_precision` are **NULL** in `risk_model_config`.  
> This document describes the evaluation methodology that must be run to
> populate those fields before the project is presented to judges.

---

## Why evaluation matters

The current risk formula uses hand-picked weights (0.35/0.20/0.20/0.15/0.10)
and cutoffs (42/58/72) that were chosen by engineering judgement, not calibrated
against real landslide event data.  This is explicitly documented in the
`notes` column of `risk_model_config`.

A judge who asks "how do you know your alert thresholds are correct?" needs a
real, checkable number — not a claim.  This document explains how to produce
that number.

---

## Evaluation plan

### Step 1 — Data preparation

**Positive labels**: Real landslide events from the GSI Bhukosh database or
Mathew et al. (2014) NE-Himalaya catalogue (~490 events).  See
`docs/DATA_SOURCES.md` for access instructions.

**Negative labels (pseudo-absence)**: Random sampling of zone-days where no
landslide was recorded, matched to the zone and temporal distribution of
positive events to avoid severe class imbalance.  Use a 1:3 positive-to-negative
ratio as a starting point (adjust based on observed precision/recall).

**Features per event**:
- `intensity_ratio`: 72-hr rainfall / zone I-D threshold (normalized 0-1)
- `antecedent_ratio`: 30-day rainfall / zone E-threshold (normalized 0-1)
- `soil_moisture_norm`: soil_moisture_pct / 100.0
- `slope_norm`: mean_slope_deg / 45.0
- `history_norm`: historical_landslide_count / 4.0

### Step 2 — Train/test split

Use a **spatial grouped split** rather than random split to avoid data leakage:
- Assign each zone to one of 5 groups by district.
- Use 4 groups for training, 1 for test (rotate for cross-validation).
- This ensures the model is evaluated on zones it has never seen — the
  realistic deployment scenario.

### Step 3 — Model training

**Start with logistic regression** (the weighted sum in `recompute_risk()` is
literally logistic regression in the limit — coefficients map directly to
`weight_*` in `risk_model_config`).

```python
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import precision_recall_curve, auc

model = LogisticRegression(class_weight='balanced', max_iter=500)
model.fit(X_train, y_train)

proba = model.predict_proba(X_test)[:, 1]
precision, recall, thresholds = precision_recall_curve(y_test, proba)
pr_auc = auc(recall, precision)

# Recall at 80% precision operating point
idx = next((i for i, p in enumerate(precision) if p >= 0.80), None)
recall_at_80p = recall[idx] if idx is not None else 0.0
```

**If logistic regression PR-AUC < 0.65**: Try Random Forest with max_depth=5
(shallow enough to remain interpretable).  Extract feature importances and map
them to the weight columns.

### Step 4 — Extract coefficients

For logistic regression, the learned coefficients (after normalization to sum
to 1.0) become the new weights in `risk_model_config`:

```python
coefs = model.coef_[0]
coefs_normalized = coefs / coefs.sum()
# Map in feature order: intensity, antecedent, soil_moisture, slope, history
```

For a shallow decision tree or Random Forest, translate the split logic to
CASE/WHEN in the score computation, or use feature importances as surrogate
weights (less accurate but deployable in the same schema).

### Step 5 — Update risk_model_config

```sql
INSERT INTO public.risk_model_config (
  model_version, weight_intensity, weight_antecedent, weight_soil_moisture,
  weight_slope, weight_history, cutoff_moderate, cutoff_high, cutoff_severe,
  pr_auc, recall_at_80_precision, notes, is_active
) VALUES (
  'v0.2-logistic-regression',
  <w_intensity>, <w_antecedent>, <w_soil>, <w_slope>, <w_history>,
  <cutoff_mod>, <cutoff_high>, <cutoff_severe>,
  <pr_auc>, <recall_at_80p>,
  'Logistic regression on Mathew et al. 2014 NE-Himalaya catalogue. '
  'Spatial grouped CV by district. 1:3 positive:negative ratio.',
  false  -- set to true only after validating against smoke test
);
-- Then flip active flag:
UPDATE public.risk_model_config SET is_active = false WHERE is_active = true;
UPDATE public.risk_model_config SET is_active = true  WHERE model_version = 'v0.2-logistic-regression';
SELECT public.recompute_risk();
```

---

## Evaluation results

| Model version | PR-AUC | Recall @ 80% precision | Trained on | Evaluated on |
|---------------|--------|------------------------|------------|--------------|
| v0.1-hand-tuned | — | — | N/A (hand-tuned) | N/A |
| *(run notebook)* | | | | |

> Fill this table in after running `ml-notebooks/01_risk_calibration.ipynb`
> and update `risk_model_config` accordingly.

---

## Notebook

See [`ml-notebooks/01_risk_calibration.ipynb`](../ml-notebooks/01_risk_calibration.ipynb)
for the implementation.

---

## Judge Q&A framing

**"What's your PR-AUC?"**  
If the notebook has been run: cite the number from the table above and point to
`risk_model_config` (it's in the live database, not just a document claim).  
If not yet run: "Our current weights are hand-tuned from published research;
the evaluation notebook is ready and the `risk_model_config` table is designed
to receive the trained values — we can run it now."  Never fabricate a number.

**"Why logistic regression instead of deep learning?"**  
Logistic regression coefficients map directly to the weighted-sum formula in
`recompute_risk()` — the model IS the formula. This means every alert includes
an exact attribution of how much each factor contributed, which district
officers need to decide whether to evacuate a village.
