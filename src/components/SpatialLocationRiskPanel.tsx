import { useTranslation } from "react-i18next";
import { riskColor } from "@/lib/risk";
import type { LocationSpatialRisk, CellRiskEvaluation } from "@/lib/spatial-risk.service";
import { ChevronUp, ShieldAlert, Satellite, CloudRain, Mountain, Info, Compass, Layers, Activity } from "lucide-react";

interface Props {
  locationRisk?: LocationSpatialRisk | null;
  cellRisk?: CellRiskEvaluation | null;
  onClose: () => void;
}

export default function SpatialLocationRiskPanel({
  locationRisk,
  cellRisk,
  onClose,
}: Props) {
  const { t } = useTranslation();

  if (!locationRisk && !cellRisk) return null;

  // Normalize displayed values whether from city aggregation or direct cell click
  const isCell = !locationRisk && Boolean(cellRisk);
  const title = isCell
    ? `${cellRisk!.district} (${cellRisk!.cell_id})`
    : locationRisk!.location.name;
  const subtitle = isCell
    ? `${cellRisk!.state} · 0.25° Spatial Prediction Cell · Centroid: ${cellRisk!.centroid[0].toFixed(2)}°N, ${cellRisk!.centroid[1].toFixed(2)}°E`
    : `${locationRisk!.location.district} district · ${locationRisk!.location.state} · Location Risk Aggregate`;

  const level = isCell ? cellRisk!.risk_level : locationRisk!.risk.level;
  const score = isCell ? cellRisk!.final_risk_score : locationRisk!.risk.score;
  const probability = isCell ? cellRisk!.probability : locationRisk!.risk.probability;
  const confidence = isCell ? cellRisk!.data_confidence : locationRisk!.risk.confidence;

  const susceptibilityScore = isCell
    ? Math.round(cellRisk!.static_susceptibility * 100)
    : Math.round(locationRisk!.components.static_susceptibility * 100);

  const dynamicTrigger = isCell
    ? Math.round(cellRisk!.dynamic_trigger_score)
    : Math.round(locationRisk!.components.dynamic_trigger_score);

  const soilMoisture = isCell
    ? null
    : locationRisk!.components.soil_moisture_index !== null
      ? Math.round(locationRisk!.components.soil_moisture_index * 100)
      : null;

  const isDeformAvailable = isCell
    ? cellRisk?.provenance.satellite_status === "AVAILABLE"
    : locationRisk?.components.satellite_deformation.status === "AVAILABLE";

  const isDeformProcessing = isCell
    ? cellRisk?.provenance.satellite_status === "PROCESSING"
    : (locationRisk?.components.satellite_deformation.status as string) === "PROCESSING";

  const deformVelocity = isCell
    ? cellRisk?.provenance.satellite_deformation?.los_velocity_mean_mm_year
    : locationRisk?.components.satellite_deformation.velocity_mm_year;

  const deformDisplacement = isCell
    ? cellRisk?.provenance.satellite_deformation?.cumulative_displacement_mm
    : locationRisk?.components.satellite_deformation.displacement_mm;

  const deformPeriod = isCell
    ? cellRisk?.provenance.satellite_deformation?.observation_period
    : locationRisk?.components.satellite_deformation.observation_period;

  const deformSensor = isCell
    ? cellRisk?.provenance.satellite_deformation?.sensor ?? "Sentinel-1 C-SAR"
    : locationRisk?.components.satellite_deformation.sensor ?? "Sentinel-1 C-SAR";

  const deformQuality = isCell
    ? cellRisk?.provenance.satellite_deformation?.quality
    : locationRisk?.components.satellite_deformation.quality;

  const deformCoverage = isCell
    ? cellRisk?.provenance.satellite_deformation?.spatial_coverage_pct
    : locationRisk?.components.satellite_deformation.spatial_coverage_pct;

  const deformReason = isCell
    ? cellRisk?.provenance.satellite_deformation?.unavailable_reason
    : locationRisk?.components.satellite_deformation.unavailable_reason;

  const deformReasonFormatted = deformReason === "SAR_DECORRELATION_DENSE_CANOPY"
    ? t("spatial_risk.sar_decorrelation", "C-band phase decorrelation (dense canopy)")
    : deformReason === "PENDING_SAR_INTERFEROMETRIC_PROCESSING"
    ? t("spatial_risk.sar_processing_pending", "SAR interferometric processing pending")
    : deformReason === "INSUFFICIENT_ACQUISITIONS"
    ? t("spatial_risk.sar_insufficient_acq", "Insufficient Sentinel-1 acquisitions (< 3 epochs)")
    : deformReason === "LOW_COHERENCE"
    ? t("spatial_risk.sar_low_coherence", "Low mean interferometric coherence (< 0.40)")
    : deformReason === "ORBIT_DATA_UNAVAILABLE"
    ? t("spatial_risk.sar_orbit_unavailable", "Precise orbit ephemerides (POEORB) unavailable")
    : t("spatial_risk.sar_unconfigured", "No convergent orbit acquisition");

  const verifiedObs = isCell
    ? cellRisk!.provenance.observation_count
    : locationRisk!.components.verified_observations_count;

  const modelVersion = isCell
    ? cellRisk!.provenance.model_version
    : locationRisk!.model_version;

  const color = riskColor(level);

  return (
    <div
      id="spatial-location-risk-panel"
      className="panel p-4 space-y-4 border-l-4 border-l-primary bg-card/95 backdrop-blur shadow-md animate-in fade-in duration-200"
    >
      {/* Top Title & Header */}
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border pb-3">
        <div>
          <div className="flex items-center gap-2">
            <span className="label-caps flex items-center gap-1 text-[0.65rem] text-primary">
              <Compass className="w-3.5 h-3.5" />
              {isCell
                ? t("spatial_risk.cell_assessment", "Spatial Grid Cell Assessment")
                : t("spatial_risk.derived_location_assessment", "Derived Spatial Risk Assessment")}
            </span>
            <span className="rounded border border-border bg-secondary/50 px-1.5 py-0.2 text-[0.65rem] font-mono text-muted-foreground">
              {modelVersion}
            </span>
          </div>

          <h3 className="text-xl font-bold text-foreground font-display mt-0.5">
            {title}
          </h3>
          <p className="text-xs text-muted-foreground">
            {subtitle}
          </p>
        </div>

        {/* Right Level & Score Badge */}
        <div className="flex items-center gap-3">
          <div className="text-right">
            <div className="text-[0.65rem] uppercase tracking-wider font-semibold text-muted-foreground">
              {t("spatial_risk.current_risk", "Current Risk")}
            </div>
            <div className="flex items-center justify-end gap-1.5">
              <span
                className="inline-block w-2.5 h-2.5 rounded-full"
                style={{ backgroundColor: color }}
              />
              <span className="text-lg font-bold font-display" style={{ color }}>
                {t(`risk_levels.${level}`, level)}
              </span>
              <span className="text-xs font-mono text-muted-foreground">
                ({score}/100)
              </span>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Close spatial location details"
            className="rounded border border-border p-1.5 text-muted-foreground hover:text-foreground cursor-pointer"
          >
            <ChevronUp className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div className="col-span-1 rounded border border-border bg-card/80 p-3 flex flex-col justify-between">
          <div className="text-xs font-medium text-muted-foreground">
            {t("spatial_risk.operational_score", "Operational Risk Score")}
          </div>
          <div className="flex items-baseline gap-1 my-1">
            <span className="text-4xl font-extrabold font-mono" style={{ color }}>
              {score}
            </span>
            <span className="text-xs font-mono text-muted-foreground">/100</span>
          </div>
          <div className="text-[0.68rem] text-muted-foreground leading-tight">
            {t("spatial_risk.heuristic_note", "Combined static terrain susceptibility + dynamic weather trigger.")}
          </div>
        </div>

        <div className="col-span-1 md:col-span-2 rounded border border-border/80 bg-muted/20 p-3 flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
              <Activity className="w-3.5 h-3.5 text-primary" />
              {t("spatial_risk.statistical_prob_title", "Statistical Landslide Probability")}
            </span>
            <span className="text-[0.65rem] font-mono uppercase px-1.5 py-0.5 rounded bg-muted text-muted-foreground border border-border">
              {probability !== null ? "CALIBRATED" : "UNAVAILABLE"}
            </span>
          </div>
          <div className="my-1.5">
            {probability !== null ? (
              <div className="text-2xl font-bold font-mono text-foreground">
                {(probability * 100).toFixed(1)}%
              </div>
            ) : (
              <div className="text-xs font-sans text-muted-foreground leading-snug">
                {t(
                  "spatial_risk.prob_unavailable_explanation",
                  "Not empirically calibrated for this coordinate. Uncalibrated probabilities are withheld per scientific integrity rules."
                )}
              </div>
            )}
          </div>
          <div className="text-[0.65rem] font-mono text-muted-foreground/80 flex items-center justify-between">
            <span>Model: {modelVersion}</span>
            <span>Confidence: {confidence}</span>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
        <div className="rounded border border-border bg-secondary/20 p-2.5 space-y-1">
          <div className="flex items-center gap-1.5 text-muted-foreground font-medium text-[0.72rem]">
            <Mountain className="w-3.5 h-3.5 text-amber-500" />
            <span>{t("spatial_risk.static_susceptibility", "Terrain Susceptibility")}</span>
          </div>
          <div className="text-base font-bold font-mono text-foreground">
            {susceptibilityScore}%
          </div>
          <div className="text-[0.65rem] text-muted-foreground leading-tight">
            {isCell
              ? `Elev: ${cellRisk!.elevation_m}m · Slope: ${cellRisk!.slope_deg}°`
              : t("spatial_risk.terrain_basis", "Relief, slope gradient & terrain ruggedness")}
          </div>
        </div>

        <div className="rounded border border-border bg-secondary/20 p-2.5 space-y-1">
          <div className="flex items-center gap-1.5 text-muted-foreground font-medium text-[0.72rem]">
            <CloudRain className="w-3.5 h-3.5 text-sky-500" />
            <span>{t("spatial_risk.dynamic_trigger", "Rainfall Trigger")}</span>
          </div>
          <div className="text-base font-bold font-mono text-foreground">
            {dynamicTrigger}/100
          </div>
          <div className="text-[0.65rem] text-muted-foreground leading-tight">
            {soilMoisture !== null
              ? `Soil moisture: ~${soilMoisture}% · Antecedent precip.`
              : t("spatial_risk.telemetry_interpolated", "Interpolated from regional weather clusters")}
          </div>
        </div>

        <div className="rounded border border-border bg-secondary/20 p-2.5 space-y-1.5" id="satellite-deformation-card">
          <div className="flex items-center justify-between text-muted-foreground font-medium text-[0.72rem]">
            <div className="flex items-center gap-1.5">
              <Satellite className="w-3.5 h-3.5 text-violet-500" />
              <span>{t("spatial_risk.satellite_signal", "Satellite Deformation")}</span>
            </div>
            <span
              className={`text-[0.62rem] font-mono px-1.5 py-0.5 rounded font-bold ${
                isDeformAvailable
                  ? "bg-emerald-500/15 text-emerald-500 border border-emerald-500/30"
                  : isDeformProcessing
                  ? "bg-amber-500/15 text-amber-500 border border-amber-500/30 animate-pulse"
                  : "bg-muted text-muted-foreground border border-border"
              }`}
            >
              {isDeformAvailable ? "AVAILABLE" : isDeformProcessing ? "PROCESSING" : "UNAVAILABLE"}
            </span>
          </div>

          {isDeformProcessing ? (
            <div className="space-y-1.5 text-xs">
              <div className="text-[0.72rem] font-medium text-amber-500">
                {t("spatial_risk.sar_processing_active", "SAR Processing Active")}
              </div>
              <div className="text-[0.68rem] text-muted-foreground leading-snug">
                Status: InSAR dedicated worker pipeline active.
              </div>
              <div className="text-[0.65rem] text-muted-foreground pt-0.5 border-t border-border/40">
                Source: <span className="font-medium text-foreground">{deformSensor}</span>
              </div>
            </div>
          ) : isDeformAvailable ? (
            <div className="space-y-1 text-xs">
              <div className="flex items-baseline gap-2">
                <span className="text-base font-bold font-mono text-foreground">
                  {deformVelocity !== null && deformVelocity !== undefined
                    ? `${deformVelocity > 0 ? "+" : ""}${deformVelocity}`
                    : deformDisplacement !== null && deformDisplacement !== undefined
                    ? `${deformDisplacement > 0 ? "+" : ""}${deformDisplacement}`
                    : "—"}
                </span>
                <span className="text-xs font-mono text-muted-foreground">
                  {deformVelocity !== null && deformVelocity !== undefined
                    ? "mm/year (Multi-temporal LOS velocity)"
                    : "mm (Pair LOS displacement)"}
                </span>
              </div>
              {deformVelocity === null && deformDisplacement !== null && (
                <div className="text-[0.65rem] text-muted-foreground italic">
                  Single-pair interferometric displacement; long-term velocity not annualized.
                </div>
              )}
              {deformVelocity !== null && deformDisplacement !== null && deformDisplacement !== undefined && (
                <div className="text-[0.68rem] text-muted-foreground font-mono flex items-center justify-between">
                  <span>Cumulative: {deformDisplacement > 0 ? "+" : ""}{deformDisplacement} mm</span>
                  <span className="text-[0.62rem] px-1 py-0.2 rounded bg-violet-500/10 text-violet-400 font-sans font-semibold">
                    Trend: Multi-epoch Stack
                  </span>
                </div>
              )}
              <div className="text-[0.65rem] text-muted-foreground leading-tight space-y-0.5 pt-0.5 border-t border-border/40">
                <div>Source: <span className="font-medium text-foreground">{deformSensor}</span></div>
                {deformPeriod && (
                  <div>Period: <span className="font-mono text-foreground">{deformPeriod.start_date} → {deformPeriod.end_date}</span></div>
                )}
                <div className="flex items-center justify-between">
                  <span>Quality: <span className="font-medium text-foreground">{deformQuality ?? "Standard"}</span></span>
                  {deformCoverage !== undefined && deformCoverage !== null && (
                    <span>Coverage: <span className="font-mono text-foreground">{deformCoverage}%</span></span>
                  )}
                </div>
              </div>
            </div>
          ) : (
            <div className="space-y-1 text-xs">
              <div className="text-[0.72rem] font-medium text-amber-600 dark:text-amber-400">
                {deformReasonFormatted}
              </div>
              <div className="text-[0.65rem] text-muted-foreground leading-tight space-y-0.5 pt-0.5 border-t border-border/40">
                <div>Source: <span className="font-medium text-foreground">{deformSensor}</span></div>
                <div className="text-[0.62rem] text-muted-foreground italic">
                  {t("spatial_risk.scientific_integrity_no_fake", "Strict integrity policy: No synthetic or 0 mm/yr values substituted.")}
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="rounded border border-border bg-secondary/20 p-2.5 space-y-1">
          <div className="flex items-center gap-1.5 text-muted-foreground font-medium text-[0.72rem]">
            <ShieldAlert className="w-3.5 h-3.5 text-emerald-500" />
            <span>{t("spatial_risk.confidence_and_evidence", "Data Confidence")}</span>
          </div>
          <div className="text-base font-bold font-mono text-foreground">
            {confidence}
          </div>
          <div className="text-[0.65rem] text-muted-foreground leading-tight">
            {verifiedObs} {t("spatial_risk.verified_obs_count", "verified field observations")}
          </div>
        </div>
      </div>

      <div className="rounded border border-border/60 bg-muted/30 p-2.5 flex items-start gap-2 text-xs font-sans text-muted-foreground">
        <Info className="w-4 h-4 text-primary shrink-0 mt-0.5" />
        <div className="space-y-0.5">
          <div className="font-semibold text-[0.72rem] text-foreground">
            {t("spatial_risk.transparency_title", "Scientific Integrity & Statistical Probability Policy")}
          </div>
          <p className="text-[0.68rem] leading-relaxed">
            {probability !== null ? (
              <span>{t("spatial_risk.probability_calibrated", "Calibrated statistical probability: {{prob}}%", { prob: (probability * 100).toFixed(1) })}</span>
            ) : (
              <span>
                {t("spatial_risk.probability_uncalibrated_notice", "Statistical probability is reported as UNAVAILABLE because empirical landslide frequency has not undergone formal isotonic probability calibration for this specific coordinate. An operational, data-driven Risk Score (0-100) combining static susceptibility and dynamic trigger conditions is provided instead.")}
              </span>
            )}
          </p>

          <p className="text-[0.66rem] leading-relaxed text-muted-foreground/90 pt-0.5">
            {t("spatial_risk.insar_option_a_notice", "Satellite InSAR Ground Motion: Evaluated independently under Option A (independent indicator) alongside active ML model v0.2-lr-trained without uncalibrated weight injection.")}
          </p>

          {!isCell && locationRisk && (
            <div className="pt-1 flex items-center gap-1 text-[0.65rem] font-mono text-foreground/80">
              <Layers className="w-3 h-3 text-primary" />
              <span>
                {t("spatial_risk.aggregation_summary", "Derived from {{count}} surrounding 0.25° spatial grid cells via Inverse-Distance Weighting (IDW).", {
                  count: locationRisk.surrounding_cells_count,
                })}
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
