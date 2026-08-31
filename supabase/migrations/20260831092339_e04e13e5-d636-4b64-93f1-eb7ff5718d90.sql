CREATE TABLE public.risk_zones (
  id SERIAL PRIMARY KEY,
  zone_name TEXT NOT NULL,
  district TEXT NOT NULL,
  state TEXT NOT NULL,
  centroid_lat DOUBLE PRECISION NOT NULL,
  centroid_lng DOUBLE PRECISION NOT NULL,
  mean_slope_deg DOUBLE PRECISION NOT NULL DEFAULT 20,
  population INTEGER NOT NULL DEFAULT 0,
  threshold_e_mm DOUBLE PRECISION NOT NULL DEFAULT 435.3,
  current_risk_level TEXT NOT NULL DEFAULT 'Low',
  risk_score DOUBLE PRECISION NOT NULL DEFAULT 0,
  explanation TEXT,
  last_computed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT ON public.risk_zones TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.risk_zones TO authenticated;
GRANT ALL ON public.risk_zones TO service_role;
ALTER TABLE public.risk_zones ENABLE ROW LEVEL SECURITY;
CREATE POLICY "risk zones are public" ON public.risk_zones FOR SELECT TO anon, authenticated USING (true);

CREATE TABLE public.weather_readings (
  id BIGSERIAL PRIMARY KEY,
  zone_id INTEGER NOT NULL REFERENCES public.risk_zones(id) ON DELETE CASCADE,
  station_id TEXT NOT NULL,
  reading_time TIMESTAMPTZ NOT NULL DEFAULT now(),
  rainfall_mm DOUBLE PRECISION NOT NULL DEFAULT 0,
  soil_moisture_pct DOUBLE PRECISION,
  source TEXT NOT NULL DEFAULT 'IMD/SMAP fixture'
);
CREATE INDEX idx_weather_zone_time ON public.weather_readings (zone_id, reading_time DESC);
GRANT SELECT ON public.weather_readings TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.weather_readings TO authenticated;
GRANT ALL ON public.weather_readings TO service_role;
ALTER TABLE public.weather_readings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "weather is public" ON public.weather_readings FOR SELECT TO anon, authenticated USING (true);

CREATE TABLE public.historical_landslides (
  id BIGSERIAL PRIMARY KEY,
  zone_id INTEGER REFERENCES public.risk_zones(id) ON DELETE SET NULL,
  event_date DATE NOT NULL,
  lat DOUBLE PRECISION NOT NULL,
  lng DOUBLE PRECISION NOT NULL,
  severity TEXT NOT NULL DEFAULT 'Moderate',
  source TEXT NOT NULL DEFAULT 'GSI Bhukosh (fixture)'
);
GRANT SELECT ON public.historical_landslides TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.historical_landslides TO authenticated;
GRANT ALL ON public.historical_landslides TO service_role;
ALTER TABLE public.historical_landslides ENABLE ROW LEVEL SECURITY;
CREATE POLICY "landslide inventory is public" ON public.historical_landslides FOR SELECT TO anon, authenticated USING (true);

CREATE TABLE public.road_segments (
  id BIGSERIAL PRIMARY KEY,
  zone_id INTEGER NOT NULL REFERENCES public.risk_zones(id) ON DELETE CASCADE,
  road_name TEXT NOT NULL,
  segment_label TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  length_km DOUBLE PRECISION NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT ON public.road_segments TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.road_segments TO authenticated;
GRANT ALL ON public.road_segments TO service_role;
ALTER TABLE public.road_segments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "road status is public" ON public.road_segments FOR SELECT TO anon, authenticated USING (true);

CREATE TABLE public.alerts (
  id BIGSERIAL PRIMARY KEY,
  zone_id INTEGER NOT NULL REFERENCES public.risk_zones(id) ON DELETE CASCADE,
  risk_level TEXT NOT NULL,
  message TEXT NOT NULL,
  language TEXT NOT NULL DEFAULT 'en',
  channel TEXT NOT NULL DEFAULT 'both',
  explanation TEXT NOT NULL,
  dispatched_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  dispatched_by TEXT NOT NULL DEFAULT 'rules_engine'
);
CREATE INDEX idx_alerts_time ON public.alerts (dispatched_at DESC);
GRANT SELECT ON public.alerts TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.alerts TO authenticated;
GRANT ALL ON public.alerts TO service_role;
ALTER TABLE public.alerts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "alerts are public" ON public.alerts FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "authenticated can dispatch alerts" ON public.alerts FOR INSERT TO authenticated WITH CHECK (true);

INSERT INTO public.risk_zones (id, zone_name, district, state, centroid_lat, centroid_lng, mean_slope_deg, population) VALUES
(1,'Tamenglong','Tamenglong','Manipur',24.98,93.5,31.4,51213),
(2,'Noney','Noney','Manipur',24.83,93.66,38.2,22840),
(3,'Aizawl East','Aizawl','Mizoram',23.73,92.72,42.6,74310),
(4,'Lunglei Slopes','Lunglei','Mizoram',22.89,92.79,36.1,31905),
(5,'Shillong-Sohra Escarpment','East Khasi Hills','Meghalaya',25.3,91.72,45.8,96420),
(6,'Jaintia Hills Ridge','West Jaintia Hills','Meghalaya',25.45,92.36,33.7,40118),
(7,'Kohima Ridge','Kohima','Nagaland',25.67,94.11,40.3,68550),
(8,'Dimapur Foothills','Dimapur','Nagaland',25.9,93.73,21.5,88240),
(9,'Papum Pare','Papum Pare','Arunachal Pradesh',27.1,93.62,29.9,35760),
(10,'Dibang Valley','Dibang Valley','Arunachal Pradesh',28.25,95.9,47.2,9130),
(11,'Gangtok-Singtam Corridor','East Sikkim','Sikkim',27.33,88.61,44.1,58970),
(12,'Mangan North','Mangan','Sikkim',27.51,88.53,48.6,12480),
(13,'Haflong Hills','Dima Hasao','Assam',25.17,93.02,34.8,27615),
(14,'Karbi Anglong West','Karbi Anglong','Assam',26.05,93.1,24.6,61230),
(15,'Ambassa Hills','Dhalai','Tripura',23.93,91.85,19.8,43870);
SELECT setval('risk_zones_id_seq', 15);

INSERT INTO public.weather_readings (zone_id, station_id, reading_time, rainfall_mm, soil_moisture_pct, source)
SELECT z.id,
       'IMD-' || (1000 + z.id)::text,
       now() - (d || ' days')::interval,
       ROUND((GREATEST(0, (CASE WHEN z.state IN ('Meghalaya','Sikkim','Mizoram') THEN 26 ELSE 13 END)
         * (0.35 + 1.5 * abs(sin((z.id * 7 + d * 3)::double precision)))
         * (CASE WHEN d < 3 AND z.id % 4 = 0 THEN 4.4 WHEN d < 3 AND z.id % 3 = 0 THEN 2.5 ELSE 1.0 END)))::numeric, 1)::double precision,
       ROUND((38 + 45 * abs(cos((z.id * 5 + d)::double precision)))::numeric, 1)::double precision,
       'IMD/SMAP fixture'
FROM public.risk_zones z CROSS JOIN generate_series(0, 29) AS d;

INSERT INTO public.historical_landslides (zone_id, event_date, lat, lng, severity, source)
SELECT z.id,
       make_date(2015 + ((z.id * 3 + k) % 10), 6 + ((z.id + k) % 4), 1 + ((z.id * 7 + k * 5) % 27)),
       z.centroid_lat + (((z.id * 13 + k * 29) % 20) - 10) / 100.0,
       z.centroid_lng + (((z.id * 17 + k * 23) % 20) - 10) / 100.0,
       (ARRAY['Minor','Moderate','Major'])[1 + ((z.id + k) % 3)],
       'GSI Bhukosh (fixture)'
FROM public.risk_zones z CROSS JOIN generate_series(1, 3) AS k
WHERE k <= 1 + (z.id % 3);

INSERT INTO public.road_segments (zone_id, road_name, segment_label, status, length_km)
SELECT z.id,
       (ARRAY['NH-6','NH-37','NH-44','NH-102','NH-10','NH-29','NH-54','SH-1','SH-9','NH-27'])[1 + ((z.id * 3 + k) % 10)],
       z.zone_name || ' link road ' || k::text,
       (ARRAY['open','open','restricted','blocked'])[1 + ((z.id * 5 + k * 7) % 4)],
       ROUND((6 + ((z.id * 11 + k * 13) % 38))::numeric, 1)::double precision
FROM public.risk_zones z CROSS JOIN generate_series(1, 2) AS k
WHERE k <= 1 + (z.id % 2);

CREATE OR REPLACE FUNCTION public.recompute_risk()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  z RECORD;
  r72 DOUBLE PRECISION; r30 DOUBLE PRECISION; i_obs DOUBLE PRECISION;
  i_thr DOUBLE PRECISION; e_thr DOUBLE PRECISION; hist INTEGER;
  score DOUBLE PRECISION; lvl TEXT; expl TEXT; prev TEXT;
BEGIN
  FOR z IN SELECT * FROM public.risk_zones LOOP
    SELECT COALESCE(SUM(rainfall_mm),0) INTO r72 FROM public.weather_readings
      WHERE zone_id = z.id AND reading_time > now() - interval '3 days';
    SELECT COALESCE(SUM(rainfall_mm),0) INTO r30 FROM public.weather_readings
      WHERE zone_id = z.id AND reading_time > now() - interval '30 days';
    SELECT COUNT(*) INTO hist FROM public.historical_landslides WHERE zone_id = z.id;

    e_thr := z.threshold_e_mm;
    i_obs := r72 / 3.0;
    i_thr := 43.26 * power(3.0, -0.78);

    score := 0.45 * LEAST(r72 / NULLIF(i_thr * 3.0, 0), 2.5) / 2.5
           + 0.25 * LEAST(r30 / NULLIF(e_thr, 0), 2.0) / 2.0
           + 0.20 * LEAST(z.mean_slope_deg / 45.0, 1.0)
           + 0.10 * LEAST(hist / 4.0, 1.0);
    score := ROUND((score * 100)::numeric, 1);

    lvl := CASE WHEN score >= 72 THEN 'Severe'
                WHEN score >= 58 THEN 'High'
                WHEN score >= 42 THEN 'Moderate'
                ELSE 'Low' END;

    expl := format(
      '72-hr cumulative rainfall of %smm gives an intensity of %s mm/day against the Sikkim I-D threshold of %s mm/day (I = 43.26 x D^-0.78, D = 3 days). 30-day antecedent rainfall is %smm against the NE-Himalaya moisture threshold of %smm (E = -11.10 + 0.62 x D, D = 720 hr). Mean terrain slope %s deg and %s recorded historical landslide(s) in this zone raise the terrain weighting. Combined risk score: %s / 100 which maps to %s.',
      ROUND(r72::numeric,1), ROUND(i_obs::numeric,1), ROUND(i_thr::numeric,1),
      ROUND(r30::numeric,1), ROUND(e_thr::numeric,1), z.mean_slope_deg, hist, score, lvl);

    prev := z.current_risk_level;
    UPDATE public.risk_zones
       SET current_risk_level = lvl, risk_score = score, explanation = expl, last_computed_at = now()
     WHERE id = z.id;

    IF lvl IN ('High','Severe') AND (prev IS DISTINCT FROM lvl) THEN
      INSERT INTO public.alerts (zone_id, risk_level, message, language, channel, explanation)
      VALUES (z.id, lvl,
        format('%s LANDSLIDE RISK for %s, %s. Avoid slope-cut roads and report cracks or slumping immediately.', upper(lvl), z.zone_name, z.state),
        'en', 'both', expl);
    END IF;
  END LOOP;
END;
$$;
REVOKE ALL ON FUNCTION public.recompute_risk() FROM public;
GRANT EXECUTE ON FUNCTION public.recompute_risk() TO anon, authenticated, service_role;

SELECT public.recompute_risk();