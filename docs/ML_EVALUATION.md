# Empirical ML Evaluation Report — Actual Reproducible Metrics

**Project**: Himalaya Sentinel / landalert-nexus (SIH26001)  
**Evaluation Script**: `scripts/ml_validation_full.py` & `scripts/train_and_export_artifact.py`  
**Dataset Fingerprint**: `f1054c5041ad8e672a45899f42f037d1f7cd15cc6f55256d8d7d68388ed2aa26`  
**Validation Strategy**: Spatial GroupKFold Cross-Validation (5 Folds, grouped by District)  
**Positive Event Count**: 8 verified rainfall-triggered landslides  
**Pseudo-Absence Count**: 24 deterministic pseudo-absences (3:1 ratio)  
**Total Feature Matrix**: 32 rows × 19 canonical features  

---

## 1. Primary Model Comparison

All metrics are strictly calculated via Spatial GroupKFold cross-validation across independent geographic districts (`East Sikkim`, `North Sikkim`, `Dima Hasao`, `Papum Pare`). Zero synthetic fixtures or GLOF events are included in the evaluation.

| Model Candidate | PR-AUC | Recall @ 80% Precision | Spatial Generalization | Decision / Status |
|:---|:---:|:---:|:---:|:---|
| **Random Guessing Baseline** | 0.2500 | 0.0000 | N/A | Theoretical floor ($P / (P + N) = 8/32$) |
| **Continuous Threshold Baseline** | 0.3230 | 0.0000 | Poor | $R_{3d} / I_{thr}$ scalar ranking |
| **Binary Threshold Baseline** | 0.4156 | 0.0000 | Moderate | Sikkim I-D binary trigger |
| **Random Forest Classifier** | 0.3608 | 0.0000 | Severely Overfitted | Rejected (Fails selection threshold) |
| **Logistic Regression (L2, C=1.0)** | **0.5934** | **0.1250** | Defensible Linear Trend | **Selected Active Production Model** |

### Selection Rule Verification
- **Rule**: Random Forest must exceed Logistic Regression PR-AUC by $>0.05$ to replace LR.
- **Evaluation**: $\text{RF PR-AUC } (0.3608) < \text{LR PR-AUC } (0.5934)$.
- **Outcome**: Logistic Regression is retained as the active model.

---

## 2. Spatial Cross-Validation Fold Breakdown

Spatial grouping ensures that `train_groups ∩ val_groups = ∅`. Scalers and preprocessing are fitted strictly on the training folds.

| Fold | Validation District | Positives | Pseudo-Absences | PR-AUC | Recall @ 80% Prec |
|:---:|:---|:---:|:---:|:---:|:---:|
| 1 | East Sikkim | 1 | 6 | 1.0000 | 1.0000 |
| 2 | North Sikkim (Zone 1) | 2 | 5 | 0.8500 | 0.5000 |
| 3 | Dima Hasao | 0 | 3 | N/A (0 pos) | 0.0000 |
| 4 | North Sikkim (Zone 2) | 1 | 4 | 1.0000 | 1.0000 |
| 5 | Papum Pare | 4 | 6 | 0.7639 | 0.2500 |
| **Pooled** | **All 5 Folds** | **8** | **24** | **0.5934** | **0.1250** |

*Note on Fold Metrics: Folds 1 and 4 contain only 1 positive event, making fold-level PR-AUC trivially 1.0. Fold 3 has 0 positives, making fold PR-AUC undefined. The pooled out-of-fold PR-AUC (0.5934) is the sole scientifically valid indicator of generalization.*

---

## 3. Controlled Ablation Study

Ablation evaluates the incremental value of feature groups under identical Spatial GroupKFold CV:

| Configuration | Feature Set | Dimension | PR-AUC | $\Delta$ vs Baseline |
|:---|:---|:---:|:---:|:---:|
| **Model A** | Rainfall Features Only (`rain_1d` .. `rain_3d_vs_e_thr`) | 9 | 0.3677 | +0.1177 vs random |
| **Model B** | Rainfall + Terrain (`slope_norm`, `slope_sin`, `slope_class`) | 12 | 0.4540 | +0.0863 vs Model A |
| **Model C** | Rainfall + Terrain + Historical Proximity | 14 | 0.4319 | -0.0221 vs Model B |
| **Model D** | All Available Features (including Cyclical & Monsoon) | 19 | **0.5934** | +0.1394 vs Model B |

### Soil Moisture Contribution in Training
- In the historical dataset (2018–2024), ERA5-Land soil moisture was unavailable for the training coordinates, requiring fallback to neutral 0.50 for all 32 rows.
- Consequently, soil moisture feature variance is **0.0000**.
- The trained Logistic Regression weights for `soil_moisture_latest` and `soil_moisture_7d_trend` are mathematically **0.0000**.
- The model learns **zero** empirical soil moisture relationship from this training run.

---

## 4. Uncertainty & Small-Sample Confidence Intervals

Due to small sample size ($N = 8$ positives), metric confidence intervals were generated via 1,000 stratified bootstrap resamples:

| Model | Point Estimate | Bootstrap Mean | Bootstrap Std Dev | 95% Confidence Interval |
|:---|:---:|:---:|:---:|:---:|
| **Logistic Regression** | 0.5934 | 0.5926 | 0.2238 | **[0.1539, 1.0000]** |
| **Random Forest** | 0.3608 | 0.3725 | 0.2372 | **[0.1250, 1.0000]** |

The 95% confidence interval for Logistic Regression spans from 0.1539 (below random chance) to 1.0000. This wide interval proves that **the current dataset cannot statistically distinguish a superior model from random variation**.

---

## 5. Active Model Specification

- **Model Version**: `v0.2-lr-trained`
- **Model Type**: Logistic Regression (L2 Regularization, $C=1.0$, balanced class weighting)
- **Feature Schema**: `v1.0.0` (19 features)
- **Intercept**: $+0.2796$
- **Top Positive Weights**:
  - `rain_1d`: $+1.2868$
  - `rain_30d`: $+0.5002$
  - `day_of_year_sin`: $+0.4471$
  - `is_monsoon`: $+0.2575$
- **Top Negative Weights**:
  - `day_of_year_cos`: $-1.3333$
  - `dist_to_nearest_event_km`: $-0.7178$
  - `rain_15d`: $-0.5437$
  - `rain_7d`: $-0.5139$
