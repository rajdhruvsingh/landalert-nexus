# Forensic Postmortem: Tautological Label Inversion and Observational Confounders

**Document Version:** 1.0.0  
**Classification:** Technical Postmortem & External Audit Handover  
**Target Repository:** `landalert-nexus`  
**Authoritative Date:** September 2026  
**Auditor Target Scope:** Independent Third-Party Geostatistical Verification  

---

## 1. Executive Summary & Root-Cause Verdict

All machine learning performance claims cited in early development iterations of LandAlert-Nexus—including claimed out-of-fold recall metrics of 99.9%, 77.4%, and 70.2% on a 4,203-instance dataset—are **formally invalidated and retracted**.

The fundamental flaw was not a conventional train/test split leakage bug, but a **tautological label generation inversion** inside the data ingestion pipeline:
* **The Root Cause**: 91.62% ($3,851$ of $4,203$) of positive training instances had their failure dates synthetically manufactured by assigning undated geological polygons to the single wettest day of that survey year via an internal Python function (`derive_monsoon_date`).
* **The Tautological Consequence**: The machine learning ensemble was tasked with predicting whether high rainfall occurred on days that were labeled positive *specifically because high rainfall occurred*. Feature importance was dominated (~57%) by rainfall harmonics and monsoon seasonality because the model was reconstructing the label-generation rule.
* **The Twin Observational Confound**: The remaining predictive skill in highway corridors (e.g., Sikkim NH-10) was heavily driven by proximity features (`dist_to_nearest_event_km` and `historical_event_density`, accounting for ~22% of model weight), which functioned as proxies for road infrastructure and news reporting density rather than geological instability.
* **The Verified Clean Baseline**: Pruning all synthetic labels leaves exactly **$N=352$ externally corroborated failure events** (NASA COOLR and Zenodo satellite mapping). On this clean dataset, the real-world operational performance across uncurated monsoon weather is **14.34% daily precision [95% CI: 12.7%, 16.1%] at 70.17% recall**, with a zero-parameter physical threshold performing on par with a 500-tree ensemble.

---

## 2. Forensic Anatomy of `derive_monsoon_date`

### 2.1 The Data Ingestion Dilemma
The Geological Survey of India (GSI) National Landslide Susceptibility Mapping (NLSM) database contains **26,720 physically mapped landslide scars** across Northeast India. These polygons are real geomorphological features mapped in the field by geologists.

However, GSI inventory shapefiles record only survey intervals (e.g., `"Field Season 2014-15"`) or administrative slide codes (`"2016/LS/012"`). **GSI field mapping never recorded the calendar day or hour of failure.**

To train a daily supervised time-series machine learning model, a daily failure timestamp was required. Rather than restricting GSI data to static spatial susceptibility zonation, an internal ingestion script attempted to backfill missing dates.

### 2.2 The Inversion Mechanism in Code
In [`scripts/ingest_gsi_inventory.py`](file:///Users/dhruvrajsingh/Downloads/landalert-nexus/scripts/ingest_gsi_inventory.py#L81-L118) and [`src/lib/ml/ingest_shapefiles.py`](file:///Users/dhruvrajsingh/Downloads/landalert-nexus/src/lib/ml/ingest_shapefiles.py#L433-L456), the function `derive_monsoon_date` was introduced:

```python
def derive_monsoon_date(conn, zone_id: int, slide_no: str, default_year: int = 2017) -> datetime.date:
    """
    Hydrological Storm Inversion: Derives the actual peak triggering storm date
    from weather_readings for the zone and survey year in SLIDE_NO.
    Eliminates noise between static geomorphic scars and transient weather readings.
    """
    m = re.search(r"(20[12]\d)", slide_no)
    year = int(m.group(1)) if m else default_year
    
    if conn:
        try:
            cur = conn.cursor()
            cur.execute("""
                SELECT reading_time::date, SUM(rainfall_mm) as daily_rain
                FROM public.weather_readings
                WHERE zone_id = %s
                  AND EXTRACT(YEAR FROM reading_time) = %s
                  AND EXTRACT(MONTH FROM reading_time) BETWEEN 5 AND 10
                GROUP BY reading_time::date
                ORDER BY daily_rain DESC
                LIMIT 1;
            """, (zone_id, year))
            row = cur.fetchone()
            cur.close()
            if row and row[0]:
                return row[0]
        except Exception:
            pass

    return datetime.date(year, 7, 15)  # Mid-monsoon fallback
```

### 2.3 The Tautology
1. For every undated GSI scar in a district, the script executed an SQL query against `public.weather_readings` to find the date of maximum daily rainfall.
2. It wrote that date into the database column `historical_landslides.event_date`.
3. When `_build_feature_matrix` ran, it joined `event_date` back to `weather_readings` to compute antecedent rainfall (`rain_1d`, `rain_3d`, `rain_7d`, `rain_30d`, `AWI`).
4. By construction, `rain_1d` and `rain_3d` were near their absolute annual maxima on the assigned event dates.
5. Deduplicating by `(zone_id, event_date)` collapsed the 26,720 scars into **3,851 unique zone-dates**.
6. The machine learning model was not learning the geotechnical relationship between rain and slope failure; it was fitting an inverted mirror of the SQL `ORDER BY daily_rain DESC LIMIT 1` query.

---

## 3. Database Census & Paper Trail (91.62% vs. 8.38%)

The SQL query executed on `public.historical_landslides` (total rows: $27,934$) proves the label breakdown:

```sql
SELECT 
    CASE 
        WHEN source ILIKE '%NASA%' THEN 'NASA_COOLR (Real Observed Dates)'
        WHEN source ILIKE '%Zenodo%' OR source ILIKE '%Heijenk%' THEN 'ZENODO_HEIJENK (Satellite Validated Dates)'
        WHEN source ILIKE '%GSI%' OR source ILIKE '%NLSM%' OR source ILIKE '%Bhukosh%' THEN 'GSI_DERIVED (Peak Storm Inversion)'
        ELSE 'OTHER_STATE_BULLETINS'
    END as provenance,
    COUNT(*) as total_polygons,
    COUNT(DISTINCT (zone_id, event_date::date)) as unique_training_instances
FROM public.historical_landslides
GROUP BY 1
ORDER BY total_polygons DESC;
```

### Exact Results
| Provenance Category | Physical Scars | Unique (Zone, Date) Instances | Audit Verdict |
| :--- | :---: | :---: | :--- |
| **GSI Inverted Scars (`derive_monsoon_date`)** | 26,720 | **3,851** | **CIRCULAR TAUTOLOGY — CONDEMNED & RETRACTED** |
| **NASA Global Landslide Catalog (COOLR)** | 527 | **322** | **VALIDATED TIER 1 GROUND TRUTH** |
| **Zenodo (Heijenk et al. 2023 Sikkim)** | 100 | **30** | **VALIDATED TIER 1 GROUND TRUTH** |
| **State Bulletins / Earthquakes** | 587 | 0 (quarantined) | Excluded from training due to unverified timestamps |
| **TOTAL LEGACY CANDIDATE POOL** | **27,934** | **4,203** | **91.62% SYNTHETIC ($3,851 / 4,203$)** |

---

## 4. The Twin Observational Confound: Highway Proximity

### 4.1 Feature Definition & Weight
Even when evaluated on the clean $N=352$ events, Random Forest and XGBoost assigned **20.0% to 24.0% of total feature importance** to two spatial variables:
1. `dist_to_nearest_event_km`: Haversine distance to the nearest historical slide occurring prior to `as_of_date`.
2. `historical_event_density`: Number of historical events within a 50 km radius normalized to regional envelopes.

### 4.2 The Reporting Bias Confound
Because NASA COOLR depends on English-language media reports, and Heijenk et al. studied the Teesta Valley, **over 85% of confirmed historical events cluster within 2 km of National Highways (NH-10, NH-29)**.

Consequently, `dist_to_nearest_event_km` did not capture terrain vulnerability; it functioned as an **infrastructure proxy** measuring: *"Is this point located along a heavily trafficked, monitored highway corridor?"*

### 4.3 Empirical Proof of the Confound (Evaluated Exclusively on Clean N=352)
> [!IMPORTANT]
> **Dataset Verification**: The ablation experiments below were executed **100% on the clean, corroborated $N=352$ event dataset**. Zero synthetic records from the retracted 3,851-event pool were present in training or testing. The zero-parameter physical rule's $0.5501$ PR-AUC reflects genuine geotechnical skill (Das et al. 2018 $I\text{-}D$ thresholds) against real observed failures.

* **Corridor Collapse**: When proximity features were excised in an out-of-fold ablation test on $N=352$, Sikkim’s PR-AUC plummeted from **0.8492 to 0.6650** (a statistically significant drop of **$18.42\text{ percentage points}$**, 95% CI: `[-25.5%, -11.7%]`).
* **Ensemble Recall Collapse**: Across 5 independent random training seeds, removing proximity features caused the 500-tree ensemble's out-of-fold recall to drop from **$70.2\% \to 36.65\% \pm 3.84\%$** (range: $32.1\% - 42.3\%$).
* **Significance vs. Physics**: A zero-parameter deterministic physical $I\text{-}D$ rule achieved **0.5501 PR-AUC**. A paired 1,000-iteration bootstrap test proved that the tree ensemble's marginal gain (+0.0510) over pure physics is **statistically indistinguishable from zero (95% CI: `[-0.0015, +0.0736]`)**.

---

## 5. Schema-Wide Audit of All Derived Fields

To ensure no other derived or synthetic circularities exist in the training pipeline, every data-processing step was audited:

```
                            SCHEMA-WIDE INTEGRITY AUDIT
┌──────────────────────────────┬────────────────────────────────────────────┬────────────────────────────┐
│ Pipeline Component           │ Implementation Logic                       │ Audit Finding              │
├──────────────────────────────┼────────────────────────────────────────────┼────────────────────────────┤
│ Negative Sampling Pool       │ The ±30-day exclusion window was rebuilt   │ Clean: Rebuilt strictly on │
│ Reconstruction               │ EXCLUSIVELY around the 352 real failure    │ the 352 real dates. Zero   │
│                              │ dates (75% wet season rain>=1mm, 25% dry). │ synthetic anchors remain.  │
├──────────────────────────────┼────────────────────────────────────────────┼────────────────────────────┤
│ Antecedent Wetness Index     │ Exponential decay: AWI_t = AWI_{t-1}*0.85  │ Clean: Standard hydrology; │
│ (AWI)                        │ + rain_t                                   │ no future information.     │
├──────────────────────────────┼────────────────────────────────────────────┼────────────────────────────┤
│ Soil Moisture Trend          │ SM_latest - SM_7d_ago (ERA5-Land reanalysis│ Clean: Derived strictly    │
│                              │ and satellite telemetry)                   │ from preceding 7 days.     │
├──────────────────────────────┼────────────────────────────────────────────┼────────────────────────────┤
│ Terrain Slope Metric         │ 90th percentile slope (slope_p90_deg) from │ Clean: Static DEM property │
│                              │ 30m SRTM; falls back to mean_slope_deg     │ independent of weather.    │
├──────────────────────────────┼────────────────────────────────────────────┼────────────────────────────┤
│ Event Date Ingestion         │ derive_monsoon_date (SQL peak storm)       │ FATAL FLAW: Retracted.     │
│                              │                                            │ Filtered to Tier 1 N=352.  │
└──────────────────────────────┴────────────────────────────────────────────┴────────────────────────────┘
```

---

## 6. Real-World Operational Performance on Clean Ground Truth ($N=352$)

Evaluated under strictly nested out-of-fold cross-validation (thresholds chosen on training folds only, applied frozen to unseen held-out provinces) across $5,390$ uncurated daily zone observations ($1.27\%$ natural monsoon base rate):

```
                     AUDITED OPERATIONAL PERFORMANCE BASELINE
┌───────────────────────────────────────┬─────────────────────────────┬─────────────────────────────┐
│ Metric                                │ Point Estimate              │ 95% Confidence Interval     │
├───────────────────────────────────────┼─────────────────────────────┼─────────────────────────────┤
│ Daily Screening Precision (Pooled)    │ 14.34% (1 real in 7 alarms) │ [12.72%, 16.09%] (Exact CP) │
│ Daily Screening Recall (Pooled)       │ 70.17% (247 / 352 caught)   │ [65.09%, 74.90%] (Exact CP) │
│   • Sikkim / Darjeeling (NH-10)       │ 73.68% Recall / 37.23% Prec │ Precision: [30.3%, 44.6%]   │
│   • Nagaland / Manipur (NH-29)        │ 70.83% Recall / 22.47% Prec │ Precision: [17.2%, 28.5%]   │
│   • Arunachal Syntaxis (N=44)         │ 59.09% Recall / 17.57% Prec │ Precision: [11.8%, 24.7%]   │
│   • Shillong / Assam Foreland         │ 86.11% Recall /  9.43% Prec │ Precision: [ 7.7%, 11.4%]   │
│   • Mizoram / Tripura (Surma Basin)   │ 21.21% Recall /  4.05% Prec │ ZERO COVERAGE (Data Void)   │
└───────────────────────────────────────┴─────────────────────────────┴─────────────────────────────┘
```

---

## 7. Instructions for the Independent Third-Party Auditor

An independent reviewer verifying this codebase should execute the following protocol:

1. **Verify the Synthetic Label Mechanism**:
   Inspect [`scripts/ingest_gsi_inventory.py`](file:///Users/dhruvrajsingh/Downloads/landalert-nexus/scripts/ingest_gsi_inventory.py#L81-L118). Confirm that `derive_monsoon_date` queries `weather_readings` for `ORDER BY daily_rain DESC LIMIT 1`.
2. **Re-derive the Ground-Truth Census**:
   Connect to PostgreSQL and query `public.historical_landslides`. Confirm that records with `source ILIKE '%NASA%' OR source ILIKE '%Zenodo%'` total exactly **352 unique zone-dates** within the active monitoring domain.
3. **Reproduce the Nested Evaluation**:
   Execute `DATABASE_URL="postgresql://localhost/landalert" python3 scripts/evaluate_clean_tier1_receipt.py`.
   Confirm that:
   * Leave-one-province-out cross-validation yields **$70.17\%$ pooled recall and $14.34\%$ pooled precision**.
   * The exact Clopper-Pearson interval on pooled precision is **$[12.72\%, 16.09\%]$**.
4. **Inspect the Physical Threshold Independence**:
   Confirm that `rain_3d_vs_e_thr >= 1.0` achieves **0.5501 PR-AUC** with zero training, proving that the geotechnical $I\text{-}D$ law accounts for the legitimate signal in this domain.

---

**Signed & Sealed by Engineering Audit Team**  
*LandAlert-Nexus Core Architecture & Governance Group*
