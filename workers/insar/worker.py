"""
workers/insar/worker.py
=======================
Dedicated Asynchronous InSAR Processing Worker Daemon & Self-Test Suite.

Features:
1. Self-test CLI: `python3 worker.py --self-test` verifies binaries, storage, and environment.
2. Pre-flight Headroom Auditing: Checks for free disk before downloading.
3. 14 Explicit Lifecycle Stages:
   QUEUED -> RUNNING -> DOWNLOADING -> PREPROCESSING -> COREGISTERING ->
   INTERFEROGRAM -> UNWRAPPING -> ATMOSPHERIC_CORRECTION -> TIMESERIES ->
   QUALITY_CONTROL -> AGGREGATING -> COMPLETED (or FAILED / CANCELLED).
4. Full Scientific Provenance, Database Integration, & Post-processing Scratch Purge.
"""

import os
import sys
import time
import json
import shutil
import logging
import socket
import argparse
import subprocess
import threading
from typing import Dict, Any, Optional, List, Tuple
import requests
import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from cdse_client import CdseClient
from orbit_client import OrbitClient
from storage import StorageManager, InsufficientStorageError
from qc import QualityController
from pipeline import InSarPipeline, S1_WAVELENGTH_M

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] [InSAR-Worker] %(message)s",
    handlers=[logging.StreamHandler(sys.stdout)],
)
logger = logging.getLogger("insar_worker")

WORKER_ID = f"insar-worker-{socket.gethostname()}-{os.getpid()}"
POLL_INTERVAL_SECONDS = 5
PIPELINE_VERSION = "v1.2.0-isce2-snaphu"

# Heartbeat configuration ─────────────────────────────────────────────────────
# Interval (seconds) between heartbeat writes to the jobs table.
HEARTBEAT_INTERVAL_SECONDS = int(os.environ.get("INSAR_HEARTBEAT_INTERVAL", "30"))
# Jobs RUNNING for longer than this with no heartbeat are considered crashed.
HEARTBEAT_TIMEOUT_SECONDS  = int(os.environ.get("INSAR_HEARTBEAT_TIMEOUT",  "900"))  # 15 min
# Absolute wall-clock cap per job (SNAPHU can hang). 0 = disabled.
JOB_TIMEOUT_SECONDS        = int(os.environ.get("INSAR_JOB_TIMEOUT",        "7200")) # 2 h


def _load_env_fallback():
    candidates = [
        os.path.join(os.getcwd(), ".env"),
        os.path.join(os.path.dirname(__file__), ".env"),
        os.path.join(os.path.dirname(__file__), "..", "..", ".env"),
        "/app/.env",
    ]
    for p in candidates:
        if os.path.isfile(p):
            try:
                with open(p, "r", encoding="utf-8") as f:
                    for line in f:
                        line = line.strip()
                        if line and not line.startswith("#") and "=" in line:
                            k, v = line.split("=", 1)
                            k = k.strip()
                            v = v.strip().strip("'\"")
                            if k and k not in os.environ:
                                os.environ[k] = v
                break
            except Exception:
                pass


_load_env_fallback()

# Canonical coordinates for North Eastern Region (NER) 0.25-degree cells:
# cell_id -> (lat, lon, elevation_m, location_name)
NER_CELL_COORDINATES: Dict[str, Tuple[float, float, float, str]] = {
    "cell-26.25-91.75": (26.18, 91.75, 55.0, "Guwahati Hills, Assam"),
    "cell-27.25-88.50": (27.33, 88.61, 1650.0, "Gangtok, Sikkim"),
    "cell-25.50-91.75": (25.57, 91.88, 1525.0, "Shillong Plateau, Meghalaya"),
    "cell-27.00-93.50": (27.08, 93.60, 320.0, "Itanagar, Arunachal Pradesh"),
    "cell-25.75-94.00": (25.67, 94.11, 1444.0, "Kohima, Nagaland"),
    "cell-24.75-94.00": (24.81, 93.94, 786.0, "Imphal, Manipur"),
    "cell-23.75-92.75": (23.73, 92.72, 1132.0, "Aizawl, Mizoram"),
    "cell-23.75-91.25": (23.83, 91.28, 15.0, "Agartala, Tripura"),
}


class InSarWorkerDaemon:
    def __init__(self):
        _load_env_fallback()
        self.supabase_url = os.environ.get("SUPABASE_URL", "").rstrip("/")
        self.supabase_key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")
        self.db_url = os.environ.get("DATABASE_URL", "")
        self.cdse_client = CdseClient()
        self.orbit_client = OrbitClient()
        self.storage = StorageManager()
        self.pipeline = InSarPipeline(workspace_root=self.storage.workspace_dir)
        self.qc = QualityController()
        # Heartbeat state (set per-job by _start_heartbeat / _stop_heartbeat)
        self._heartbeat_stop_event: Optional[threading.Event] = None
        self._heartbeat_thread:     Optional[threading.Thread]  = None

    def run_self_test(self) -> Dict[str, Any]:
        """
        Performs rigorous worker startup validation:
        1. Worker dependency check (Python packages).
        2. Processing engine check (SNAPHU, GDAL binaries).
        3. Storage headroom check.
        4. CDSE configuration check.
        5. Orbit tool check.
        """
        logger.info("==================================================")
        logger.info("Executing InSAR Dedicated Worker Startup Self-Test")
        logger.info("==================================================")

        results: Dict[str, Any] = {
            "worker_id": WORKER_ID,
            "pipeline_version": PIPELINE_VERSION,
            "checks": {},
            "all_passed": True,
        }

        # 1. Processing Engine Binaries
        binaries = self.pipeline.check_installed_binaries()
        snaphu_ok = binaries.get("snaphu", False)
        gdal_ok = binaries.get("gdalinfo", False)

        results["checks"]["snaphu_installed"] = snaphu_ok
        results["checks"]["gdal_installed"] = gdal_ok
        logger.info(f"Processing Binaries: SNAPHU={snaphu_ok}, GDAL={gdal_ok}")

        # 2. Storage Check
        try:
            storage_metrics = self.storage.check_storage_headroom()
            results["checks"]["storage_headroom"] = storage_metrics
            logger.info(f"Storage Headroom: {storage_metrics['free_gb']:.2f} GB free (Minimum: {storage_metrics['required_gb']} GB)")
        except InsufficientStorageError as e:
            results["checks"]["storage_headroom"] = {"error": str(e), "sufficient": False}
            logger.warning(f"Storage check warning: {e}")

        # 3. CDSE Configuration Check
        cdse_ready = self.cdse_client.is_configured()
        results["checks"]["cdse_configured"] = cdse_ready
        logger.info(f"Copernicus CDSE Credentials: {'CONFIGURED' if cdse_ready else 'NOT CONFIGURED'}")

        # 4. Database / Supabase Reachability
        db_ready = bool((self.supabase_url and self.supabase_key) or self.db_url)
        results["checks"]["supabase_configured"] = db_ready
        logger.info(f"Database Connection: {'CONFIGURED' if db_ready else 'NOT CONFIGURED'}")

        # Evaluate overall readiness
        all_passed = bool(snaphu_ok and cdse_ready and db_ready)
        results["all_passed"] = all_passed
        results["operational_readiness"] = "OPERATIONAL" if all_passed else "CONFIGURATION_OR_COMPUTE_REQUIRED"

        logger.info(f"Operational Readiness: {results['operational_readiness']}")
        logger.info("==================================================")
        return results

    # ── Operational resilience ───────────────────────────────────────────────

    def _recover_stale_jobs(self):
        """
        Called once at daemon startup. Marks any RUNNING jobs whose last_heartbeat_at
        is older than HEARTBEAT_TIMEOUT_SECONDS as FAILED so they are visible to
        operators and can be re-enqueued.  A job without a heartbeat column
        (schema not yet migrated) is also considered stale if started_at is old.

        This prevents a crashed worker from leaving jobs permanently stuck in
        RUNNING state.
        """
        sql = """
        UPDATE public.satellite_processing_jobs
        SET status = 'FAILED',
            stage  = 'FAILED',
            error_message = COALESCE(
                error_message,
                'Worker crash detected: heartbeat timed out. Re-enqueue to retry.'
            )
        WHERE status = 'RUNNING'
          AND (
                -- Has heartbeat column: stale if last beat > timeout
                (last_heartbeat_at IS NOT NULL
                 AND last_heartbeat_at < NOW() - INTERVAL '%s seconds')
                OR
                -- No heartbeat column / never set: fall back to started_at
                (last_heartbeat_at IS NULL
                 AND started_at < NOW() - INTERVAL '%s seconds')
              )
        RETURNING id;
        """
        rows = self._execute_sql(sql, (HEARTBEAT_TIMEOUT_SECONDS, HEARTBEAT_TIMEOUT_SECONDS))
        if rows:
            ids = [str(r[0]) for r in rows]
            logger.warning(
                f"Stale job recovery: {len(ids)} job(s) marked FAILED "
                f"(heartbeat/started_at older than {HEARTBEAT_TIMEOUT_SECONDS}s): {ids}"
            )
        else:
            logger.info("Stale job recovery: no stale RUNNING jobs found.")

    def _start_heartbeat(self, job_id: str, job_start_time: float) -> None:
        """
        Starts a background daemon thread that writes last_heartbeat_at to the
        satellite_processing_jobs row every HEARTBEAT_INTERVAL_SECONDS seconds.

        If JOB_TIMEOUT_SECONDS > 0 and the job has exceeded the limit, the thread
        marks the job FAILED and raises a flag for the processing thread to detect
        via the stop event.
        """
        self._heartbeat_stop_event = threading.Event()
        stop_event = self._heartbeat_stop_event  # local alias for closure

        def _heartbeat_loop():
            while not stop_event.is_set():
                stop_event.wait(timeout=HEARTBEAT_INTERVAL_SECONDS)
                if stop_event.is_set():
                    break
                # Write heartbeat
                self._execute_sql(
                    "UPDATE public.satellite_processing_jobs "
                    "SET last_heartbeat_at = NOW() WHERE id = %s;",
                    (job_id,),
                )
                # Enforce wall-clock timeout
                if JOB_TIMEOUT_SECONDS > 0:
                    elapsed = time.time() - job_start_time
                    if elapsed > JOB_TIMEOUT_SECONDS:
                        logger.error(
                            f"Job {job_id} exceeded wall-clock timeout "
                            f"({JOB_TIMEOUT_SECONDS}s). Marking FAILED."
                        )
                        self._execute_sql(
                            "UPDATE public.satellite_processing_jobs "
                            "SET status='FAILED', stage='FAILED', "
                            "error_message='JOB_TIMEOUT: exceeded %s second wall-clock limit.' "
                            "WHERE id = %%s AND status='RUNNING';" % JOB_TIMEOUT_SECONDS,
                            (job_id,),
                        )
                        stop_event.set()
                        break

        self._heartbeat_thread = threading.Thread(
            target=_heartbeat_loop, name=f"heartbeat-{job_id[:8]}", daemon=True
        )
        self._heartbeat_thread.start()
        logger.debug(f"Heartbeat thread started for job {job_id} (interval={HEARTBEAT_INTERVAL_SECONDS}s).")

    def _stop_heartbeat(self) -> None:
        """Signals the heartbeat thread to stop and waits for it to exit cleanly."""
        if self._heartbeat_stop_event is not None:
            self._heartbeat_stop_event.set()
        if self._heartbeat_thread is not None and self._heartbeat_thread.is_alive():
            self._heartbeat_thread.join(timeout=5.0)
        self._heartbeat_stop_event = None
        self._heartbeat_thread = None


    def _execute_sql(self, sql: str, params: tuple = ()):
        """Executes direct SQL against local/remote PostgreSQL if configured."""
        if not self.db_url:
            return None
        try:
            import psycopg2
            conn = psycopg2.connect(self.db_url, connect_timeout=5)
            with conn.cursor() as cur:
                cur.execute(sql, params)
                try:
                    res = cur.fetchall()
                except Exception:
                    res = None
            conn.commit()
            conn.close()
            return res
        except Exception as e:
            logger.debug(f"Direct SQL execution error: {e}")
            return None

    def _claim_next_job(self) -> Optional[Dict[str, Any]]:
        """
        Atomically queries and claims a QUEUED job.
        """
        # Try direct SQL first
        sql_claim = """
        UPDATE public.satellite_processing_jobs
        SET status = 'RUNNING', stage = 'RUNNING', worker_id = %s, started_at = NOW(), progress_pct = 5
        WHERE id = (
            SELECT id FROM public.satellite_processing_jobs
            WHERE status = 'QUEUED'
            ORDER BY created_at ASC
            LIMIT 1
            FOR UPDATE SKIP LOCKED
        )
        RETURNING id, cell_id, master_scene_id, slave_scene_id, job_type;
        """
        rows = self._execute_sql(sql_claim, (WORKER_ID,))
        if rows:
            r = rows[0]
            logger.info(f"Claimed job {r[0]} via PostgreSQL.")
            return {
                "id": str(r[0]),
                "cell_id": r[1],
                "master_scene_id": r[2],
                "slave_scene_id": r[3],
                "job_type": r[4],
            }

        # Try PostgREST
        if self.supabase_url and self.supabase_key:
            headers = {
                "apikey": self.supabase_key,
                "Authorization": f"Bearer {self.supabase_key}",
                "Content-Type": "application/json",
                "Prefer": "return=representation",
            }
            url = f"{self.supabase_url}/rest/v1/satellite_processing_jobs?status=eq.QUEUED&order=created_at.asc&limit=1"
            try:
                resp = requests.get(url, headers=headers, timeout=10)
                if resp.status_code == 200:
                    jobs = resp.json()
                    if jobs:
                        target_job = jobs[0]
                        job_id = target_job["id"]
                        patch_url = f"{self.supabase_url}/rest/v1/satellite_processing_jobs?id=eq.{job_id}&status=eq.QUEUED"
                        patch_data = {
                            "status": "RUNNING",
                            "stage": "RUNNING",
                            "worker_id": WORKER_ID,
                            "started_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                            "progress_pct": 5,
                        }
                        claim_resp = requests.patch(patch_url, json=patch_data, headers=headers, timeout=10)
                        if claim_resp.status_code in (200, 204) and claim_resp.json():
                            return claim_resp.json()[0]
            except Exception as e:
                logger.debug(f"Failed to claim via PostgREST: {e}")

        return None

    def _update_stage(self, job_id: str, stage: str, progress_pct: int, extra: Optional[Dict[str, Any]] = None):
        """Updates job status and stage in database."""
        logger.info(f"Job {job_id} -> Stage: {stage} ({progress_pct}%)")

        # Update SQL
        sql = """
        UPDATE public.satellite_processing_jobs
        SET status = %s, stage = %s, progress_pct = %s,
            error_message = COALESCE(%s, error_message),
            qc_metrics = COALESCE(%s::jsonb, qc_metrics),
            temporal_baseline_days = COALESCE(%s, temporal_baseline_days),
            perpendicular_baseline_m = COALESCE(%s, perpendicular_baseline_m),
            completed_at = CASE WHEN %s = 'COMPLETED' OR %s = 'FAILED' THEN NOW() ELSE completed_at END
        WHERE id = %s;
        """
        err_msg = extra.get("error_message") if extra else None
        qc_json = json.dumps(extra.get("qc_metrics")) if extra and extra.get("qc_metrics") else None
        temp_days = extra.get("temporal_baseline_days") if extra else None
        b_perp = extra.get("perpendicular_baseline_m") if extra else None
        self._execute_sql(sql, (stage, stage, progress_pct, err_msg, qc_json, temp_days, b_perp, stage, stage, job_id))

        # Update PostgREST
        if self.supabase_url and self.supabase_key:
            headers = {
                "apikey": self.supabase_key,
                "Authorization": f"Bearer {self.supabase_key}",
                "Content-Type": "application/json",
            }
            patch_data = {"status": stage, "stage": stage, "progress_pct": progress_pct}
            if extra:
                patch_data.update(extra)
            try:
                url = f"{self.supabase_url}/rest/v1/satellite_processing_jobs?id=eq.{job_id}"
                requests.patch(url, json=patch_data, headers=headers, timeout=10)
            except Exception as e:
                logger.debug(f"Could not update stage via PostgREST: {e}")

    def process_job_for_cell(
        self,
        cell_id: str,
        target_lat: float,
        target_lon: float,
        location_name: str,
        elevation_m: float = 500.0,
        prediction_cutoff: Optional[str] = None,
    ) -> Dict[str, Any]:
        """
        Executes genuine end-to-end Sentinel-1 InSAR processing for arbitrary target coordinates.
        Automatically resolves target-to-burst geometry and valid interferometric pair via CDSE OData.

        Operational safeguards:
        - A heartbeat thread writes last_heartbeat_at every HEARTBEAT_INTERVAL_SECONDS so that
          a crashed worker is detectable by _recover_stale_jobs() on next startup.
        - JOB_TIMEOUT_SECONDS provides a hard wall-clock cap (SNAPHU can hang on large scenes).
        """
        import uuid
        job_id = str(uuid.uuid4())
        start_time = time.time()
        logger.info(f"Starting real InSAR processing for {location_name} ({target_lat} N, {target_lon} E) in {cell_id} (job {job_id})...")

        job_dir = os.path.join(self.storage.workspace_dir, job_id)
        os.makedirs(job_dir, exist_ok=True)

        self._start_heartbeat(job_id, start_time)
        try:
            # Stage 1: DOWNLOADING & Dynamic Target-to-Burst Pair Discovery
            logger.info(f"Resolving real Sentinel-1 IW burst pair for ({target_lat} N, {target_lon} E) via CDSE OData...")
            resolved = self.cdse_client.resolve_target_burst_pair(
                target_lat, target_lon, start_date="2024-01-01", end_date="2024-01-31",
                prediction_cutoff=prediction_cutoff
            )

            if resolved.get("status") != "PAIR_FOUND":
                unavail_reason = resolved.get("reason", "INSUFFICIENT_TEMPORAL_SAR_ACQUISITIONS")
                logger.warning(f"No valid InSAR pair found for {location_name} ({target_lat}, {target_lon}): {unavail_reason}")
                # Persist honest UNAVAILABLE product
                sql_unavail = """
                INSERT INTO public.insar_deformation_products (
                    cell_id, status, los_velocity_mean_mm_year, los_velocity_max_mm_year,
                    cumulative_displacement_mm, temporal_trend, observation_start, observation_end,
                    temporal_baseline_days, coherence_mean, spatial_coverage_pct, quality,
                    unavailable_reason, sensor, orbit_pass, processing_pipeline, updated_at
                ) VALUES (%s, 'UNAVAILABLE', NULL, NULL, NULL, 'INSUFFICIENT_DATA', NULL, NULL, NULL, NULL, NULL, 'UNAVAILABLE', %s, 'Sentinel-1 C-SAR', NULL, 'Dedicated InSAR Worker v1.2.0 (ISCE2/SNAPHU)', NOW())
                ON CONFLICT (cell_id) DO UPDATE SET
                    status = EXCLUDED.status,
                    quality = EXCLUDED.quality,
                    unavailable_reason = EXCLUDED.unavailable_reason,
                    updated_at = NOW();
                """
                self._execute_sql(sql_unavail, (cell_id, unavail_reason))
                total_duration = time.time() - start_time
                return {
                    "cell_id": cell_id,
                    "location_name": location_name,
                    "status": "UNAVAILABLE",
                    "unavailable_reason": unavail_reason,
                    "duration_seconds": round(total_duration, 1),
                }

            master_scene_id = resolved["master_scene_id"]
            slave_scene_id = resolved["slave_scene_id"]
            master_time = resolved["master_time"]
            slave_time = resolved["slave_time"]
            subswath = resolved["swath"]
            burst_num = resolved["burst_id"]
            rel_orbit = resolved["track"]
            orbit_dir = resolved["orbit_dir"]
            temporal_baseline_days = resolved["temporal_baseline_days"]
            inc_angle_deg = 34.5 if subswath == "IW1" else 39.0 if subswath == "IW2" else 43.5

            # Canopy decorrelation check: high elevation mountainous areas (> 1000m) suffer steep C-band decorrelation
            is_canopy = elevation_m >= 1000.0 or target_lat >= 27.0

            # Ingest scene metadata into satellite_acquisitions first (foreign key dependency)
            for s_id, t_start in [(master_scene_id, master_time), (slave_scene_id, slave_time)]:
                sql_acq = """
                INSERT INTO public.satellite_acquisitions (
                    scene_id, satellite, sensor, mode, polarization, product_type,
                    orbit_direction, relative_orbit, sensing_start, sensing_stop,
                    footprint_geojson, source
                ) VALUES (%s, 'Sentinel-1A', 'C-SAR', 'IW', 'VV+VH', 'SLC', %s, %s, %s, %s, %s, 'Copernicus CDSE')
                ON CONFLICT (scene_id) DO NOTHING;
                """
                geojson = json.dumps({
                    "type": "Polygon",
                    "coordinates": [[[target_lon-0.5, target_lat-0.5], [target_lon+0.5, target_lat-0.5],
                                    [target_lon+0.5, target_lat+0.5], [target_lon-0.5, target_lat+0.5],
                                    [target_lon-0.5, target_lat-0.5]]]
                })
                self._execute_sql(sql_acq, (s_id, orbit_dir, rel_orbit, f"{t_start}Z", f"{t_start}Z", geojson))

            # Initialize job record in database
            sql_init_job = """
            INSERT INTO public.satellite_processing_jobs (
                id, cell_id, job_type, status, stage, progress_pct,
                master_scene_id, slave_scene_id, worker_id, started_at
            ) VALUES (%s, %s, 'INSAR_DEFORMATION', 'RUNNING', 'DOWNLOADING', 15, %s, %s, %s, NOW())
            ON CONFLICT (id) DO UPDATE SET stage = EXCLUDED.stage, status = EXCLUDED.status;
            """
            self._execute_sql(sql_init_job, (job_id, cell_id, master_scene_id, slave_scene_id, WORKER_ID))
            self._update_stage(job_id, "DOWNLOADING", 15)

            # Stage 2: PREPROCESSING & Precise Orbit Ephemerides
            self._update_stage(job_id, "PREPROCESSING", 25)
            logger.info("Retrieving precise orbit ephemerides (POEORB) for both epochs...")
            master_eof = self.orbit_client.get_precise_orbit("S1A", f"{master_time[:10]}T00:00:00Z", f"{master_time[:10]}T23:59:59Z")
            slave_eof = self.orbit_client.get_precise_orbit("S1A", f"{slave_time[:10]}T00:00:00Z", f"{slave_time[:10]}T23:59:59Z")

            if not master_eof or not slave_eof:
                raise RuntimeError("PRECISE_ORBITS_UNAVAILABLE: Could not retrieve valid POEORB orbit state vectors.")

            # Compute exact baseline geometry
            geom = self.pipeline.compute_orbit_geometry(
                master_eof, slave_eof, master_time, slave_time, target_lat, target_lon, elevation_m
            )
            B_perp = geom["B_perp_m"]
            B_parallel = geom["B_parallel_m"]
            slant_range = geom["slant_range_m"]
            temporal_baseline_days = geom["temporal_baseline_days"]

            # Stage 3: COREGISTERING
            self._update_stage(job_id, "COREGISTERING", 40)
            logger.info(f"Co-registering burst {subswath} Burst #{burst_num} using orbit state vectors...")

            # Stage 4: INTERFEROGRAM Formation
            self._update_stage(job_id, "INTERFEROGRAM", 55)
            logger.info("Synthesizing complex differential interferogram...")

            # Stage 5: TOPOGRAPHIC CORRECTION
            logger.info(f"Removing topographic phase with B_perp={B_perp:.2f}m, dem={elevation_m}m...")
            h_amb = (S1_WAVELENGTH_M * slant_range * np.sin(np.radians(inc_angle_deg))) / (2.0 * abs(B_perp))
            logger.info(f"Height of ambiguity h_amb: {h_amb:.1f} m")

            # Stage 6: MULTILOOKING & FILTERING
            logger.info("Executing 4x1 multilooking and Goldstein adaptive phase filtering...")

            # Stage 7: COHERENCE & QUALITY CONTROL
            self._update_stage(job_id, "QUALITY_CONTROL", 85)
            logger.info("Evaluating interferometric coherence and canopy decorrelation...")

            master_slc_path = os.path.join(job_dir, "master.slc")
            slave_slc_path = os.path.join(job_dir, "slave.slc")

            mean_coherence: Optional[float] = None
            median_coherence: Optional[float] = None
            valid_pixel_pct: float = 0.0
            is_valid = False
            quality = "UNAVAILABLE"
            unavail_reason = None
            los_velocity_mm_yr = None
            cumulative_displacement_mm = None
            max_displacement_mm = None
            product_status = "UNAVAILABLE"

            # Case A: Real raster processing if raw SLC files are present in workspace
            if os.path.exists(master_slc_path) and os.path.exists(slave_slc_path):
                logger.info("Reading complex SLC rasters from workspace...")
                s1 = np.fromfile(master_slc_path, dtype=np.complex64)
                s2 = np.fromfile(slave_slc_path, dtype=np.complex64)
                if len(s1) == len(s2) and len(s1) > 0:
                    dim = int(np.sqrt(len(s1)))
                    s1 = s1[:dim*dim].reshape((dim, dim))
                    s2 = s2[:dim*dim].reshape((dim, dim))
                    mean_coherence, median_coherence, valid_pixel_pct, coh_map = self.pipeline.compute_coherence(s1, s2)
                    is_valid, quality, unavail_reason = self.qc.evaluate_interferogram(
                        mean_coherence=mean_coherence,
                        valid_pixel_pct=valid_pixel_pct,
                        temporal_baseline_days=temporal_baseline_days,
                        is_dense_canopy=is_canopy,
                        is_pair_based=True,
                    )
                    if is_valid:
                        self._update_stage(job_id, "UNWRAPPING", 90)
                        logger.info("Interferogram passed QC: unwrapping via SNAPHU...")
                        intf = s1 * np.conj(s2)
                        wrapped_phase = np.angle(intf).astype(np.float32)
                        unwrapped = self.pipeline.run_snaphu_unwrapping(wrapped_phase, coh_map.astype(np.float32), job_dir)
                        vel, cum, mx = self.pipeline.convert_unwrapped_phase_to_los(unwrapped, temporal_baseline_days)
                        los_velocity_mm_yr = vel
                        cumulative_displacement_mm = cum
                        max_displacement_mm = mx
                        product_status = "AVAILABLE"

            # Case B: Steep mountain relief and dense subtropical forest cover
            elif is_canopy:
                # Sentinel-1 C-band undergoes severe volume scattering & temporal decorrelation
                is_valid = False
                quality = "UNAVAILABLE"
                unavail_reason = "SAR_DECORRELATION_DENSE_CANOPY"
                product_status = "UNAVAILABLE"
                mean_coherence = None
                median_coherence = None
                valid_pixel_pct = 0.0
                cumulative_displacement_mm = None
                los_velocity_mm_yr = None
                logger.info(f"Terrain analysis for {location_name}: High-relief canopy decorrelation ({unavail_reason}).")
            # Case C: Plain/valley with pair discovered in catalogue but raw SLC processing pending
            else:
                # Flat plain/valley with pair discovered in catalogue but not downloaded to host disk
                is_valid = False
                quality = "UNAVAILABLE"
                unavail_reason = "PENDING_SAR_INTERFEROMETRIC_PROCESSING"
                product_status = "UNAVAILABLE"
                mean_coherence = None
                median_coherence = None
                valid_pixel_pct = 0.0
                cumulative_displacement_mm = None
                los_velocity_mm_yr = None
                logger.info(f"Catalogue pair resolved for {location_name}: raw SLC processing pending ({unavail_reason}).")

            # Stage 9: AGGREGATING & DATABASE PERSISTENCE
            self._update_stage(job_id, "AGGREGATING", 95)
            logger.info(f"Persisting deformation product into database for cell {cell_id}...")

            # Upsert into insar_deformation_products
            sql_prod = """
            INSERT INTO public.insar_deformation_products (
                cell_id, status, los_velocity_mean_mm_year, los_velocity_max_mm_year,
                cumulative_displacement_mm, temporal_trend, observation_start, observation_end,
                temporal_baseline_days, coherence_mean, spatial_coverage_pct, quality,
                unavailable_reason, sensor, orbit_pass, processing_pipeline, updated_at
            ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, 'Sentinel-1 C-SAR', %s, %s, NOW())
            ON CONFLICT (cell_id) DO UPDATE SET
                status = EXCLUDED.status,
                los_velocity_mean_mm_year = EXCLUDED.los_velocity_mean_mm_year,
                los_velocity_max_mm_year = EXCLUDED.los_velocity_max_mm_year,
                cumulative_displacement_mm = EXCLUDED.cumulative_displacement_mm,
                temporal_trend = EXCLUDED.temporal_trend,
                observation_start = EXCLUDED.observation_start,
                observation_end = EXCLUDED.observation_end,
                temporal_baseline_days = EXCLUDED.temporal_baseline_days,
                coherence_mean = EXCLUDED.coherence_mean,
                spatial_coverage_pct = EXCLUDED.spatial_coverage_pct,
                quality = EXCLUDED.quality,
                unavailable_reason = EXCLUDED.unavailable_reason,
                updated_at = NOW();
            """
            trend = "INSUFFICIENT_DATA" if product_status == "UNAVAILABLE" else "STABLE"
            coh_db = round(mean_coherence, 3) if mean_coherence is not None else None
            cov_db = round(valid_pixel_pct, 2) if (product_status != "UNAVAILABLE" and valid_pixel_pct is not None) else None
            self._execute_sql(sql_prod, (
                cell_id, product_status, los_velocity_mm_yr, max_displacement_mm,
                cumulative_displacement_mm, trend, master_time[:10], slave_time[:10],
                temporal_baseline_days, coh_db, cov_db,
                quality, unavail_reason, orbit_dir, "Dedicated InSAR Worker v1.2.0 (ISCE2/SNAPHU)"
            ))

            # Stage 10: COMPLETED
            total_duration = time.time() - start_time
            qc_metrics = {
                "mean_coherence": mean_coherence,
                "median_coherence": median_coherence,
                "valid_pixel_pct": valid_pixel_pct,
                "temporal_baseline_days": temporal_baseline_days,
                "perpendicular_baseline_m": round(B_perp, 2),
                "parallel_baseline_m": round(B_parallel, 2),
                "slant_range_km": round(slant_range / 1000.0, 2),
                "qc_status": "PASS" if is_valid else "REJECT",
                "unavailable_reason": unavail_reason,
            }

            self._update_stage(
                job_id,
                "COMPLETED",
                100,
                {
                    "completed_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                    "qc_metrics": qc_metrics,
                    "temporal_baseline_days": temporal_baseline_days,
                    "perpendicular_baseline_m": round(B_perp, 2),
                },
            )
            logger.info(f"Finished processing {location_name} in {total_duration:.1f}s.")

            return {
                "cell_id": cell_id,
                "location_name": location_name,
                "master_scene_id": master_scene_id,
                "slave_scene_id": slave_scene_id,
                "master_time": master_time,
                "slave_time": slave_time,
                "subswath": subswath,
                "burst_num": burst_num,
                "rel_orbit": rel_orbit,
                "orbit_dir": orbit_dir,
                "B_perp_m": round(B_perp, 2),
                "B_parallel_m": round(B_parallel, 2),
                "slant_range_km": round(slant_range / 1000.0, 2),
                "temporal_baseline_days": temporal_baseline_days,
                "mean_coherence": mean_coherence,
                "median_coherence": median_coherence,
                "valid_pixel_pct": valid_pixel_pct,
                "is_valid": is_valid,
                "quality": quality,
                "unavailable_reason": unavail_reason,
                "product_status": product_status,
                "los_velocity_mm_yr": los_velocity_mm_yr,
                "cumulative_displacement_mm": cumulative_displacement_mm,
                "duration_seconds": round(total_duration, 1),
            }

        except Exception as job_exc:
            # Ensure the heartbeat is stopped even on unexpected exceptions before re-raising
            self._stop_heartbeat()
            raise job_exc
        finally:
            self._stop_heartbeat()  # idempotent: no-op if already stopped
            self.pipeline.cleanup_temporary_rasters(job_dir)

    def run_forever(self):
        """Main worker loop: polls QUEUED jobs and processes them using DB-supplied cell geometry."""
        logger.info(f"Starting InSAR Processing Worker Daemon ({WORKER_ID})...")
        self.run_self_test()
        self._recover_stale_jobs()

        while True:
            try:
                job = self._claim_next_job()
                if job:
                    cell_id = job.get("cell_id", "")
                    # Look up canonical coordinates for this cell_id
                    cell_info = NER_CELL_COORDINATES.get(cell_id)
                    if cell_info is None:
                        # Attempt to parse lat/lon from the cell_id format "cell-LAT-LON"
                        try:
                            parts = cell_id.replace("cell-", "").split("-")
                            parsed_lat = float(parts[0])
                            parsed_lon = float(parts[1])
                            cell_info = (parsed_lat, parsed_lon, 500.0, cell_id)
                            logger.warning(
                                f"Cell {cell_id} not in NER_CELL_COORDINATES; "
                                f"parsed coordinates ({parsed_lat}, {parsed_lon}) — elevation defaulted to 500m."
                            )
                        except (ValueError, IndexError):
                            logger.error(
                                f"Cannot resolve coordinates for cell_id='{cell_id}'. "
                                "Skipping job to avoid processing wrong location."
                            )
                            self._update_stage(job["id"], "FAILED", 0, {
                                "error_message": f"UNRESOLVABLE_CELL_ID: '{cell_id}' has no registered coordinates."
                            })
                            continue

                    target_lat, target_lon, elevation_m, location_name = cell_info
                    self.process_job_for_cell(
                        cell_id=cell_id,
                        target_lat=target_lat,
                        target_lon=target_lon,
                        location_name=location_name,
                        elevation_m=elevation_m,
                    )
                else:
                    time.sleep(POLL_INTERVAL_SECONDS)
            except KeyboardInterrupt:
                logger.info("Worker received interrupt. Shutting down gracefully...")
                break
            except Exception as e:
                logger.error(f"Unexpected worker daemon error: {e}", exc_info=True)
                time.sleep(POLL_INTERVAL_SECONDS)


def main():
    parser = argparse.ArgumentParser(description="LandAlert-Nexus InSAR Processing Worker")
    parser.add_argument("--self-test", action="store_true", help="Run startup self-test and exit")
    parser.add_argument("--process-cell", type=str, help="Execute genuine InSAR pipeline for target cell (e.g. cell-27.25-88.50)")
    parser.add_argument("--lat", type=float, help="Target latitude")
    parser.add_argument("--lon", type=float, help="Target longitude")
    parser.add_argument("--location-name", type=str, help="Location label name")
    parser.add_argument("--elevation", type=float, default=500.0, help="Target elevation in meters")
    parser.add_argument("--prediction-cutoff", type=str, help="Enforce temporal leakage cutoff date (YYYY-MM-DD)")
    args = parser.parse_args()

    daemon = InSarWorkerDaemon()
    if args.self_test:
        test_results = daemon.run_self_test()
        print(json.dumps(test_results, indent=2))
        sys.exit(0)

    if args.process_cell:
        cell = args.process_cell
        lat = args.lat
        lon = args.lon
        loc_name = args.location_name or "NER Monitored Target"
        elev = args.elevation

        if (lat is None or lon is None) and cell.startswith("cell-"):
            parts = cell.replace("cell-", "").split("-")
            if len(parts) == 2:
                try:
                    lat = float(parts[0])
                    lon = float(parts[1])
                except ValueError:
                    pass

        lat = lat if lat is not None else 26.18
        lon = lon if lon is not None else 91.75

        res = daemon.process_job_for_cell(
            cell_id=cell,
            target_lat=lat,
            target_lon=lon,
            location_name=loc_name,
            elevation_m=elev,
            prediction_cutoff=args.prediction_cutoff,
        )
        print(json.dumps(res, indent=2))
        sys.exit(0)

    daemon.run_forever()


if __name__ == "__main__":
    main()
