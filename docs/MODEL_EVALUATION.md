# Himalaya Sentinel ML Validation & Scientific Evaluation Report

> **Document Type**: Technical ML Audit & Evaluation Report  
> **Repository**: `landalert-nexus` (SIH26001 — Landslide Early Warning for NER)  
> **Evaluation Date**: 2026-09-04  
> **Active Model Version**: `v0.2-lr-trained`  
> **Database Fingerprint**: `f1054c5041ad8e672a45899f42f037d1f7cd15cc6f55256d8d7d68388ed2aa26`  
> **Test Suite Status**: 29/29 Passing (14 Vitest + 15 Python Leakage Tests)

---

## Executive Summary & Production Status

| Category                  | Classification                  | Assessment & Rationale                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ------------------------- | ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Engineering Readiness** | **READY**                       | End-to-end pipeline is fully reproducible, deterministic, and leakage-free. Automated backfill (`scripts/backfill_weather_open_meteo.py`), training audit (`scripts/ml_audit_pipeline.py`), and validation (`scripts/ml_validation_full.py`) execute without errors. PostgreSQL database constraints enforce a single active model row. Soil-moisture status metadata (`measured`, `stale`, `missing`, `fallback`) is explicitly tracked and exposed.                      |
| **Scientific Readiness**  | **DATA-LIMITED / INCONCLUSIVE** | Only 8 verified rainfall-triggered landslide events exist in the training catalogue. The 95% bootstrap confidence interval for PR-AUC spans $[0.1250, 1.0000]$, overlapping both the chance baseline ($0.2500$) and the threshold-only baseline ($0.3230$). Soil moisture is constant ($0.5$) across all historical training samples. **Additional verified landslide events are strictly required before stronger claims about predictive superiority can be justified.** |

---

## 1. Dataset

The dataset integrates historical landslide records from North Eastern Region (NER) literature with multi-year meteorological reanalysis.

- **Total Historical Landslide Records**: 39
  - **Synthetic Demo Records**: 30 (labeled `is_synthetic = true`, excluded from ML training)
  - **Real Historical Events**: 9 (labeled `is_synthetic = false`)
    - **Rainfall Slope Failures**: 8 events (used as ML training positives)
    - **Glacial Lake Outburst Floods (GLOF)**: 1 event (South Lhonak Lake breach, 2023-10-04, Zone 11; excluded from rainfall-triggered slope failure training)
- **Meteorological Data**: 49,770 daily weather readings across all 15 risk zones:
  - 49,320 rows backfilled from Open-Meteo ERA5-Land Historical Reanalysis (2016-01-01 to 2024-12-31)
  - 450 rows from IMD/SMAP fixture data (August–September 2026)
- **Dataset Fingerprint (SHA-256)**: `f1054c5041ad8e672a45899f42f037d1f7cd15cc6f55256d8d7d68388ed2aa26` (computed over the 32 × 21 matrix of features, labels, and zone IDs).

---

## 2. Feature Matrix

The feature matrix consists of **32 observations × 19 features**, with **0 missing (NaN) values**.

| Feature Group                     | Column Name                 | Description & Formula                                                           | Value Range in Training Set                 |
| --------------------------------- | --------------------------- | ------------------------------------------------------------------------------- | ------------------------------------------- |
| **Rainfall Accumulation**         | `rain_1d`                   | 1-day antecedent rainfall                                                       | 0.0 – 90.0 mm                               |
|                                   | `rain_3d`                   | 3-day antecedent rainfall                                                       | 0.0 – 162.1 mm                              |
|                                   | `rain_7d`                   | 7-day antecedent rainfall                                                       | 0.0 – 359.8 mm                              |
|                                   | `rain_15d`                  | 15-day antecedent rainfall                                                      | 0.0 – 907.2 mm                              |
|                                   | `rain_30d`                  | 30-day antecedent rainfall                                                      | 0.0 – 1642.4 mm                             |
| **Rainfall Intensity & Dynamics** | `rain_intensity_max_1d`     | Peak 1-day rainfall within 30-day window                                        | 0.0 – 210.0 mm                              |
|                                   | `antecedent_wetness_index`  | Exponentially decayed 30-day rainfall ($\alpha = 0.90$)                         | 0.0 – 436.4                                 |
|                                   | `threshold_exceedance_flag` | Binary flag ($1$ if 3-day intensity exceeds zone I-D threshold)                 | 0 or 1                                      |
|                                   | `rain_3d_vs_e_thr`          | Continuous ratio: $\text{rain\_3d} / E_{\text{threshold}}$                      | 0.0 – 1.05                                  |
| **Soil Moisture**                 | `soil_moisture_latest`      | Latest soil moisture fraction (0–1 scale)                                       | 0.500 (constant fallback)                   |
|                                   | `soil_moisture_7d_trend`    | 7-day normalized rate of change in soil moisture                                | 0.000 (constant fallback)                   |
| **Terrain Susceptibility**        | `slope_norm`                | SRTM 30m DEM mean slope normalized by $45^\circ$                                | 0.022 – 0.624                               |
|                                   | `slope_sin`                 | Sine of mean slope angle ($\sin \theta$)                                        | 0.017 – 0.471                               |
|                                   | `slope_class`               | Ordinal slope category ($0: <15^\circ$, $1: 15^\circ-30^\circ$, $2: >30^\circ$) | 0 or 1                                      |
| **Spatial Proximity**             | `dist_to_nearest_event_km`  | Haversine distance to nearest known historical landslide                        | 1.5 – 337.7 km                              |
|                                   | `historical_event_density`  | Number of events within 50 km radius (normalized by 4)                          | 0.0 – 0.75                                  |
| **Seasonality & Calendar**        | `day_of_year_sin`           | $\sin(2\pi \cdot \text{DOY} / 365)$                                             | -0.999 – +0.999                             |
|                                   | `day_of_year_cos`           | $\cos(2\pi \cdot \text{DOY} / 365)$                                             | -0.999 – +0.999                             |
|                                   | `is_monsoon`                | Binary indicator for monsoon season (June to September)                         | 0 or 1 (46% in absences, 100% in positives) |

---

## 3. Label Methodology & Positive Verification

Every positive training instance represents a confirmed, documented landslide in the North Eastern Region triggered by precipitation.

### Audit of the 8 Positive Events

| #     | Event Date | Zone & Name            | District & State            | Lat, Lng     | Severity | Slope | 3d Rain  | SM Status      | Source Documentation                                                                         |
| ----- | ---------- | ---------------------- | --------------------------- | ------------ | -------- | ----- | -------- | -------------- | -------------------------------------------------------------------------------------------- |
| **1** | 2018-06-07 | Zone 3: Aizawl East    | Aizawl, Mizoram             | 23.74, 92.74 | Moderate | 28.1° | 40.0 mm  | Fallback (0.5) | Pachuau & Lallianthanga (2017) _IJDR_ 7(3):76-84; NDMA Mizoram DMP 2019 trigger catalogue.   |
| **2** | 2019-08-01 | Zone 5: Shillong-Sohra | East Khasi Hills, Meghalaya | 25.29, 91.73 | Moderate | 1.0°* | 97.1 mm  | Fallback (0.5) | NDMA Meghalaya State DMP 2019; PIB August 2019 NE landslides bulletin; Sohra escarpment.     |
| **3** | 2020-07-13 | Zone 7: Kohima Ridge   | Kohima, Nagaland            | 25.66, 94.12 | Minor    | 18.6° | 58.2 mm  | Fallback (0.5) | GSI Nagaland Hazard Zonation Report (2014); NDMA Nagaland SDMP 2022 trigger catalogue.       |
| **4** | 2021-05-25 | Zone 13: Haflong Hills | Dima Hasao, Assam           | 25.16, 93.03 | Moderate | 23.5° | 18.3 mm  | Fallback (0.5) | Boro et al. (2021) _Landslides_ 18(4):1533-1547; pre-monsoon NH-27 blockage.                 |
| **5** | 2022-06-30 | Zone 2: Noney          | Noney, Manipur              | 24.82, 93.68 | Major    | 6.4°  | 25.7 mm  | Fallback (0.5) | Tupul/Marangching railway yard disaster (61 fatalities); _Down to Earth_ (2022-07-01); NDTV. |
| **6** | 2022-07-04 | Zone 2: Noney          | Noney, Manipur              | 24.80, 93.71 | Moderate | 6.4°  | 21.8 mm  | Fallback (0.5) | NH-37 Irang River valley blockage; _The Hindu_ (July 2022 NE India landslides).              |
| **7** | 2023-06-15 | Zone 12: Mangan North  | Mangan, Sikkim              | 27.50, 88.54 | Moderate | 24.7° | 162.1 mm | Fallback (0.5) | Singtam-Dikchu-Mangan corridor landslides (~3500 stranded); _India Today NE_ (June 2023).    |
| **8** | 2024-07-30 | Zone 1: Tamenglong     | Tamenglong, Manipur         | 24.97, 93.51 | Moderate | 9.2°  | 18.6 mm  | Fallback (0.5) | Dimthanlong village mudslide (Ward 3); 2 fatalities; NH-37 severed; _The Sangai Express_.    |

_\*Note on Zone 5_: Zone 5 (Shillong-Sohra Escarpment) has a zone-averaged DEM slope of $1.0^\circ$ because the polygon centroid sits on the Cherrapunji plateau surface, while the failure occurred on the incised escarpment flank. This limitation is noted and preserved without manual tampering.

### Excluded Event (GLOF)

- **2023-10-04 (Zone 11, East Sikkim)**: Chungthang / Teesta basin flash flood triggered by South Lhonak Lake glacial outburst. Correctly categorized as `hazard_type = 'glof_triggered'` and excluded from rainfall-triggered slope failure modeling.

---

## 4. Pseudo-Absence Methodology

Due to the absence of systematically recorded "non-landslide" dates in historical monitoring archives, pseudo-absences were generated under strict physical and temporal constraints:

1. **Spatial Buffer Exclusion**: $\ge 1.0\text{ km}$ minimum separation from any known historical landslide location.
2. **Terrain Susceptibility Restriction**: Sampled exclusively from risk zones with DEM mean slope $> 5.0^\circ$ (excluding flat plains where landslides are physically impossible).
3. **Temporal Exclusion**: Absence dates must not fall within $\pm 14\text{ days}$ of any known event in the same zone.
4. **Class Imbalance Ratio**: Exactly 3:1 negative-to-positive ratio ($24$ pseudo-absences to $8$ positives).
5. **Deterministic Sampling**: Seed `RANDOM_SEED = 42` guarantees 100% exact reproduction across environments.
6. **Seasonal Challenge**: 11 of the 24 pseudo-absences ($46\%$) were sampled during the active monsoon season (June–September) to ensure the model does not merely learn "rain = slide" without distinguishing triggering spikes from baseline seasonal rain.

Validation check results:

- Slope violations ($< 5.0^\circ$): **0**
- Spatial buffer violations ($< 1.0\text{ km}$): **0**
- Temporal violations ($< \pm 14\text{ days}$): **0**

---

## 5. Leakage Controls

Three levels of leakage prevention were implemented and audited:

1. **Temporal Precedence**: Feature extraction enforces strict inequality `reading_date < event_date`. Same-day rainfall ($T$) and future rainfall ($T+1, T+2$) are excluded. If weather data is unavailable before the event date, the pipeline returns `None` rather than fabricating zeros.
2. **Spatial Cross-Validation**: Validation is partitioned using `GroupKFold(n_splits=5)` grouped strictly by **administrative district**. No district appears simultaneously in both the training set and validation set in any fold.
3. **Automated Regression Suite**: 15 automated test cases in `scripts/test_ml_leakage.py` verify temporal isolation, exponential decay invariance, threshold boundary triggers, and coordinate calculations.

---

## 6. Validation Strategy

Evaluation uses **Spatial GroupKFold ($n=5$ splits)** grouped by administrative district across the 10 represented districts:
`['Aizawl', 'Dibang Valley', 'Dima Hasao', 'East Khasi Hills', 'East Sikkim', 'Kohima', 'Lunglei', 'Mangan', 'Noney', 'Tamenglong']`.

### Headline Evaluation Metrics

- **PR-AUC (Precision-Recall Area Under Curve)**: Primary metric under severe class imbalance ($25\%$ positive prevalence).
- **Recall @ 80% Precision**: Primary operating point indicating the percentage of real landslides captured before the false discovery rate exceeds $20\%$.

---

## 7. Baseline Results

The engineering threshold baseline is derived from the published empirical rainfall thresholds used in the operational PL/pgSQL engine:

- Intensity threshold: $I = \alpha \cdot D^\beta$
- Cumulative moisture threshold: $E(D) = -11.10 + 0.62 \cdot D_{\text{hours}}$

When evaluating on the identical 32 observations:

- **Random Chance Baseline** (prevalence $8/32$): **PR-AUC = 0.2500**
- **Threshold Exceedance (Binary Flag)**: **PR-AUC = 0.4156**
  - Positives exceeding threshold: $3 / 8$ ($37.5\%$ true positive rate)
  - Negatives exceeding threshold: $7 / 24$ ($29.2\%$ false positive rate)
- **Continuous Exceedance Ratio (`rain_3d_vs_e_thr`)**: **PR-AUC = 0.3230**
  - Recall @ 80% precision: **0.0000** (the threshold signal alone cannot achieve 80% precision at any decision boundary)

---

## 8. Logistic Regression Results

- **Cross-Validated PR-AUC**: **0.5934**
- **Recall @ 80% Precision**: **0.1250** (captures 1 of the 8 events at $\ge 80\%$ precision)
- **Hyperparameters**: `class_weight='balanced'`, $C=1.0$, `max_iter=1000`
- **Improvement over Chance**: $+0.3434$ PR-AUC
- **Improvement over Continuous Threshold Baseline**: $+0.2704$ PR-AUC

---

## 9. Random Forest Results

- **Cross-Validated PR-AUC**: **0.3608**
- **Recall @ 80% Precision**: **0.0000**
- **Hyperparameters**: `n_estimators=200`, `max_depth=5`, `class_weight='balanced'`
- **Selection Decision**: Random Forest fails the model selection criterion (must outperform Logistic Regression by $>0.05$ PR-AUC). Non-linear tree ensembles overfit severely on $N=8$ positive events under spatial cross-validation. Logistic Regression is retained as the active model architecture.

---

## 10. Model Comparison Summary

| Model / Mechanism                                       | PR-AUC     | Recall @ 80% Precision | Δ vs. Chance ($0.2500$) | Δ vs. Threshold Baseline ($0.3230$) | Status                   |
| ------------------------------------------------------- | ---------- | ---------------------- | ----------------------- | ----------------------------------- | ------------------------ |
| **Random Chance**                                       | 0.2500     | —                      | —                       | -0.0730                             | Reference Floor          |
| **Threshold Continuous (`rain_3d_vs_e_thr`)**           | 0.3230     | 0.0000                 | +0.0730                 | Baseline                            | Operational Rule         |
| **Threshold Binary Flag (`threshold_exceedance_flag`)** | 0.4156     | —                      | +0.1656                 | +0.0926                             | Operational Binary Alert |
| **Random Forest Classifier**                            | 0.3608     | 0.0000                 | +0.1108                 | +0.0378                             | Rejected (Overfitting)   |
| **Logistic Regression (Active `v0.2-lr-trained`)**      | **0.5934** | **0.1250**             | **+0.3434**             | **+0.2704**                         | **Selected Model**       |

---

## 11. Ablation Study

An ablation study was executed to determine the empirical contribution of each feature group:

| Feature Subset                        | Feature Count | Features Included                                                                                      | LR PR-AUC  | RF PR-AUC | Δ vs. Threshold Baseline |
| ------------------------------------- | ------------- | ------------------------------------------------------------------------------------------------------ | ---------- | --------- | ------------------------ |
| **A: Rainfall only**                  | 9             | `rain_1d`..`rain_30d`, `rain_intensity_max_1d`, `awi`, `threshold_exceedance_flag`, `rain_3d_vs_e_thr` | 0.3677     | 0.2212    | +0.0447                  |
| **B: Rainfall + Terrain**             | 12            | Set A + `slope_norm`, `slope_sin`, `slope_class`                                                       | 0.4540     | 0.2308    | +0.1309                  |
| **C: Rainfall + Terrain + Proximity** | 14            | Set B + `dist_to_nearest_event_km`, `historical_event_density`                                         | 0.3535     | 0.2255    | +0.0305                  |
| **D: All Features (Full Pipeline)**   | 19            | Set C + `soil_moisture_latest`, `soil_moisture_7d_trend`, `day_of_year_sin/cos`, `is_monsoon`          | **0.5934** | 0.3608    | **+0.2704**              |

### Scientific Findings from Ablation

1. **Terrain Slope is Critical**: Adding DEM slope features (Set B) yields the cleanest physical gain ($+0.0863$ PR-AUC over rainfall alone), aligning with geotechnical domain knowledge that rainfall thresholds must be conditioned on slope gradient.
2. **Proximity Features Cause Noise at $N=8$**: Adding historical event distance in Set C degrades performance without seasonal controls, because 8 events across 8 distinct states provide sparse spatial clustering.
3. **Soil Moisture Features are Non-Informative**: In the current historical dataset, `soil_moisture_latest` has a standard deviation of **$0.000000$** across all 32 rows (all defaulted to the neutral $0.5$ fallback). Therefore, soil moisture contributes zero variance to model predictions. The performance lift between Set C and Set D is driven entirely by the temporal monsoon features (`is_monsoon`, `day_of_year_sin/cos`).

---

## 12. Fold-Level Results

Aggregate cross-validated PR-AUC can mask severe fold-level variance. Below is the full per-fold breakdown for the 5 spatial folds:

| Fold       | Held-Out Validation District(s)      | Positives | Negatives | LR PR-AUC | LR Recall @ 80% Prec | RF PR-AUC | RF Recall @ 80% Prec | Statistical Reliability Note                  |
| ---------- | ------------------------------------ | --------- | --------- | --------- | -------------------- | --------- | -------------------- | --------------------------------------------- |
| **Fold 1** | Aizawl                               | 1         | 5         | 1.0000    | 1.0000               | 1.0000    | 1.0000               | Single positive — metric sensitive            |
| **Fold 2** | Dima Hasao, Noney                    | 3         | 4         | 0.8500    | 0.6667               | 0.9028    | 0.6667               | Multi-event fold — representative             |
| **Fold 3** | Dibang Valley, Lunglei               | 0         | 7         | **N/A**   | **N/A**              | **N/A**   | **N/A**              | **Zero positives in fold — metric undefined** |
| **Fold 4** | East Sikkim, Kohima                  | 1         | 5         | 1.0000    | 1.0000               | 0.2500    | 0.0000               | Single positive — metric sensitive            |
| **Fold 5** | East Khasi Hills, Mangan, Tamenglong | 3         | 3         | 0.7639    | 0.3333               | 0.5139    | 0.0000               | Multi-event fold — representative             |

### Statistical Distribution Across Defined Folds ($n=4/5$)

- **Logistic Regression PR-AUC**:
  - Mean: **0.9035**
  - Standard Deviation: **0.1012**
  - Range: **[0.7639, 1.0000]**
- **Random Forest PR-AUC**:
  - Mean: **0.6667**
  - Standard Deviation: **0.3016**
  - Range: **[0.2500, 1.0000]**

> **Diagnostic Insight**: Pooling predictions across folds yields an aggregate PR-AUC of **0.5934**, whereas averaging per-fold PR-AUCs yields **0.9035**. This discrepancy arises because Fold 1 and Fold 4 each contain only a single positive event that ranked first within its respective fold (artificially achieving PR-AUC = 1.0). In Fold 3, PR-AUC cannot be calculated because the held-out districts contain no historical landslide events.

---

## 13. Soil-Moisture Fallback & Inference Metadata

### Status in Training Data

All 32 training instances received `soil_moisture_latest = 0.50` (neutral fallback) because the Open-Meteo ERA5-Land Historical Archive does not provide hourly sub-surface moisture for the 2016–2024 coordinates in this region.

### Production Inference Architecture

To ensure transparent operations and prevent hidden fallbacks during live scoring, migration `20260904182000_add_soil_moisture_inference_metadata.sql` added explicit tracking to `public.risk_zones` and `public.recompute_risk()`:

```sql
ALTER TABLE public.risk_zones
  ADD COLUMN soil_moisture_pct DOUBLE PRECISION DEFAULT 50.0,
  ADD COLUMN soil_moisture_status TEXT NOT NULL DEFAULT 'fallback'
    CHECK (soil_moisture_status IN ('measured', 'stale', 'missing', 'fallback')),
  ADD COLUMN soil_moisture_reading_time TIMESTAMPTZ;
```

Inference distinguishes 4 discrete operational states:

1. `measured`: A verified sensor or satellite reading recorded within the last 72 hours.
2. `stale`: A reading exists, but the latest observation is older than 72 hours.
3. `missing`: No soil moisture record exists for this risk zone in `weather_readings`.
4. `fallback`: Default neutral constant ($50.0\%$) applied when readings are missing or disabled.

The dynamic explanation string directly exposes this metadata to emergency managers:

> _"Soil moisture: 50.8% (status: measured — fresh within 72h, recorded 2026-09-04 17:43)."_

---

## 14. Uncertainty Analysis & Model Value Verdict

### Uncertainty Quantification

A stratified bootstrap evaluation ($2,000$ resamples with replacement, seed `42`) was conducted to evaluate out-of-bag metric stability:

- **Logistic Regression 95% Confidence Interval**: **$[0.1250, 1.0000]$** (Mean: $0.4719$, Std: $0.2408$, CI Width: $0.8750$)
- **Random Forest 95% Confidence Interval**: **$[0.1250, 1.0000]$** (Mean: $0.4287$, Std: $0.2205$, CI Width: $0.8750$)

**Statistical Caveat**:
With $N=8$ positive events, confidence intervals span $>87\%$ of the entire PR-AUC unit interval. The lower bound ($0.1250$) falls below the chance baseline ($0.2500$), and the interval fully encompasses the threshold baseline ($0.3230$). Furthermore, bootstrap assumptions of independent and identically distributed (i.i.d.) observations are violated by spatial autocorrelation across Himalayan catchments. Manufacturing narrow confidence bounds on this sample size would be scientifically dishonest.

### Objective Model Value Verdict

> **Verdict: INCONCLUSIVE DUE TO SAMPLE SIZE**

**Scientific Evaluation**:
Does the current Logistic Regression demonstrate sufficient evidence of improvement over the threshold-only baseline to justify calling it an ML enhancement?

- **Nominal Point Estimate**: LR ($0.5934$) outperforms the continuous threshold ($0.3230$) and chance ($0.2500$).
- **Statistical Significance**: **Unproven**. The wide confidence interval and single-event folds demonstrate that this performance could be a statistical artifact of the 8 selected events.
- **Conclusion**: The current ML model represents an **implemented, auditable prototype**, but there is **insufficient empirical evidence** to claim a proven operational improvement over the physics-based threshold engine.

---

## 15. Required Future Data & Retraining Triggers

### Data Ingestion Plan

To achieve statistical significance and transition the ML pipeline from **INCONCLUSIVE** to **SCIENTIFICALLY VALIDATED**, the following data must be ingested:

1. **Target Volume**: Minimum $\ge 20$ (ideally $\ge 50$) geocoded, verified rainfall-triggered landslide events across all 15 risk zones ($\ge 3$ events per cross-validation fold).
2. **Authoritative Sources**:
   - NASA COOLR (Cooperative Open Online Landslide Repository)
   - Geological Survey of India (GSI) Bhukosh portal
   - NRSC/ISRO Landslide Atlas of India (1998–2022 database)
   - State Disaster Management Authority (SDMA) incident logs for Assam, Manipur, Meghalaya, Mizoram, Nagaland, and Sikkim.
3. **Continuous Soil Moisture Ingestion**: High-resolution daily satellite soil moisture (NASA-USDA SMAP L4 or IMD automatic agro-meteorological station telemetry) to replace the current constant fallback.

### Formal Retraining Triggers

The model registry and automated pipeline will trigger retraining under any of the following events:

1. **Data Ingestion Trigger**: When $\ge 10$ new verified rainfall-triggered events are inserted into `historical_landslides`.
2. **Annual Seasonal Trigger**: On **June 1** of each year (pre-monsoon audit) using the prior calendar year's validated landslide reports.
3. **Threshold Recalibration Trigger**: When any zone's published empirical $I$-$D$ or $E(D)$ threshold is updated via new peer-reviewed literature.
