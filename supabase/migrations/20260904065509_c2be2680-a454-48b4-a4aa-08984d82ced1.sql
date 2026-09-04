CREATE UNIQUE INDEX IF NOT EXISTS weather_readings_zone_station_time_key
  ON public.weather_readings (zone_id, station_id, reading_time);

CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog;

SELECT cron.schedule(
  'recompute-landslide-risk',
  '0 * * * *',
  $$SELECT public.recompute_risk();$$
);