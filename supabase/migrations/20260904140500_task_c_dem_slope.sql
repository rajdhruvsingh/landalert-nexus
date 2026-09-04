-- Task C: SRTM30m-derived slope values computed by scripts/compute_slope_from_dem.ts
-- Source: api.opentopodata.org SRTM30m, central finite difference (±90m offset)
-- Run date: 2026-09-04T08:38:40.682Z
-- To apply: npx tsx scripts/compute_slope_from_dem.ts --apply

UPDATE public.risk_zones
  SET mean_slope_deg = 9.2,
      slope_source = 'SRTM30m DEM via api.opentopodata.org, central finite difference ±100m offset, computed 2026-09-04. Center elevation: 1227m. N:1228m S:1237m E:1244m W:1213m.'
WHERE id = 1;

UPDATE public.risk_zones
  SET mean_slope_deg = 6.4,
      slope_source = 'SRTM30m DEM via api.opentopodata.org, central finite difference ±100m offset, computed 2026-09-04. Center elevation: 999m. N:977m S:999m E:984m W:988m.'
WHERE id = 2;

UPDATE public.risk_zones
  SET mean_slope_deg = 28.1,
      slope_source = 'SRTM30m DEM via api.opentopodata.org, central finite difference ±100m offset, computed 2026-09-04. Center elevation: 1000m. N:980m S:1022m E:946m W:1044m.'
WHERE id = 3;

UPDATE public.risk_zones
  SET mean_slope_deg = 23.9,
      slope_source = 'SRTM30m DEM via api.opentopodata.org, central finite difference ±100m offset, computed 2026-09-04. Center elevation: 1000m. N:988m S:967m E:1036m W:950m.'
WHERE id = 4;

UPDATE public.risk_zones
  SET mean_slope_deg = 1,
      slope_source = 'SRTM30m DEM via api.opentopodata.org, central finite difference ±100m offset, computed 2026-09-04. Center elevation: 1498m. N:1497m S:1500m E:1492m W:1494m.'
WHERE id = 5;

UPDATE public.risk_zones
  SET mean_slope_deg = 4.3,
      slope_source = 'SRTM30m DEM via api.opentopodata.org, central finite difference ±100m offset, computed 2026-09-04. Center elevation: 1274m. N:1275m S:1273m E:1286m W:1271m.'
WHERE id = 6;

UPDATE public.risk_zones
  SET mean_slope_deg = 18.6,
      slope_source = 'SRTM30m DEM via api.opentopodata.org, central finite difference ±100m offset, computed 2026-09-04. Center elevation: 1425m. N:1419m S:1423m E:1394m W:1461m.'
WHERE id = 7;

UPDATE public.risk_zones
  SET mean_slope_deg = 0,
      slope_source = 'SRTM30m DEM via api.opentopodata.org, central finite difference ±100m offset, computed 2026-09-04. Center elevation: 150m. N:149m S:149m E:151m W:151m.'
WHERE id = 8;

UPDATE public.risk_zones
  SET mean_slope_deg = 2.2,
      slope_source = 'SRTM30m DEM via api.opentopodata.org, central finite difference ±100m offset, computed 2026-09-04. Center elevation: 328m. N:344m S:349m E:332m W:326m.'
WHERE id = 9;

UPDATE public.risk_zones
  SET mean_slope_deg = 8.8,
      slope_source = 'SRTM30m DEM via api.opentopodata.org, central finite difference ±100m offset, computed 2026-09-04. Center elevation: 2913m. N:2908m S:2877m E:2888m W:2890m.'
WHERE id = 10;

UPDATE public.risk_zones
  SET mean_slope_deg = 15.1,
      slope_source = 'SRTM30m DEM via api.opentopodata.org, central finite difference ±100m offset, computed 2026-09-04. Center elevation: 1571m. N:1569m S:1554m E:1604m W:1552m.'
WHERE id = 11;

UPDATE public.risk_zones
  SET mean_slope_deg = 24.7,
      slope_source = 'SRTM30m DEM via api.opentopodata.org, central finite difference ±100m offset, computed 2026-09-04. Center elevation: 798m. N:780m S:843m E:822m W:755m.'
WHERE id = 12;

UPDATE public.risk_zones
  SET mean_slope_deg = 23.5,
      slope_source = 'SRTM30m DEM via api.opentopodata.org, central finite difference ±100m offset, computed 2026-09-04. Center elevation: 661m. N:649m S:667m E:584m W:669m.'
WHERE id = 13;

UPDATE public.risk_zones
  SET mean_slope_deg = 0.3,
      slope_source = 'SRTM30m DEM via api.opentopodata.org, central finite difference ±100m offset, computed 2026-09-04. Center elevation: 92m. N:90m S:90m E:88m W:89m.'
WHERE id = 14;

UPDATE public.risk_zones
  SET mean_slope_deg = 3.9,
      slope_source = 'SRTM30m DEM via api.opentopodata.org, central finite difference ±100m offset, computed 2026-09-04. Center elevation: 77m. N:86m S:73m E:72m W:76m.'
WHERE id = 15;
