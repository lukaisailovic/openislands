interface BrandmarkProps {
  className?: string;
}

// The accent tile carries the OpenIslands tide-teal (the same #2dd4bf the docs
// use as their accent); the other tiles inherit currentColor so the mark recolors
// with whatever text color its container sets.
const ACCENT = "#2dd4bf";

export function Brandmark({ className }: BrandmarkProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className={className}>
      <rect x="3" y="3" width="10" height="10" rx="2.6" fill="currentColor" />
      <rect x="14.8" y="3" width="6.2" height="10" rx="2.2" fill="currentColor" />
      <rect x="3" y="14.8" width="10" height="6.2" rx="2.2" fill="currentColor" />
      <rect x="14.8" y="14.8" width="6.2" height="6.2" rx="2" fill={ACCENT} />
    </svg>
  );
}
