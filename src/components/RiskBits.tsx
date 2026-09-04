import { riskBadgeClass, roadStatusClass } from "@/lib/risk";
import { cn } from "@/lib/utils";

export function RiskBadge({
  level,
  score,
  className,
}: {
  level: string;
  score?: number | undefined;
  className?: string | undefined;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded border px-2 py-0.5 font-display text-xs uppercase tracking-widest",
        riskBadgeClass(level),
        className,
      )}
    >
      {level}
      {score !== undefined && <span className="font-mono text-[0.65rem] opacity-80">{score}</span>}
    </span>
  );
}

export function RoadBadge({ status }: { status: string }) {
  return (
    <span
      className={cn(
        "inline-flex rounded border px-2 py-0.5 font-mono text-[0.7rem] uppercase",
        roadStatusClass(status),
      )}
    >
      {status}
    </span>
  );
}

export function Stat({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: string | number;
  hint?: string | undefined;
  tone?: string | undefined;
}) {
  return (
    <div className="panel p-4">
      <div className="label-caps">{label}</div>
      <div
        className="mt-1 font-display text-3xl leading-none"
        style={tone ? { color: tone } : undefined}
      >
        {value}
      </div>
      {hint && <div className="mt-1 text-xs text-muted-foreground">{hint}</div>}
    </div>
  );
}

export function ExplanationCard({
  explanation,
  title = "Why this fired",
}: {
  explanation: string | null;
  title?: string;
}) {
  if (!explanation) return null;
  return (
    <div className="rounded-lg border border-primary/35 bg-primary/5 p-4">
      <div className="label-caps text-primary">{title}</div>
      <p className="mt-2 font-mono text-[0.8rem] leading-relaxed text-foreground/90">
        {explanation}
      </p>
    </div>
  );
}
