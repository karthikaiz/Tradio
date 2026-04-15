"use client";

interface LiveDotProps {
  className?: string;
}

export default function LiveDot({ className = "" }: LiveDotProps) {
  return (
    <span
      className={`live-dot flex-shrink-0 ${className}`}
      aria-label="Live"
    />
  );
}
