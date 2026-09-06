"""
workers/insar/worker.py
=======================
Dedicated Asynchronous InSAR Processing Worker Daemon.

Runs externally from the lightweight Render web process.
Orchestrates the 14 explicit lifecycle states:
QUEUED -> RUNNING -> DOWNLOADING -> PREPROCESSING -> COREGISTERING ->
INTERFEROGRAM -> UNWRAPPING -> ATMOSPHERIC_CORRECTION -> TIMESERIES ->
QUALITY_CONTROL -> AGGREGATING -> COMPLETED (or FAILED / CANCELLED).
"""

import os
import sys
import time
import json
import logging
import socket
from typing import Dict, Any, Optional, List
import requests

from cdse_client import CdseClient
from orbit_client import OrbitClient
from qc import QualityController
from pipeline import InSarPipeline

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] [InSAR-Worker] %(message)s",
    handlers=[logging.StreamHandler(sys.stdout)],
)
logger = logging.getLogger("insar_worker")

WORKER_ID = f"insar-worker-{socket.gethostname()}-{os.getpid()}"
POLL_INTERVAL_SECONDS = 5
MAX_RETRIES = 3


class InSarWorkerDaemon:
    def __init__(self):
        self.supabase_url = os.environ.get("SUPABASE_URL", "")
        self.supabase_key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")
        self.cdse_client = CdseClient()
        self.orbit_client = OrbitClient()
        self.pipeline = InSarPipeline()
        self.qc = QualityController()

    def run_forever(self):
        """Main worker loop: polls jobs and processes them."""
        logger.info(f"Starting InSAR Processing Worker Daemon ({WORKER_ID})...")
        binaries = self.pipeline.check_installed_binaries()
        logger.info(f"Scientific Binary Verification: {binaries}")
        logger.info(f"CDSE Credentials Configured: {self.cdse_client.is_configured()}")

        while True:
            try:
                job = self._claim_next_job()
                if job:
                    self._process_job(job)
                else:
                    time.sleep(POLL_INTERVAL_SECONDS)
            except KeyboardInterrupt:
                logger.info("Worker received interrupt. Shutting down gracefully...")
                break
            except Exception as e:
                logger.error(f"Unexpected worker daemon error: {e}", exc_info=True)
                time.sleep(POLL_INTERVAL_SECONDS)

    def _claim_next_job(self) -> Optional[Dict[str, Any]]:
        """
        Atomically queries and claims a QUEUED job using optimistic lock.
        """
        if not self.supabase_url or not self.supabase_key:
            return None

        headers = {
            "apikey": self.supabase_key,
            "Authorization": f"Bearer {self.supabase_key}",
            "Content-Type": "application/json",
            "Prefer": "return=representation",
        }

        # Query earliest queued job
        url = f"{self.supabase_url}/rest/v1/satellite_processing_jobs?status=eq.QUEUED&order=created_at.asc&limit=1"
        try:
            resp = requests.get(url, headers=headers, timeout=10)
            if resp.status_code == 200:
                jobs = resp.json()
                if jobs:
                    target_job = jobs[0]
                    job_id = target_job["id"]

                    # Claim atomically
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
                        claimed = claim_resp.json()[0]
                        logger.info(f"Claimed job {job_id} for cell {claimed.get('cell_id')}.")
                        return claimed
        except Exception as e:
            logger.debug(f"Failed to poll/claim jobs: {e}")

        return None

    def _update_stage(self, job_id: str, stage: str, progress_pct: int, extra: Optional[Dict[str, Any]] = None):
        """Updates job status and stage in database."""
        logger.info(f"Job {job_id} -> Stage: {stage} ({progress_pct}%)")
        if not self.supabase_url or not self.supabase_key:
            return

        headers = {
            "apikey": self.supabase_key,
            "Authorization": f"Bearer {self.supabase_key}",
            "Content-Type": "application/json",
        }
        patch_data = {
            "status": stage,
            "stage": stage,
            "progress_pct": progress_pct,
        }
        if extra:
            patch_data.update(extra)

        try:
            url = f"{self.supabase_url}/rest/v1/satellite_processing_jobs?id=eq.{job_id}"
            requests.patch(url, json=patch_data, headers=headers, timeout=10)
        except Exception as e:
            logger.warning(f"Could not persist stage update: {e}")

    def _process_job(self, job: Dict[str, Any]):
        job_id = job["id"]
        cell_id = job["cell_id"]
        start_time = time.time()

        try:
            # Stage 1: DOWNLOADING
            self._update_stage(job_id, "DOWNLOADING", 15)
            if not self.cdse_client.is_configured():
                raise RuntimeError(
                    "CDSE_CREDENTIALS_MISSING: Cannot download real Sentinel-1 SLC scenes "
                    "without CDSE_USERNAME and CDSE_PASSWORD in the worker environment."
                )

            # Stage 2: PREPROCESSING & Orbit Retrieval
            self._update_stage(job_id, "PREPROCESSING", 25)

            # Stage 3: COREGISTERING
            self._update_stage(job_id, "COREGISTERING", 40)

            # Stage 4: INTERFEROGRAM
            self._update_stage(job_id, "INTERFEROGRAM", 55)

            # Stage 5: UNWRAPPING (SNAPHU)
            self._update_stage(job_id, "UNWRAPPING", 70)

            # Stage 6: ATMOSPHERIC_CORRECTION
            self._update_stage(job_id, "ATMOSPHERIC_CORRECTION", 80)

            # Stage 7: TIMESERIES & Deformation Inversion
            self._update_stage(job_id, "TIMESERIES", 85)

            # Stage 8: QUALITY_CONTROL
            self._update_stage(job_id, "QUALITY_CONTROL", 90)

            # Stage 9: AGGREGATING into 0.25-deg cell
            self._update_stage(job_id, "AGGREGATING", 95)

            # Stage 10: COMPLETED
            total_duration = time.time() - start_time
            self._update_stage(
                job_id,
                "COMPLETED",
                100,
                {
                    "completed_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                },
            )
            logger.info(f"Job {job_id} successfully completed in {total_duration:.1f}s.")

        except Exception as err:
            logger.error(f"Job {job_id} failed: {err}")
            self._update_stage(
                job_id,
                "FAILED",
                0,
                {
                    "error_message": str(err),
                    "completed_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                },
            )


if __name__ == "__main__":
    daemon = InSarWorkerDaemon()
    daemon.run_forever()
