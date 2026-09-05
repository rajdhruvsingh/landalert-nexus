import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useOnlineStatus, queueObservation } from "@/lib/offline-manager";
import { submitFieldObservationsServerFn } from "@/lib/monitoring.functions";
import type { FieldObservationInput } from "@/lib/sync.service";
import { supabase } from "@/integrations/supabase/client";
import { getUserAuthorizationState } from "@/lib/auth-domains";

interface Props {
  initialZoneId?: number;
  trigger?: React.ReactNode;
  onSuccess?: () => void;
}

// Authoritative fallback matching the 15 monitored hill zones in risk_zones
export const FALLBACK_ZONES = [
  { id: 1, name: "Tamenglong", state: "Manipur", district: "Tamenglong" },
  { id: 2, name: "Noney", state: "Manipur", district: "Noney" },
  { id: 3, name: "Aizawl East", state: "Mizoram", district: "Aizawl" },
  { id: 4, name: "Lunglei Slopes", state: "Mizoram", district: "Lunglei" },
  { id: 5, name: "Shillong-Sohra Escarpment", state: "Meghalaya", district: "East Khasi Hills" },
  { id: 6, name: "Jaintia Hills Ridge", state: "Meghalaya", district: "West Jaintia Hills" },
  { id: 7, name: "Kohima Ridge", state: "Nagaland", district: "Kohima" },
  { id: 8, name: "Dimapur Foothills", state: "Nagaland", district: "Dimapur" },
  { id: 9, name: "Papum Pare", state: "Arunachal Pradesh", district: "Papum Pare" },
  { id: 10, name: "Dibang Valley", state: "Arunachal Pradesh", district: "Dibang Valley" },
  { id: 11, name: "Gangtok-Singtam Corridor", state: "Sikkim", district: "East Sikkim" },
  { id: 12, name: "Mangan North", state: "Sikkim", district: "Mangan" },
  { id: 13, name: "Haflong Hills", state: "Assam", district: "Dima Hasao" },
  { id: 14, name: "Karbi Anglong West", state: "Assam", district: "Karbi Anglong" },
  { id: 15, name: "Ambassa Hills", state: "Tripura", district: "Dhalai" },
];

interface MediaItem {
  file?: File;
  previewUrl: string;
  name: string;
  size: number;
  mimeType: string;
  base64Data?: string;
  url?: string;
}

// Helper to ensure an authenticated Supabase session exists before media upload
export async function ensureAuthenticatedSession() {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (session) return session;
    const { data: anonData, error } = await supabase.auth.signInAnonymously();
    if (!error && anonData?.session) {
      return anonData.session;
    }
  } catch (err) {
    console.warn("Anonymous auth session establishment failed:", err);
  }
  return null;
}

export function FieldObservationDialog({ initialZoneId, trigger, onSuccess }: Props) {
  const [open, setOpen] = useState(false);
  const isOnline = useOnlineStatus();

  // 1. Live Zones from Database (Fixing the bug where ZONES_LIST had non-existent zones)
  const [zones, setZones] = useState(FALLBACK_ZONES);
  const [zoneId, setZoneId] = useState<number>(initialZoneId ?? 1);

  useEffect(() => {
    async function fetchRealZones() {
      try {
        const res = await fetch("/api/gis/zones.geojson");
        if (res.ok) {
          const geo = await res.json();
          if (geo?.features && Array.isArray(geo.features)) {
            const list = geo.features.map((f: any) => ({
              id: Number(f.properties.id),
              name: String(f.properties.zone_name),
              state: String(f.properties.state),
              district: String(f.properties.district),
            })).sort((a: any, b: any) => a.id - b.id);
            if (list.length === 15) {
              setZones(list);
            }
          }
        }
      } catch {
        // Fallback already pre-populated with correct 15 zones
      }
    }
    fetchRealZones();
  }, []);

  // 2. Submitter Role & Trust Tier
  const [userRole, setUserRole] = useState<string>("PUBLIC_USER");
  const [mediaUploadEnabled, setMediaUploadEnabled] = useState<boolean>(true);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session?.user?.email) {
        const authState = getUserAuthorizationState({
          email: session.user.email,
          user_metadata: session.user.user_metadata,
        });
        setUserRole(authState.role);
        setObserverId(session.user.email.split("@")[0] ?? "field_observer");
      } else if (session?.user) {
        setUserRole("PUBLIC_USER");
        setObserverId(`citizen_${session.user.id.slice(0, 8)}`);
      }
    });
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    fetch("/api/field-observations/status")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data && typeof data.mediaUploadEnabled === "boolean") {
          setMediaUploadEnabled(data.mediaUploadEnabled);
        }
      })
      .catch(() => {});
  }, []);


  const [rainfallMm, setRainfallMm] = useState<string>("");
  const [soilCondition, setSoilCondition] = useState<string>("damp");
  const [visualSigns, setVisualSigns] = useState<string>("None");
  const [roadStatus, setRoadStatus] = useState<"open" | "restricted" | "blocked" | "unknown">("open");
  const [observerId, setObserverId] = useState<string>("citizen_observer");

  // 3. Geolocation Capture
  const [geoLat, setGeoLat] = useState<number | null>(null);
  const [geoLng, setGeoLng] = useState<number | null>(null);
  const [geoAccuracy, setGeoAccuracy] = useState<number | null>(null);
  const [geoCapturedAt, setGeoCapturedAt] = useState<string | null>(null);
  const [gpsStatus, setGpsStatus] = useState<string | null>(null);

  function captureGps() {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setGpsStatus("Browser geolocation not supported");
      return;
    }
    setGpsStatus("Acquiring GPS location…");
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setGeoLat(Number(pos.coords.latitude.toFixed(5)));
        setGeoLng(Number(pos.coords.longitude.toFixed(5)));
        setGeoAccuracy(Number(pos.coords.accuracy.toFixed(1)));
        setGeoCapturedAt(new Date(pos.timestamp).toISOString());
        setGpsStatus(
          `GPS Acquired: ${pos.coords.latitude.toFixed(4)}°N, ${pos.coords.longitude.toFixed(4)}°E (±${Math.round(pos.coords.accuracy)}m)`,
        );
      },
      (err) => {
        setGpsStatus(`GPS error: ${err.message}`);
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 },
    );
  }

  // 4. Media Upload (Photo/Video)
  const [mediaList, setMediaList] = useState<MediaItem[]>([]);
  const [fileError, setFileError] = useState<string | null>(null);

  async function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    setFileError(null);
    const files = Array.from(e.target.files || []);
    if (!files.length) return;

    if (mediaList.length + files.length > 3) {
      setFileError("Maximum 3 files allowed per observation");
      return;
    }

    const newItems: MediaItem[] = [];
    for (const file of files) {
      const isImg = file.type.startsWith("image/");
      const isVid = file.type.startsWith("video/");

      if (!isImg && !isVid) {
        setFileError(`Unsupported format: ${file.name}. Only photos and videos allowed.`);
        return;
      }
      if (isImg && file.size > 10 * 1024 * 1024) {
        setFileError(`Image ${file.name} exceeds 10MB limit.`);
        return;
      }
      if (isVid && file.size > 50 * 1024 * 1024) {
        setFileError(`Video ${file.name} exceeds 50MB limit.`);
        return;
      }

      // Convert to base64 for offline durability
      const base64Data = await new Promise<string>((resolve) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.readAsDataURL(file);
      });

      newItems.push({
        file,
        previewUrl: URL.createObjectURL(file),
        name: file.name,
        size: file.size,
        mimeType: file.type,
        base64Data,
      });
    }

    setMediaList((prev) => [...prev, ...newItems]);
    // Automatically trigger GPS acquisition if not done yet
    if (!geoLat) {
      captureGps();
    }
  }

  function removeMedia(idx: number) {
    setMediaList((prev) => prev.filter((_, i) => i !== idx));
  }

  const [submitting, setSubmitting] = useState(false);
  const [statusMessage, setStatusMessage] = useState<{
    type: "success" | "error" | "offline";
    text: string;
  } | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setStatusMessage(null);
    // If online, upload media files first to obtain permanent storage URLs
    const uploadedUrls: string[] = [];
    const mediaMeta: Array<{ name: string; size: number; mimeType: string; url?: string }> = [];

    if (isOnline && mediaList.length > 0) {
      const session = await ensureAuthenticatedSession();
      const authHeaders: Record<string, string> = {};
      if (session?.access_token) {
        authHeaders["Authorization"] = `Bearer ${session.access_token}`;
      }

      for (const item of mediaList) {
        if (item.file) {
          try {
            const fd = new FormData();
            fd.append("file", item.file);
            fd.append("zoneId", String(zoneId));
            const upRes = await fetch("/api/field-observations/upload", {
              method: "POST",
              headers: authHeaders,
              body: fd,
            });
            if (upRes.ok) {
              const upJson = await upRes.json();
              uploadedUrls.push(upJson.url);
              mediaMeta.push({
                name: item.name,
                size: item.size,
                mimeType: item.mimeType,
                url: upJson.url,
              });
              continue;
            }
          } catch (err) {
            console.warn("Direct media upload failed, fallback to offline base64 queue:", err);
          }
        }
        // If upload failed or in sandbox, preserve base64
        uploadedUrls.push(item.base64Data || item.previewUrl);
        mediaMeta.push({
          name: item.name,
          size: item.size,
          mimeType: item.mimeType,
          url: item.base64Data,
        });
      }
    } else {
      // Offline: store base64 payload in queue
      for (const item of mediaList) {
        uploadedUrls.push(item.base64Data || "");
        mediaMeta.push({
          name: item.name,
          size: item.size,
          mimeType: item.mimeType,
          url: item.base64Data,
        });
      }
    }

    const record: Omit<FieldObservationInput, "idempotency_key" | "client_timestamp"> = {
      zone_id: zoneId,
      observed_at: new Date().toISOString(),
      rainfall_mm: rainfallMm ? Number(rainfallMm) : undefined,
      soil_condition: soilCondition,
      visual_signs: visualSigns === "None" ? undefined : visualSigns,
      road_status: roadStatus,
      observer_id: observerId.trim() || "citizen_observer",
      media_urls: uploadedUrls.filter((u) => !u.startsWith("data:")),
      media_metadata: mediaMeta,
      geo_lat: geoLat ?? undefined,
      geo_lng: geoLng ?? undefined,
      geo_accuracy_m: geoAccuracy ?? undefined,
      geo_captured_at: geoCapturedAt ?? undefined,
      consent_given: true,
      submitter_role: userRole,
    };

    try {
      if (!isOnline) {
        // Offline: save to local queue
        queueObservation(record);
        setStatusMessage({
          type: "offline",
          text: "Device is offline. Observation & media queued locally; will sync automatically upon reconnection.",
        });
        setTimeout(() => {
          setOpen(false);
          setStatusMessage(null);
          onSuccess?.();
        }, 2200);
      } else {
        // Online: direct server call
        const fullRecord = queueObservation(record);
        const res = await submitFieldObservationsServerFn({
          data: { observations: [fullRecord] },
        });

        if (res.success && res.syncedCount > 0) {
          const trustNotice =
            userRole === "PUBLIC_USER"
              ? "Submitted for official review (unverified citizen signal)."
              : "Submitted with official authority credentials.";
          setStatusMessage({
            type: "success",
            text: `Observation for Zone ${zoneId} submitted. ${trustNotice}`,
          });
          setTimeout(() => {
            setOpen(false);
            setStatusMessage(null);
            onSuccess?.();
          }, 1800);
        } else {
          setStatusMessage({
            type: "error",
            text: res.errors?.[0] || "Server sync failed; queued locally for automatic retry.",
          });
        }
      }
    } catch (err) {
      console.error("Submission failed:", err);
      queueObservation(record);
      setStatusMessage({
        type: "offline",
        text: "Network error encountered. Observation preserved in offline queue.",
      });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger ?? (
          <Button
            variant="outline"
            size="sm"
            className="font-mono text-xs uppercase tracking-wider"
          >
            Report Observation
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="sm:max-w-[520px] max-h-[90vh] overflow-y-auto bg-surface text-foreground border-border">
        <DialogHeader>
          <DialogTitle className="text-xl font-display uppercase tracking-wide">
            Submit Field Observation
          </DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground">
            Feed ground-truth observations & geo-tagged photos into the NER early warning system.
          </DialogDescription>
        </DialogHeader>

        {/* Trust Model Notice */}
        <div className="rounded border border-amber-500/30 bg-amber-500/10 p-2.5 text-[0.7rem] font-mono text-amber-300">
          <div className="font-semibold uppercase tracking-wider flex items-center justify-between">
            <span>🛡️ Trust Model: {userRole === "PUBLIC_USER" ? "Citizen Report" : "Verified Official"}</span>
            <span className="text-[0.65rem] opacity-80">
              {userRole === "PUBLIC_USER" ? "Pending Triage" : "Direct Official Feed"}
            </span>
          </div>
          <p className="mt-1 text-muted-foreground leading-normal">
            {userRole === "PUBLIC_USER"
              ? "Public reports enter the system as unverified candidate signals. Photos & coordinates are reviewed by emergency authorities before displaying on the public dashboard."
              : "Official survey record authenticated under emergency authority. Media displays immediately upon verification."}
          </p>
        </div>

        {statusMessage && (
          <div
            className={`rounded border p-3 text-xs font-mono leading-relaxed ${
              statusMessage.type === "success"
                ? "border-emerald-500/50 bg-emerald-500/10 text-emerald-400"
                : statusMessage.type === "offline"
                  ? "border-blue-500/50 bg-blue-500/10 text-blue-400"
                  : "border-destructive/50 bg-destructive/10 text-destructive"
            }`}
          >
            {statusMessage.text}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-3.5">
          {/* 1. Zone Selection (Live 15 Monitored Zones) */}
          <div className="grid gap-1.5">
            <Label htmlFor="zoneSelect" className="text-xs font-mono uppercase text-muted-foreground">
              Monitored Zone (NER)
            </Label>
            <Select value={String(zoneId)} onValueChange={(v) => setZoneId(Number(v))}>
              <SelectTrigger id="zoneSelect" className="bg-secondary/40 border-border font-mono text-xs">
                <SelectValue placeholder="Select Zone" />
              </SelectTrigger>
              <SelectContent className="bg-surface border-border max-h-60">
                {zones.map((z) => (
                  <SelectItem key={z.id} value={String(z.id)} className="text-xs font-mono">
                    Zone {z.id}: {z.name} ({z.district}, {z.state})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* 2. Measurements */}
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="rainInput" className="text-xs font-mono uppercase text-muted-foreground">
                Rainfall (mm, 24h)
              </Label>
              <Input
                id="rainInput"
                type="number"
                min="0"
                max="600"
                step="0.1"
                placeholder="e.g. 45.0"
                value={rainfallMm}
                onChange={(e) => setRainfallMm(e.target.value)}
                className="bg-secondary/40 border-border font-mono text-xs"
              />
            </div>

            <div className="grid gap-1.5">
              <Label htmlFor="soilCondition" className="text-xs font-mono uppercase text-muted-foreground">
                Soil Condition
              </Label>
              <Select value={soilCondition} onValueChange={setSoilCondition}>
                <SelectTrigger id="soilCondition" className="bg-secondary/40 border-border font-mono text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-surface border-border">
                  <SelectItem value="dry" className="text-xs font-mono">Dry / Stable</SelectItem>
                  <SelectItem value="damp" className="text-xs font-mono">Damp</SelectItem>
                  <SelectItem value="saturated" className="text-xs font-mono">Saturated / Soft</SelectItem>
                  <SelectItem value="waterlogged" className="text-xs font-mono">Waterlogged / Seepage</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="visualSigns" className="text-xs font-mono uppercase text-muted-foreground">
                Visual Signs
              </Label>
              <Select value={visualSigns} onValueChange={setVisualSigns}>
                <SelectTrigger id="visualSigns" className="bg-secondary/40 border-border font-mono text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-surface border-border">
                  <SelectItem value="None" className="text-xs font-mono">None observed</SelectItem>
                  <SelectItem value="Tension cracks on slope" className="text-xs font-mono">Tension cracks</SelectItem>
                  <SelectItem value="Mudflow / Slumping" className="text-xs font-mono">Mudflow / Slumping</SelectItem>
                  <SelectItem value="Tilting trees/poles" className="text-xs font-mono">Tilting trees/poles</SelectItem>
                  <SelectItem value="Rockfall debris" className="text-xs font-mono">Rockfall debris</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="grid gap-1.5">
              <Label htmlFor="roadStatus" className="text-xs font-mono uppercase text-muted-foreground">
                Road Connectivity
              </Label>
              <Select
                value={roadStatus}
                onValueChange={(v) => setRoadStatus(v as "open" | "restricted" | "blocked" | "unknown")}
              >
                <SelectTrigger id="roadStatus" className="bg-secondary/40 border-border font-mono text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-surface border-border">
                  <SelectItem value="open" className="text-xs font-mono">Open / Clear</SelectItem>
                  <SelectItem value="restricted" className="text-xs font-mono">Restricted / 1-Way</SelectItem>
                  <SelectItem value="blocked" className="text-xs font-mono">Blocked / Impassable</SelectItem>
                  <SelectItem value="unknown" className="text-xs font-mono">Unknown</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* 3. Geo-Tagged Media Upload (Photos/Videos) - Hidden when disabled */}
          {mediaUploadEnabled && (
            <div className="rounded border border-border bg-secondary/20 p-3 space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-xs font-mono uppercase text-muted-foreground">
                  Field Media (Photos / Video)
                </Label>
                <span className="text-[0.65rem] font-mono text-muted-foreground">
                  Max 3 files (Photos &le;10MB, Videos &le;50MB)
                </span>
              </div>

              <Input
                type="file"
                accept="image/*,video/*"
                multiple
                disabled={submitting || mediaList.length >= 3}
                onChange={handleFileSelect}
                className="bg-secondary/40 border-border font-mono text-xs file:font-mono file:text-xs file:bg-primary/20 file:text-primary file:border-0 file:rounded cursor-pointer"
              />

              {fileError && <p className="text-[0.7rem] text-destructive font-mono">{fileError}</p>}

              {mediaList.length > 0 && (
                <div className="flex flex-wrap gap-2 pt-1">
                  {mediaList.map((item, idx) => (
                    <div
                      key={idx}
                      className="relative group border border-border rounded overflow-hidden bg-surface flex items-center gap-1.5 pr-2"
                    >
                      {item.mimeType.startsWith("image/") ? (
                        <img
                          src={item.previewUrl}
                          alt={item.name}
                          className="h-10 w-10 object-cover rounded-l"
                        />
                      ) : (
                        <div className="h-10 w-10 flex items-center justify-center bg-primary/20 text-xs">
                          🎬
                        </div>
                      )}
                      <span className="text-[0.65rem] font-mono truncate max-w-[100px]" title={item.name}>
                        {item.name}
                      </span>
                      <button
                        type="button"
                        onClick={() => removeMedia(idx)}
                        className="text-muted-foreground hover:text-destructive text-xs ml-1"
                        title="Remove"
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* 4. GPS Geolocation Capture */}
          <div className="flex items-center justify-between rounded border border-border/70 bg-secondary/10 px-3 py-2">
            <div className="space-y-0.5">
              <div className="text-xs font-mono uppercase text-muted-foreground">GPS Location</div>
              <div className="text-[0.7rem] font-mono text-foreground">
                {gpsStatus || "Not captured yet"}
              </div>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={captureGps}
              className="font-mono text-[0.7rem] h-7 px-2"
            >
              📍 {geoLat ? "Recapture GPS" : "Capture GPS"}
            </Button>
          </div>

          {/* 5. One-Line Mandatory Consent Notice */}
          <p className="text-[0.68rem] text-muted-foreground leading-relaxed italic border-l-2 border-primary/50 pl-2">
            Notice: Uploaded photos, videos, and GPS coordinates will be reviewed by emergency
            authorities and, once approved, will be visible on the public early warning dashboard.
          </p>

          <div className="grid gap-1.5">
            <Label htmlFor="observerInput" className="text-xs font-mono uppercase text-muted-foreground">
              Observer Identity / Station
            </Label>
            <Input
              id="observerInput"
              type="text"
              placeholder="e.g. DDMA Field Team / Citizen Observer"
              value={observerId}
              onChange={(e) => setObserverId(e.target.value)}
              className="bg-secondary/40 border-border font-mono text-xs"
            />
          </div>

          <DialogFooter className="mt-4 flex items-center justify-between sm:justify-between pt-2 border-t border-border">
            <div className="flex items-center gap-1.5 font-mono text-[0.68rem] text-muted-foreground">
              <span className={`h-2 w-2 rounded-full ${isOnline ? "bg-emerald-400" : "bg-blue-400"}`} />
              <span>{isOnline ? "Online (Direct API)" : "Offline (Local Queue)"}</span>
            </div>
            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setOpen(false)}
                disabled={submitting}
                className="font-mono text-xs"
              >
                Cancel
              </Button>
              <Button
                type="submit"
                size="sm"
                disabled={submitting}
                className="font-mono text-xs uppercase"
              >
                {submitting ? "Submitting…" : isOnline ? "Submit Report" : "Queue Offline"}
              </Button>
            </div>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
