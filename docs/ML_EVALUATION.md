# Empirical ML Evaluation Report — Actual Reproducible Metrics

**Project**: Himalaya Sentinel / landalert-nexus (SIH26001)  
**Evaluation Script**: `scripts/ml_validation_full.py` & `scripts/train_and_export_artifact.py`  
**Candidate Model**: `v0.3-lr-trained` (Artifact: `models/v0.3-lr-trained.json`)  
**Active Production Model**: `v0.2-lr-trained` (Registry ID 4, gated and active)  
**Dataset Fingerprint**: `c8ff20879e0da6e07669d0669bcfc70438cf3ff9655f528a478be3fc735e5d3c`  
**Validation Strategy**: Spatial GroupKFold Cross-Validation (5 Folds, grouped by District)  
**Positive Event Count**: 15 verified rainfall-triggered landslides across all 15 zones (1 GLOF quarantined)  
**Pseudo-Absence Count**: 41 deterministic pseudo-absences (from 45 generated, 4 skipped due to antecedent weather coverage)  
**Total Feature Matrix**: 56 rows × 19 canonical features

---

## 1. Primary Model Comparison

All metrics are strictly calculated via Spatial GroupKFold cross-validation across independent geographic districts (15 unique districts across all 8 NER states). Zero synthetic fixtures or GLOF events are included in the evaluation.

| Model Candidate                     |   PR-AUC   | Recall @ 80% Precision | Spatial Generalization  | Decision / Status                                           |
| :---------------------------------- | :--------: | :--------------------: | :---------------------: | :---------------------------------------------------------- |
| **Random Guessing Baseline**        |   0.2679   |         0.0000         |           N/A           | Theoretical floor ($P / (P + N) = 15/56$)                   |
| **Continuous Threshold Baseline**   |   0.4821   |         0.0667         |        Moderate         | $R_{3d} / I_{thr}$ scalar ranking                           |
| **Binary Threshold Baseline**       |   0.5381   |         0.0000         |        Moderate         | Zone I-D binary trigger                                     |
| **Random Forest Classifier**        |   0.4452   |         0.0000         |   Severely Overfitted   | Rejected (Fails selection threshold; RF PR-AUC < Threshold) |
| **Logistic Regression (L2, C=1.0)** | **0.6363** |       **0.0667**       | Defensible Linear Trend | **Candidate Model (`v0.3-lr-trained`, Validated / Inactive)**|

### Selection Rule Verification

- **Rule**: Random Forest must exceed Logistic Regression PR-AUC by $>0.05$ to replace LR.
- **Evaluation**: $\text{RF PR-AUC } (0.4452) < \text{LR PR-AUC } (0.6363)$.
- **Outcome**: Logistic Regression is retained as the candidate model architecture. Activation remains manual per safety rules.

---

## 2. Spatial Cross-Validation Fold Breakdown

Spatial grouping ensures that $\text{train\_groups} \cap \text{val\_groups} = \emptyset$. Scalers and preprocessing are fitted strictly on the training folds.

|    Fold    | Validation Districts                       | Positives | Pseudo-Absences |   PR-AUC    | Recall @ 80% Prec |
| :--------: | :----------------------------------------- | :-------: | :-------------: | :---------: | :---------------: |
|     1      | Aizawl, Dibang Valley, Noney               |     4     |        8        |   1.0000    |      1.0000       |
|     2      | East Sikkim, Karbi Anglong, Tamenglong     |     2     |        9        |   0.2583    |      0.0000       |
|     3      | Dima Hasao, Dimapur, Mangan                |     3     |        8        |   0.8500    |      0.6667       |
|     4      | Dhalai, East Khasi Hills, Lunglei          |     3     |        8        |   0.8500    |      0.6667       |
|     5      | Kohima, Papum Pare, West Jaintia Hills     |     3     |        8        |   0.6556    |      0.3333       |
| **Pooled** | **All 5 Folds**                            |  **15**   |     **41**      | **0.6363**  |    **0.0667**     |

_Note on Fold Metrics: With 15 positive events distributed across all 15 zones and districts, every single validation fold contains 2 to 4 positive events (mean fold PR-AUC = 0.7228). The pooled out-of-fold PR-AUC (0.6363) represents the authoritative cross-validation metric across all 56 predictions._

---

## 3. Controlled Ablation Study

Ablation evaluates the incremental value of feature groups under identical Spatial GroupKFold CV:

| Configuration | Feature Set                                                                 | Dimension |   PR-AUC   | $\Delta$ vs Baseline |
| :------------ | :-------------------------------------------------------------------------- | :-------: | :--------: | :------------------: |
| **Model A**   | Rainfall Features Only (`rain_1d` .. `rain_3d_vs_e_thr`)                    |     9     |   0.4064   |  -0.0756 vs threshold|
| **Model B**   | Rainfall + Terrain 90th-Percentile (`slope_norm`, `slope_sin`, `slope_class`)|    12     |   0.5076   |  +0.0255 vs threshold|
| **Model C**   | Rainfall + Terrain + Historical Proximity                                   |    14     |   0.5291   |  +0.0470 vs threshold|
| **Model D**   | All Available Features (including Cyclical & Monsoon)                       |    19     | **0.6363** |  +0.1542 vs threshold|

### Soil Moisture Contribution in Training

- In the historical reanalysis archive (2016–2024), Open-Meteo ERA5-Land historical reanalysis returns `null` for fractional layers `0_to_1cm` and `1_to_3cm`.
- Consequently, all historical training rows remain on the neutral fallback ($\text{value} = 0.50, \text{trend} = 0.00$), and feature variance is **0.0000**.
- The trained Logistic Regression weights for `soil_moisture_latest` and `soil_moisture_7d_trend` are mathematically **0.0000**.
- The model learns **zero** empirical soil moisture relationship from this training run.

---

## 4. Uncertainty & Small-Sample Confidence Intervals

Metric confidence intervals were computed via 1,000 stratified bootstrap resamples ($N = 56$, 15 positives, 41 pseudo-absences):

| Model                   | Point Estimate | Bootstrap Mean | Bootstrap Std Dev | 95% Confidence Interval |
| :---------------------- | :------------: | :------------: | :---------------: | :---------------------: |
| **Logistic Regression** |     0.6363     |     0.6656     |      0.1772       |  **[0.3021, 1.0000]**   |
| **Random Forest**       |     0.4452     |     0.5676     |      0.1879       |  **[0.2400, 0.9382]**   |

The 95% confidence interval for Logistic Regression spans from 0.3021 to 1.0000 (width = 0.6979). While the lower bound now exceeds random chance (0.2679), the interval still spans across the continuous threshold baseline (0.4821). This statistical reality confirms that **the empirical result remains statistically inconclusive due to sample size**, even as the point estimate shows positive improvement ($\Delta = +0.1542$).

---

## 5. Candidate Model Specification (`v0.3-lr-trained`)

- **Model Version**: `v0.3-lr-trained` (Candidate / Inactive)
- **Model Type**: Logistic Regression (L2 Regularization, $C=1.0$, balanced class weighting)
- **Feature Schema**: `v1.0.0` (19 features)
- **Intercept**: $-1.3781$
- **Top Positive Weights**:
  - `rain_1d`: $+1.6021$
  - `day_of_year_sin`: $+0.6331$
  - `is_monsoon`: $+0.4188$
  - `rain_30d`: $+0.3790$
  - `threshold_exceedance_flag`: $+0.3460$
  - `historical_event_density`: $+0.1480$
  - `dist_to_nearest_event_km`: $+0.0475$
- **Top Negative Weights**:
  - `day_of_year_cos`: $-1.6759$
  - `rain_7d`: $-0.7248$
  - `rain_15d`: $-0.6127$
  - `slope_sin`: $-0.4966$
  - `slope_norm`: $-0.4471$
  - `rain_intensity_max_1d`: $-0.2524$
  - `slope_class`: $-0.2280$
  - `antecedent_wetness_index`: $-0.1765$
  - `rain_3d`: $-0.0614$
  - `rain_3d_vs_e_thr`: $-0.0249$
- **Zero Weights (Fallback)**:
  - `soil_moisture_latest`: $0.0000$
  - `soil_moisture_7d_trend`: $0.0000$
