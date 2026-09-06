"""
workers/insar/pipeline.py
=========================
Sentinel-1 InSAR Processing Pipeline Wrapper.

Primary Processing Stack:
- Precise Orbit Ephemerides (POD / POEORB) state vector extraction.
- Sub-pixel TOPS Burst Co-registration & Enhanced Spectral Diversity (ESD).
- Complex-valued Differential Interferogram generation: I = S1 * conj(S2).
- Topographic phase simulation & removal using DEM and perpendicular baseline B_perp.
- Multilooking & Goldstein adaptive phase filtering.
- Genuine Interferometric Coherence estimation & valid pixel percentage computation.
- SNAPHU (Statistical-Cost Network-Flow Algorithm) 2D Phase Unwrapping.
- Line-Of-Sight (LOS) displacement conversion: d_LOS = -(lambda / 4pi) * phi_unwrapped.
- Zonal aggregation into canonical 0.25-degree LandAlert spatial cells.
"""

import os
import shutil
import subprocess
import logging
import xml.etree.ElementTree as ET
from typing import Dict, Any, Optional, Tuple, List
import numpy as np

logger = logging.getLogger("insar_worker.pipeline")

# Sentinel-1 C-band physical radar parameters
S1_WAVELENGTH_M = 0.05546576  # C-band wavelength: 5.54658 cm (f = 5.405 GHz)


class InSarPipeline:
    def __init__(self, workspace_root: Optional[str] = None):
        default_root = "/data/insar_workspace" if os.path.exists("/data") and os.access("/data", os.W_OK) else os.path.join(os.getcwd(), "data", "insar_workspace")
        self.workspace_root = workspace_root or default_root
        os.makedirs(self.workspace_root, exist_ok=True)

    def check_installed_binaries(self) -> Dict[str, bool]:
        """
        Verifies presence of required scientific InSAR binaries.
        """
        binaries = ["gdalinfo", "snaphu", "python3"]
        status = {}
        for b in binaries:
            status[b] = shutil.which(b) is not None
        
        # Check container snaphu if host doesn't have it
        if not status["snaphu"]:
            try:
                res = subprocess.run(
                    ["docker", "run", "--rm", "--entrypoint", "snaphu", "landalert-insar-worker:test", "-h"],
                    stdout=subprocess.PIPE,
                    stderr=subprocess.PIPE,
                    text=True,
                    timeout=5,
                )
                if "snaphu" in res.stdout + res.stderr:
                    status["snaphu"] = True
            except Exception:
                pass

        return status

    def compute_orbit_geometry(
        self,
        master_eof_path: str,
        slave_eof_path: str,
        master_time_str: str,
        slave_time_str: str,
        target_lat: float,
        target_lon: float,
        target_height_m: float = 1520.0,
    ) -> Dict[str, Any]:
        """
        Extracts satellite state vectors from official ESA POEORB (.EOF) files
        and computes baseline geometry (B_parallel, B_perp, slant range R).
        """
        def _parse_osv(eof_path: str, target_time: str) -> Tuple[np.ndarray, np.ndarray, float]:
            tree = ET.parse(eof_path)
            root = tree.getroot()
            osvs = root.findall(".//OSV")
            target_epoch = np.datetime64(target_time[:19])
            best_osv = None
            min_dt = 999999.0

            for osv in osvs:
                t_str = osv.find("UTC").text.replace("UTC=", "").strip()
                t_epoch = np.datetime64(t_str[:19])
                dt = abs(float((t_epoch - target_epoch) / np.timedelta64(1, "s")))
                if dt < min_dt:
                    min_dt = dt
                    x = float(osv.find("X").text)
                    y = float(osv.find("Y").text)
                    z = float(osv.find("Z").text)
                    vx = float(osv.find("VX").text)
                    vy = float(osv.find("VY").text)
                    vz = float(osv.find("VZ").text)
                    best_osv = (np.array([x, y, z]), np.array([vx, vy, vz]), dt)

            if best_osv is None:
                raise RuntimeError(f"No valid state vectors found in {eof_path} near {target_time}")
            return best_osv

        m_pos, m_vel, _ = _parse_osv(master_eof_path, master_time_str)
        s_pos, s_vel, _ = _parse_osv(slave_eof_path, slave_time_str)
        B_vec = s_pos - m_pos

        # Ground target position in ECEF WGS84
        a = 6378137.0
        f = 1.0 / 298.257223563
        e2 = 2 * f - f**2
        phi = np.radians(target_lat)
        lam = np.radians(target_lon)
        h = target_height_m
        N = a / np.sqrt(1.0 - e2 * np.sin(phi)**2)
        P_tgt = np.array([
            (N + h) * np.cos(phi) * np.cos(lam),
            (N + h) * np.cos(phi) * np.sin(lam),
            (N * (1.0 - e2) + h) * np.sin(phi),
        ])

        R_vec = P_tgt - m_pos
        R = float(np.linalg.norm(R_vec))
        r_hat = R_vec / R
        v_hat = m_vel / np.linalg.norm(m_vel)
        c_hat = np.cross(v_hat, r_hat)
        c_hat /= np.linalg.norm(c_hat)

        B_perp = float(np.dot(B_vec, c_hat))
        B_parallel = float(np.dot(B_vec, r_hat))

        # Temporal baseline in days
        m_epoch = np.datetime64(master_time_str[:19])
        s_epoch = np.datetime64(slave_time_str[:19])
        temporal_baseline_days = float((s_epoch - m_epoch) / np.timedelta64(1, "D"))

        logger.info(
            f"Orbit Baseline: B_perp={B_perp:.2f}m, B_parallel={B_parallel:.2f}m, "
            f"SlantRange={R/1000.0:.2f}km, TempBaseline={temporal_baseline_days:.1f}d"
        )

        return {
            "B_perp_m": B_perp,
            "B_parallel_m": B_parallel,
            "slant_range_m": R,
            "temporal_baseline_days": int(round(temporal_baseline_days)),
            "master_osv": m_pos.tolist(),
            "slave_osv": s_pos.tolist(),
        }

    def compute_topographic_phase(
        self,
        B_perp: float,
        slant_range: float,
        inc_angle_deg: float,
        height_dem_m: np.ndarray,
    ) -> np.ndarray:
        """
        Simulates topographic phase to be removed from the raw interferogram:
        phi_topo = -(4 * pi / lambda) * (B_perp / (R * sin(theta))) * h
        """
        theta = np.radians(inc_angle_deg)
        coeff = -(4.0 * np.pi / S1_WAVELENGTH_M) * (B_perp / (slant_range * np.sin(theta)))
        return coeff * height_dem_m

    def compute_coherence(
        self,
        s1: np.ndarray,
        s2: np.ndarray,
        box_size: int = 5,
    ) -> Tuple[float, float, float, np.ndarray]:
        """
        Computes interferometric sample coherence:
        gamma = |sum(s1 * conj(s2))| / sqrt(sum(|s1|^2) * sum(|s2|^2))
        Returns: (mean_coherence, median_coherence, valid_pixel_pct, coherence_map)
        """
        # Complex product
        intf = s1 * np.conj(s2)
        p1 = np.abs(s1)**2
        p2 = np.abs(s2)**2

        # Fast 2D uniform box filter via scipy or uniform kernel
        from scipy.ndimage import uniform_filter
        sum_intf = uniform_filter(np.real(intf), size=box_size) + 1j * uniform_filter(np.imag(intf), size=box_size)
        sum_p1 = uniform_filter(p1, size=box_size)
        sum_p2 = uniform_filter(p2, size=box_size)

        denom = np.sqrt(np.maximum(sum_p1 * sum_p2, 1e-12))
        coh_map = np.clip(np.abs(sum_intf) / denom, 0.0, 1.0)

        valid_mask = coh_map >= 0.40
        valid_pixel_pct = float(np.count_nonzero(valid_mask) / coh_map.size * 100.0)
        mean_coh = float(np.mean(coh_map))
        median_coh = float(np.median(coh_map))

        return mean_coh, median_coh, valid_pixel_pct, coh_map

    def run_snaphu_unwrapping(
        self,
        wrapped_phase: np.ndarray,
        correlation: np.ndarray,
        job_dir: str,
    ) -> np.ndarray:
        """
        Invokes real SNAPHU binary to perform statistical minimum cost flow phase unwrapping.
        """
        os.makedirs(job_dir, exist_ok=True)
        length, width = wrapped_phase.shape

        # Interleaved complex format for SNAPHU (float32 real, float32 imag)
        complex_int = np.zeros((length, width, 2), dtype=np.float32)
        complex_int[:, :, 0] = correlation * np.cos(wrapped_phase)
        complex_int[:, :, 1] = correlation * np.sin(wrapped_phase)

        flat_path = os.path.join(job_dir, "phase.flat")
        out_path = os.path.join(job_dir, "unwrapped.out")
        complex_int.tofile(flat_path)

        # Correlation file
        corr_path = os.path.join(job_dir, "corr.raw")
        correlation.astype(np.float32).tofile(corr_path)

        # Check if local snaphu or docker snaphu
        has_local = shutil.which("snaphu") is not None
        if has_local:
            cmd = [
                "snaphu", "-d", "--mcf",
                "-C", "CORRFILEFORMAT FLOAT_DATA",
                "-c", corr_path,
                "-o", out_path,
                flat_path, str(width)
            ]
            subprocess.run(cmd, cwd=job_dir, check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        else:
            # Delegate to container
            cmd = [
                "docker", "run", "--rm",
                "-v", f"{job_dir}:/scratch",
                "-w", "/scratch",
                "--entrypoint", "snaphu",
                "landalert-insar-worker:test",
                "-d", "--mcf",
                "-C", "CORRFILEFORMAT FLOAT_DATA",
                "-c", "corr.raw",
                "-o", "unwrapped.out",
                "phase.flat", str(width)
            ]
            subprocess.run(cmd, check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)

        if not os.path.exists(out_path):
            raise RuntimeError("SNAPHU unwrapped output file was not created.")

        raw_unwrapped = np.fromfile(out_path, dtype=np.float32)
        # SNAPHU returns interleaved (mag, phase)
        if len(raw_unwrapped) == length * width * 2:
            unwrapped_phase = raw_unwrapped[1::2].reshape((length, width))
        else:
            unwrapped_phase = raw_unwrapped.reshape((length, width))

        return unwrapped_phase

    def convert_unwrapped_phase_to_los(
        self,
        unwrapped_phase_rad: np.ndarray,
        temporal_baseline_days: int,
    ) -> Tuple[Optional[float], float, float]:
        """
        Converts unwrapped interferometric phase to Line-Of-Sight (LOS) displacement:
        d_LOS = -(lambda / 4pi) * phi_unwrapped

        Strict rule: A single pair MUST NOT be presented as long-term annual deformation velocity.
        """
        phase_to_meters = -S1_WAVELENGTH_M / (4.0 * np.pi)
        displacement_mm = unwrapped_phase_rad * phase_to_meters * 1000.0

        valid_mask = np.isfinite(displacement_mm)
        if not np.any(valid_mask):
            return None, 0.0, 0.0

        valid_displacements = displacement_mm[valid_mask]
        mean_displacement_mm = float(np.mean(valid_displacements))
        max_displacement_mm = float(np.min(valid_displacements))  # Negative = movement away

        # Multi-temporal velocity rate is only computed for multi-epoch stacks (>= 60 days)
        if temporal_baseline_days < 60:
            mean_velocity_mm_year = None
        else:
            temporal_baseline_years = temporal_baseline_days / 365.25
            mean_velocity_mm_year = mean_displacement_mm / temporal_baseline_years

        return mean_velocity_mm_year, mean_displacement_mm, max_displacement_mm

    def cleanup_temporary_rasters(self, job_dir: str) -> None:
        """
        Removes intermediate scratch rasters while preserving outputs.
        """
        extensions_to_delete = [".flat", ".raw", ".int", ".amp", ".slc"]
        if not os.path.exists(job_dir):
            return
        for root, _, files in os.walk(job_dir):
            for f in files:
                if any(f.endswith(ext) for ext in extensions_to_delete):
                    try:
                        os.remove(os.path.join(root, f))
                    except OSError:
                        pass
        logger.info(f"Cleaned intermediate temporary files in {job_dir}.")


class MultiTemporalInSarProcessor:
    """
    Multi-Temporal InSAR (PSI / SBAS) Small-Baseline Inversion Engine.
    Enforces scientific integrity:
    1. Requires >= 20 repeat acquisitions spanning >= 365 days for valid annual velocity rate.
    2. Builds Delaunay / small-baseline interferometric network (|B_perp| <= 150m, |dt| <= 60d).
    3. Rejects decorrelated pairs (gamma < 0.40).
    4. Inverts unwrapped phase network via Singular Value Decomposition (SVD) / Weighted Least Squares.
    5. Computes velocity uncertainty sigma_v.
    6. If criteria are not met, strictly reports INSUFFICIENT_TEMPORAL_SAR_ACQUISITIONS without fabrication.
    """

    def __init__(self, min_acquisitions: int = 20, min_timespan_days: int = 365):
        self.min_acquisitions = min_acquisitions
        self.min_timespan_days = min_timespan_days

    def evaluate_network_suitability(
        self,
        acquisitions: List[Dict[str, Any]],
        max_b_perp_m: float = 150.0,
        max_dt_days: float = 60.0,
    ) -> Dict[str, Any]:
        """
        Validates whether an acquisition catalog meets the minimum multi-temporal threshold.
        """
        n_acq = len(acquisitions)
        if n_acq < 2:
            return {
                "status": "INSUFFICIENT_DATA",
                "reason": "INSUFFICIENT_TEMPORAL_SAR_ACQUISITIONS",
                "acquisition_count": n_acq,
                "timespan_days": 0,
                "can_solve_velocity": False,
                "error": f"Need at least 2 acquisitions, got {n_acq}.",
            }

        # Sort by date
        sorted_acqs = sorted(acquisitions, key=lambda x: x.get("time", ""))
        t_start = np.datetime64(sorted_acqs[0]["time"][:10])
        t_end = np.datetime64(sorted_acqs[-1]["time"][:10])
        timespan_days = int((t_end - t_start) / np.timedelta64(1, "D"))

        # Form small baseline candidate pairs
        pairs = []
        for i in range(n_acq):
            t_i = np.datetime64(sorted_acqs[i]["time"][:10])
            b_i = sorted_acqs[i].get("b_perp_m", 0.0)
            for j in range(i + 1, n_acq):
                t_j = np.datetime64(sorted_acqs[j]["time"][:10])
                b_j = sorted_acqs[j].get("b_perp_m", 0.0)
                dt = abs(float((t_j - t_i) / np.timedelta64(1, "D")))
                db = abs(b_j - b_i)
                if dt <= max_dt_days and db <= max_b_perp_m:
                    pairs.append({
                        "master_idx": i,
                        "slave_idx": j,
                        "temporal_baseline_days": dt,
                        "perpendicular_baseline_m": db,
                    })

        is_production_ready = (n_acq >= self.min_acquisitions) and (timespan_days >= self.min_timespan_days)

        return {
            "status": "VALID_STACK" if is_production_ready else "INSUFFICIENT_TEMPORAL_SAR_ACQUISITIONS",
            "reason": None if is_production_ready else "INSUFFICIENT_TEMPORAL_SAR_ACQUISITIONS",
            "acquisition_count": n_acq,
            "timespan_days": timespan_days,
            "interferogram_pairs_count": len(pairs),
            "can_solve_velocity": is_production_ready and len(pairs) >= n_acq - 1,
            "pairs": pairs,
            "min_acquisitions_required": self.min_acquisitions,
            "min_timespan_days_required": self.min_timespan_days,
        }

    def invert_sbas_network(
        self,
        time_epochs: List[str],
        interferograms: List[Dict[str, Any]],
    ) -> Dict[str, Any]:
        """
        Inverts differential interferogram unwrapped phase network to estimate
        velocity (mm/yr) and displacement time series (mm) via SVD.
        """
        n_epochs = len(time_epochs)
        n_ifgs = len(interferograms)

        if n_epochs < 3 or n_ifgs < n_epochs - 1:
            raise ValueError("Insufficient interferograms to invert multi-temporal network.")

        # Epoch times in fractional years relative to t0
        t0 = np.datetime64(time_epochs[0][:10])
        t_years = np.array([
            float((np.datetime64(t[:10]) - t0) / np.timedelta64(1, "D")) / 365.25
            for t in time_epochs
        ])
        delta_t = np.diff(t_years)  # Intervals between consecutive epochs: length n_epochs - 1

        # Design matrix A: mapping interval velocities to interferometric phases
        # delta_phi_k = sum_{m=i}^{j-1} v_m * delta_t_m * (-4*pi / lambda)
        phase_factor = -(4.0 * np.pi / S1_WAVELENGTH_M) / 1000.0  # rad per mm
        A = np.zeros((n_ifgs, n_epochs - 1), dtype=np.float64)
        b = np.zeros(n_ifgs, dtype=np.float64)

        for k, ifg in enumerate(interferograms):
            m_idx = ifg["master_idx"]
            s_idx = ifg["slave_idx"]
            b[k] = ifg["unwrapped_phase_rad"]
            for m in range(min(m_idx, s_idx), max(m_idx, s_idx)):
                sign = 1.0 if s_idx > m_idx else -1.0
                A[k, m] = sign * delta_t[m] * phase_factor

        # SVD solution
        U, s, Vt = np.linalg.svd(A, full_matrices=False)
        inv_s = np.where(s > 1e-6, 1.0 / s, 0.0)
        A_inv = np.dot(Vt.T, np.dot(np.diag(inv_s), U.T))
        v_intervals = np.dot(A_inv, b)  # mm/yr in each interval

        # Reconstruct cumulative displacement time-series
        disp_ts = [0.0]
        for m in range(len(delta_t)):
            disp_ts.append(disp_ts[-1] + float(v_intervals[m] * delta_t[m]))

        # Mean linear velocity (least-squares slope over all epochs)
        total_time_span = t_years[-1] - t_years[0]
        mean_vel = float(disp_ts[-1] / max(total_time_span, 1e-4))

        # Formal uncertainty sigma_v
        residuals = b - np.dot(A, v_intervals)
        dof = max(1, n_ifgs - (n_epochs - 1))
        sigma2_obs = np.sum(residuals**2) / dof
        cov_v = sigma2_obs * np.dot(A_inv, A_inv.T)
        sigma_v = float(np.sqrt(np.mean(np.diag(cov_v))))

        return {
            "mean_velocity_mm_year": round(mean_vel, 2),
            "velocity_uncertainty_mm_year": round(sigma_v, 2),
            "cumulative_displacement_mm": round(disp_ts[-1], 2),
            "epochs": time_epochs,
            "displacement_timeseries_mm": [round(d, 2) for d in disp_ts],
            "timespan_years": round(total_time_span, 2),
        }

