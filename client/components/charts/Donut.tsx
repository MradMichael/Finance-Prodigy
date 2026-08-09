"use client";

export interface DonutSegment {
  value: number;
  color: string;
  label: string;
}

/**
 * Dependency-free SVG donut chart via stroke-dasharray, one arc per
 * segment. Chosen over a charting library for the same reason printReport
 * avoided one for PDFs: this app only ever needs a handful of simple,
 * on-brand chart shapes, not a general-purpose charting engine.
 */
export default function Donut({
  segments, size = 140, thickness = 20, trackColor, centerLabel, centerSublabel, labelColor,
}: {
  segments: DonutSegment[];
  size?: number;
  thickness?: number;
  trackColor: string;
  centerLabel?: string;
  centerSublabel?: string;
  labelColor: string;
}) {
  const total = segments.reduce((s, x) => s + x.value, 0);
  const r = (size - thickness) / 2;
  const cx = size / 2;
  const cy = size / 2;
  const circumference = 2 * Math.PI * r;

  let offset = 0;
  const arcs = total > 0
    ? segments
        .filter((s) => s.value > 0)
        .map((s) => {
          const frac = s.value / total;
          const dash = frac * circumference;
          const arc = { ...s, dash, gap: circumference - dash, offset };
          offset += dash;
          return arc;
        })
    : [];

  return (
    <div className="relative flex-shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle cx={cx} cy={cy} r={r} fill="none" stroke={trackColor} strokeWidth={thickness} />
        {arcs.map((a, i) => (
          <circle
            key={i}
            cx={cx} cy={cy} r={r} fill="none"
            stroke={a.color} strokeWidth={thickness}
            strokeDasharray={`${a.dash} ${a.gap}`}
            strokeDashoffset={-a.offset}
            transform={`rotate(-90 ${cx} ${cy})`}
            strokeLinecap={arcs.length > 1 ? "butt" : "round"}
          />
        ))}
      </svg>
      {(centerLabel || centerSublabel) && (
        <div className="absolute inset-0 flex flex-col items-center justify-center text-center px-2">
          {centerLabel && <span className="text-base font-medium tabular-nums" style={{ color: labelColor }}>{centerLabel}</span>}
          {centerSublabel && <span className="text-[10px] mt-0.5" style={{ color: labelColor, opacity: 0.7 }}>{centerSublabel}</span>}
        </div>
      )}
    </div>
  );
}
