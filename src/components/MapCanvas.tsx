import { lazy, Suspense, useEffect, useState, type ComponentProps } from "react";

const RiskMap = lazy(() => import("./RiskMap"));

type Props = ComponentProps<typeof RiskMap>;

export function MapCanvas(props: Props) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  if (!mounted) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-surface">
        <span className="label-caps animate-pulse">Loading terrain layer…</span>
      </div>
    );
  }

  return (
    <Suspense
      fallback={
        <div className="flex h-full w-full items-center justify-center bg-surface">
          <span className="label-caps animate-pulse">Loading terrain layer…</span>
        </div>
      }
    >
      <RiskMap {...props} />
    </Suspense>
  );
}
