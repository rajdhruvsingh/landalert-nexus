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

## 2. Limitation 1: Sample Size of Positive Events ($N = 8$)

### Reality
The training dataset contains exactly **8 verified real rainfall-triggered landslide events** across the entire North Eastern Region from 2018 through 2024:
- 1 event in East Sikkim (2020)
- 3 events in North Sikkim (2018, 2023)
- 4 events in Papum Pare, Arunachal Pradesh (2022)

### Scientific Consequence
- Fitting a 19-parameter statistical model on 8 positive instances yields approximately **0.42 positives per feature**. Standard statistical learning rules of thumb (e.g., Harrell's rule) require at least 10–20 positive outcomes per feature.
- Cross-validation with 5 spatial folds means individual validation folds contain as few as **0 or 1 positive event**.
- The resulting out-of-fold PR-AUC of 0.5934 has a 95% bootstrap confidence interval spanning **[0.1539, 1.0000]**. This range encompasses both random chance and near-perfection, meaning the model's true generalization power cannot be established with statistical significance.

---

## 3. Limitation 2: Soil Moisture Feature Non-Informativeness

### Reality
While live inference now captures operational ERA5-Land soil moisture, the historical reanalysis archive for the 2018–2024 training coordinates lacked historical soil moisture fields. Consequently:
- All 8 positive training rows and all 24 pseudo-absence rows fell back to the neutral constant value:
  $$\text{soil\_moisture\_latest} = 0.50, \quad \text{soil\_moisture\_7d\_trend} = 0.00$$
- Feature variance in the training matrix is **0.0000**.

### Scientific Consequence
- The trained Logistic Regression model assigned a coefficient of exactly **0.0000** to soil moisture.
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
