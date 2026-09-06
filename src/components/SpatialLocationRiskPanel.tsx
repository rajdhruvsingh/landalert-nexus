import { useTranslation } from "react-i18next";
import { riskColor } from "@/lib/risk";
import type { LocationSpatialRisk, CellRiskEvaluation } from "@/lib/spatial-risk.service";
import { ChevronUp, ShieldAlert, Satellite, CloudRain, Mountain, Info, Compass, Layers } from "lucide-react";

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

  const satelliteStatus = isCell
    ? cellRisk!.provenance.satellite_status
    : locationRisk!.components.satellite_deformation.status;

  const satelliteSummary = isCell
    ? "NASA GPM / Sentinel InSAR deformation boundary unconfigured (No fake signal)"
    : locationRisk!.components.satellite_deformation.note;

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

      {/* Grid of 4 Signals */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
        {/* 1. Static Susceptibility */}
        <div className="rounded border border-border bg-secondary/20 p-2.5 space-y-1">
          <div className="flex items-center gap-1.5 text-muted-foreground font-medium text-[0.72rem]">
            <Mountain className="w-3.5 h-3.5 text-amber-500" />
            <span>{t("spatial_risk.static_susceptibility", "Static Susceptibility")}</span>
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

        {/* 2. Dynamic Weather Trigger */}
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

        {/* 3. Satellite Deformation / Sentinel */}
        <div className="rounded border border-border bg-secondary/20 p-2.5 space-y-1">
          <div className="flex items-center gap-1.5 text-muted-foreground font-medium text-[0.72rem]">
            <Satellite className="w-3.5 h-3.5 text-violet-500" />
            <span>{t("spatial_risk.satellite_signal", "Satellite Deformation")}</span>
          </div>
          <div className="text-xs font-bold font-mono uppercase text-muted-foreground">
            {satelliteStatus === "AVAILABLE" ? "AVAILABLE" : "UNAVAILABLE"}
          </div>
          <div className="text-[0.65rem] text-muted-foreground leading-tight truncate" title={satelliteSummary}>
            {satelliteStatus === "AVAILABLE" ? satelliteSummary : t("spatial_risk.satellite_unconfigured", "No fabricated signal; InSAR awaiting provider setup")}
          </div>
        </div>

        {/* 4. Confidence & Field Observations */}
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

      {/* Probability & Methodology Transparency Note */}
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
