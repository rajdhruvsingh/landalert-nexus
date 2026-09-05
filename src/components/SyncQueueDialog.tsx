import { useState, useEffect, useCallback } from "react";
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
import {
  getQueuedObservations,
  clearOfflineQueue,
  useOfflineQueue,
  useConnectivityStatus,
} from "@/lib/offline-manager";
import type { FieldObservationInput } from "@/lib/sync.service";
import { FALLBACK_ZONES } from "./FieldObservationDialog";
import {
  RefreshCw,
  AlertCircle,
  Clock,
  Trash2,
  CheckCircle2,
  CloudOff,
  Wifi,
  WifiOff,
} from "lucide-react";

interface Props {
  trigger?: React.ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

export function SyncQueueDialog({
  trigger,
  open: controlledOpen,
  onOpenChange: setControlledOpen,
}: Props) {
  const { t } = useTranslation();
  const [internalOpen, setInternalOpen] = useState(false);
  const isControlled = controlledOpen !== undefined;
  const open = isControlled ? controlledOpen : internalOpen;
  const setOpen = isControlled ? setControlledOpen! : setInternalOpen;

  const { isOnline, queueCount, syncing, triggerSync } = useOfflineQueue();
  const { connectivityState, checkHealth } = useConnectivityStatus();
  const [queueItems, setQueueItems] = useState<FieldObservationInput[]>([]);
  const [syncStatusMsg, setSyncStatusMsg] = useState<string | null>(null);

  const reloadItems = useCallback(() => {
    setQueueItems(getQueuedObservations());
  }, []);

  useEffect(() => {
    reloadItems();
    if (typeof window !== "undefined") {
      window.addEventListener("landalert-queue-updated", reloadItems);
      return () => {
        window.removeEventListener("landalert-queue-updated", reloadItems);
      };
    }
  }, [reloadItems]);

  const handleSyncNow = async () => {
    setSyncStatusMsg(null);
    await checkHealth();
    try {
      const res = await triggerSync();
      reloadItems();
      if (res) {
        if (res.success && res.syncedCount > 0) {
          setSyncStatusMsg(
            t("sync_queue.synced_success", "Successfully synchronized {{count}} observation(s).", {
              count: res.syncedCount,
            }),
          );
        } else if (res.errors?.length) {
          setSyncStatusMsg(
            t("sync_queue.sync_error", "Sync notice: {{error}}", {
              error: res.errors[0],
            }),
          );
        }
      }
    } catch (err: any) {
      setSyncStatusMsg(err?.message || "Sync attempt failed.");
    }
  };

  const handleClear = () => {
    if (window.confirm(t("sync_queue.confirm_clear", "Clear all pending offline observations? This action cannot be undone."))) {
      clearOfflineQueue();
      reloadItems();
      setSyncStatusMsg(t("sync_queue.queue_cleared", "Offline queue cleared."));
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {trigger && <DialogTrigger asChild>{trigger}</DialogTrigger>}
      <DialogContent className="sm:max-w-[700px] max-h-[85vh] overflow-hidden flex flex-col bg-surface text-foreground border-border z-[100]">
        <DialogHeader className="shrink-0 border-b border-border pb-3">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <RefreshCw className={`h-5 w-5 text-primary ${syncing ? "animate-spin" : ""}`} />
              <DialogTitle className="text-lg font-display text-foreground">
                {t("sync_queue.title", "Offline Synchronization Queue")}
              </DialogTitle>
            </div>
            {/* Live Connectivity Badge */}
            <div className="flex items-center gap-1.5 px-2 py-0.5 rounded text-[0.68rem] font-mono border border-border">
              {connectivityState === "api_reachable" ? (
                <>
                  <Wifi className="h-3 w-3 text-emerald-500" />
                  <span className="text-emerald-600 dark:text-emerald-400 font-semibold">
                    {t("sync_queue.api_connected", "API Reachable")}
                  </span>
                </>
              ) : connectivityState === "api_unavailable" ? (
                <>
                  <AlertCircle className="h-3 w-3 text-amber-500" />
                  <span className="text-amber-600 dark:text-amber-400 font-semibold">
                    {t("sync_queue.api_down", "API Unavailable")}
                  </span>
                </>
              ) : (
                <>
                  <WifiOff className="h-3 w-3 text-red-500" />
                  <span className="text-red-600 dark:text-red-400 font-semibold">
                    {t("sync_queue.device_offline", "Device Offline")}
                  </span>
                </>
              )}
            </div>
          </div>
          <DialogDescription className="text-xs text-muted-foreground mt-1">
            {t(
              "sync_queue.desc",
              "Review field observations cached locally in persistent storage awaiting server confirmation.",
            )}
          </DialogDescription>
        </DialogHeader>

        {/* Operational Status Notice */}
        {syncStatusMsg && (
          <div className="px-3 py-2 text-xs font-mono rounded bg-secondary/50 border border-border text-foreground flex items-center justify-between shrink-0 mt-2">
            <span>{syncStatusMsg}</span>
            <button
              onClick={() => setSyncStatusMsg(null)}
              className="text-[0.68rem] text-muted-foreground hover:text-foreground"
            >
              ✕
            </button>
          </div>
        )}

        {/* Queue Items Table / Empty View */}
        <div className="flex-1 overflow-y-auto mt-2 pr-1">
          {queueItems.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center text-muted-foreground">
              <CheckCircle2 className="h-10 w-10 text-emerald-500/80 mb-2" />
              <p className="text-sm font-semibold text-foreground font-display">
                {t("sync_queue.empty_title", "No observations pending synchronization.")}
              </p>
              <p className="text-xs max-w-sm mt-1">
                {t(
                  "sync_queue.empty_desc",
                  "All field observations have been synchronized with the central monitoring server.",
                )}
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {queueItems.map((item, index) => {
                const zone = FALLBACK_ZONES.find((z) => z.id === item.zone_id);
                const locLabel = zone
                  ? `${zone.name} • ${zone.district}, ${zone.state}`
                  : `Zone ${item.zone_id}`;
                const mediaCount = item.media_metadata?.length || item.media_urls?.length || 0;
                const status = item.queue_status || "PENDING";

                return (
                  <div
                    key={item.idempotency_key || index}
                    className="p-3 rounded border border-border bg-secondary/20 hover:bg-secondary/30 transition-colors text-xs font-sans flex flex-col gap-2"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-[0.68rem] font-bold text-primary px-1.5 py-0.5 rounded bg-primary/10">
                          #{index + 1}
                        </span>
                        <span className="font-semibold text-foreground font-display">
                          {locLabel}
                        </span>
                      </div>
                      <div className="flex items-center gap-2 font-mono text-[0.65rem]">
                        <span className="text-muted-foreground flex items-center gap-1">
                          <Clock className="h-3 w-3" />
                          {new Date(item.client_timestamp || item.observed_at).toLocaleString([], {
                            month: "short",
                            day: "numeric",
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </span>
                        <span
                          className={`px-1.5 py-0.5 rounded font-semibold uppercase ${
                            status === "FAILED"
                              ? "bg-red-500/10 text-red-600 dark:text-red-400 border border-red-500/20"
                              : status === "SYNCHRONIZED"
                              ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20"
                              : status === "SYNCING"
                              ? "bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20"
                              : "bg-blue-500/10 text-blue-600 dark:text-blue-400 border border-blue-500/20"
                          }`}
                        >
                          {status === "FAILED"
                            ? "Failed"
                            : status === "SYNCHRONIZED"
                            ? "Synced"
                            : status === "SYNCING"
                            ? "Syncing"
                            : "Pending"}
                        </span>
                      </div>
                    </div>

                    {/* Details Row */}
                    <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 text-[0.72rem] text-muted-foreground font-mono bg-background/50 p-2 rounded">
                      <div>
                        <span className="block text-[0.65rem] uppercase text-muted-foreground/80">
                          {t("field_observation.col_rainfall", "Rainfall")}
                        </span>
                        <span className="font-semibold text-foreground">
                          {item.rainfall_mm !== undefined ? `${item.rainfall_mm} mm` : "N/A"}
                        </span>
                      </div>
                      <div>
                        <span className="block text-[0.65rem] uppercase text-muted-foreground/80">
                          {t("field_observation.col_signs", "Signs")}
                        </span>
                        <span className="font-semibold text-foreground truncate block">
                          {item.visual_signs || "None"}
                        </span>
                      </div>
                      <div>
                        <span className="block text-[0.65rem] uppercase text-muted-foreground/80">
                          {t("field_observation.col_road", "Road")}
                        </span>
                        <span className="font-semibold text-foreground uppercase">
                          {item.road_status || "open"}
                        </span>
                      </div>
                      <div>
                        <span className="block text-[0.65rem] uppercase text-muted-foreground/80">
                          {t("sync_queue.col_media", "Media")}
                        </span>
                        <span className="font-semibold text-foreground">
                          {mediaCount} {mediaCount === 1 ? "file" : "files"}
                        </span>
                      </div>
                      <div>
                        <span className="block text-[0.65rem] uppercase text-muted-foreground/80">
                          {t("field_observation.col_retries", "Retries")}
                        </span>
                        <span className="font-semibold text-foreground">
                          {item.retry_count || 0}
                        </span>
                      </div>
                    </div>

                    {/* Queue ID, Observer, and Error row */}
                    <div className="flex flex-wrap items-center justify-between gap-1 text-[0.68rem] font-mono text-muted-foreground pt-0.5">
                      <span className="truncate max-w-[320px]" title={item.idempotency_key}>
                        Queue ID: {item.idempotency_key}
                      </span>
                      <span className="text-muted-foreground">
                        Observer: {item.observer_id || "citizen_observer"}
                      </span>
                    </div>

                    {item.last_error && (
                      <div className="text-[0.68rem] text-red-600 dark:text-red-400 bg-red-500/10 border border-red-500/20 rounded px-2 py-1 flex items-center justify-between gap-2">
                        <span>Last error: {item.last_error}</span>
                        <button
                          type="button"
                          onClick={handleSyncNow}
                          className="font-bold underline hover:text-red-700 dark:hover:text-red-300 shrink-0 cursor-pointer"
                        >
                          Retry
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer with Actions */}
        <div className="pt-3 border-t border-border flex items-center justify-between gap-3 shrink-0">
          <div className="flex items-center gap-2">
            {queueItems.length > 0 && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={handleClear}
                disabled={syncing}
                className="text-xs text-destructive hover:bg-destructive/10 h-8"
              >
                <Trash2 className="h-3.5 w-3.5 mr-1" />
                {t("sync_queue.clear_queue", "Clear Queue")}
              </Button>
            )}
          </div>

          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setOpen(false)}
              className="text-xs h-8"
            >
              {t("common.close", "Close")}
            </Button>

            <Button
              type="button"
              size="sm"
              onClick={handleSyncNow}
              disabled={syncing || queueItems.length === 0}
              className="text-xs h-8 bg-primary text-primary-foreground hover:bg-primary/90 font-semibold"
            >
              <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${syncing ? "animate-spin" : ""}`} />
              {syncing
                ? t("sync_queue.syncing", "Syncing…")
                : t("sync_queue.sync_all", "Sync All Pending ({{count}})", {
                    count: queueItems.length,
                  })}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
