import { useState, useMemo, useEffect } from "react";
import { useTranslation } from "react-i18next";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import type { ZoneRow, ObservationRow } from "@/lib/monitoring.functions";
import {
  Eye,
  FilePlus,
  Search,
  MapPin,
  Calendar,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  ShieldCheck,
  ArrowLeft,
  Image as ImageIcon,
  Video as VideoIcon,
} from "lucide-react";
import { FieldObservationDialog } from "./FieldObservationDialog";
import {
  getObservationStatusMeta,
  matchesObservationStatusFilter,
  type ObservationFilterGroup,
} from "@/lib/observation-status";
import type { AppUserRole } from "@/lib/auth-domains";
import { sanitizeObservationRecord, sanitizeObservationList } from "@/lib/observation-sanitizer";
import { getOfflineMedia } from "@/lib/offline-media-store";

interface Props {
  observations: ObservationRow[];
  zones: ZoneRow[];
  selectedObservationId?: number | string | null;
  trigger?: React.ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  onSelectZone?: (zoneId: number) => void;
  onSuccess?: () => void;
  /** Role of the currently logged-in user — controls visibility of review actions. */
  viewerRole?: AppUserRole;
  /** Supabase session access_token — forwarded as Bearer in review API calls. */
  accessToken?: string | null;
}

export function ObservationDetailsDialog({
  observations,
  zones,
  selectedObservationId,
  trigger,
  open: controlledOpen,
  onOpenChange: setControlledOpen,
  onSelectZone,
  onSuccess,
  viewerRole,
  accessToken,
}: Props) {
  const { t } = useTranslation();
  const [internalOpen, setInternalOpen] = useState(false);
  const [activeObsId, setActiveObsId] = useState<number | string | null>(selectedObservationId ?? null);
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<ObservationFilterGroup>("all");
  const [resolvedOfflineUrls, setResolvedOfflineUrls] = useState<Record<string, string>>({});

  // Review action state
  const [reviewAction, setReviewAction] = useState<"approve" | "reject" | null>(null);
  const [reviewNotes, setReviewNotes] = useState("");
  const [reviewBusy, setReviewBusy] = useState(false);
  const [reviewNotice, setReviewNotice] = useState<{ type: "success" | "error"; msg: string } | null>(null);

  const isControlled = controlledOpen !== undefined;
  const open = isControlled ? controlledOpen : internalOpen;
  const setOpen = isControlled ? setControlledOpen! : setInternalOpen;

  const zoneMap = useMemo(() => {
    const map = new Map<number, ZoneRow>();
    zones.forEach((z) => map.set(z.id, z));
    return map;
  }, [zones]);

  const sanitizedObservations = useMemo(() => {
    return sanitizeObservationList(observations);
  }, [observations]);

  // Sync selectedObservationId if changed externally
  const activeObs = useMemo(() => {
    const targetId = activeObsId ?? selectedObservationId;
    if (!targetId) return null;
    const found = sanitizedObservations.find((o) => String(o.id) === String(targetId)) ?? null;
    return found ? sanitizeObservationRecord(found) : null;
  }, [activeObsId, selectedObservationId, sanitizedObservations]);

  // Resolve offline IndexedDB media for active observation
  useEffect(() => {
    if (!activeObs?.media_metadata || !Array.isArray(activeObs.media_metadata)) {
      return;
    }

    let isMounted = true;
    const createdBlobUrls: string[] = [];

    const loadBlobs = async () => {
      const urls: Record<string, string> = {};
      const mediaList = (Array.isArray(activeObs.media_metadata) ? activeObs.media_metadata : []) as any[];
      for (const meta of mediaList) {
        if (meta.id && !meta.url) {
          try {
            const stored = await getOfflineMedia(meta.id);
            if (stored && stored.blob) {
              const objUrl = URL.createObjectURL(stored.blob);
              createdBlobUrls.push(objUrl);
              urls[meta.id] = objUrl;
            }
          } catch {
            // Ignore offline fetch errors
          }
        }
      }
      if (isMounted) {
        setResolvedOfflineUrls(urls);
      }
    };

    loadBlobs();

    return () => {
      isMounted = false;
      createdBlobUrls.forEach((u) => URL.revokeObjectURL(u));
    };
  }, [activeObs]);

  const filteredObservations = useMemo(() => {
    return sanitizedObservations.filter((obs) => {
      const z = zoneMap.get(obs.zone_id);
      const q = searchQuery.trim().toLowerCase();
      const matchesQuery =
        !q ||
        (obs.visual_signs && obs.visual_signs.toLowerCase().includes(q)) ||
        (obs.road_status && obs.road_status.toLowerCase().includes(q)) ||
        (z && z.zone_name.toLowerCase().includes(q)) ||
        (z && z.district.toLowerCase().includes(q)) ||
        (z && z.state.toLowerCase().includes(q));

      const status = (obs as any).status ?? (obs as any).review_status;
      const matchesStatus = matchesObservationStatusFilter(status, statusFilter);

      return matchesQuery && matchesStatus;
    });
  }, [observations, searchQuery, statusFilter, zoneMap]);

  // Whether the viewer has permission to approve/reject
  const canReview =
    viewerRole === "VERIFIED_OFFICIAL" ||
    viewerRole === "DISPATCHER" ||
    viewerRole === "ADMIN";

  async function submitReview(obsId: number | string, newStatus: "VERIFIED" | "REJECTED") {
    if (!accessToken) {
      setReviewNotice({ type: "error", msg: "You are not signed in. Please sign in to review observations." });
      return;
    }
    if (newStatus === "REJECTED" && reviewNotes.trim().length < 5) {
      setReviewNotice({ type: "error", msg: "Please provide a rejection reason (at least 5 characters)." });
      return;
    }
    setReviewBusy(true);
    setReviewNotice(null);
    try {
      const res = await fetch("/api/observations/review", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          observation_id: obsId,
          new_status: newStatus,
          verification_notes: reviewNotes.trim(),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setReviewNotice({ type: "error", msg: data?.error ?? `Request failed (${res.status})` });
      } else {
        setReviewNotice({
          type: "success",
          msg: newStatus === "VERIFIED"
            ? "Observation approved and marked Verified."
            : "Observation rejected.",
        });
        setReviewAction(null);
        setReviewNotes("");
        // Propagate cache invalidation to parent
        onSuccess?.();
      }
    } catch (err) {
      setReviewNotice({ type: "error", msg: err instanceof Error ? err.message : "Network error." });
    } finally {
      setReviewBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {trigger && <DialogTrigger asChild>{trigger}</DialogTrigger>}
      <DialogContent className="sm:max-w-[850px] max-h-[85vh] overflow-hidden flex flex-col bg-surface text-foreground border-border">
        <DialogHeader className="shrink-0">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Eye className="h-5 w-5 text-primary shrink-0" />
              <DialogTitle className="text-xl font-display text-foreground">
                {activeObs
                  ? t("observations.details_title", "Field Observation Report Details")
                  : t("observations.browser_title", "Regional Ground Observations")}
              </DialogTitle>
            </div>

            <div className="flex items-center gap-2">
              <FieldObservationDialog
                trigger={
                  <Button size="sm" className="h-8 gap-1 text-xs">
                    <FilePlus className="h-3.5 w-3.5" />
                    <span>{t("quick_actions.report_observation", "+ Report Observation")}</span>
                  </Button>
                }
                onSuccess={() => {
                  onSuccess?.();
                  setOpen(false);
                }}
              />
            </div>
          </div>
          <DialogDescription className="text-xs text-muted-foreground">
            {activeObs
              ? t(
                "observations.details_desc",
                "Detailed on-ground inspection record submitted by field observers, patrol teams, or district officers.",
              )
              : t(
                "observations.browser_desc",
                "Verified ground telemetry, slope crack reports, and field inspections across 8 North Eastern states.",
              )}
          </DialogDescription>
        </DialogHeader>

        {/* View Mode 1: Detailed Single Observation Card */}
        {activeObs ? (
          <div className="flex-1 overflow-y-auto space-y-4 pt-2">
            <div className="flex items-center justify-between pb-2 border-b border-border">
              <button
                type="button"
                onClick={() => setActiveObsId(null)}
                className="inline-flex items-center gap-1.5 text-xs text-primary font-medium hover:underline"
              >
                <ArrowLeft className="h-3.5 w-3.5" />
                <span>{t("observations.back_to_list", "Back to all observations")}</span>
              </button>

              {(() => {
                const statusMeta = getObservationStatusMeta((activeObs as any).status ?? (activeObs as any).review_status);
                return (
                  <span
                    className={`inline-block px-2.5 py-0.5 rounded border text-[0.68rem] font-mono font-semibold ${statusMeta.badgeClass}`}
                  >
                    {statusMeta.label}
                  </span>
                );
              })()}
            </div>

            {/* Detailed metadata grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {/* Location Card */}
              <div className="rounded border border-border bg-card p-3 space-y-1.5 shadow-xs">
                <div className="flex items-center gap-1.5 text-xs font-semibold text-foreground font-display">
                  <MapPin className="h-4 w-4 text-primary" />
                  <span>{t("observations.location_details", "Location & Zone")}</span>
                </div>
                {(() => {
                  const z = zoneMap.get(activeObs.zone_id);
                  return (
                    <div className="text-xs space-y-1 text-muted-foreground">
                      <div>
                        <span className="font-semibold text-foreground">{z ? z.zone_name : `Zone ${activeObs.zone_id}`}</span>
                      </div>
                      <div>
                        <span>{z ? `${z.district} District, ${z.state}` : `Zone ID: ${activeObs.zone_id}`}</span>
                      </div>
                      {activeObs.geo_lat && activeObs.geo_lng && (
                        <div className="font-mono text-[0.7rem] text-primary pt-1">
                          <span>
                            {activeObs.geo_lat.toFixed(5)}° N, {activeObs.geo_lng.toFixed(5)}° E
                          </span>
                          {activeObs.geo_accuracy_m && (
                            <span className="text-muted-foreground ml-1">
                              (±{activeObs.geo_accuracy_m.toFixed(0)}m)
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })()}
              </div>

              {/* Timestamp Card */}
              <div className="rounded border border-border bg-card p-3 space-y-1.5 shadow-xs">
                <div className="flex items-center gap-1.5 text-xs font-semibold text-foreground font-display">
                  <Calendar className="h-4 w-4 text-primary" />
                  <span>{t("observations.timestamp_heading", "Inspection Timing")}</span>
                </div>
                <div className="text-xs space-y-1 text-muted-foreground font-mono">
                  <div>
                    <span className="text-foreground">
                      {new Date(activeObs.observed_at).toLocaleString("en-IN", {
                        dateStyle: "medium",
                        timeStyle: "short",
                      })}
                    </span>
                  </div>
                  <div className="text-[0.68rem] text-muted-foreground">
                    <span>{t("observations.client_recorded", "Client recorded:")} </span>
                    <span>{new Date(activeObs.client_timestamp).toLocaleTimeString("en-IN")}</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Observation Findings */}
            <div className="rounded border border-border bg-card p-4 space-y-3 shadow-xs">
              <h4 className="text-xs font-bold font-display uppercase tracking-wider text-muted-foreground">
                {t("observations.findings_title", "Ground Conditions & Visual Signs")}
              </h4>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="rounded border border-border/80 bg-secondary/30 p-2.5">
                  <div className="text-[0.68rem] text-muted-foreground uppercase">{t("observations.visual_signs", "Visual Signs")}</div>
                  <div className="font-semibold text-xs text-foreground mt-0.5">
                    {activeObs.visual_signs || "Slope movement / ground distress"}
                  </div>
                </div>

                <div className="rounded border border-border/80 bg-secondary/30 p-2.5">
                  <div className="text-[0.68rem] text-muted-foreground uppercase">{t("observations.road_impact", "Road Status")}</div>
                  <div className="font-semibold text-xs text-foreground mt-0.5">
                    {activeObs.road_status ? activeObs.road_status.toUpperCase() : "NORMAL / OPEN"}
                  </div>
                </div>

                <div className="rounded border border-border/80 bg-secondary/30 p-2.5">
                  <div className="text-[0.68rem] text-muted-foreground uppercase">{t("observations.local_rainfall", "Local Rainfall")}</div>
                  <div className="font-semibold text-xs text-foreground mt-0.5">
                    {activeObs.rainfall_mm !== null && activeObs.rainfall_mm !== undefined
                      ? `${activeObs.rainfall_mm.toFixed(1)} mm`
                      : "Not recorded"}
                  </div>
                </div>
              </div>

              {/* Soil condition and notes */}
              <div className="space-y-1 pt-1">
                <div className="text-[0.68rem] text-muted-foreground uppercase font-semibold">
                  {t("observations.soil_condition", "Soil & Slope Notes")}
                </div>
                <div className="text-xs text-muted-foreground bg-secondary/20 p-2.5 rounded border border-border/60">
                  {activeObs.soil_condition || activeObs.verification_notes || "No additional commentary noted by field inspector."}
                </div>
              </div>

              {/* Attached Evidence Media (URLs, Offline Blobs, or Metadata) */}
              {(() => {
                const mediaUrls = activeObs.media_urls || [];
                const mediaMeta = (Array.isArray(activeObs.media_metadata) ? activeObs.media_metadata : []) as any[];
                const hasAnyMedia = mediaUrls.length > 0 || mediaMeta.length > 0;

                if (!hasAnyMedia) return null;

                const items: Array<{
                  key: string;
                  url?: string;
                  name?: string;
                  size?: number;
                  mimeType?: string;
                  isOffline?: boolean;
                }> = [];

                mediaUrls.forEach((url, i) => {
                  items.push({
                    key: `url-${i}`,
                    url,
                    name: `Evidence Photo ${i + 1}`,
                  });
                });

                mediaMeta.forEach((m: any, i: number) => {
                  const resolvedUrl = m.id ? resolvedOfflineUrls[m.id] : undefined;
                  const itemUrl = m.url || resolvedUrl;
                  // Avoid duplicate if already represented in items
                  if (itemUrl && items.some((it) => it.url === itemUrl)) return;
                  items.push({
                    key: m.id || `meta-${i}`,
                    url: itemUrl,
                    name: m.name || `Evidence File ${i + 1}`,
                    size: m.size,
                    mimeType: m.mimeType,
                    isOffline: Boolean(!itemUrl || m.id?.startsWith("offline_")),
                  });
                });

                if (items.length === 0) return null;

                return (
                  <div className="space-y-2 pt-2 border-t border-border">
                    <div className="text-[0.68rem] text-muted-foreground uppercase font-semibold">
                      {t("observations.evidence_photos", "Attached Evidence Photos & Media")} ({items.length})
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                      {items.map((item) => {
                        const isVideo =
                          item.mimeType?.startsWith("video/") ||
                          item.name?.endsWith(".mp4") ||
                          item.name?.endsWith(".mov");

                        if (item.url) {
                          if (isVideo) {
                            return (
                              <div key={item.key} className="rounded border border-border bg-black/40 overflow-hidden">
                                <video src={item.url} controls className="h-32 w-full object-contain" />
                                <div className="p-1.5 text-[0.65rem] text-muted-foreground truncate">{item.name}</div>
                              </div>
                            );
                          }
                          return (
                            <a
                              key={item.key}
                              href={item.url}
                              target="_blank"
                              rel="noreferrer"
                              className="block rounded border border-border overflow-hidden group hover:opacity-90 bg-secondary/10"
                            >
                              <img
                                src={item.url}
                                alt={item.name}
                                className="h-32 w-full object-cover group-hover:scale-102 transition-transform"
                              />
                              <div className="p-1.5 text-[0.65rem] text-muted-foreground truncate font-mono">
                                {item.name}
                              </div>
                            </a>
                          );
                        }

                        // Staged offline evidence card
                        return (
                          <div
                            key={item.key}
                            className="rounded border border-border/80 bg-secondary/30 p-2.5 flex items-center gap-2.5"
                          >
                            <div className="p-2 rounded bg-primary/10 text-primary shrink-0">
                              {isVideo ? <VideoIcon className="h-4 w-4" /> : <ImageIcon className="h-4 w-4" />}
                            </div>
                            <div className="min-w-0 flex-1">
                              <div className="text-xs font-semibold text-foreground truncate">{item.name}</div>
                              <div className="text-[0.65rem] text-muted-foreground flex items-center gap-1.5 mt-0.5">
                                <span>{item.size ? `${(item.size / 1024 / 1024).toFixed(2)} MB` : "Field File"}</span>
                                <span className="text-primary font-medium">• Staged Evidence</span>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })()}
            </div>

            {/* ── Official Review Card (role-gated) ── */}
            {canReview && (
              <div className="rounded border border-primary/30 bg-primary/5 p-4 space-y-3 shadow-xs">
                <div className="flex items-center gap-2 text-xs font-bold font-display uppercase tracking-wider text-primary">
                  <ShieldCheck className="h-4 w-4" />
                  <span>{t("observations.official_review_title", "Official Review")}</span>
                  <span className="ml-auto text-[0.65rem] font-normal text-muted-foreground uppercase tracking-wide">
                    {viewerRole}
                  </span>
                </div>

                {/* Toast notice */}
                {reviewNotice && (
                  <div
                    className={`rounded px-3 py-2 text-xs font-medium ${reviewNotice.type === "success"
                        ? "bg-emerald-500/15 text-emerald-400 border border-emerald-500/30"
                        : "bg-rose-500/15 text-rose-400 border border-rose-500/30"
                      }`}
                  >
                    {reviewNotice.msg}
                  </div>
                )}

                {/* Action buttons */}
                {reviewAction === null && (
                  <div className="flex items-center gap-2">
                    <button
                      id="obs-review-approve-btn"
                      type="button"
                      disabled={reviewBusy}
                      onClick={() => { setReviewAction("approve"); setReviewNotes(""); setReviewNotice(null); }}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold transition-colors disabled:opacity-50"
                    >
                      <CheckCircle2 className="h-3.5 w-3.5" />
                      {t("observations.approve_btn", "Approve")}
                    </button>
                    <button
                      id="obs-review-reject-btn"
                      type="button"
                      disabled={reviewBusy}
                      onClick={() => { setReviewAction("reject"); setReviewNotes(""); setReviewNotice(null); }}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded bg-zinc-600 hover:bg-zinc-500 text-white text-xs font-semibold transition-colors disabled:opacity-50"
                    >
                      <XCircle className="h-3.5 w-3.5" />
                      {t("observations.reject_btn", "Reject")}
                    </button>
                  </div>
                )}

                {/* Approve panel — optional notes */}
                {reviewAction === "approve" && (
                  <div className="space-y-2">
                    <label className="text-[0.7rem] text-muted-foreground uppercase font-semibold">
                      {t("observations.approve_notes_label", "Verification notes (optional)")}
                    </label>
                    <textarea
                      id="obs-approve-notes"
                      rows={2}
                      value={reviewNotes}
                      onChange={(e) => setReviewNotes(e.target.value)}
                      placeholder={t("observations.approve_notes_placeholder", "e.g. Field visit confirmed slope crack at chainage 12+400…")}
                      className="w-full rounded border border-border bg-background px-2.5 py-1.5 text-xs text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary resize-none"
                    />
                    <div className="flex items-center gap-2">
                      <button
                        id="obs-approve-submit-btn"
                        type="button"
                        disabled={reviewBusy}
                        onClick={() => submitReview(activeObs.id, "VERIFIED")}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold transition-colors disabled:opacity-50"
                      >
                        <CheckCircle2 className="h-3.5 w-3.5" />
                        {reviewBusy ? t("common.saving", "Saving…") : t("observations.confirm_approve", "Confirm Approve")}
                      </button>
                      <button
                        type="button"
                        onClick={() => { setReviewAction(null); setReviewNotes(""); setReviewNotice(null); }}
                        className="text-xs text-muted-foreground hover:text-foreground"
                      >
                        {t("common.cancel", "Cancel")}
                      </button>
                    </div>
                  </div>
                )}

                {/* Reject panel — required reason */}
                {reviewAction === "reject" && (
                  <div className="space-y-2">
                    <label className="text-[0.7rem] text-muted-foreground uppercase font-semibold">
                      {t("observations.reject_reason_label", "Rejection reason (required)")}
                    </label>
                    <textarea
                      id="obs-reject-notes"
                      rows={3}
                      value={reviewNotes}
                      onChange={(e) => setReviewNotes(e.target.value)}
                      placeholder={t("observations.reject_reason_placeholder", "e.g. No physical evidence found during site inspection — possible misidentification.")}
                      className="w-full rounded border border-border bg-background px-2.5 py-1.5 text-xs text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary resize-none"
                    />
                    <div className="flex items-center gap-2">
                      <button
                        id="obs-reject-submit-btn"
                        type="button"
                        disabled={reviewBusy || reviewNotes.trim().length < 5}
                        onClick={() => submitReview(activeObs.id, "REJECTED")}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded bg-zinc-600 hover:bg-zinc-500 text-white text-xs font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        <XCircle className="h-3.5 w-3.5" />
                        {reviewBusy ? t("common.saving", "Saving…") : t("observations.confirm_reject", "Confirm Reject")}
                      </button>
                      <button
                        type="button"
                        onClick={() => { setReviewAction(null); setReviewNotes(""); setReviewNotice(null); }}
                        className="text-xs text-muted-foreground hover:text-foreground"
                      >
                        {t("common.cancel", "Cancel")}
                      </button>
                    </div>
                    {reviewNotes.trim().length > 0 && reviewNotes.trim().length < 5 && (
                      <p className="text-[0.68rem] text-rose-400">
                        {t("observations.reject_reason_min", "Reason must be at least 5 characters.")}
                      </p>
                    )}
                  </div>
                )}
              </div>
            )}

            <div className="flex items-center justify-between pt-2">
              {(() => {
                const z = zoneMap.get(activeObs.zone_id);
                return z && onSelectZone ? (
                  <button
                    type="button"
                    onClick={() => {
                      onSelectZone(z.id);
                      setOpen(false);
                    }}
                    className="text-xs font-semibold text-primary hover:underline"
                  >
                    {t("observations.view_zone_map", "Focus Zone on Risk Map →")}
                  </button>
                ) : <span />;
              })()}
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setActiveObsId(null)}
                className="text-xs"
              >
                {t("observations.back_to_list", "Back to list")}
              </Button>
            </div>
          </div>
        ) : (
          /* View Mode 2: Observations Table Browser */
          <div className="flex-1 overflow-hidden flex flex-col pt-2">
            {/* Filter and Search Bar */}
            <div className="flex flex-wrap items-center justify-between gap-2 pb-2 shrink-0 border-b border-border">
              <div className="flex items-center gap-1 text-xs">
                <button
                  type="button"
                  onClick={() => setStatusFilter("all")}
                  className={`px-2.5 py-1 rounded text-xs font-medium transition-colors ${statusFilter === "all"
                      ? "bg-primary text-primary-foreground font-semibold"
                      : "bg-secondary/40 text-muted-foreground hover:text-foreground"
                    }`}
                >
                  {t("observations.filter_all", "All ({{count}})", { count: observations.length })}
                </button>
                <button
                  type="button"
                  onClick={() => setStatusFilter("verified")}
                  className={`px-2.5 py-1 rounded text-xs font-medium transition-colors ${statusFilter === "verified"
                      ? "bg-emerald-600 text-white font-semibold"
                      : "bg-secondary/40 text-muted-foreground hover:text-foreground"
                    }`}
                >
                  {t("observations.filter_verified", "Verified")}
                </button>
                <button
                  type="button"
                  onClick={() => setStatusFilter("actionable")}
                  className={`px-2.5 py-1 rounded text-xs font-medium transition-colors ${statusFilter === "actionable"
                      ? "bg-orange-600 text-white font-semibold"
                      : "bg-secondary/40 text-muted-foreground hover:text-foreground"
                    }`}
                >
                  {t("observations.filter_actionable", "Actionable")}
                </button>
                <button
                  type="button"
                  onClick={() => setStatusFilter("pending")}
                  className={`px-2.5 py-1 rounded text-xs font-medium transition-colors ${statusFilter === "pending"
                      ? "bg-amber-600 text-white font-semibold"
                      : "bg-secondary/40 text-muted-foreground hover:text-foreground"
                    }`}
                >
                  {t("observations.filter_pending", "Pending")}
                </button>
                <button
                  type="button"
                  onClick={() => setStatusFilter("rejected")}
                  className={`px-2.5 py-1 rounded text-xs font-medium transition-colors ${statusFilter === "rejected"
                      ? "bg-zinc-600 text-white font-semibold"
                      : "bg-secondary/40 text-muted-foreground hover:text-foreground"
                    }`}
                >
                  {t("observations.filter_rejected", "Rejected")}
                </button>
              </div>

              <div className="relative">
                <input
                  type="search"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder={t("observations.search_placeholder", "Filter observations, zone, signs...")}
                  className="h-8 w-56 rounded border border-border bg-background px-2.5 pr-7 text-xs text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary"
                />
                <Search className="absolute right-2 top-2.5 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
              </div>
            </div>

            {/* Scrollable Table Area */}
            <div className="flex-1 overflow-y-auto mt-2">
              <table className="w-full text-left text-xs border-collapse font-sans">
                <thead className="sticky top-0 bg-secondary/80 backdrop-blur-xs z-10">
                  <tr className="border-b border-border text-muted-foreground font-medium">
                    <th className="py-2 px-3 whitespace-nowrap">{t("operational_tables.col_time", "Time (IST)")}</th>
                    <th className="py-2 px-3 whitespace-nowrap">{t("operational_tables.col_location", "Location")}</th>
                    <th className="py-2 px-3 whitespace-nowrap">{t("operational_tables.col_type", "Type / Visual Signs")}</th>
                    <th className="py-2 px-3 whitespace-nowrap">{t("operational_tables.col_status", "Status")}</th>
                    <th className="py-2 px-3 text-right">{t("common.action", "Action")}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/60">
                  {filteredObservations.map((obs) => {
                    const z = zoneMap.get(obs.zone_id);
                    const loc = z ? `${z.zone_name}, ${z.state}` : `Zone ${obs.zone_id}`;
                    const typeLabel =
                      obs.visual_signs ||
                      (obs.road_status && obs.road_status !== "open" ? `Road ${obs.road_status}` : "Slope Movement");
                    const statusMeta = getObservationStatusMeta((obs as any).status ?? (obs as any).review_status);

                    return (
                      <tr key={obs.id} className="hover:bg-secondary/20 transition-colors">
                        <td className="py-2.5 px-3 font-mono text-[0.7rem] whitespace-nowrap text-muted-foreground">
                          {new Date(obs.observed_at).toLocaleDateString("en-IN", {
                            day: "2-digit",
                            month: "short",
                          })}{" "}
                          {new Date(obs.observed_at).toLocaleTimeString("en-IN", {
                            hour: "2-digit",
                            minute: "2-digit",
                            hour12: false,
                          })}
                        </td>
                        <td className="py-2.5 px-3 font-semibold text-foreground whitespace-nowrap">
                          {loc}
                        </td>
                        <td className="py-2.5 px-3 text-muted-foreground text-[0.72rem] max-w-xs truncate">
                          {typeLabel}
                        </td>
                        <td className="py-2.5 px-3 whitespace-nowrap">
                          <span
                            className={`inline-block px-2 py-0.5 rounded border font-display text-[0.65rem] font-semibold ${statusMeta.badgeClass}`}
                          >
                            {statusMeta.label}
                          </span>
                        </td>
                        <td className="py-2.5 px-3 text-right">
                          <button
                            type="button"
                            onClick={() => setActiveObsId(obs.id)}
                            className="text-xs text-primary font-bold hover:underline"
                          >
                            {t("observations.see_details", "See Details →")}
                          </button>
                        </td>
                      </tr>
                    );

                  })}
                  {filteredObservations.length === 0 && (
                    <tr>
                      <td colSpan={5} className="py-8 text-center text-muted-foreground text-xs">
                        {t("observations.no_records", "No observations found matching the search filter.")}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {/* Footer */}
            <div className="pt-3 border-t border-border flex items-center justify-between shrink-0">
              <span className="text-[0.68rem] text-muted-foreground">
                {t("observations.footer_count", "Showing {{count}} ground observations", {
                  count: filteredObservations.length,
                })}
              </span>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setOpen(false)}
                className="text-xs"
              >
                {t("common.close", "Close")}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
