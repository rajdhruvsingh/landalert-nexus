-- =============================================================
-- Migration: Fix Dimthanlong event date and source citation
-- =============================================================
-- Event: Dimthanlong village (Ward 3), Tamenglong district, Manipur.
-- Heavy rainfall (>140 mm) on the night of July 29-30, 2024 caused a
-- devastating mudslide burying the home of Manipur Police constable
-- Ringsinlung Kahmei. Mother (Duanzaengliu, 28) and 2-year-old son
-- were killed; father critically injured; NH-37 (Imphal-Jiribam road)
-- severed between Nungba and Rengpang.
-- Sources: NDTV (2024-07-30); India Today NE (2024-07-30);
-- Imphal Times (2024-07-30); The Sangai Express (2024-07-31).
-- =============================================================

UPDATE public.historical_landslides
SET event_date = '2024-07-30',
    source = 'Dimthanlong village mudslide (Ward 3), Tamenglong dist, Manipur 2024-07-30. '
             || '2 fatalities (mother Duanzaengliu, 28, and 2-year-old son); father (police constable Ringsinlung Kahmei) critically injured; '
             || '>140mm rainfall; NH-37 severed between Nungba and Rengpang. '
             || 'Sources: NDTV (2024-07-30); India Today NE (2024-07-30); Imphal Times (2024-07-30); The Sangai Express (2024-07-31). '
             || 'Coordinates: approx. Dimthanlong village centroid.'
WHERE zone_id = 1 AND event_date = '2023-07-15';
