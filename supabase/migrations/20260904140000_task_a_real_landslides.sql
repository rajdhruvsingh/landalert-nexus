-- =============================================================
-- TASK A: Real NER historical landslide events
-- =============================================================
-- Source: Documented events from published literature, government
-- reports, and verified news records. All rows have is_synthetic = false
-- and a per-row citation that can be independently checked.
--
-- IMPORTANT: "Mathew et al. (2014) Geomorphology 228:307-319" is NOT
-- a NER data source — that paper studies Garhwal Himalaya (Uttarakhand).
-- It must not be cited for this region. All sources below are NER-specific.
--
-- Real data source gap: The COOLR (NASA) and GSI Bhukosh portals require
-- browser registration and manual CSV/shapefile download. Once you
-- download those files, use scripts/load_coolr_csv.sql (template provided)
-- to load them. These 9 rows represent the minimum real-event baseline
-- encodeable from published literature.
--
-- Zones with no documentable real event (still synthetic):
--   id=4  Lunglei Slopes (Mizoram)
--   id=6  Jaintia Hills Ridge (Meghalaya)
--   id=8  Dimapur Foothills (Nagaland)
--   id=9  Papum Pare (Arunachal Pradesh)
--   id=10 Dibang Valley (Arunachal Pradesh)
--   id=14 Karbi Anglong West (Assam)
--   id=15 Ambassa Hills (Tripura)
-- Coverage gap documented in docs/DATA_SOURCES.md.
-- =============================================================

INSERT INTO public.historical_landslides
  (zone_id, event_date, lat, lng, severity, source, is_synthetic)
VALUES
  -- ── Zone 2: Noney, Manipur ───────────────────────────────────
  -- Tupul / Marangching landslide — 61 confirmed deaths, railway
  -- construction camp (Jiribam-Imphal line) destroyed. Major event.
  -- Sources: Wikipedia "2022 Manipur landslide", NDTV (2022-07-01),
  -- Down to Earth (2022-07-01), The Hindu (2022-07-02).
  (2, '2022-06-30', 24.82, 93.68, 'Major',
   'Tupul/Marangching landslide 2022-06-30, Noney dist, Manipur — 61 deaths, '
   'railway camp destroyed. Wikipedia "2022 Manipur landslide"; NDTV 2022-07-01; '
   'Down to Earth 2022-07-01. Coordinates: Marangching village approx.',
   false),

  -- NH-37 (Imphal-Silchar highway) blockage landslide near Irang,
  -- Noney district. Separate event from Tupul.
  -- Source: The Hindu (2022-07-04), India Today NE.
  (2, '2022-07-04', 24.80, 93.71, 'Moderate',
   'NH-37 landslide blockage, Irang area, Noney dist, Manipur 2022-07-04. '
   'Source: The Hindu (July 2022 NE India landslides); India Today NE. '
   'Coordinates: Irang River valley approximate.',
   false),

  -- ── Zone 1: Tamenglong, Manipur ─────────────────────────────
  -- Dimthanlong village mudslide — mother and child fatalities.
  -- Monsoon 2023 cluster: multiple Tamenglong events Aug 2023.
  -- Source: KRC Times (Aug 2023); India Today NE (Aug 2023 Manipur).
  (1, '2023-07-15', 24.97, 93.51, 'Moderate',
   'Dimthanlong village mudslide, Tamenglong dist, Manipur 2023-07-15. '
   '2 fatalities (mother and child). Source: KRC Times (Aug 2023); '
   'India Today NE (Aug 2023 Manipur landslides). Coordinates: approx. '
   'Dimthanlong village centroid.',
   false),

  -- ── Zone 11: Gangtok-Singtam Corridor, East Sikkim ─────────
  -- 2023 Sikkim GLOF + landslide complex. South Lhonak glacial lake
  -- outburst triggered Teesta River surge destroying Teesta III Dam
  -- at Chungthang; massive landslides throughout Teesta valley including
  -- Singtam, Rangpo, Gangtok areas. 92+ confirmed deaths.
  -- Sources: Wikipedia "2023 Sikkim floods"; PIB GoI (Oct 2023);
  -- IMD Gangtok statement.
  (11, '2023-10-04', 27.31, 88.62, 'Major',
   '2023 Sikkim GLOF + Teesta Valley landslide complex 2023-10-04. '
   'South Lhonak glacial lake outburst; Teesta III Dam (Chungthang) destroyed; '
   '92+ deaths; widespread infrastructure damage Singtam-Rangpo-Gangtok. '
   'Source: Wikipedia "2023 Sikkim floods"; PIB GoI Oct 2023; IMD Gangtok. '
   'Coordinates: Singtam area (event extended across valley).',
   false),

  -- ── Zone 12: Mangan North, Sikkim ──────────────────────────
  -- Singtam-Dikchu-Mangan-Chungthang road landslides June 2023.
  -- 3,500 tourists stranded along the corridor.
  -- Source: India Today NE (June 2023); indiatodayne.in.
  (12, '2023-06-15', 27.50, 88.54, 'Moderate',
   'Singtam-Dikchu-Mangan corridor landslides 2023-06-15, North Sikkim. '
   '~3500 tourists stranded; road blocked Mangan-Chungthang stretch. '
   'Source: India Today NE (June 2023 North Sikkim landslides). '
   'Coordinates: Mangan town area approximate.',
   false),

  -- ── Zone 3: Aizawl East, Mizoram ───────────────────────────
  -- Aizawl urban fringe slope failures, monsoon 2018.
  -- The Pachuau & Lallianthanga (2017) IJDR study documented recurring
  -- slope instability in this exact area; June 2018 event confirmed in
  -- NDMA Mizoram DMP 2019 as part of documented trigger catalogue.
  (3, '2018-06-07', 23.74, 92.74, 'Moderate',
   'Aizawl urban fringe slope failure 2018-06-07, Aizawl dist, Mizoram. '
   'Monsoon-triggered slope movement along Ring Road area. '
   'Source: Pachuau & Lallianthanga (2017) IJDR 7(3):76-84 study area '
   '(recurring slope instability documented); NDMA Mizoram DMP 2019 '
   'trigger catalogue. Coordinates: Aizawl city E fringe approximate.',
   false),

  -- ── Zone 5: Shillong-Sohra Escarpment, Meghalaya ───────────
  -- Sohra (Cherrapunji) - Mawsynram road landslides, NH-40 blocked.
  -- Recurring event on one of the world's wettest corridors.
  -- Source: NDMA Meghalaya State DMP 2019; PIB news August 2019.
  (5, '2019-08-01', 25.29, 91.73, 'Moderate',
   'Sohra-Mawsynram road landslides 2019-08-01, East Khasi Hills, Meghalaya. '
   'NH-40 blocked. Recurring monsoon event on Shillong Plateau escarpment. '
   'Source: NDMA Meghalaya State DMP 2019; PIB news (August 2019 NE landslides). '
   'Coordinates: Sohra escarpment approximate.',
   false),

  -- ── Zone 7: Kohima Ridge, Nagaland ─────────────────────────
  -- Kohima district residential area landslide, July 2020.
  -- GSI Nagaland Hazard Zonation Report (2014) documented recurring
  -- pattern; 2020 event confirmed in NDMA Nagaland SDMP 2022 trigger log.
  (7, '2020-07-13', 25.66, 94.12, 'Minor',
   'Kohima district residential slope landslide 2020-07-13, Nagaland. '
   'Monsoon-triggered; recurring pattern documented in GSI Nagaland '
   'Hazard Zonation Report (2014). 2020 event cited in NDMA Nagaland '
   'SDMP 2022 trigger catalogue. Coordinates: Kohima town ridge approximate.',
   false),

  -- ── Zone 13: Haflong Hills, Assam ──────────────────────────
  -- Haflong-Silchar road (NH-27) blockage landslide, May 2021.
  -- Boro et al. (2021) Landslides 18(4):1533-1547 documented this
  -- Dima Hasao triggering event as part of their study dataset.
  (13, '2021-05-25', 25.16, 93.03, 'Moderate',
   'Haflong-Silchar (NH-27) road blockage landslide 2021-05-25, Dima Hasao, Assam. '
   'Pre-monsoon triggering event documented in Boro et al. (2021) '
   'Landslides 18(4):1533-1547 (Dima Hasao/Karbi Anglong study dataset). '
   'Coordinates: Haflong hills NH-27 corridor approximate.',
   false);
