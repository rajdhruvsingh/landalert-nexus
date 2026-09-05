export function IndiaEmblem({ className = "h-10 w-10" }: { className?: string }) {
  return (
    <img
      src="/emblem-of-india.svg"
      alt="State Emblem of India"
      className={`${className} object-contain dark:invert dark:brightness-150`}
      loading="eager"
      width={40}
      height={50}
    />
  );
}

