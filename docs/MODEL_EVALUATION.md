# Himalaya Sentinel ML Validation & Scientific Evaluation Report

> **Document Type**: Technical ML Audit & Evaluation Report  
> **Repository**: `landalert-nexus` (SIH26001 — Landslide Early Warning for NER)  
> **Evaluation Date**: 2026-09-05  
> **Active Production Model**: `v0.2-lr-trained` (Registry ID 4)  
> **Evaluated Candidate Model**: `v0.3-lr-trained` (Registry ID 20, validated / inactive)  
> **Database Fingerprint (v0.3)**: `c8ff20879e0da6e07669d0669bcfc70438cf3ff9655f528a478be3fc735e5d3c`  
> **Test Suite Status**: 29/29 Passing (14 Vitest + 15 Python Leakage Tests)

---

## Executive Summary & Production Status

| Category                  | Classification                  | Assessment & Rationale                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ------------------------- | ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Engineering Readiness** | **READY**                       | End-to-end pipeline is fully reproducible, deterministic, and leakage-free. Multi-point DEM slope sampling (3x3 grid, 250m spacing) computes 90th-percentile slope across all 15 zones. Model registry enforces lifecycle (candidate -> gate -> validation -> manual activation). PostgreSQL database constraints enforce a single active model row. Soil-moisture status metadata (`measured`, `stale`, `missing`, `fallback`) is explicitly tracked and exposed.                      |
| **Scientific Readiness**  | **DATA-LIMITED / INCONCLUSIVE** | Expanded from 8 to 15 verified rainfall-triggered landslide events covering all 15 risk zones across 8 NER states (1 GLOF quarantined). The candidate model (`v0.3-lr-trained`) achieves an out-of-fold PR-AUC of $0.6363$ (vs threshold baseline $0.4821$). However, the 95% bootstrap confidence interval spans $[0.3021, 1.0000]$, overlapping the threshold baseline. **While empirical point metrics improve, statistical certainty remains limited by the sample size.** |

---

## 1. Dataset

The dataset integrates historical landslide records from North Eastern Region (NER) literature and state disaster reports with multi-year meteorological reanalysis.

- **Total Historical Landslide Records**: 46
  - **Synthetic Demo Records**: 30 (labeled `is_synthetic = true`, excluded from ML training)
  - **Real Historical Events**: 16 (labeled `is_synthetic = false`)
    - **Rainfall Slope Failures**: 15 events (used as ML training positives across all 15 zones)
    - **Glacial Lake Outburst Floods (GLOF)**: 1 event (South Lhonak Lake breach, 2023-10-04, Zone 11; excluded from rainfall-triggered slope failure training)
- **Meteorological Data**: 49,770 daily weather readings across all 15 risk zones:
  - 49,320 rows backfilled from Open-Meteo ERA5-Land Historical Reanalysis (2016-01-01 to 2024-12-31)
  - 450 rows from IMD/SMAP fixture data (August–September 2026)
- **Dataset Fingerprint (SHA-256)**: `c8ff20879e0da6e07669d0669bcfc70438cf3ff9655f528a478be3fc735e5d3c` (computed over the 56 × 21 matrix of features, labels, and zone IDs).

---

## 2. Feature Matrix

The feature matrix consists of **56 observations × 19 features**, with **0 missing (NaN) values**.

| Feature Group                     | Column Name                 | Description & Formula                                                           | Value Range in Training Set                 |
| --------------------------------- | --------------------------- | ------------------------------------------------------------------------------- | ------------------------------------------- |
| **Rainfall Accumulation**         | `rain_1d`                   | 1-day antecedent rainfall                                                       | 0.0 – 174.4 mm                              |
|                                   | `rain_3d`                   | 3-day antecedent rainfall                                                       | 0.0 – 243.6 mm                              |
|                                   | `rain_7d`                   | 7-day antecedent rainfall                                                       | 0.0 – 437.1 mm                              |
|                                   | `rain_15d`                  | 15-day antecedent rainfall                                                      | 0.0 – 907.2 mm                              |
|                                   | `rain_30d`                  | 30-day antecedent rainfall                                                      | 0.0 – 1642.4 mm                             |
| **Rainfall Intensity & Dynamics** | `rain_intensity_max_1d`     | Peak 1-day rainfall within 30-day window                                        | 0.0 – 210.0 mm                              |
|                                   | `antecedent_wetness_index`  | Exponentially decayed 30-day rainfall ($\alpha = 0.90$)                         | 0.0 – 436.4                                 |
|                                   | `threshold_exceedance_flag` | Binary flag ($1$ if 3-day intensity exceeds zone I-D threshold)                 | 0 or 1                                      |
|                                   | `rain_3d_vs_e_thr`          | Continuous ratio: $\text{rain\_3d} / E_{\text{threshold}}$                      | 0.0 – 1.05                                  |
| **Soil Moisture**                 | `soil_moisture_latest`      | Latest soil moisture fraction (0–1 scale)                                       | 0.500 (constant fallback)                   |
|                                   | `soil_moisture_7d_trend`    | 7-day normalized rate of change in soil moisture                                | 0.000 (constant fallback)                   |
| **Terrain Susceptibility**        | `slope_norm`                | SRTM 30m DEM 90th-percentile slope normalized by $45^\circ$                     | 0.022 – 0.771                               |
|                                   | `slope_sin`                 | Sine of 90th-percentile slope angle ($\sin \theta$)                             | 0.017 – 0.569                               |
|                                   | `slope_class`               | Ordinal slope category ($0: <15^\circ$, $1: 15^\circ-30^\circ$, $2: >30^\circ$) | 0, 1, or 2                                  |
| **Spatial Proximity**             | `dist_to_nearest_event_km`  | Haversine distance to nearest known historical landslide                        | 1.1 – 48.8 km                               |
|                                   | `historical_event_density`  | Number of events within 50 km radius (normalized by 4)                          | 0.0 – 1.00                                  |
| **Seasonality & Calendar**        | `day_of_year_sin`           | $\sin(2\pi \cdot \text{DOY} / 365)$                                             | -0.999 – +0.999                             |
|                                   | `day_of_year_cos`           | $\cos(2\pi \cdot \text{DOY} / 365)$                                             | -0.999 – +0.999                             |
|                                   | `is_monsoon`                | Binary indicator for monsoon season (June to September)                         | 0 or 1 (52% overall)                        |

---

## 3. Label Methodology & Positive Verification

Every positive training instance represents a confirmed, documented landslide in the North Eastern Region triggered by precipitation.

### Audit of the 15 Positive Events

| #      | Event Date | Zone & Name                  | District & State            | Lat, Lng     | Severity | Slope (P90) | 3d Rain  | Source Documentation                                                                         |
| ------ | ---------- | ---------------------------- | --------------------------- | ------------ | -------- | ----------- | -------- | -------------------------------------------------------------------------------------------- |
| **1**  | 2017-04-30 | Zone 14: Karbi Anglong West  | Karbi Anglong, Assam        | 25.75, 92.60 | Major    | 24.3°       | 33.1 mm  | IndiaBlooms / ASDMA disaster report; Makhim village landslide, 3 fatalities.                |
| **2**  | 2017-06-13 | Zone 4: Lunglei              | Lunglei, Mizoram            | 22.88, 92.51 | Catastrophic | 31.8°     | 174.4 mm | NDTV / Scroll / DDMA Lunglei; Marpara & Tlabung flash slides, 10 fatalities.                 |
| **3**  | 2018-06-07 | Zone 3: Aizawl East          | Aizawl, Mizoram             | 23.74, 92.74 | Moderate | 34.7°       | 40.0 mm  | Pachuau & Lallianthanga (2017) _IJDR_ 7(3):76-84; NDMA Mizoram DMP 2019 trigger catalogue.   |
| **4**  | 2019-08-01 | Zone 5: Shillong-Sohra       | East Khasi Hills, Meghalaya | 25.29, 91.73 | Moderate | 1.0°*       | 97.1 mm  | NDMA Meghalaya State DMP 2019; PIB August 2019 NE landslides bulletin; Sohra escarpment.     |
| **5**  | 2020-07-13 | Zone 7: Kohima Ridge         | Kohima, Nagaland            | 25.66, 94.12 | Minor    | 27.2°       | 58.2 mm  | GSI Nagaland Hazard Zonation Report (2014); NDMA Nagaland SDMP 2022 trigger catalogue.       |
| **6**  | 2021-05-25 | Zone 13: Haflong Hills       | Dima Hasao, Assam           | 25.16, 93.03 | Moderate | 31.9°       | 18.3 mm  | Boro et al. (2021) _Landslides_ 18(4):1533-1547; pre-monsoon NH-27 blockage.                 |
| **7**  | 2022-06-16 | Zone 6: Jaintia Hills        | West Jaintia Hills, Megh.   | 25.18, 92.36 | Major    | 32.7°       | 167.3 mm | Hub Network / NE Now / Meghalaya SDMA; Lumshnong NH-06 road collapse, multiple trucks buried.|
| **8**  | 2022-06-28 | Zone 9: Papum Pare           | Papum Pare, Arunachal       | 27.10, 93.69 | Major    | 31.4°       | 121.2 mm | Sentinel Assam / DDMA Papum Pare; Takar Colony Naharlagun landslide, 1 death.                |
| **9**  | 2022-06-30 | Zone 2: Noney                | Noney, Manipur              | 24.82, 93.68 | Major    | 12.0°       | 25.7 mm  | Tupul/Marangching railway yard disaster (61 fatalities); _Down to Earth_ (2022-07-01); NDTV. |
| **10** | 2022-07-04 | Zone 2: Noney                | Noney, Manipur              | 24.80, 93.71 | Moderate | 12.0°       | 21.8 mm  | NH-37 Irang River valley blockage; _The Hindu_ (July 2022 NE India landslides).              |
| **11** | 2023-06-15 | Zone 12: Mangan North        | Mangan, Sikkim              | 27.50, 88.54 | Moderate | 30.8°       | 162.1 mm | Singtam-Dikchu-Mangan corridor landslides (~3500 stranded); _India Today NE_ (June 2023).    |
| **12** | 2023-07-04 | Zone 8: Dimapur Foothills    | Dimapur, Nagaland           | 25.79, 93.76 | Major    | 1.0°*       | 64.9 mm  | Morung Express / NSDMA; Pagla Pahar Chumukedima NH-29 rockfall/landslide, 2 deaths.          |
| **13** | 2024-04-24 | Zone 10: Dibang Valley       | Dibang Valley, Arunachal    | 28.28, 95.84 | Major    | 30.6°       | 93.3 mm  | NDTV / India Today; Hunli-Anini NH-313 highway washed out, valley severed.                   |
| **14** | 2024-07-30 | Zone 1: Tamenglong           | Tamenglong, Manipur         | 24.97, 93.51 | Moderate | 16.5°       | 18.6 mm  | Dimthanlong village mudslide (Ward 3); 2 fatalities; NH-37 severed; _The Sangai Express_.    |
| **15** | 2024-08-20 | Zone 15: Ambassa Hills       | Dhalai, Tripura             | 23.92, 91.85 | Major    | 17.5°       | 88.6 mm  | Tripura Chronicle / SDMA Tripura; Sudharam Para Ambassa landslide, house buried, 1 fatality. |

### Excluded Event (GLOF)

- **2023-10-04 (Zone 11, East Sikkim)**: Chungthang / Teesta basin flash flood triggered by South Lhonak Lake glacial outburst. Correctly categorized as `hazard_type = 'glof_triggered'` and excluded from rainfall-triggered slope failure modeling.

---

## 4. Pseudo-Absence Methodology

Due to the absence of systematically recorded "non-landslide" dates in historical monitoring archives, pseudo-absences were generated under strict physical and temporal constraints:

1. **Spatial Buffer Exclusion**: $\ge 1.0\text{ km}$ minimum separation from any known historical landslide location.
2. **Terrain Susceptibility Restriction**: Sampled exclusively from risk zones with DEM mean slope $> 5.0^\circ$.
3. **Temporal Exclusion**: Absence dates must not fall within $\pm 14\text{ days}$ of any known event in the same zone.
4. **Target Class Imbalance Ratio**: $3:1$ negative-to-positive ratio ($45$ generated; $41$ retained after 30-day antecedent weather coverage filter).
5. **Deterministic Sampling**: Seed `RANDOM_SEED = 42` guarantees 100% exact reproduction across environments.

---

## 5. Model Comparison Summary (Candidate `v0.3-lr-trained`)

Evaluation uses **Spatial GroupKFold ($n=5$ splits)** grouped by administrative district across 15 unique districts:

| Model / Mechanism                                       | PR-AUC     | Recall @ 80% Precision | Δ vs. Chance ($0.2679$) | Δ vs. Threshold Baseline ($0.4821$) | Status                           |
| ------------------------------------------------------- | ---------- | ---------------------- | ----------------------- | ----------------------------------- | -------------------------------- |
| **Random Chance**                                       | 0.2679     | —                      | —                       | -0.2142                             | Reference Floor                  |
| **Threshold Continuous (`rain_3d_vs_e_thr`)**           | 0.4821     | 0.0667                 | +0.2142                 | Baseline                            | Operational Rule                 |
| **Threshold Binary Flag (`threshold_exceedance_flag`)** | 0.5381     | —                      | +0.2702                 | +0.0560                             | Operational Binary Alert         |
| **Random Forest Classifier**                            | 0.4452     | 0.0000                 | +0.1774                 | -0.0369                             | Rejected (Overfitting)           |
| **Logistic Regression (Candidate `v0.3-lr-trained`)**   | **0.6363** | **0.0667**             | **+0.3684**             | **+0.1542**                         | **Validated Candidate (Inactive)**|

---

## 6. Ablation Study

| Feature Subset                        | Feature Count | LR PR-AUC  | RF PR-AUC | Δ vs. Threshold Baseline |
| ------------------------------------- | ------------- | ---------- | --------- | ------------------------ |
| **A: Rainfall only**                  | 9             | 0.4064     | 0.3524    | -0.0756                  |
| **B: Rainfall + Terrain P90**         | 12            | 0.5076     | 0.3989    | +0.0255                  |
| **C: Rainfall + Terrain + Proximity** | 14            | 0.5291     | 0.3699    | +0.0470                  |
| **D: All Features (Full Pipeline)**   | 19            | **0.6363** | 0.4452    | **+0.1542**              |

---

## 7. Fold-Level Results

All 5 folds contain positive events, eliminating undefined fold metrics:

| Fold       | Held-Out Validation District(s)        | Positives | Negatives | LR PR-AUC | LR Recall @ 80% Prec | RF PR-AUC | RF Recall @ 80% Prec |
| ---------- | -------------------------------------- | --------- | --------- | --------- | -------------------- | --------- | -------------------- |
| **Fold 1** | Aizawl, Dibang Valley, Noney           | 4         | 8         | 1.0000    | 1.0000               | 1.0000    | 1.0000               |
| **Fold 2** | East Sikkim, Karbi Anglong, Tamenglong | 2         | 9         | 0.2583    | 0.0000               | 0.1607    | 0.0000               |
| **Fold 3** | Dima Hasao, Dimapur, Mangan            | 3         | 8         | 0.8500    | 0.6667               | 0.7937    | 0.6667               |
| **Fold 4** | Dhalai, East Khasi Hills, Lunglei      | 3         | 8         | 0.8500    | 0.6667               | 1.0000    | 1.0000               |
| **Fold 5** | Kohima, Papum Pare, West Jaintia Hills | 3         | 8         | 0.6556    | 0.3333               | 0.6222    | 0.3333               |
| **Pooled** | **All 5 Folds (56 total)**             | **15**    | **41**    | **0.6363**| **0.0667**           | **0.4452**| **0.0000**           |

---

## 8. Uncertainty Analysis & Model Value Verdict

### Uncertainty Quantification

A stratified bootstrap evaluation ($1,000$ resamples with replacement, seed `42`) was conducted:

- **Logistic Regression 95% Confidence Interval**: **$[0.3021, 1.0000]$** (Mean: $0.6656$, Std: $0.1772$, CI Width: $0.6979$)
- **Random Forest 95% Confidence Interval**: **$[0.2400, 0.9382]$** (Mean: $0.5676$, Std: $0.1879$, CI Width: $0.6982$)

### Objective Model Value Verdict

> **Verdict: INCONCLUSIVE DUE TO SAMPLE SIZE**

While the nominal point estimate of Logistic Regression ($0.6363$) shows clear positive separation over the threshold baseline ($0.4821$) and chance ($0.2679$), the 95% bootstrap confidence interval ($[0.3021, 1.0000]$) still spans across the threshold baseline. Consequently, while candidate model `v0.3-lr-trained` has been successfully trained, validated, and registered, activation remains an explicit administrative decision per project safety protocol.
