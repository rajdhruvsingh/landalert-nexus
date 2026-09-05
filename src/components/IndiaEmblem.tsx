export function IndiaEmblem({ className = "h-10 w-10" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 100 120"
      className={className}
      fill="currentColor"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      {/* Three Lions Silhouette */}
      {/* Central Lion Head */}
      <circle cx="50" cy="22" r="12" />
      <path d="M46 10 C46 5 54 5 54 10 Z" />
      {/* Mane & Shoulders */}
      <path d="M40 24 C34 32 36 48 50 48 C64 48 66 32 60 24 Z" />
      {/* Left Lion Head & Mane */}
      <circle cx="34" cy="26" r="9" />
      <path d="M30 18 C28 12 36 14 36 18 Z" />
      <path d="M26 30 C22 38 28 46 36 46 C34 40 33 34 35 28 Z" />
      {/* Right Lion Head & Mane */}
      <circle cx="66" cy="26" r="9" />
      <path d="M70 18 C72 12 64 14 64 18 Z" />
      <path d="M74 30 C78 38 72 46 64 46 C66 40 67 34 65 28 Z" />
      {/* Paws and Chest Pillars */}
      <rect x="36" y="47" width="8" height="20" rx="3" />
      <rect x="46" y="47" width="8" height="20" rx="3" />
      <rect x="56" y="47" width="8" height="20" rx="3" />
      {/* Abacus / Capital Platform */}
      <rect x="20" y="69" width="60" height="7" rx="2" />
      {/* Central Ashoka Chakra */}
      <circle cx="50" cy="72.5" r="3.5" fill="none" stroke="var(--background)" strokeWidth="1" />
      <circle cx="50" cy="72.5" r="0.8" fill="var(--background)" />
      {/* Galloping Horse (Left) and Bull (Right) reliefs */}
      <ellipse cx="32" cy="72.5" rx="4" ry="2" />
      <ellipse cx="68" cy="72.5" rx="4" ry="2" />
      {/* Lower Platform / Base Band */}
      <rect x="25" y="77" width="50" height="4" rx="1.5" />
      {/* Bell-shaped Inverted Lotus Base */}
      <path d="M28 82 C32 94 68 94 72 82 Z" />
      <line x1="40" y1="83" x2="40" y2="92" stroke="var(--background)" strokeWidth="1" />
      <line x1="50" y1="83" x2="50" y2="93" stroke="var(--background)" strokeWidth="1" />
      <line x1="60" y1="83" x2="60" y2="92" stroke="var(--background)" strokeWidth="1" />
      {/* Sub-pedestal */}
      <rect x="22" y="94" width="56" height="4" rx="1" />
      <rect x="18" y="99" width="64" height="3" rx="1" />
      {/* Satyameva Jayate Motto Bar */}
      <rect x="26" y="104" width="48" height="2.5" rx="1" opacity="0.8" />
    </svg>
  );
}
