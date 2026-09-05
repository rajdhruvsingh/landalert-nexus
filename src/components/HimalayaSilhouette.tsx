export function HimalayaSilhouette({ className = "w-full h-full" }: { className?: string }) {
  return (
    <img
      src="/himalaya-hero-trans.png"
      alt=""
      aria-hidden="true"
      className={`${className} object-contain pointer-events-none select-none`}
      loading="eager"
    />
  );
}
