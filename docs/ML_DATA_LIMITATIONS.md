# Scientific Data Limitations & Model Validity Boundary

**Project**: Himalaya Sentinel / landalert-nexus (SIH26001)  
**Target Domain**: Landslide Early Warning, North Eastern Region (NER), India  
**Status**: Software Production-Ready | Statistical Model Data-Limited

---

## 1. The Core Scientific Boundary

In machine learning for natural hazards, there is a fundamental distinction between:

1. **Software/Engineering Production Readiness**: Can the software reliably ingest weather, extract features without leakage, evaluate models, serialize artifacts, serve real-time predictions, explain drivers, and maintain transactional safety?
   - **Verdict**: **YES (PRODUCTION READY)**.
2. **Scientific Model Generalization**: Can the statistical model make reliable, highly accurate real-world predictions across unseen terrain and seasons?
   - **Verdict**: **DATA-LIMITED / INCONCLUSIVE (REQUIRES MORE VERIFIED LABELS)**.

This document transparently outlines the six critical scientific data limitations of the current system.

---

## 2. Limitation 1: Sample Size of Positive Events ($N = 15$)

### Reality

The training dataset contains **15 verified real rainfall-triggered landslide events** across the North Eastern Region from 2017 through 2024 (1 event per zone across all 15 risk zones, plus 1 quarantined GLOF event):

- 1 event in East Sikkim (2020)
- 1 event in North Sikkim / Mangan (2023)
- 1 event in Papum Pare, Arunachal Pradesh (2022)
- 1 event in Dibang Valley, Arunachal Pradesh (2024)
- 2 events in Noney, Manipur (2022)
- 1 event in Tamenglong, Manipur (2024)
- 1 event in Aizawl, Mizoram (2018)
- 1 event in Lunglei, Mizoram (2017)
- 1 event in East Khasi Hills / Sohra, Meghalaya (2019)
- 1 event in West Jaintia Hills, Meghalaya (2022)
- 1 event in Kohima, Nagaland (2020)
- 1 event in Dimapur Foothills, Nagaland (2023)
- 1 event in Dima Hasao, Assam (2021)
- 1 event in Karbi Anglong West, Assam (2017)
- 1 event in Ambassa Hills, Tripura (2024)

### Scientific Consequence

- Expanding to 15 events across all 15 zones provides complete regional representation (0.79 positives per feature for 19 features), but remains below the ideal 10–20 positive outcomes per feature.
- Cross-validation with 5 spatial folds now has non-empty positive partitions in all 5 folds (2 to 4 positives per fold).
- The candidate model (`v0.3-lr-trained`) achieves an out-of-fold PR-AUC of **0.6363** (vs chance baseline 0.2679 and continuous threshold baseline 0.4821).
- However, the 95% bootstrap confidence interval remains wide at **[0.3021, 1.0000]** (spanning across the threshold baseline of 0.4821). This wide interval confirms that while the candidate model exhibits a positive empirical gain ($\Delta = +0.1542$ over threshold baseline), true generalization across unseen monsoon cycles remains data-limited and statistically inconclusive until continuous multi-year event records are acquired.

---

## 3. Limitation 2: Soil Moisture Feature Non-Informativeness

### Reality

While live inference captures operational ERA5-Land surface soil moisture (`soil_moisture_0_to_1cm` and `soil_moisture_1_to_3cm`), querying the Open-Meteo Historical Reanalysis Archive API (`archive-api.open-meteo.com/v1/archive`) for historical antecedent windows (2016–2024) across:
(a) All 15 verified positive events, and
(b) All candidate pseudo-absences
returns zero non-null readings (100% `null` values) for `soil_moisture_0_to_1cm` and `soil_moisture_1_to_3cm`. In ECMWF ERA5-Land historical archives, standard soil levels are discretized as Layer 1 (0–7cm) and Layer 2 (7–28cm); the fractional 0–1cm and 1–3cm levels are non-existent in the reanalysis archive.

Consequently, per the strict scientific protocol forbidding fabricated or interpolated values:
- All historical training rows genuinely lacking archive coverage remain on the documented neutral fallback:
  $$\text{soil\_moisture\_latest} = 0.50, \quad \text{soil\_moisture\_7d\_trend} = 0.00$$
- Specific coordinates/dates lacking archive coverage:
  1. Zone 3 (Aizawl East, 23.74°N, 92.74°E, 2018-06-07)
  2. Zone 5 (Shillong-Sohra, 25.29°N, 91.73°E, 2019-08-01)
  3. Zone 7 (Kohima Ridge, 25.66°N, 94.12°E, 2020-07-13)
  4. Zone 13 (Haflong Hills, 25.16°N, 93.03°E, 2021-05-25)
  5. Zone 2 (Noney, 24.82°N, 93.68°E, 2022-06-30)
  6. Zone 2 (Noney, 24.80°N, 93.71°E, 2022-07-04)
  7. Zone 12 (Mangan North, 27.50°N, 88.54°E, 2023-06-15)
  8. Zone 1 (Tamenglong, 24.97°N, 93.51°E, 2024-07-30)
  9. Zone 4 (Lunglei, 22.88°N, 92.51°E, 2017-06-13)
  10. Zone 6 (Jaintia Hills, 25.18°N, 92.36°E, 2022-06-16)
  11. Zone 8 (Dimapur Foothills, 25.79°N, 93.76°E, 2023-07-04)
  12. Zone 9 (Papum Pare, 27.10°N, 93.69°E, 2022-06-28)
  13. Zone 10 (Dibang Valley, 28.28°N, 95.84°E, 2024-04-24)
  14. Zone 14 (Karbi Anglong West, 25.75°N, 92.60°E, 2017-04-30)
  15. Zone 15 (Ambassa Hills, 23.92°N, 91.85°E, 2024-08-20)
  16. All pseudo-absence coordinates/dates across 2016–2024.
- Feature variance in the training matrix remains **0.0000**.

### Scientific Consequence

- The trained Logistic Regression model assigns a coefficient of exactly **0.0000** to soil moisture.
- **The model has learned zero empirical relationship between soil moisture and slope failure**.
- In the live application, the UI clearly tags soil moisture as `Fallback proxy (50%)` or `Observed ERA5-Land` so operators are never misled into believing that fallback values reflect field sensor observations.

---

## 4. Limitation 3: Pseudo-Absences vs Confirmed Absences

### Reality

In landslide susceptibility modeling, confirmed negative records ("hillslope was monitored during a 200mm storm and did not fail") do not exist in government inventories. Therefore, 24 pseudo-absences were generated using scientific constraints:

- Spatial buffer: $>1\text{ km}$ away from known landslide locations
- Temporal buffer: $>14\text{ days}$ away from recorded landslide dates
- Terrain filter: $\text{mean\_slope\_deg} > 5^\circ$
- Ratio: $3:1$ relative to positives

### Scientific Consequence

- Pseudo-absences are **hypothetical absences**, not ground-truth confirmed non-events.
- Small unrecorded shallow landslides, rockfalls, or road clearance slips may have occurred at pseudo-absence coordinates without entering official records.
- True false-positive rates in unmonitored valleys cannot be definitively measured without dense ground instrumentation or radar-based change detection.

---

## 5. Limitation 4: GLOF vs Rainfall Landslide Mechanics

### Reality

On 2023-10-04, the South Lhonak Lake Glacial Lake Outburst Flood (GLOF) caused catastrophic slope washouts in North Sikkim.

- GLOF events are hydrodynamic surge failures triggered by moraine dam collapse, not by rainfall-induced pore-water pressure buildup.

### Scientific Consequence

- Including GLOF events in rainfall-landslide training data would severely distort the rainfall threshold curve.
- The South Lhonak event was **strictly quarantined** from the training pipeline.
- Systems predicting rainfall landslides must never claim capability for predicting sudden glacial lake outbursts without dedicated lacustrine monitoring.

---

## 6. Limitation 5: Spatial Clustering and Transferability

### Reality

The 8 positive events represent only 3 districts (East Sikkim, North Sikkim, and Papum Pare).

- Entire states in the NER console (Meghalaya, Mizoram, Nagaland, Manipur, Tripura) currently have **zero real positive training events** in the local database.

### Scientific Consequence

- The machine learning model cannot be assumed to transfer reliably to Khasi/Jaintia hills (Meghalaya) or Lushai hills (Mizoram), where lithology, weathered mantle depth, and rainfall intensity regimes differ substantially from Sikkim.
- In unrepresented states, **published regional physical thresholds (e.g., GSI / Das et al. empirical curves) remain the primary reliable baseline**, not the trained ML weights.

---

## 7. Operational Roadmap to Scientific Readiness

To transition the ML layer from **Data-Limited Pilot** to **Statistically Confirmed Production Model**, the following data collection thresholds must be met:

1. **Target 1: $\ge 25$ Verified Real Landslides**
   - Import verified landslide coordinates from Geological Survey of India (GSI) Bhukosh inventory covering Meghalaya, Assam, and Mizoram.
   - Shrinks bootstrap 95% CI width by $\sim 50\%$.
2. **Target 2: Retrospective Soil Moisture Backfill**
   - Run regional hydrologic simulations (e.g., VIC or WRF-Hydro) to reconstruct historical root-zone degree of saturation for all historical events.
   - Enables the ML model to learn genuine non-zero pore-pressure coefficients.
3. **Target 3: Post-Monsoon Blind Evaluation**
   - Freeze the current `v0.2-lr-trained` model and evaluate prospective accuracy on all real landslides reported in the 2027 monsoon season before retrained activation.
