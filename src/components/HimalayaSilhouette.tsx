export function HimalayaSilhouette({ className = "w-full h-full" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 1200 320"
      preserveAspectRatio="none"
      className={className}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <defs>
        <linearGradient id="mtnGradFar" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="currentColor" stopOpacity="0.10" />
          <stop offset="100%" stopColor="currentColor" stopOpacity="0.01" />
        </linearGradient>
        <linearGradient id="mtnGradMid" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="currentColor" stopOpacity="0.16" />
          <stop offset="100%" stopColor="currentColor" stopOpacity="0.02" />
        </linearGradient>
        <linearGradient id="mtnGradFore" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="currentColor" stopOpacity="0.22" />
          <stop offset="100%" stopColor="currentColor" stopOpacity="0.04" />
        </linearGradient>
      </defs>

      {/* Distant High Himalayan Peaks */}
      <path
        d="M0 260 L90 200 L180 230 L320 140 L440 190 L590 80 L720 170 L860 110 L990 190 L1100 130 L1200 180 L1200 320 L0 320 Z"
        fill="url(#mtnGradFar)"
      />
      {/* Distant Ridges */}
      <path
        d="M590 80 L570 160 L500 220 M590 80 L640 170 L690 240 M860 110 L820 180 L760 250 M320 140 L300 190 L240 250"
        stroke="currentColor"
        strokeWidth="1"
        strokeOpacity="0.15"
      />

      {/* Mid-range Ridge Line */}
      <path
        d="M0 280 L140 220 L270 260 L410 180 L540 230 L660 150 L790 220 L930 160 L1060 220 L1200 190 L1200 320 L0 320 Z"
        fill="url(#mtnGradMid)"
      />
      <path
        d="M660 150 L640 210 L590 280 M660 150 L710 220 M410 180 L380 240 L340 290 M930 160 L890 230"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeOpacity="0.20"
      />

      {/* Foreground Rolling North-East Hill Slopes */}
      <path
        d="M0 300 C150 290 250 250 400 260 C550 270 650 220 800 240 C950 260 1080 210 1200 230 L1200 320 L0 320 Z"
        fill="url(#mtnGradFore)"
      />
    </svg>
  );
}
