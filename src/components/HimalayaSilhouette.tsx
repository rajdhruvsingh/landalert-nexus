export function HimalayaSilhouette({ className = "w-full h-full" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 1200 300"
      preserveAspectRatio="none"
      className={className}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <defs>
        <linearGradient id="mtnGradLight" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="currentColor" stopOpacity="0.14" />
          <stop offset="100%" stopColor="currentColor" stopOpacity="0.02" />
        </linearGradient>
        <linearGradient id="mtnGradFront" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="currentColor" stopOpacity="0.22" />
          <stop offset="100%" stopColor="currentColor" stopOpacity="0.04" />
        </linearGradient>
      </defs>

      {/* Far peaks */}
      <path
        d="M0 240 L120 180 L220 220 L380 120 L480 170 L620 60 L780 160 L890 90 L1020 180 L1120 130 L1200 170 L1200 300 L0 300 Z"
        fill="url(#mtnGradLight)"
      />
      {/* Ridge lines */}
      <path
        d="M620 60 L600 140 L530 200 M620 60 L670 150 L720 220 M890 90 L850 160 L780 230 M380 120 L350 180 L290 240"
        stroke="currentColor"
        strokeWidth="1"
        strokeOpacity="0.2"
      />

      {/* Mid/Front peaks */}
      <path
        d="M0 270 L160 210 L310 250 L460 180 L590 220 L710 140 L840 210 L990 150 L1110 210 L1200 180 L1200 300 L0 300 Z"
        fill="url(#mtnGradFront)"
      />
      <path
        d="M710 140 L690 200 L640 260 M710 140 L760 210 M460 180 L430 230 L390 280 M990 150 L950 220"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeOpacity="0.25"
      />
    </svg>
  );
}
