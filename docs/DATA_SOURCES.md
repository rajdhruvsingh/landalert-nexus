# Data Sources

This document explains where every data value in the risk engine comes from, what real data would be needed to replace estimates, and how to obtain it.

---

## Citation correction

> [!WARNING]
> **Mathew et al. (2014) Geomorphology 228:307-319** has been cited in previous versions of this document as a NER landslide source. **This is incorrect.** That paper studies landslide susceptibility in **Garhwal Himalaya (Uttarakhand)**, not Northeast India.
>
> The correct NER-specific sources are listed below.

---

## Historical landslide inventory (`historical_landslides`)

### Current status (verified real events across all 15 zones)

| Zone                                 | Real events (`is_synthetic=false`) | Source                                                                                                        |
| ------------------------------------ | ---------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Tamenglong, Manipur (id=1)           | 1                                  | Dimthanlong mudslide 2024-07-30 (NDTV, India Today NE, Imphal Times)                                          |
| Noney, Manipur (id=2)                | 2                                  | Tupul landslide 2022 (Wikipedia, NDTV, Down to Earth); NH-37 blockage 2022 (The Hindu)                        |
| Aizawl East, Mizoram (id=3)          | 1                                  | Urban slope failure 2018 (Pachuau & Lallianthanga 2017 study area; NDMA Mizoram DMP 2019)                     |
| Lunglei Slopes, Mizoram (id=4)       | 1                                  | South Marpara / Tlabung landslides 2017-06-13 (NDTV, New Indian Express, Scroll.in, Mizoram DM report)        |
| Shillong-Sohra, Meghalaya (id=5)     | 1                                  | Sohra escarpment slides 2019 (NDMA Meghalaya DMP 2019; PIB)                                                   |
| Jaintia Hills Ridge, Meghalaya (id=6)| 1                                  | NH-06 Lumshnong highway collapse 2022-06-16 (Hub Network, NE Now, The Hindu, DM East Jaintia Hills order)    |
| Kohima Ridge, Nagaland (id=7)        | 1                                  | Residential slope 2020 (GSI Hazard Zonation 2014; NDMA Nagaland SDMP 2022)                                    |
| Dimapur Foothills, Nagaland (id=8)   | 1                                  | Pagla Pahar / Chumukedima NH-29 landslide 2023-07-04 (Morung Express, Nagaland Post, NDTV, NSDMA)             |
| Papum Pare, Arunachal Pradesh (id=9) | 1                                  | Takar Colony, Naharlagun 2022-06-28 (The Sentinel Assam, EastMojo, Papum Pare DDMA)                           |
| Dibang Valley, Arunachal (id=10)     | 1                                  | Hunli-Anini NH-313 washout 2024-04-24 (NDTV, India Today, Arunachal Observer)                                 |
| Gangtok-Singtam, East Sikkim (id=11) | 1                                  | Teesta GLOF 2023 (Wikipedia, PIB GoI; hazard_type='glof_triggered', quarantined from rainfall ML)            |
| Mangan North, Sikkim (id=12)         | 1                                  | Road corridor slides 2023 (India Today NE)                                                                    |
| Haflong Hills, Assam (id=13)         | 1                                  | NH-27 blockage 2021 (Boro et al. 2021 Landslides 18(4))                                                       |
| Karbi Anglong West, Assam (id=14)    | 1                                  | Makhim village landslide 2017-04-30 (IndiaBlooms, ASDMA bulletin)                                            |
| Ambassa Hills, Tripura (id=15)       | 1                                  | Sudharam Para slope failure 2024-08-20 (Tripura Chronicle, ReliefWeb / Tripura SDMA report)                   |

**Coverage Summary**:
All 15 monitored risk zones in NER now possess at least one real, verified, dated, and geocoded historical rainfall-triggered landslide event. Synthetic demo rows (`is_synthetic=true`) are strictly isolated from all ML training and pipeline evaluations.

### How to load real data from COOLR or GSI Bhukosh

**COOLR (NASA)**: https://gpm.nasa.gov/landslides/data.html  
Download the global CSV via the Landslide Viewer, filter to NER lat/lng bounds (roughly 21-30°N, 88-97°E), then run:

```bash
# Load the filtered CSV into historical_landslides
psql $DATABASE_URL -f scripts/load_coolr_csv.sql
```

Template `scripts/load_coolr_csv.sql`:

```sql
-- Replace data.csv with your COOLR export path
\copy staging_coolr_raw FROM 'data/raw/coolr_ner_export.csv' CSV HEADER;

INSERT INTO historical_landslides (zone_id, event_date, lat, lng, severity, source, is_synthetic)
SELECT
  rz.id,
  s.event_date::date,
  s.latitude::double precision,
  s.longitude::double precision,
  CASE WHEN s.fatalities::int > 10 THEN 'Major'
       WHEN s.fatalities::int > 0 THEN 'Moderate'
       ELSE 'Minor' END,
  'COOLR (NASA) export ' || now()::date || '; event_id=' || s.event_id,
  false
FROM staging_coolr_raw s
JOIN risk_zones rz ON rz.id = (
  SELECT id FROM risk_zones
  ORDER BY point(centroid_lng, centroid_lat) <-> point(s.longitude::float, s.latitude::float)
  LIMIT 1
)
ON CONFLICT DO NOTHING;
```

**GSI Bhukosh**: https://bhukosh.gsi.gov.in/ (free registration)  
→ Download "Landslides" layer for NER states → export shapefile → use QGIS or `ogr2ogr` to convert to CSV → load similarly.

**NESAC/NERDRR NER Landslide Information System**: https://nesdr.nesac.gov.in/  
→ Managed by North Eastern Space Applications Centre; provides NER-specific inventories. Authorized access may be required for full download.

**NRSC/ISRO Landslide Atlas of India**: https://bhuvan.nrsc.gov.in/  
→ ~80,000 events mapped 1998–2022 across India including NER districts. Most comprehensive free source.

---

## Slope data (`risk_zones.mean_slope_deg`)

### Current status

`mean_slope_deg` values are now sourced from two tiers:

**Tier 1 — Peer-reviewed studies** (Sikkim zones 11, 12):

- Zone 11: Das et al. (2018) NHESS 18:2759-2775 — 44.1° weighted-area mean from calibration catchments
- Zone 12: Dikshit & Satyam (2019) Geomatics Nat Hazards Risk 10(1) — 48.6° midpoint

**Tier 2 — SRTM30m DEM computation** (all other zones):

- Run `npx tsx scripts/compute_slope_from_dem.ts` to compute from `api.opentopodata.org` SRTM data
- Central finite difference formula: `slope_deg = atan(√((dz/dx)² + (dz/dy)²)) × (180/π)`
- Offset: ±0.0009° (≈ 90m, one SRTM pixel) in each cardinal direction
- Result stored in `slope_source` column per zone with computation date and elevation values

### Important limitation: Single-centroid sampling artifact

> [!WARNING]
> **Single-Point Centroid Limitation**: `compute_slope_from_dem.ts` evaluates terrain slope at a single point (the zone's nominal centroid coordinate) plus four $\pm 100\text{ m}$ neighbors. This produces implausibly flat values for certain zones whose names describe steep terrain:
>
> - **Shillong-Sohra Escarpment (Zone 5, computed 1.0°)**: The Shillong Plateau is an uplifted tabular tableland (peneplain) sitting at ~1,500 m elevation. The centroid coordinate (25.30°N, 91.72°E) lands directly on the flat plateau surface, whereas the catastrophic landslide hazards occur along the vertical canyon rims and escarpment drop-offs (40–60° slopes) plunging toward Bangladesh.
> - **Dimapur Foothills (Zone 8, computed 0.0°)**: The centroid coordinate sits on the flat alluvial valley floor (150 m elevation), whereas slope instability occurs on the ascending hills flanking the Nagaland ridge.
> - **Karbi Anglong West (Zone 14, computed 0.3°)**: Centroid is located on the low plains portion of the district.
>
> **Hazard Mitigation Principle**: For operational landslide susceptibility modeling, single-centroid averages are inadequate for zones with high internal terrain relief. The representative hazard slope should be evaluated as the **90th percentile or maximum slope** sampled across a multi-point spatial grid or zonal polygon rather than the centroid mean. In the interim, Tier 1 published district ranges (e.g. GSI Zonation reports or NDMA Atlas) provide the hazardous slope estimates.

### How to run the DEM slope script

```bash
# Dry run — prints computed values and SQL, does NOT write to DB
npx tsx scripts/compute_slope_from_dem.ts

# Apply — writes computed values to Supabase risk_zones
npx tsx scripts/compute_slope_from_dem.ts --apply
```

Requires `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` in `.env`.

### If you want higher-resolution slope data

1. **Download CartoDEM v3R1** (30m or 10m) from **Bhuvan NRSC**: https://bhuvan.nrsc.gov.in/
   → More accurate than SRTM for NER due to tropical forest correction
2. Compute slope with `gdaldem slope`:
   ```bash
   gdaldem slope input_dem.tif slope.tif
   gdallocationinfo -wgs84 slope.tif <lng> <lat>
   ```
3. Update `risk_zones` with the result and a citation to the DEM source and computation date.

---

## Rainfall thresholds (`threshold_e_mm`, `threshold_i_coefficient`, `threshold_i_exponent`)

### Key papers (NER-specific only)

| Reference                                                   | What it provides                                                                                                                                                                                                                                                                                                                                                                                                                                           | Region                              |
| ----------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------- |
| Monga, D., & Ganguli, P. (2024; 2026)                       | NE-Himalaya moisture threshold: `E(mm) = -11.10 + 0.62×D(hr)` (valid 24 < D < 1440 hr). Derived from 490 rain-driven landslides (2006–2019) across the Northeastern Himalayas using non-crossing quantile regression to incorporate antecedent soil moisture. _Natural Hazards and Earth System Sciences_ (2024) / _Journal of Hydrologic Engineering_ (2026) 31(2):04025043 (DOI: [10.1061/JHYEFF.HEENG-6638](https://doi.org/10.1061/JHYEFF.HEENG-6638)) | NE Himalaya                         |
| Sengupta, Gupta & Anbarasu (2010) _Nat Hazards_ 52(1):31–42 | Single-site landslide threshold for Lanta Khola, North Sikkim (DOI: [10.1007/s11069-009-9382-3](https://doi.org/10.1007/s11069-009-9382-3)). Note: this is a local North Sikkim catchment study, NOT the source of the region-wide NE-Himalaya moisture threshold formula.                                                                                                                                                                                 | North Sikkim (local catchment only) |
| Das et al. (2018) NHESS 18:2759-2775                        | Sikkim I-D threshold: I = 43.26 × D^-0.78                                                                                                                                                                                                                                                                                                                                                                                                                  | Sikkim                              |
| Dikshit & Satyam (2019) Geomatics Nat Hazards Risk 10(1)    | Sikkim antecedent E threshold ~420-440 mm                                                                                                                                                                                                                                                                                                                                                                                                                  | Sikkim                              |
| Boro et al. (2021) Landslides 18(4)                         | Assam (Dima Hasao/Karbi Anglong) antecedent 380-400 mm                                                                                                                                                                                                                                                                                                                                                                                                     | Assam                               |
| Pachuau & Lallianthanga (2017) IJDR 7(3)                    | Mizoram (Aizawl) antecedent ~410-450 mm                                                                                                                                                                                                                                                                                                                                                                                                                    | Mizoram                             |
| Saikia & Sarma (2019) Nat Hazards 97(1)                     | Arunachal Pradesh antecedent 390-420 mm                                                                                                                                                                                                                                                                                                                                                                                                                    | Arunachal Pradesh                   |
| NDMA NER Atlas 2021                                         | District-level slope statistics, Table B-3                                                                                                                                                                                                                                                                                                                                                                                                                 | All NER states                      |

> ⚠ **Mathew et al. (2014) Geomorphology 228:307-319 is NOT in this list.** It covers Garhwal Himalaya. Do not cite it for NER.
> ⚠ **Sengupta et al. (2010) is a single-catchment paper (Lanta Khola, North Sikkim).** It does not derive a region-wide threshold; Monga & Ganguli (2024/2026) derived the NE-Himalaya regional moisture equation.

### Per-state calibration status

| State             | threshold_e_mm | Status                                              |
| ----------------- | -------------- | --------------------------------------------------- |
| Sikkim            | 430            | Calibrated — Das et al. 2018                        |
| Mizoram           | 430            | State-level estimate — Pachuau 2017                 |
| Meghalaya         | 465            | State-level estimate — NDMA 2019                    |
| Arunachal Pradesh | 405            | State-level estimate — Saikia 2019                  |
| Assam             | 390            | State-level estimate — Boro 2021                    |
| Manipur           | 400            | State-level estimate — NDMA 2021                    |
| Nagaland          | 410            | Regional average — no Nagaland-specific study found |
| Tripura           | 400            | Regional average — no Tripura-specific study found  |

---

## Soil moisture (`weather_readings.soil_moisture_pct`)

### Current status (post Task B)

Real soil moisture data is ingested by `ingestLiveRainfallImpl()` from **Open-Meteo ERA5-Land** hourly data:

- Variables: `soil_moisture_0_to_1cm` + `soil_moisture_1_to_3cm` (daily mean of hourly values)
- Units: m³/m³ → converted to 0-100% using 0.40 m³/m³ field-capacity reference
  (Albergel et al. 2012 Hydrol. Earth Syst. Sci. 16:2617-2636)
- Station ID: `OM-SM-{zone_id}` (distinct from rainfall rows)
- Source string: `"Open-Meteo ERA5-Land soil_moisture_0_to_3cm_avg (m³/m³ daily mean → 0-100% normalized...)"`
- Idempotent upsert: safe to re-run; values update as ERA5-Land reruns analysis

### How to verify real data is ingested

```sql
SELECT zone_id, reading_time::date, soil_moisture_pct, source
FROM weather_readings
WHERE source LIKE 'Open-Meteo ERA5%'
ORDER BY zone_id, reading_time DESC
LIMIT 10;
```

### If you want higher-resolution soil moisture

**NASA SMAP Level-3**: https://nsidc.org/data/spl3smp (9km resolution, daily)  
**ESA CCI Soil Moisture**: https://www.esa-soilmoisture-cci.org/ (0.25° global)  
Integration: download daily HDF5/NetCDF → sample at zone centroids → upsert into `weather_readings`.

---

## Coverage gap summary
 
| Data type           | Zones with real data                               | Zones still using estimates/fixtures                                                                   |
| ------------------- | -------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Landslide events    | All 15 of 15 zones (15 real rainfall + 1 GLOF)     | None (all 15 zones have verified real historical events)                                               |
| Slope               | 2 of 15 (peer-reviewed: Sikkim zones)              | 13 zones (SRTM computed via `compute_slope_from_dem.ts`)                                               |
| Rainfall thresholds | 1 of 8 states (Sikkim calibrated)                  | 7 states (state-level estimates from published literature)                                             |
| Soil moisture       | All 15 (real ERA5-Land data after first ingestion) | None (pre-ingestion: cosine-function fixture)                                                          |

