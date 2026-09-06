import { useState, useEffect } from "react";
import {
  useOfflineQueue,
  getCachedOfflinePackage,
  downloadAndCacheOfflinePackage,
  type CachedBundleStatus,
} from "@/lib/offline-manager";
import { Button } from "@/components/ui/button";
import { useTranslation } from "react-i18next";
import { SyncQueueDialog } from "./SyncQueueDialog";

export function OfflineBanner() {
  const { t } = useTranslation();
  const { isOnline, queueCount, syncing, triggerSync } = useOfflineQueue();
  const [cachedStatus, setCachedStatus] = useState<CachedBundleStatus | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [bannerNotice, setBannerNotice] = useState<string | null>(null);
  const [queueDialogOpen, setQueueDialogOpen] = useState(false);

  useEffect(() => {
    setCachedStatus(getCachedOfflinePackage());
  }, []);

  async function handleDownloadPackage() {
    setDownloading(true);
    try {
      const pkg = await downloadAndCacheOfflinePackage();
      setCachedStatus(getCachedOfflinePackage());
      setBannerNotice(
        t("offline.bundle_cached", "Offline bundle cached for 15 zones. Valid until {{time}}.", {
          time: new Date(pkg.cache_policy.valid_until).toLocaleTimeString(),
        }),
      );
      setTimeout(() => setBannerNotice(null), 4000);
    } catch (err) {
      console.error("Failed to download bundle:", err);
      setBannerNotice(t("offline.bundle_failed", "Failed to download offline package."));
    } finally {
      setDownloading(false);
    }
  }

  return (
    <aside
      aria-label={t("offline.aria_label", "Offline status and synchronization")}
      aria-live="polite"
      className="border-b border-border bg-secondary/80 backdrop-blur px-4 py-2 text-xs font-mono"
    >
      <div className="mx-auto flex max-w-[1600px] flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span
            className={`h-2.5 w-2.5 rounded-full ${
              !isOnline ? "bg-amber-400 animate-pulse" : "bg-blue-400"
            }`}
          />
          <span className={`font-semibold uppercase tracking-wider ${!isOnline ? "text-amber-400" : ""}`}>
            {!isOnline ? t("offline.offline_mode", "⚠ Offline Mode — Cached Risk Data") : t("offline.sync_worker", "Offline Sync Worker")}
          </span>
          <span className={!isOnline ? "text-amber-300 font-medium" : "text-muted-foreground"}>
            {!isOnline
              ? cachedStatus?.cachedAt
                ? t("offline.last_updated_time", "Last updated at {{time}} ({{age}}h ago), may be outdated — live network recompute needed.", {
                    time: new Date(cachedStatus.cachedAt).toLocaleTimeString(),
                    age: cachedStatus.ageHours,
                  })
                : t("offline.last_updated_unknown", "Last updated at unknown timestamp, may be outdated — live network recompute needed.")
              : bannerNotice || t("offline.pending_queue", "{{count}} pending observation(s) in local queue.", { count: queueCount })}
          </span>
        </div>

        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() => setQueueDialogOpen(true)}
            className="h-7 px-2.5 text-[0.68rem] font-mono uppercase border-primary/50 text-primary hover:bg-primary/10 cursor-pointer"
          >
            {syncing ? t("offline.syncing", "Syncing…") : t("offline.sync_queue_count", "Sync Queue ({{count}})", { count: queueCount })}
          </Button>

          {isOnline && (
            <Button
              size="sm"
              variant="outline"
              onClick={handleDownloadPackage}
              disabled={downloading}
              className="h-7 px-2.5 text-[0.68rem] font-mono uppercase text-muted-foreground hover:text-foreground cursor-pointer"
            >
              {downloading ? t("offline.caching", "Caching…") : t("offline.download_bundle", "Download 24h Bundle")}
            </Button>
          )}

          <SyncQueueDialog open={queueDialogOpen} onOpenChange={setQueueDialogOpen} />
        </div>
      </div>
    </aside>
  );
}
