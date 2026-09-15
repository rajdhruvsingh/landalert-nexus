# External Landslide Data — Manual Downloads

Place CSV files here for ingestion via:
```
python3 -m src.lib.ml.ingest_external_data --source csv
```

## Priority Sources (highest → lowest impact on model)

### 1. ISRO Landslide Atlas of India — **15,000–25,000 NE India events**
- Register (free): https://bhuvan.nrsc.gov.in
- Download: Landslide Atlas → NE States Shapefile (1998–2022)
- Convert: `ogr2ogr -f CSV isro_atlas.csv NE_Landslides.shp`
- Place as: `data/external/isro_atlas.csv`
- Required columns: latitude, longitude, event_date (or year + month)

### 2. NASA GLC / COOLR CSV — **~1,200 NE India events** (API retired)
- URL: https://disc.gsfc.nasa.gov/datasets/GLC_EXPORT_METADATA_1/
- Or search "Global Landslide Catalog" on NASA Earthdata
- Note: ~550 events already in DB from prior ingestion run
- Filter: `country_name == 'India'`
- Place as: `data/external/nasa_glc.csv`

### 3. EM-DAT — **200–500 major events**
- Register (free research): https://public.emdat.be
- Search: Country=India, Disaster Type=Landslide → Export CSV
- Place as: `data/external/emdat_india_landslides.csv`

### 4. GSI Bhukosh District Reports
- URL: https://bhukosh.gsi.gov.in → Landslide Zonation
- Manual extraction from district PDFs

## Column Name Aliases Accepted
The importer accepts flexible column names:
- **Latitude**: latitude, lat, y, centroid_lat, ycoord
- **Longitude**: longitude, lon, long, lng, x, centroid_lon, xcoord
- **Date**: event_date, date, occurred, start_date, began, year_mo_da
- **Severity**: severity, alert, level, total_deaths, deaths

## After Downloading
```bash
python3 -m src.lib.ml.ingest_external_data --source csv --dry-run  # preview
python3 -m src.lib.ml.ingest_external_data --source csv             # insert
python3 -m src.lib.ml.train_v05                                     # retrain
```
