-- 20260906160000_ingest_7_verified_ner_landslides.sql
-- Ingest 7 documented, real-world rainfall-triggered landslide events
-- across Northeast India to reach the verified real positive threshold (>=20).
-- All events are verified against state disaster management authority reports
-- and reputable news archives. Zero synthetic data.

INSERT INTO public.historical_landslides (
  zone_id, event_date, lat, lng, severity, source, is_synthetic, hazard_type
) VALUES
  -- 1. Aizawl, Mizoram (Zone 3) — Melthum Quarry & Slope Disaster (Cyclone Remal remnants)
  (
    3,
    '2024-05-28'::date,
    23.70,
    92.71,
    'Major',
    'Melthum-Hlimen landslide quarry collapse 2024-05-28, Aizawl, Mizoram — 34 fatalities. Incessant torrential rains triggered by Cyclone Remal. Official sources: Mizoram Disaster Management & Rehabilitation; NDTV (2024-05-28); The Hindu (2024-05-29).',
    false,
    'rainfall_slope_failure'
  ),

  -- 2. Dima Hasao, Assam (Zone 13) — New Haflong Railway Station & Town Washout
  (
    13,
    '2022-05-14'::date,
    25.18,
    93.02,
    'Major',
    'New Haflong railway station landslide washout 2022-05-14, Dima Hasao, Assam — 3 fatalities, rail track severed during severe pre-monsoon deluge. Source: Assam State Disaster Management Authority (ASDMA) incident bulletin; The New Indian Express (2022-05-15).',
    false,
    'rainfall_slope_failure'
  ),

  -- 3. Mangan, North Sikkim (Zone 12) — Pakshep & Ambithang Catastrophic Slides
  (
    12,
    '2024-06-13'::date,
    27.51,
    88.53,
    'Major',
    'Pakshep and Ambithang landslides 2024-06-13, Mangan district, North Sikkim — 6 fatalities, Sangkalang bridge collapse, >1200 tourists stranded following continuous extreme rainfall. Source: India Today NE (2024-06-14); Hindustan Times (2024-06-14).',
    false,
    'rainfall_slope_failure'
  ),

  -- 4. East Khasi Hills, Meghalaya (Zone 5) — Mawsynram Dangar/Kenmynsaw Landslides
  (
    5,
    '2022-06-17'::date,
    25.21,
    91.53,
    'Major',
    'Dangar and Kenmynsaw landslides 2022-06-17, Mawsynram Block, East Khasi Hills, Meghalaya — 8 fatalities (5 from a single family in Dangar). Triggered by all-time record 1,003.6 mm/24h downpour. Source: Meghalaya State Disaster Management Authority; District Magistrate order; Meghalaya Monitor (2022-06-17).',
    false,
    'rainfall_slope_failure'
  ),

  -- 5. Papum Pare, Arunachal Pradesh (Zone 9) — Tigdo Village & Modirijo Landslides
  (
    9,
    '2020-07-10'::date,
    27.12,
    93.68,
    'Moderate',
    'Tigdo village and Modirijo landslides 2020-07-10, Papum Pare district, Arunachal Pradesh — 8 fatalities buried in collapsed residential dwellings during monsoon downpour. Source: Papum Pare District Disaster Management Authority (DDMA); Scroll.in (2020-07-10).',
    false,
    'rainfall_slope_failure'
  ),

  -- 6. Tamenglong, Manipur (Zone 1) — New Salem & Neigailuang Mudslides
  (
    1,
    '2018-07-11'::date,
    24.98,
    93.49,
    'Major',
    'New Salem and Neigailuang landslides 2018-07-11, Tamenglong district, Manipur — 9 fatalities (children) in residential slope collapses after continuous heavy monsoon rain. Source: Manipur Government incident release; NDTV (2018-07-11); Imphal Times (2018-07-11).',
    false,
    'rainfall_slope_failure'
  ),

  -- 7. Kohima, Nagaland (Zone 7) — Pezielietsie & NH-29 Landslide Crisis
  (
    7,
    '2018-08-04'::date,
    25.67,
    94.10,
    'Moderate',
    'Pezielietsie and NH-29 slope failures 2018-08-04, Kohima district, Nagaland — 118 houses damaged/destroyed, vital road severed during state-declared emergency. Source: Kohima District Disaster Management Authority (DDMA); Nagaland State Disaster Management Authority (NSDMA); The New Indian Express (2018-08-05).',
    false,
    'rainfall_slope_failure'
  )
ON CONFLICT DO NOTHING;
