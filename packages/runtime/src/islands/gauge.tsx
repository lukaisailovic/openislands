import { useEffect, useState } from "react";

export const SIZE = 200;
export const CENTER = SIZE / 2;
export const FILL_MS = 700;
export const EASE_OUT = "cubic-bezier(0.22, 1, 0.36, 1)";

export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(mq.matches);
    const onChange = (e: MediaQueryListEvent) => setReduced(e.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  return reduced;
}

/** True one frame after mount, so a ring transitions from empty to filled. */
export function useMountedFill(): boolean {
  const [filled, setFilled] = useState(false);
  useEffect(() => {
    const frame = requestAnimationFrame(() => setFilled(true));
    return () => cancelAnimationFrame(frame);
  }, []);
  return filled;
}

interface GaugeRingProps {
  radius: number;
  stroke: number;
  color: string;
  /** 0–1 fraction of the ring to fill. */
  fraction: number;
  /** Whether the fill is rendered (false during the from-empty mount frame). */
  filled: boolean;
  transition?: string;
}

/** A background track plus its rotated foreground fill — the shared gauge arc. */
export function GaugeRing({ radius, stroke, color, fraction, filled, transition }: GaugeRingProps) {
  const circumference = 2 * Math.PI * radius;
  return (
    <g transform={`rotate(-90 ${CENTER} ${CENTER})`}>
      <circle
        cx={CENTER}
        cy={CENTER}
        r={radius}
        fill="none"
        stroke={color}
        strokeOpacity={0.18}
        strokeWidth={stroke}
      />
      <circle
        cx={CENTER}
        cy={CENTER}
        r={radius}
        fill="none"
        stroke={color}
        strokeWidth={stroke}
        strokeLinecap="round"
        strokeDasharray={circumference}
        strokeDashoffset={filled ? circumference * (1 - fraction) : circumference}
        style={{ transition }}
      />
    </g>
  );
}
