import { Link } from "@tanstack/react-router";

export function ConsoleNav() {
  return (
    <nav className="sticky top-0 z-[1000] border-b border-border bg-background/90 backdrop-blur">
      <div className="mx-auto flex max-w-[1600px] flex-wrap items-center justify-between gap-3 px-4 py-2.5 lg:px-8">
        <Link to="/" className="flex items-center gap-2">
          <span className="inline-block h-2.5 w-2.5 rounded-sm bg-risk-severe" />
          <span className="font-display text-sm uppercase tracking-[0.2em]">
            NER Landslide Console
          </span>
        </Link>
        <div className="flex items-center gap-1">
          <NavLink to="/" label="Risk console" />
          <NavLink to="/alerts" label="Alert log" />
        </div>
      </div>
    </nav>
  );
}

function NavLink({ to, label }: { to: "/" | "/alerts"; label: string }) {
  return (
    <Link
      to={to}
      activeOptions={{ exact: to === "/" }}
      className="rounded px-3 py-1.5 font-mono text-xs uppercase tracking-wider text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground [&.active]:bg-primary/15 [&.active]:text-primary"
    >
      {label}
    </Link>
  );
}

export function PanelSkeleton({ label = "Loading zone data…" }: { label?: string }) {
  return (
    <div className="mx-auto max-w-[1600px] px-4 py-10 lg:px-8">
      <div className="label-caps animate-pulse">{label}</div>
      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div
            key={i}
            className="h-24 animate-pulse rounded-lg border border-border bg-secondary/40"
          />
        ))}
      </div>
      <div className="mt-4 h-[420px] animate-pulse rounded-lg border border-border bg-secondary/30" />
    </div>
  );
}

export function RouteError({ error, reset }: { error: Error; reset?: () => void }) {
  return (
    <div className="mx-auto max-w-xl px-4 py-20 text-center lg:px-8">
      <div className="label-caps text-risk-severe">Data feed error</div>
      <h1 className="mt-2 text-2xl font-semibold uppercase tracking-wide">
        Monitoring data could not be loaded
      </h1>
      <p className="mt-2 font-mono text-xs text-muted-foreground">{error.message}</p>
      <div className="mt-6 flex justify-center gap-2">
        {reset && (
          <button
            onClick={reset}
            className="rounded border border-primary/50 bg-primary/15 px-4 py-2 font-mono text-xs uppercase tracking-wider text-primary"
          >
            Retry
          </button>
        )}
        <Link
          to="/"
          className="rounded border border-border px-4 py-2 font-mono text-xs uppercase tracking-wider text-muted-foreground hover:bg-secondary"
        >
          Back to console
        </Link>
      </div>
    </div>
  );
}
