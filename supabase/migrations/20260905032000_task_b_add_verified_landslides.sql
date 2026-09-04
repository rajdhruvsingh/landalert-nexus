-- =============================================================
-- Migration: Add 7 verified real rainfall landslide events
-- =============================================================
-- Covers the 7 previously unrepresented zones:
--   Zone 4:  Lunglei Slopes, Mizoram
--   Zone 6:  Jaintia Hills Ridge, Meghalaya
--   Zone 8:  Dimapur Foothills, Nagaland
--   Zone 9:  Papum Pare, Arunachal Pradesh
--   Zone 10: Dibang Valley, Arunachal Pradesh
--   Zone 14: Karbi Anglong West, Assam
--   Zone 15: Ambassa Hills, Tripura
-- All events are verified with specific dates, coordinates, and citable sources.
-- GLOF and non-rainfall events strictly excluded.
-- =============================================================

INSERT INTO public.historical_landslides (zone_id, event_date, lat, lng, severity, hazard_type, source, is_synthetic)
VALUES
  (
    4,
    '2017-06-13',
    22.88,
    92.51,
    'Major',
    'rainfall_slope_failure',
    'South Marpara and Tlabung landslides 2017-06-13, Lunglei district, Mizoram — 10 fatalities, houses swept away, NH-54 blocked. Source: NDTV (2017-06-13); The New Indian Express (2017-06-13); Scroll.in (2017-06-14); Mizoram Disaster Management and Rehabilitation report.',
    false
  ),
  (
    6,
    '2022-06-16',
    25.18,
    92.38,
    'Major',
    'rainfall_slope_failure',
    'NH-06 highway landslide collapse at Lumshnong 2022-06-16, East Jaintia Hills, Meghalaya. Toll plaza road section washed away; severed road connectivity to southern Assam, Mizoram, and Tripura. Source: Hub Network (2022-06-16); NorthEast Now (2022-06-16); The Hindu (June 2022 NE floods); District Magistrate East Jaintia Hills order.',
    false
  ),
  (
    8,
    '2023-07-04',
    25.79,
    93.77,
    'Major',
    'rainfall_slope_failure',
    'Pagla Pahar / Chumukedima landslide on NH-29, 2023-07-04, Nagaland — 2 fatalities, 3 injured, vehicles crushed under massive rock and debris slide during torrential rainfall. Source: Morung Express (2023-07-04); Nagaland Post (2023-07-05); NDTV (2023-07-05); Nagaland State Disaster Management Authority (NSDMA).',
    false
  ),
  (
    9,
    '2022-06-28',
    27.10,
    93.69,
    'Moderate',
    'rainfall_slope_failure',
    'Takar Colony landslide, Naharlagun 2022-06-28, Papum Pare district, Arunachal Pradesh — 1 fatality (Sangio Yapa), 3 rescued from buried kutcha house following intense monsoon downpour. Source: The Sentinel Assam (2022-06-28); EastMojo (2022-06-28); Papum Pare DDMA.',
    false
  ),
  (
    10,
    '2024-04-24',
    28.28,
    95.88,
    'Major',
    'rainfall_slope_failure',
    'Hunli-Anini highway (NH-313) landslide washout 2024-04-24, Dibang Valley district, Arunachal Pradesh. Incessant rainfall washed away major road stretch, cutting off Anini district headquarters. Source: NDTV (2024-04-25); India Today (2024-04-25); Arunachal Observer (2024-04-27).',
    false
  ),
  (
    14,
    '2017-04-30',
    25.88,
    92.65,
    'Moderate',
    'rainfall_slope_failure',
    'Makhim village landslide (Jirikinding PS) 2017-04-30, West Karbi Anglong, Assam — 3 child fatalities trapped under mud and earth during heavy pre-monsoon rains. Source: IndiaBlooms (2017-04-30); Assam State Disaster Management Authority (ASDMA) incident bulletin.',
    false
  ),
  (
    15,
    '2024-08-20',
    23.92,
    91.85,
    'Moderate',
    'rainfall_slope_failure',
    'Sudharam Para slope failure along Ambassa-Kamalpur road 2024-08-20, Ambassa sub-division, Dhalai district, Tripura. Monsoon downpour triggered slope instability and structural collapse. Source: Tripura Chronicle (2024-08-20); ReliefWeb / Tripura SDMA situation report August 2024.',
    false
  )
ON CONFLICT DO NOTHING;
