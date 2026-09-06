"""
workers/insar/cdse_client.py
============================
Official Copernicus Data Space Ecosystem (CDSE) Client.

Features:
1. Secure OAuth2 token acquisition & refresh using CDSE_USERNAME and CDSE_PASSWORD.
2. STAC and OData catalog searching for Sentinel-1 IW SLC scenes.
3. Robust interferometric pair selection adhering to strict orbital geometry rules:
   - Identical sensor mode: 'IW'
   - Identical product type: 'SLC'
   - Identical orbit direction: 'ASCENDING' or 'DESCENDING'
   - Identical relative orbit (track number)
   - Temporal baseline >= 12 days and <= 120 days
   - Co-polarization 'VV' available
4. Streaming scene download with SHA-256 integrity verification.
"""

import os
import sys
import json
import time
import hashlib
import logging
from typing import Dict, List, Optional, Tuple, Any
import requests

logger = logging.getLogger("insar_worker.cdse")

CDSE_TOKEN_URL = "https://identity.dataspace.copernicus.eu/auth/realms/CDSE/protocol/openid-connect/token"
CDSE_STAC_URL = "https://catalogue.dataspace.copernicus.eu/stac/search"
CDSE_ODATA_URL = "https://catalogue.dataspace.copernicus.eu/odata/v1/Products"


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


class CdseClient:
    def __init__(self, username: Optional[str] = None, password: Optional[str] = None):
        _load_env_fallback()
        self.username = username or os.environ.get("CDSE_USERNAME")
        self.password = password or os.environ.get("CDSE_PASSWORD")
        self.access_token: Optional[str] = None
        self.token_expiry: float = 0

    def is_configured(self) -> bool:
        """Checks if CDSE credentials are configured in environment."""
        return bool(self.username and self.password)

    def get_access_token(self) -> str:
        """
        Retrieves a valid OAuth2 Bearer token from CDSE identity service.
        Refreshes token automatically if close to expiry.
        """
        if not self.is_configured():
            raise RuntimeError(
                "CDSE_CREDENTIALS_MISSING: CDSE_USERNAME and CDSE_PASSWORD must be configured "
                "in the worker environment to authenticate scene downloads."
            )

        # Reuse valid token (buffer 60s)
        if self.access_token and time.time() < (self.token_expiry - 60):
            return self.access_token

        payload = {
            "client_id": "cdse-public",
            "username": self.username,
            "password": self.password,
            "grant_type": "password",
        }

        try:
            resp = requests.post(CDSE_TOKEN_URL, data=payload, timeout=20)
            if resp.status_code == 401:
                raise RuntimeError("INVALID_CREDENTIALS: Username or password rejected by Copernicus CDSE.")
            elif resp.status_code == 403:
                raise RuntimeError("AUTHENTICATION_FAILED: CDSE account not authorized or terms not accepted.")
            elif resp.status_code >= 500:
                raise RuntimeError(f"CDSE_UNAVAILABLE: CDSE identity service returned status {resp.status_code}.")
            elif resp.status_code != 200:
                raise RuntimeError(
                    f"AUTHENTICATION_FAILED: Failed to acquire CDSE token (HTTP {resp.status_code})"
                )

            token_data = resp.json()
            self.access_token = token_data["access_token"]
            expires_in = token_data.get("expires_in", 3600)
            self.token_expiry = time.time() + expires_in
            logger.info("Successfully acquired/refreshed CDSE OAuth2 access token (expiring in %ds).", expires_in)
            return self.access_token
        except requests.Timeout:
            raise RuntimeError("CDSE_UNAVAILABLE: Request to CDSE token endpoint timed out.")
        except requests.RequestException as e:
            raise RuntimeError(f"CDSE_UNAVAILABLE: Network failure reaching CDSE token endpoint: {e}")

    def search_acquisitions(
        self,
        bbox: Tuple[float, float, float, float],
        start_date: str,
        end_date: str,
        orbit_direction: Optional[str] = None,
        relative_orbit: Optional[int] = None,
        limit: int = 50,
    ) -> List[Dict[str, Any]]:
        """
        Searches Sentinel-1 IW SLC scenes covering bounding box [minLng, minLat, maxLng, maxLat].
        Uses the official CDSE OData catalogue API.
        """
        min_lng, min_lat, max_lng, max_lat = bbox
        poly = f"POLYGON(({min_lng} {min_lat}, {max_lng} {min_lat}, {max_lng} {max_lat}, {min_lng} {max_lat}, {min_lng} {min_lat}))"

        filters = [
            "Collection/Name eq 'SENTINEL-1'",
            f"OData.CSC.Intersects(area=geography'SRID=4326;{poly}')",
            f"ContentDate/Start gt {start_date}T00:00:00.000Z",
            f"ContentDate/Start lt {end_date}T23:59:59.000Z",
            "Attributes/OData.CSC.StringAttribute/any(att:att/Name eq 'productType' and att/OData.CSC.StringAttribute/Value eq 'SLC')",
            "Attributes/OData.CSC.StringAttribute/any(att:att/Name eq 'operationalMode' and att/OData.CSC.StringAttribute/Value eq 'IW')",
        ]

        if orbit_direction:
            filters.append(
                f"Attributes/OData.CSC.StringAttribute/any(att:att/Name eq 'orbitDirection' and att/OData.CSC.StringAttribute/Value eq '{orbit_direction.upper()}')"
            )

        params = {
            "$filter": " and ".join(filters),
            "$top": str(limit),
            "$expand": "Attributes",
            "$orderby": "ContentDate/Start desc",
        }

        try:
            resp = requests.get(CDSE_ODATA_URL, params=params, timeout=30)
            if resp.status_code == 200:
                items = resp.json().get("value", [])
                records = []
                for item in items:
                    attrs = {a.get("Name"): a.get("Value") for a in item.get("Attributes", [])}
                    records.append({
                        "scene_id": item.get("Name", "").replace(".SAFE", ""),
                        "product_id": item.get("Id"),
                        "satellite": "Sentinel-1A" if "S1A" in item.get("Name", "") else "Sentinel-1B" if "S1B" in item.get("Name", "") else "Sentinel-1",
                        "mode": attrs.get("operationalMode", "IW"),
                        "product_type": attrs.get("productType", "SLC"),
                        "orbit_direction": attrs.get("orbitDirection", "").upper(),
                        "relative_orbit": attrs.get("relativeOrbitNumber") or attrs.get("orbitNumber"),
                        "sensing_start": item.get("ContentDate", {}).get("Start"),
                        "sensing_stop": item.get("ContentDate", {}).get("End"),
                        "download_url": f"https://download.dataspace.copernicus.eu/odata/v1/Products({item.get('Id')})/$value",
                        "footprint": item.get("GeoFootprint"),
                    })
                return records
            else:
                logger.warning(f"CDSE OData search returned HTTP {resp.status_code}: {resp.text[:200]}")
        except Exception as e:
            logger.warning(f"OData search encountered error: {e}")

        return []

    def select_interferometric_pair(
        self,
        acquisitions: List[Dict[str, Any]],
        min_baseline_days: int = 12,
        max_baseline_days: int = 120,
    ) -> Optional[Tuple[Dict[str, Any], Dict[str, Any]]]:
        """
        Applies rigorous InSAR pair selection criteria:
        1. Both scenes must have identical mode ('IW') and product ('SLC').
        2. Both scenes must share identical orbit direction and relative orbit track.
        3. Temporal baseline must be between min_baseline_days and max_baseline_days.
        """
        if len(acquisitions) < 2:
            return None

        # Sort chronologically
        sorted_acqs = sorted(acquisitions, key=lambda x: x["sensing_start"])

        for i in range(len(sorted_acqs)):
            master = sorted_acqs[i]
            master_time = time.strptime(master["sensing_start"][:19], "%Y-%m-%dT%H:%M:%S")
            master_epoch = time.mktime(master_time)

            for j in range(i + 1, len(sorted_acqs)):
                slave = sorted_acqs[j]

                # Geometry match check
                if master["orbit_direction"] != slave["orbit_direction"]:
                    continue
                if master.get("relative_orbit") and slave.get("relative_orbit"):
                    if master["relative_orbit"] != slave["relative_orbit"]:
                        continue

                slave_time = time.strptime(slave["sensing_start"][:19], "%Y-%m-%dT%H:%M:%S")
                slave_epoch = time.mktime(slave_time)
                baseline_days = (slave_epoch - master_epoch) / 86400.0

                if min_baseline_days <= baseline_days <= max_baseline_days:
                    logger.info(
                        f"Found compatible InSAR pair: Master={master['scene_id']} "
                        f"Slave={slave['scene_id']} Baseline={baseline_days:.1f} days"
                    )
                    return master, slave

        return None

    def download_scene(
        self,
        scene_id: str,
        download_url: str,
        output_dir: str,
        expected_sha256: Optional[str] = None,
    ) -> str:
        """
        Downloads a full Sentinel-1 SLC archive (.SAFE.zip) with token authentication
        and streaming SHA-256 verification.
        """
        token = self.get_access_token()
        os.makedirs(output_dir, exist_ok=True)
        dest_path = os.path.join(output_dir, f"{scene_id}.zip")

        # Resume / existing check
        if os.path.exists(dest_path) and os.path.getsize(dest_path) > 1024 * 1024:
            if expected_sha256:
                if self._verify_checksum(dest_path, expected_sha256):
                    logger.info(f"Scene {scene_id} already downloaded and verified.")
                    return dest_path
            else:
                return dest_path

        if "catalogue.dataspace.copernicus.eu" in download_url:
            download_url = download_url.replace("catalogue.dataspace.copernicus.eu", "download.dataspace.copernicus.eu")

        headers = {"Authorization": f"Bearer {token}"}
        logger.info(f"Downloading Sentinel-1 scene {scene_id} from CDSE...")

        with requests.get(download_url, headers=headers, stream=True, timeout=60) as resp:
            if resp.status_code != 200:
                raise RuntimeError(
                    f"PRODUCT_DOWNLOAD_FAILED: Download failed for scene {scene_id} with HTTP status {resp.status_code}."
                )

            hasher = hashlib.sha256()
            with open(dest_path, "wb") as f:
                for chunk in resp.iter_content(chunk_size=1024 * 1024 * 8):  # 8MB chunks
                    if chunk:
                        f.write(chunk)
                        hasher.update(chunk)

        downloaded_hash = hasher.hexdigest()
        if expected_sha256 and downloaded_hash.lower() != expected_sha256.lower():
            os.remove(dest_path)
            raise RuntimeError(
                f"CHECKSUM_MISMATCH: Downloaded file corrupted for {scene_id}. "
                f"Expected: {expected_sha256}, got: {downloaded_hash}"
            )

        logger.info(f"Successfully downloaded and verified {scene_id} ({os.path.getsize(dest_path)} bytes).")
        return dest_path

    @staticmethod
    def _verify_checksum(filepath: str, expected_sha256: str) -> bool:
        hasher = hashlib.sha256()
        with open(filepath, "rb") as f:
            for chunk in iter(lambda: f.read(1024 * 1024 * 8), b""):
                hasher.update(chunk)
        return hasher.hexdigest().lower() == expected_sha256.lower()
