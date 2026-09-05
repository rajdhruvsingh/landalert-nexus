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
import { useOnlineStatus, useConnectivityStatus, queueObservation, pruneQueue } from "@/lib/offline-manager";
import { submitFieldObservationsServerFn } from "@/lib/monitoring.functions";
import type { FieldObservationInput } from "@/lib/sync.service";
import { supabase } from "@/integrations/supabase/client";
import { getUserAuthorizationState } from "@/lib/auth-domains";
import { Capacitor } from "@capacitor/core";
import { Geolocation as CapGeolocation } from "@capacitor/geolocation";
import { Camera as CapCamera, CameraResultType, CameraSource } from "@capacitor/camera";
import { useTranslation } from "react-i18next";

interface Props {
  initialZoneId?: number;
  trigger?: React.ReactNode;
  onSuccess?: () => void;
}

import {
  getAllStates,
  getDistrictsByState,
  getZonesByDistrict,
  getZonesByState,
  getZoneById,
  getAllZones,
  resolveLocationFromGps,
  type MonitoredZoneEntity,
} from "@/lib/geography";

// Authoritative fallback matching the 15 monitored hill zones in risk_zones
export const FALLBACK_ZONES = getAllZones().map((z) => ({
  id: z.id,
  name: z.name,
  state: z.state,
  district: z.district,
  centroid_lat: z.centroid_lat,
  centroid_lng: z.centroid_lng,
}));

export const NER_GEOGRAPHY: Record<string, { districts: string[]; defaultZoneId: number }> = Object.fromEntries(
  getAllStates().map((st) => {
    const districts = getDistrictsByState(st.id).map((d) => d.name);
    const zones = getZonesByState(st.id);
    return [
      st.name,
      {
        districts,
        defaultZoneId: zones[0]?.id ?? 1,
      },
    ];
  }),
);

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
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const { isOnline, connectivityState, checkHealth } = useConnectivityStatus();
  const [fieldErrors, setFieldErrors] = useState<{ zone?: string; observer?: string; rainfall?: string; general?: string }>({});

  // 1. Live Zones from Database and Regional Geographic Hierarchy
  const [zones, setZones] = useState(FALLBACK_ZONES);
  const initialZone = FALLBACK_ZONES.find((z) => z.id === initialZoneId) ?? FALLBACK_ZONES[0]!;
  const [selectedState, setSelectedState] = useState<string>(initialZone.state);
  const [selectedDistrict, setSelectedDistrict] = useState<string>(initialZone.district);
  const [zoneId, setZoneId] = useState<number>(initialZone.id);

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
              centroid_lat: Number(f.properties.centroid_lat || 25.5),
              centroid_lng: Number(f.properties.centroid_lng || 92.5),
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
  const [consentChecked, setConsentChecked] = useState<boolean>(false);

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


  const [gpsZoneMessage, setGpsZoneMessage] = useState<string | null>(null);

  const currentDistrictZones = useMemo(() => {
    return getZonesByDistrict(selectedDistrict);
  }, [selectedDistrict]);

  const handleStateChange = (newState: string) => {
    setSelectedState(newState);
    const districts = getDistrictsByState(newState);
    const firstDistrict = districts[0]?.name || "";
    setSelectedDistrict(firstDistrict);
    const districtZones = getZonesByDistrict(firstDistrict);
    setZoneId(districtZones.length > 0 ? districtZones[0]!.id : null);
    setGpsZoneMessage(null);
    setFieldErrors((prev) => ({ ...prev, zone: undefined, general: undefined }));
  };

  const handleDistrictChange = (newDistrict: string) => {
    setSelectedDistrict(newDistrict);
    const districtZones = getZonesByDistrict(newDistrict);
    setZoneId(districtZones.length > 0 ? districtZones[0]!.id : null);
    setGpsZoneMessage(null);
    setFieldErrors((prev) => ({ ...prev, zone: undefined, general: undefined }));
  };

  function autoLocateFromGps(lat: number, lng: number) {
    const res = resolveLocationFromGps(lat, lng);
    setSelectedState(res.state.name);
    setSelectedDistrict(res.district.name);
    if (res.isExactZone && res.zone) {
      setZoneId(res.zone.id);
      setGpsZoneMessage(res.message);
    } else {
      setZoneId(null);
      setGpsZoneMessage("Location captured. Exact monitored zone could not be determined.");
    }
  }

  const [rainfallMm, setRainfallMm] = useState<string>("");
  const [soilCondition, setSoilCondition] = useState<string>("damp");
  const [visualSigns, setVisualSigns] = useState<string>("None");
  const [roadStatus, setRoadStatus] = useState<"open" | "restricted" | "blocked" | "unknown">("open");
  const [observerId, setObserverId] = useState<string>("citizen_observer");

  // 3. Geolocation Capture (Capacitor Native with Web Fallback)
  const [geoLat, setGeoLat] = useState<number | null>(null);
  const [geoLng, setGeoLng] = useState<number | null>(null);
  const [geoAccuracy, setGeoAccuracy] = useState<number | null>(null);
  const [geoCapturedAt, setGeoCapturedAt] = useState<string | null>(null);
  const [gpsStatus, setGpsStatus] = useState<string | null>(null);

  async function captureGps() {
    setGpsStatus(t("field_observation.gps_acquiring", "Acquiring GPS location…"));

    if (Capacitor.isNativePlatform()) {
      try {
        const perm = await CapGeolocation.checkPermissions();
        if (perm.location !== "granted") {
          const req = await CapGeolocation.requestPermissions();
          if (req.location !== "granted") {
            setGpsStatus(t("field_observation.gps_denied", "GPS permission denied by user"));
            return;
          }
        }
        const pos = await CapGeolocation.getCurrentPosition({
          enableHighAccuracy: true,
          timeout: 10000,
        });
        const lat = Number(pos.coords.latitude.toFixed(5));
        const lng = Number(pos.coords.longitude.toFixed(5));
        setGeoLat(lat);
        setGeoLng(lng);
        setGeoAccuracy(Number(pos.coords.accuracy ? pos.coords.accuracy.toFixed(1) : "5.0"));
        setGeoCapturedAt(new Date(pos.timestamp).toISOString());
        autoLocateFromGps(lat, lng);
        setGpsStatus(
          t("field_observation.gps_acquired_native", "GPS Acquired (Native): {{lat}}°N, {{lng}}°E (±{{acc}}m)", {
            lat: pos.coords.latitude.toFixed(4),
            lng: pos.coords.longitude.toFixed(4),
            acc: Math.round(pos.coords.accuracy || 5),
          }),
        );
        return;
      } catch (err: any) {
        console.warn("Native Geolocation failed, falling back to browser API:", err);
      }
    }

    // Web fallback
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setGpsStatus(t("field_observation.gps_unsupported", "Browser geolocation not supported"));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const lat = Number(pos.coords.latitude.toFixed(5));
        const lng = Number(pos.coords.longitude.toFixed(5));
        setGeoLat(lat);
        setGeoLng(lng);
        setGeoAccuracy(Number(pos.coords.accuracy.toFixed(1)));
        setGeoCapturedAt(new Date(pos.timestamp).toISOString());
        autoLocateFromGps(lat, lng);
        setGpsStatus(
          t("field_observation.gps_acquired_web", "GPS Acquired: {{lat}}°N, {{lng}}°E (±{{acc}}m)", {
            lat: pos.coords.latitude.toFixed(4),
            lng: pos.coords.longitude.toFixed(4),
            acc: Math.round(pos.coords.accuracy),
          }),
        );
      },
      (err) => {
        setGpsStatus(t("field_observation.gps_error", "GPS error: {{msg}}", { msg: err.message }));
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 },
    );
  }

  // Native Camera capture helper
  async function handleNativeCameraCapture() {
    if (mediaList.length >= 3) {
      setFileError(t("field_observation.error_max_files", "Maximum 3 files allowed per observation"));
      return;
    }
    setFileError(null);
    try {
      const image = await CapCamera.getPhoto({
        quality: 85,
        allowEditing: false,
        resultType: CameraResultType.Base64,
        source: CameraSource.Prompt,
      });

      if (!image.base64String) return;

      const mimeType = image.format ? `image/${image.format}` : "image/jpeg";
      const base64Data = `data:${mimeType};base64,${image.base64String}`;

      // Calculate approximate size in bytes from base64 string
      const sizeInBytes = Math.round((image.base64String.length * 3) / 4);
      if (sizeInBytes > 10 * 1024 * 1024) {
        setFileError(t("field_observation.error_photo_size", "Captured photo exceeds 10MB limit."));
        return;
      }

      // Create a File object for consistent upload pipeline
      const byteCharacters = atob(image.base64String);
      const byteNumbers = new Array(byteCharacters.length);
      for (let i = 0; i < byteCharacters.length; i++) {
        byteNumbers[i] = byteCharacters.charCodeAt(i);
      }
      const byteArray = new Uint8Array(byteNumbers);
      const blob = new Blob([byteArray], { type: mimeType });
      const filename = `camera_${Date.now()}.${image.format ?? "jpg"}`;
      const file = new File([blob], filename, { type: mimeType });

      setMediaList((prev) => [
        ...prev,
        {
          file,
          previewUrl: base64Data,
          name: filename,
          size: sizeInBytes,
          mimeType,
          base64Data,
        },
      ]);

      if (!geoLat) {
        captureGps();
      }
    } catch (err: any) {
      if (err?.message !== "User cancelled photos app") {
        setFileError(`Camera error: ${err?.message ?? "Capture failed"}`);
      }
    }
  }

  // 4. Media Upload (Photo/Video)
  const [mediaList, setMediaList] = useState<MediaItem[]>([]);
  const [fileError, setFileError] = useState<string | null>(null);

  async function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    setFileError(null);
    const files = Array.from(e.target.files || []);
    if (!files.length) return;

    if (mediaList.length + files.length > 3) {
      setFileError(t("field_observation.error_max_files", "Maximum 3 files allowed per observation"));
      return;
    }

    const ALLOWED_IMAGE_MIMES = ["image/jpeg", "image/png", "image/webp", "image/heic"];
    const ALLOWED_VIDEO_MIMES = ["video/mp4", "video/webm", "video/quicktime"];

    const newItems: MediaItem[] = [];
    for (const file of files) {
      const isImg = ALLOWED_IMAGE_MIMES.includes(file.type) || /\.(jpe?g|png|webp|heic)$/i.test(file.name);
      const isVid = ALLOWED_VIDEO_MIMES.includes(file.type) || /\.(mp4|webm|mov)$/i.test(file.name);

      if (!isImg && !isVid) {
        setFileError(t("field_observation.error_format", `Unsupported format: ${file.name}. Allowed: JPG, PNG, WEBP, MP4, MOV, WEBM.`));
        return;
      }
      if (isImg && file.size > 10 * 1024 * 1024) {
        setFileError(t("field_observation.error_photo_size", `Image ${file.name} exceeds 10MB limit.`));
        return;
      }
      if (isVid && file.size > 50 * 1024 * 1024) {
        setFileError(t("field_observation.error_video_size", `Video ${file.name} exceeds 50MB limit.`));
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
        mimeType: file.type || (isImg ? "image/jpeg" : "video/mp4"),
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
    setFieldErrors({});

    const newErrors: { zone?: string; observer?: string; rainfall?: string; general?: string } = {};

    if (!zoneId || isNaN(Number(zoneId))) {
      newErrors.zone = t("field_observation.error_zone_req", "Please select an operational monitoring zone.");
    }

    if (!observerId.trim()) {
      newErrors.observer = t("field_observation.error_observer_req", "Observer name / agency ID is required.");
    }

    if (rainfallMm.trim() !== "") {
      const rVal = Number(rainfallMm);
      if (isNaN(rVal) || rVal < 0 || rVal > 600) {
        newErrors.rainfall = t("field_observation.error_rainfall_range", "Rainfall must be a positive number between 0 and 600 mm.");
      }
    }

    const hasRain = rainfallMm.trim() !== "" && !isNaN(Number(rainfallMm));
    const hasSigns = visualSigns !== "None";
    const hasRoad = roadStatus !== "open";
    const hasMedia = mediaList.length > 0;
    const hasGeo = geoLat !== null;

    if (!hasRain && !hasSigns && !hasRoad && !hasMedia && !hasGeo) {
      newErrors.general = t("field_observation.error_empty", "Empty observation: At least one field observation signal (rainfall mm, slope signs, road status, ground photo, or GPS reading) must be provided.");
    }

    if (Object.keys(newErrors).length > 0) {
      setFieldErrors(newErrors);
      setSubmitting(false);
      return;
    }

    const isMediaAttached = mediaList.length > 0;
    if (isMediaAttached && !consentChecked) {
      setStatusMessage({
        type: "error",
        text: t("field_observation.error_consent", "Consent required: Please accept the media review and public disclosure notice before submitting."),
      });
      setSubmitting(false);
      return;
    }

    // If online, upload media files first to obtain permanent storage URLs
    const uploadedUrls: string[] = [];
    const mediaMeta: Array<{ id?: string; name: string; size: number; mimeType: string; storagePath?: string; url?: string }> = [];

    if (isOnline && connectivityState === "api_reachable" && mediaList.length > 0) {
      let authHeaders: Record<string, string> = {};
      try {
        const session = await ensureAuthenticatedSession();
        if (session?.access_token) {
          authHeaders["Authorization"] = `Bearer ${session.access_token}`;
        }
      } catch {
        // Public reporter
      }

      for (const item of mediaList) {
        let uploaded = false;
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
                storagePath: upJson.storagePath,
                url: upJson.url,
              });
              uploaded = true;
            }
          } catch (err) {
            console.warn("Direct media upload failed, fallback to IndexedDB offline queue:", err);
          }
        }
        if (!uploaded) {
          // Store in IndexedDB for resilient offline queue
          const { saveOfflineMedia } = await import("@/lib/offline-media-store");
          const mediaId = `offline_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
          await saveOfflineMedia(mediaId, item.file || item.base64Data || item.previewUrl, {
            name: item.name,
            mimeType: item.mimeType,
            size: item.size,
          });
          mediaMeta.push({
            id: mediaId,
            name: item.name,
            size: item.size,
            mimeType: item.mimeType,
          });
        }
      }
    } else {
      // Offline: store media binary in IndexedDB, only store lightweight reference in queue
      const { saveOfflineMedia } = await import("@/lib/offline-media-store");
      for (const item of mediaList) {
        const mediaId = `offline_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        await saveOfflineMedia(mediaId, item.file || item.base64Data || item.previewUrl, {
          name: item.name,
          mimeType: item.mimeType,
          size: item.size,
        });
        mediaMeta.push({
          id: mediaId,
          name: item.name,
          size: item.size,
          mimeType: item.mimeType,
        });
      }
    }

    const record: Omit<FieldObservationInput, "idempotency_key" | "client_timestamp"> = {
      zone_id: zoneId,
      state: selectedState,
      district: selectedDistrict,
      observed_at: new Date().toISOString(),
      rainfall_mm: rainfallMm ? Number(rainfallMm) : undefined,
      soil_condition: soilCondition,
      visual_signs: visualSigns === "None" ? undefined : visualSigns,
      road_status: roadStatus,
      observer_id: observerId.trim() || "citizen_observer",
      media_urls: uploadedUrls.filter((u) => !u.startsWith("data:") && !u.startsWith("offline_")),
      media_metadata: mediaMeta,
      geo_lat: geoLat ?? undefined,
      geo_lng: geoLng ?? undefined,
      geo_accuracy_m: geoAccuracy ?? undefined,
      geo_captured_at: geoCapturedAt ?? undefined,
      consent_given: Boolean(consentChecked),
      submitter_role: userRole,
    };

    try {
      const fullRecord = queueObservation(record);

      if (!isOnline || connectivityState === "api_unavailable") {
        setStatusMessage({
          type: "offline",
          text: t("field_observation.offline_queued", "Device offline/API unavailable. Observation preserved in local offline queue; will sync automatically upon reconnection."),
        });
        setTimeout(() => {
          setOpen(false);
          setStatusMessage(null);
          onSuccess?.();
        }, 2200);
      } else {
        const res = await submitFieldObservationsServerFn({
          data: { observations: [fullRecord] },
        });

        if (res.success && res.syncedCount > 0) {
          pruneQueue([fullRecord.idempotency_key]);
          const trustNotice =
            userRole === "PUBLIC_USER"
              ? t("field_observation.trust_notice_citizen", "Submitted for official review (unverified citizen signal).")
              : t("field_observation.trust_notice_official", "Submitted with official authority credentials.");
          setStatusMessage({
            type: "success",
            text: t("field_observation.success_notice", "Observation for Zone {{zoneId}} submitted. {{trustNotice}}", { zoneId, trustNotice }),
          });
          setTimeout(() => {
            setOpen(false);
            setStatusMessage(null);
            onSuccess?.();
          }, 1800);
        } else {
          setStatusMessage({
            type: "error",
            text: res.errors?.[0] || "Server sync failed; observation preserved in offline queue.",
          });
        }
      }
    } catch (err) {
      console.error("Submission failed, preserving in offline queue:", err);
      setStatusMessage({
        type: "offline",
        text: t("field_observation.network_error", "Network error encountered. Observation preserved in offline queue."),
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
            {t("field_observation.button_label", "Report Observation")}
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="sm:max-w-[520px] max-h-[90vh] overflow-y-auto bg-surface text-foreground border-border">
        <DialogHeader>
          <DialogTitle className="text-xl font-display uppercase tracking-wide">
            {t("field_observation.dialog_title", "Submit Field Observation")}
          </DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground">
            {t("field_observation.dialog_desc", "Feed ground-truth observations & geo-tagged photos into the NER early warning system.")}
          </DialogDescription>
        </DialogHeader>

        {/* Trust Model Notice */}
        <div className="rounded border border-amber-500/30 bg-amber-500/10 p-2.5 text-[0.7rem] font-mono text-amber-300">
          <div className="font-semibold uppercase tracking-wider flex items-center justify-between">
            <span>🛡️ Trust Model: {userRole === "PUBLIC_USER" ? t("field_observation.trust_citizen", "Citizen Report") : t("field_observation.trust_official", "Verified Official")}</span>
            <span className="text-[0.65rem] opacity-80">
              {userRole === "PUBLIC_USER" ? t("field_observation.triage_pending", "Pending Triage") : t("field_observation.triage_direct", "Direct Official Feed")}
            </span>
          </div>
          <p className="mt-1 text-muted-foreground leading-normal">
            {userRole === "PUBLIC_USER"
              ? t("field_observation.trust_desc_citizen", "Public reports enter the system as unverified candidate signals. Photos & coordinates are reviewed by emergency authorities before displaying on the public dashboard.")
              : t("field_observation.trust_desc_official", "Official survey record authenticated under emergency authority. Media displays immediately upon verification.")}
          </p>
        </div>

        {statusMessage && (
          <div
            role="status"
            aria-live="polite"
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

        {fieldErrors.general && (
          <div className="rounded border border-red-500/50 bg-red-500/10 p-2.5 text-xs text-red-600 dark:text-red-400 font-mono">
            {fieldErrors.general}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-3.5">
          {/* 1. Geographic Hierarchy: State -> District -> Monitoring Zone */}
          <div className="space-y-2 rounded border border-border bg-secondary/15 p-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-mono uppercase text-muted-foreground font-semibold">
                {t("field_observation.geo_hierarchy_title", "Geographic Coverage & Hierarchy")}
              </span>
              <span className="text-[0.65rem] font-mono text-primary font-medium">
                {t("field_observation.all_ner_states", "8 NER States Monitored")}
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              {/* State Selection */}
              <div className="grid gap-1">
                <Label htmlFor="stateSelect" className="text-[0.7rem] font-mono uppercase text-muted-foreground">
                  {t("field_observation.state_label", "State")}
                </Label>
                <Select value={selectedState} onValueChange={handleStateChange}>
                  <SelectTrigger id="stateSelect" aria-label={t("field_observation.state_label", "State")} className="bg-surface border-border font-mono text-xs h-8">
                    <SelectValue placeholder={t("field_observation.state_placeholder", "Select State")} />
                  </SelectTrigger>
                  <SelectContent className="bg-surface border-border max-h-60 z-[150]">
                    {Object.keys(NER_GEOGRAPHY).map((st) => (
                      <SelectItem key={st} value={st} className="text-xs font-mono">
                        {st}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* District Selection */}
              <div className="grid gap-1">
                <Label htmlFor="districtSelect" className="text-[0.7rem] font-mono uppercase text-muted-foreground">
                  {t("field_observation.district_label", "District")}
                </Label>
                <Select value={selectedDistrict} onValueChange={handleDistrictChange}>
                  <SelectTrigger id="districtSelect" aria-label={t("field_observation.district_label", "District")} className="bg-surface border-border font-mono text-xs h-8">
                    <SelectValue placeholder={t("field_observation.district_placeholder", "Select District")} />
                  </SelectTrigger>
                  <SelectContent className="bg-surface border-border max-h-60 z-[150]">
                    {(NER_GEOGRAPHY[selectedState]?.districts || []).map((dst) => (
                      <SelectItem key={dst} value={dst} className="text-xs font-mono">
                        {dst}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Operational Instrumented Monitoring Station */}
            <div className="grid gap-1 pt-1 border-t border-border/50">
              <div className="flex items-center justify-between">
                <Label htmlFor="zoneSelect" className="text-[0.7rem] font-mono uppercase text-muted-foreground">
                  {t("field_observation.zone_label", "Instrumented Monitoring Zone")}
                </Label>
                <span className="text-[0.62rem] text-muted-foreground">
                  {currentDistrictZones.length > 0
                    ? `${currentDistrictZones.length} active station(s) in ${selectedDistrict}`
                    : `District-level coverage (${selectedDistrict})`}
                </span>
              </div>

              {currentDistrictZones.length > 0 ? (
                <Select
                  value={zoneId ? String(zoneId) : ""}
                  onValueChange={(v) => {
                    setZoneId(v ? Number(v) : null);
                    setFieldErrors((prev) => ({ ...prev, zone: undefined, general: undefined }));
                  }}
                >
                  <SelectTrigger id="zoneSelect" aria-label={t("field_observation.zone_label", "Instrumented Monitoring Zone")} className="bg-surface border-border font-mono text-xs h-8">
                    <SelectValue placeholder={t("field_observation.zone_placeholder", "Select Monitored Zone")} />
                  </SelectTrigger>
                  <SelectContent className="bg-surface border-border max-h-60 z-[150]">
                    {currentDistrictZones.map((z) => (
                      <SelectItem key={z.id} value={String(z.id)} className="text-xs font-mono">
                        Zone {z.id}: {z.name} ({z.district}, {z.state})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <div className="rounded border border-amber-500/30 bg-amber-500/10 p-2 text-xs font-sans text-amber-800 dark:text-amber-300 flex items-center justify-between gap-2">
                  <span>
                    {t("field_observation.no_zone_registered", "No active monitored risk zone currently registered.")}
                  </span>
                  <span className="text-[0.68rem] text-muted-foreground font-mono">
                    {selectedDistrict}
                  </span>
                </div>
              )}

              {gpsZoneMessage && (
                <div className="text-[0.68rem] font-mono px-2 py-1 rounded bg-secondary/50 border border-border text-foreground">
                  {gpsZoneMessage}
                </div>
              )}

              {fieldErrors.zone && (
                <p className="text-[0.68rem] text-red-500 font-mono">{fieldErrors.zone}</p>
              )}
            </div>
          </div>

          {/* 2. Measurements */}
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="rainInput" className="text-xs font-mono uppercase text-muted-foreground">
                {t("field_observation.rainfall_label", "Rainfall (mm, 24h)")}
              </Label>
              <Input
                id="rainInput"
                type="number"
                min="0"
                max="600"
                step="0.1"
                placeholder="e.g. 45.0"
                value={rainfallMm}
                onChange={(e) => {
                  setRainfallMm(e.target.value);
                  setFieldErrors((prev) => ({ ...prev, rainfall: undefined, general: undefined }));
                }}
                className="bg-secondary/40 border-border font-mono text-xs"
              />
              {fieldErrors.rainfall && (
                <p className="text-[0.68rem] text-red-500 font-mono">{fieldErrors.rainfall}</p>
              )}
            </div>

            <div className="grid gap-1.5">
              <Label htmlFor="soilCondition" className="text-xs font-mono uppercase text-muted-foreground">
                {t("field_observation.soil_label", "Soil Condition")}
              </Label>
              <Select value={soilCondition} onValueChange={setSoilCondition}>
                <SelectTrigger id="soilCondition" aria-label={t("field_observation.soil_label", "Soil Condition")} className="bg-secondary/40 border-border font-mono text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-surface border-border">
                  <SelectItem value="dry" className="text-xs font-mono">{t("field_observation.soil_dry", "Dry / Stable")}</SelectItem>
                  <SelectItem value="damp" className="text-xs font-mono">{t("field_observation.soil_damp", "Damp")}</SelectItem>
                  <SelectItem value="saturated" className="text-xs font-mono">{t("field_observation.soil_saturated", "Saturated / Soft")}</SelectItem>
                  <SelectItem value="waterlogged" className="text-xs font-mono">{t("field_observation.soil_waterlogged", "Waterlogged / Seepage")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="visualSigns" className="text-xs font-mono uppercase text-muted-foreground">
                {t("field_observation.signs_label", "Visual Signs")}
              </Label>
              <Select value={visualSigns} onValueChange={setVisualSigns}>
                <SelectTrigger id="visualSigns" aria-label={t("field_observation.signs_label", "Visual Signs")} className="bg-secondary/40 border-border font-mono text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-surface border-border">
                  <SelectItem value="None" className="text-xs font-mono">{t("field_observation.signs_none", "None observed")}</SelectItem>
                  <SelectItem value="Tension cracks on slope" className="text-xs font-mono">{t("field_observation.signs_cracks", "Tension cracks")}</SelectItem>
                  <SelectItem value="Mudflow / Slumping" className="text-xs font-mono">{t("field_observation.signs_mudflow", "Mudflow / Slumping")}</SelectItem>
                  <SelectItem value="Tilting trees/poles" className="text-xs font-mono">{t("field_observation.signs_tilting", "Tilting trees/poles")}</SelectItem>
                  <SelectItem value="Rockfall debris" className="text-xs font-mono">{t("field_observation.signs_rockfall", "Rockfall debris")}</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="grid gap-1.5">
              <Label htmlFor="roadStatus" className="text-xs font-mono uppercase text-muted-foreground">
                {t("field_observation.road_label", "Road Connectivity")}
              </Label>
              <Select
                value={roadStatus}
                onValueChange={(v) => setRoadStatus(v as "open" | "restricted" | "blocked" | "unknown")}
              >
                <SelectTrigger id="roadStatus" aria-label={t("field_observation.road_label", "Road Connectivity")} className="bg-secondary/40 border-border font-mono text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-surface border-border">
                  <SelectItem value="open" className="text-xs font-mono">{t("field_observation.road_open", "Open / Clear")}</SelectItem>
                  <SelectItem value="restricted" className="text-xs font-mono">{t("field_observation.road_restricted", "Restricted / 1-Way")}</SelectItem>
                  <SelectItem value="blocked" className="text-xs font-mono">{t("field_observation.road_blocked", "Blocked / Impassable")}</SelectItem>
                  <SelectItem value="unknown" className="text-xs font-mono">{t("field_observation.road_unknown", "Unknown")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* 3. Geo-Tagged Media Upload (Photos/Videos) - Hidden when disabled */}
          {mediaUploadEnabled && (
            <div className="rounded border border-border bg-secondary/20 p-3 space-y-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="fieldMediaUploadInput" className="text-xs font-mono uppercase text-muted-foreground">
                  {t("field_observation.media_title", "Field Media (Photos / Video)")}
                </Label>
                <span className="text-[0.65rem] font-mono text-muted-foreground">
                  {t("field_observation.media_limit", "Max 3 files (Photos ≤10MB, Videos ≤50MB)")}
                </span>
              </div>

              <div className="flex gap-2">
                <Input
                  id="fieldMediaUploadInput"
                  aria-label={t("field_observation.media_title", "Field Media (Photos / Video)")}
                  type="file"
                  accept="image/*,video/*"
                  multiple
                  disabled={submitting || mediaList.length >= 3}
                  onChange={handleFileSelect}
                  className="bg-secondary/40 border-border font-mono text-xs file:font-mono file:text-xs file:bg-primary/20 file:text-primary file:border-0 file:rounded cursor-pointer flex-1"
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  aria-label={t("field_observation.camera_button", "📷 Camera")}
                  disabled={submitting || mediaList.length >= 3}
                  onClick={handleNativeCameraCapture}
                  className="font-mono text-xs shrink-0"
                  title={t("field_observation.camera_title", "Capture photo using device camera or gallery")}
                >
                  {t("field_observation.camera_button", "📷 Camera")}
                </Button>
              </div>

              {fileError && <p className="text-[0.7rem] text-destructive font-mono">{fileError}</p>}

              {mediaList.length > 0 && (
                <div className="flex flex-wrap gap-2 pt-1">
                  {mediaList.map((item, idx) => {
                    const isImg = item.mimeType.startsWith("image/");
                    const sizeStr =
                      item.size > 1024 * 1024
                        ? `${(item.size / (1024 * 1024)).toFixed(1)} MB`
                        : `${Math.round(item.size / 1024)} KB`;
                    const typeLabel =
                      item.mimeType.split("/")[1]?.toUpperCase() || (isImg ? "IMAGE" : "VIDEO");

                    return (
                      <div
                        key={idx}
                        className="relative group border border-border rounded overflow-hidden bg-surface flex items-center gap-2 p-1.5 pr-2.5"
                      >
                        {isImg ? (
                          <img
                            src={item.previewUrl}
                            alt={item.name}
                            className="h-11 w-11 object-cover rounded"
                          />
                        ) : (
                          <div className="h-11 w-11 flex flex-col items-center justify-center bg-primary/20 text-xs rounded">
                            <span className="text-base">🎬</span>
                          </div>
                        )}
                        <div className="flex flex-col text-left font-mono text-[0.68rem] min-w-0 max-w-[150px]">
                          <span className="truncate font-semibold text-foreground" title={item.name}>
                            {item.name}
                          </span>
                          <span className="text-[0.62rem] text-muted-foreground">
                            {typeLabel} • {sizeStr}
                          </span>
                        </div>
                        <button
                          type="button"
                          aria-label={`Remove media ${item.name}`}
                          onClick={() => removeMedia(idx)}
                          className="text-muted-foreground hover:text-destructive text-sm font-bold ml-auto px-1 cursor-pointer"
                          title="Remove"
                        >
                          ×
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* 4. GPS Geolocation Capture */}
          <div className="flex items-center justify-between rounded border border-border/70 bg-secondary/10 px-3 py-2">
            <div className="space-y-0.5">
              <div className="text-xs font-mono uppercase text-muted-foreground">{t("field_observation.gps_label", "GPS Location")}</div>
              <div className="text-[0.7rem] font-mono text-foreground">
                {gpsStatus || t("field_observation.gps_not_captured", "Not captured yet")}
              </div>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              aria-label={geoLat ? t("field_observation.recapture_gps", "📍 Recapture GPS") : t("field_observation.capture_gps", "📍 Capture GPS")}
              onClick={captureGps}
              className="font-mono text-[0.7rem] h-7 px-2"
            >
              {geoLat ? t("field_observation.recapture_gps", "📍 Recapture GPS") : t("field_observation.capture_gps", "📍 Capture GPS")}
            </Button>
          </div>

          {/* 5. Mandatory Consent Checkbox Gate for Media Submissions */}
          {mediaList.length > 0 ? (
            <div className="flex items-start space-x-2.5 rounded border border-primary/40 bg-primary/10 p-2.5">
              <input
                type="checkbox"
                id="mediaConsentCheckbox"
                checked={consentChecked}
                onChange={(e) => setConsentChecked(e.target.checked)}
                className="mt-0.5 h-4 w-4 rounded border-border text-primary focus:ring-primary cursor-pointer accent-primary"
              />
              <Label
                htmlFor="mediaConsentCheckbox"
                className="text-[0.72rem] text-foreground leading-relaxed cursor-pointer font-sans select-none"
              >
                {t("field_observation.consent_media", "I understand this photo/video and location may be reviewed by authorities and shown publicly once approved.")}
              </Label>
            </div>
          ) : (
            <p className="text-[0.68rem] text-muted-foreground leading-relaxed italic border-l-2 border-primary/50 pl-2">
              {t("field_observation.notice_numerical", "Notice: Numerical rainfall and road condition observations are routed immediately to the regional early warning engine.")}
            </p>
          )}

          <div className="grid gap-1.5">
            <Label htmlFor="observerInput" className="text-xs font-mono uppercase text-muted-foreground">
              {t("field_observation.observer_label", "Observer Identity / Station")}
            </Label>
            <Input
              id="observerInput"
              type="text"
              placeholder={t("field_observation.observer_placeholder", "e.g. DDMA Field Team / Citizen Observer")}
              value={observerId}
              onChange={(e) => {
                setObserverId(e.target.value);
                setFieldErrors((prev) => ({ ...prev, observer: undefined, general: undefined }));
              }}
              className="bg-secondary/40 border-border font-mono text-xs"
            />
            {fieldErrors.observer && (
              <p className="text-[0.68rem] text-red-500 font-mono">{fieldErrors.observer}</p>
            )}
          </div>

          <DialogFooter className="mt-4 flex items-center justify-between sm:justify-between pt-2 border-t border-border">
            <div className="flex items-center gap-1.5 font-mono text-[0.68rem] text-muted-foreground">
              <span
                className={`h-2 w-2 rounded-full ${
                  connectivityState === "api_reachable"
                    ? "bg-emerald-400"
                    : connectivityState === "api_unavailable"
                    ? "bg-amber-400"
                    : "bg-blue-400"
                }`}
              />
              <span>
                {connectivityState === "api_reachable"
                  ? t("field_observation.status_online", "Online (Direct API)")
                  : connectivityState === "api_unavailable"
                  ? t("field_observation.status_api_down", "API Unavailable (Will Queue Offline)")
                  : t("field_observation.status_offline", "Offline (Local Queue)")}
              </span>
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
                {t("field_observation.cancel", "Cancel")}
              </Button>
              <Button
                type="submit"
                size="sm"
                disabled={submitting || (mediaList.length > 0 && !consentChecked)}
                className="font-mono text-xs uppercase"
              >
                {submitting
                  ? t("field_observation.submitting", "Submitting…")
                  : connectivityState === "api_reachable"
                  ? t("field_observation.submit_report", "Submit Report")
                  : t("field_observation.queue_offline", "Queue Offline")}
              </Button>
            </div>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
