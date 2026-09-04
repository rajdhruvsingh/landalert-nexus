import { useState } from "react";
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
import { useOnlineStatus, queueObservation, syncOfflineObservations } from "@/lib/offline-manager";
import { submitFieldObservationsServerFn } from "@/lib/monitoring.functions";
import type { FieldObservationInput } from "@/lib/sync.service";

interface Props {
  initialZoneId?: number;
  trigger?: React.ReactNode;
  onSuccess?: () => void;
}

const ZONES_LIST = [
  { id: 1, name: "East Sikkim (Gangtok)" },
  { id: 2, name: "South Sikkim (Namchi)" },
  { id: 3, name: "North Sikkim (Mangan)" },
  { id: 4, name: "West Sikkim (Gyalshing)" },
  { id: 5, name: "Darjeeling Hill Area" },
  { id: 6, name: "Kalimpong Sub-Division" },
  { id: 7, name: "East Khasi Hills (Cherrapunji)" },
  { id: 8, name: "West Khasi Hills (Nongstoin)" },
  { id: 9, name: "Aizawl District" },
  { id: 10, name: "Lunglei District" },
  { id: 11, name: "Kohima District" },
  { id: 12, name: "Wokha District" },
  { id: 13, name: "Papum Pare (Itanagar)" },
  { id: 14, name: "West Kameng (Bomdila)" },
  { id: 15, name: "Dima Hasao (Haflong)" },
];

export function FieldObservationDialog({ initialZoneId, trigger, onSuccess }: Props) {
  const [open, setOpen] = useState(false);
  const isOnline = useOnlineStatus();

  const [zoneId, setZoneId] = useState<number>(initialZoneId ?? 1);
  const [rainfallMm, setRainfallMm] = useState<string>("");
  const [soilCondition, setSoilCondition] = useState<string>("damp");
  const [visualSigns, setVisualSigns] = useState<string>("None");
  const [roadStatus, setRoadStatus] = useState<"open" | "restricted" | "blocked" | "unknown">(
    "open",
  );
  const [observerId, setObserverId] = useState<string>("field_operator_ner");

  const [submitting, setSubmitting] = useState(false);
  const [statusMessage, setStatusMessage] = useState<{
    type: "success" | "error" | "offline";
    text: string;
  } | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setStatusMessage(null);

    const record: Omit<FieldObservationInput, "idempotency_key" | "client_timestamp"> = {
      zone_id: zoneId,
      observed_at: new Date().toISOString(),
      rainfall_mm: rainfallMm ? Number(rainfallMm) : undefined,
      soil_condition: soilCondition,
      visual_signs: visualSigns === "None" ? undefined : visualSigns,
      road_status: roadStatus,
      observer_id: observerId.trim() || "citizen_observer",
    };

    try {
      if (!isOnline) {
        // Offline: save to local queue
        queueObservation(record);
        setStatusMessage({
          type: "offline",
          text: "Device is offline. Observation queued locally and will sync automatically upon reconnection.",
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
          setStatusMessage({
            type: "success",
            text: `Observation for Zone ${zoneId} submitted and synced successfully.`,
          });
          setTimeout(() => {
            setOpen(false);
            setStatusMessage(null);
            onSuccess?.();
          }, 1500);
        } else {
          // If server reported partial or error, fallback to queue
          setStatusMessage({
            type: "error",
            text: res.errors?.[0] || "Server sync failed; queued locally for automatic retry.",
          });
        }
      }
    } catch (err) {
      console.error("Submission failed:", err);
      // Ensure record is queued locally
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
      <DialogContent className="sm:max-w-[480px] bg-surface text-foreground border-border">
        <DialogHeader>
          <DialogTitle className="text-xl font-display uppercase tracking-wide">
            Submit Field Observation
          </DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground">
            Feed direct ground-truth measurements into the NER early warning system. Offline
            submissions are queued securely on this device.
          </DialogDescription>
        </DialogHeader>

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

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid gap-2">
            <Label
              htmlFor="zoneSelect"
              className="text-xs font-mono uppercase text-muted-foreground"
            >
              Monitored Zone
            </Label>
            <Select value={String(zoneId)} onValueChange={(v) => setZoneId(Number(v))}>
              <SelectTrigger
                id="zoneSelect"
                className="bg-secondary/40 border-border font-mono text-xs"
              >
                <SelectValue placeholder="Select Zone" />
              </SelectTrigger>
              <SelectContent className="bg-surface border-border max-h-60">
                {ZONES_LIST.map((z) => (
                  <SelectItem key={z.id} value={String(z.id)} className="text-xs font-mono">
                    Zone {z.id}: {z.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-2">
              <Label
                htmlFor="rainInput"
                className="text-xs font-mono uppercase text-muted-foreground"
              >
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

            <div className="grid gap-2">
              <Label
                htmlFor="soilCondition"
                className="text-xs font-mono uppercase text-muted-foreground"
              >
                Soil Condition
              </Label>
              <Select value={soilCondition} onValueChange={setSoilCondition}>
                <SelectTrigger
                  id="soilCondition"
                  className="bg-secondary/40 border-border font-mono text-xs"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-surface border-border">
                  <SelectItem value="dry" className="text-xs font-mono">
                    Dry / Stable
                  </SelectItem>
                  <SelectItem value="damp" className="text-xs font-mono">
                    Damp
                  </SelectItem>
                  <SelectItem value="saturated" className="text-xs font-mono">
                    Saturated / Soft
                  </SelectItem>
                  <SelectItem value="waterlogged" className="text-xs font-mono">
                    Waterlogged / Seepage
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-2">
              <Label
                htmlFor="visualSigns"
                className="text-xs font-mono uppercase text-muted-foreground"
              >
                Visual Slope Signs
              </Label>
              <Select value={visualSigns} onValueChange={setVisualSigns}>
                <SelectTrigger
                  id="visualSigns"
                  className="bg-secondary/40 border-border font-mono text-xs"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-surface border-border">
                  <SelectItem value="None" className="text-xs font-mono">
                    None observed
                  </SelectItem>
                  <SelectItem value="Tension cracks on slope" className="text-xs font-mono">
                    Tension cracks
                  </SelectItem>
                  <SelectItem value="Mudflow / Slumping" className="text-xs font-mono">
                    Mudflow / Slumping
                  </SelectItem>
                  <SelectItem value="Tilting trees/poles" className="text-xs font-mono">
                    Tilting trees/poles
                  </SelectItem>
                  <SelectItem value="Rockfall debris" className="text-xs font-mono">
                    Rockfall debris
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="grid gap-2">
              <Label
                htmlFor="roadStatus"
                className="text-xs font-mono uppercase text-muted-foreground"
              >
                Passability / Road
              </Label>
              <Select
                value={roadStatus}
                onValueChange={(v) =>
                  setRoadStatus(v as "open" | "restricted" | "blocked" | "unknown")
                }
              >
                <SelectTrigger
                  id="roadStatus"
                  className="bg-secondary/40 border-border font-mono text-xs"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-surface border-border">
                  <SelectItem value="open" className="text-xs font-mono">
                    Open / Clear
                  </SelectItem>
                  <SelectItem value="restricted" className="text-xs font-mono">
                    Restricted / 1-Way
                  </SelectItem>
                  <SelectItem value="blocked" className="text-xs font-mono">
                    Blocked / Impassable
                  </SelectItem>
                  <SelectItem value="unknown" className="text-xs font-mono">
                    Unknown
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid gap-2">
            <Label
              htmlFor="observerInput"
              className="text-xs font-mono uppercase text-muted-foreground"
            >
              Observer Identity / Station
            </Label>
            <Input
              id="observerInput"
              type="text"
              placeholder="e.g. DDMA Field Team Aizawl"
              value={observerId}
              onChange={(e) => setObserverId(e.target.value)}
              className="bg-secondary/40 border-border font-mono text-xs"
            />
          </div>

          <DialogFooter className="mt-6 flex items-center justify-between sm:justify-between">
            <div className="flex items-center gap-1.5 font-mono text-[0.68rem] text-muted-foreground">
              <span
                className={`h-2 w-2 rounded-full ${isOnline ? "bg-emerald-400" : "bg-blue-400"}`}
              />
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
