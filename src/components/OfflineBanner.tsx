import { useState, useEffect } from "react";
import {
  useOfflineQueue,
  getCachedOfflinePackage,
  downloadAndCacheOfflinePackage,
  type CachedBundleStatus,
} from "@/lib/offline-manager";
import { Button } from "@/components/ui/button";

export function OfflineBanner() {
  const { isOnline, queueCount, syncing, triggerSync } = useOfflineQueue();
  const [cachedStatus, setCachedStatus] = useState<CachedBundleStatus | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [bannerNotice, setBannerNotice] = useState<string | null>(null);

  useEffect(() => {
    setCachedStatus(getCachedOfflinePackage());
  }, []);

  async function handleDownloadPackage() {
    setDownloading(true);
    try {
      const pkg = await downloadAndCacheOfflinePackage();
      setCachedStatus(getCachedOfflinePackage());
      setBannerNotice(
        `Offline bundle cached for 15 zones. Valid until ${new Date(pkg.cache_policy.valid_until).toLocaleTimeString()}.`,
      );
      setTimeout(() => setBannerNotice(null), 4000);
    } catch (err) {
      console.error("Failed to download bundle:", err);
      setBannerNotice("Failed to download offline package.");
    } finally {
      setDownloading(false);
    }
  }

  // If online and no queued items and no notice, don't show full alert banner
  if (isOnline && queueCount === 0 && !bannerNotice) {
    return null;
  }

  return (
    <aside
      aria-label="Offline status and synchronization"
      className="border-b border-border bg-secondary/80 backdrop-blur px-4 py-2 text-xs font-mono"
    >
      <div className="mx-auto flex max-w-[1600px] flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span
            className={`h-2.5 w-2.5 rounded-full ${
              !isOnline ? "bg-amber-400 animate-pulse" : "bg-blue-400"
            }`}
          />
          <span className="font-semibold uppercase tracking-wider">
            {!isOnline ? "Offline Mode Active" : "Offline Sync Worker"}
          </span>
          <span className="text-muted-foreground">
            {!isOnline
              ? cachedStatus?.package
                ? `Using local cache (${cachedStatus.ageHours}h old)${
                    cachedStatus.isExpired ? " · ⚠ EXPIRED (reconnect for fresh predictions)" : ""
                  }`
                : "No offline bundle cached. Please connect to internet."
              : bannerNotice || `${queueCount} pending observation(s) in local queue.`}
          </span>
        </div>

        <div className="flex items-center gap-2">
          {queueCount > 0 && isOnline && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => triggerSync()}
              disabled={syncing}
              className="h-7 px-2.5 text-[0.68rem] font-mono uppercase border-primary/50 text-primary hover:bg-primary/10"
            >
              {syncing ? "Syncing…" : `Sync Queue (${queueCount})`}
            </Button>
          )}

          {isOnline && (
            <Button
              size="sm"
              variant="outline"
              onClick={handleDownloadPackage}
              disabled={downloading}
              className="h-7 px-2.5 text-[0.68rem] font-mono uppercase text-muted-foreground hover:text-foreground"
            >
              {downloading ? "Caching…" : "Download 24h Bundle"}
            </Button>
          )}
        </div>
      </div>
    </aside>
  );
}
