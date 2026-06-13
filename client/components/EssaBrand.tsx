"use client";

import { useId } from "react";

type MarkProps = {
  size?: number;
  className?: string;
  style?: React.CSSProperties;
};

function sanitize(id: string) {
  return id.replace(/:/g, "_");
}

function GoldGrad({ id }: { id: string }) {
  return (
    <linearGradient id={id} gradientUnits="userSpaceOnUse" x1="30" y1="14" x2="70" y2="90">
      <stop offset="0"    stopColor="#F6E3AE" />
      <stop offset="0.42" stopColor="#E3C076" />
      <stop offset="0.74" stopColor="#C99C4C" />
      <stop offset="1"    stopColor="#F0D596" />
    </linearGradient>
  );
}

function GoldGradSoft({ id }: { id: string }) {
  return (
    <linearGradient id={id} gradientUnits="userSpaceOnUse" x1="30" y1="14" x2="70" y2="90">
      <stop offset="0" stopColor="#E9CC8A" />
      <stop offset="1" stopColor="#C49A4A" />
    </linearGradient>
  );
}

export function Signet({ size = 100, className, style }: MarkProps) {
  const raw = useId();
  const id  = sanitize(raw);
  const g   = `${id}_g`;
  const m   = `${id}_m`;
  return (
    <svg viewBox="0 0 100 100" width={size} height={size} className={className} style={style} aria-hidden>
      <defs>
        <GoldGrad id={g} />
        <mask id={m}>
          <rect x="14" y="14" width="72" height="72" rx="21" fill="#fff" />
          <text x="50" y="53" textAnchor="middle" dominantBaseline="central"
            fontFamily="Spectral,Georgia,serif" fontWeight="700" fontSize="50" fill="#000">E</text>
        </mask>
      </defs>
      <rect x="14" y="14" width="72" height="72" rx="21" fill={`url(#${g})`} mask={`url(#${m})`} />
      <rect x="14.9" y="14.9" width="70.2" height="70.2" rx="20.2"
        fill="none" stroke="#fff" strokeOpacity=".18" strokeWidth="1" />
    </svg>
  );
}

export function Sovereign({ size = 100, className, style }: MarkProps) {
  const raw = useId();
  const id  = sanitize(raw);
  const g   = `${id}_g`;
  const gs  = `${id}_gs`;
  return (
    <svg viewBox="0 0 100 100" width={size} height={size} className={className} style={style} aria-hidden>
      <defs>
        <GoldGrad id={g} />
        <GoldGradSoft id={gs} />
      </defs>
      <circle cx="50" cy="50" r="38" fill="#0A1712" stroke={`url(#${g})`} strokeWidth="3.4" />
      <circle cx="50" cy="50" r="31.5" fill="none" stroke={`url(#${gs})`} strokeWidth="1" opacity=".7" />
      <text x="50" y="52" textAnchor="middle" dominantBaseline="central"
        fontFamily="Spectral,Georgia,serif" fontWeight="700" fontSize="44" fill={`url(#${g})`}>E</text>
    </svg>
  );
}

export function Cartouche({ size = 100, className, style }: MarkProps) {
  const raw = useId();
  const id  = sanitize(raw);
  const g   = `${id}_g`;
  const m   = `${id}_m`;
  return (
    <svg viewBox="0 0 100 100" width={size} height={size} className={className} style={style} aria-hidden>
      <defs>
        <GoldGrad id={g} />
        <mask id={m}>
          <rect x="26" y="11" width="48" height="78" rx="24" fill="#fff" />
          <text x="50" y="52" textAnchor="middle" dominantBaseline="central"
            fontFamily="Spectral,Georgia,serif" fontWeight="700" fontSize="46" fill="#000">E</text>
        </mask>
      </defs>
      <rect x="26" y="11" width="48" height="78" rx="24" fill={`url(#${g})`} mask={`url(#${m})`} />
    </svg>
  );
}

export function Crest({ size = 100, className, style }: MarkProps) {
  const raw = useId();
  const id  = sanitize(raw);
  const g   = `${id}_g`;
  const m   = `${id}_m`;
  return (
    <svg viewBox="0 0 100 100" width={size} height={size} className={className} style={style} aria-hidden>
      <defs>
        <GoldGrad id={g} />
        <mask id={m}>
          <path d="M50 13 L83 24 V52 C83 71 67 83 50 89 C33 83 17 71 17 52 V24 Z" fill="#fff" />
          <text x="50" y="50" textAnchor="middle" dominantBaseline="central"
            fontFamily="Spectral,Georgia,serif" fontWeight="700" fontSize="40" fill="#000">E</text>
        </mask>
      </defs>
      <path d="M50 13 L83 24 V52 C83 71 67 83 50 89 C33 83 17 71 17 52 V24 Z"
        fill={`url(#${g})`} mask={`url(#${m})`} />
    </svg>
  );
}

export function Facet({ size = 100, className, style }: MarkProps) {
  const raw = useId();
  const id  = sanitize(raw);
  const g   = `${id}_g`;
  const m   = `${id}_m`;
  return (
    <svg viewBox="0 0 100 100" width={size} height={size} className={className} style={style} aria-hidden>
      <defs>
        <GoldGrad id={g} />
        <mask id={m}>
          <path d="M50 11 L85 31.5 V72.5 L50 89 L15 72.5 V31.5 Z" fill="#fff" />
          <text x="50" y="52" textAnchor="middle" dominantBaseline="central"
            fontFamily="Spectral,Georgia,serif" fontWeight="700" fontSize="46" fill="#000">E</text>
        </mask>
      </defs>
      <path d="M50 11 L85 31.5 V72.5 L50 89 L15 72.5 V31.5 Z"
        fill={`url(#${g})`} mask={`url(#${m})`} />
    </svg>
  );
}

export function Nameplate({ size = 100, className, style }: MarkProps) {
  const raw = useId();
  const id  = sanitize(raw);
  const g   = `${id}_g`;
  const m   = `${id}_m`;
  return (
    <svg viewBox="0 0 100 100" width={size} height={size} className={className} style={style} aria-hidden>
      <defs>
        <GoldGrad id={g} />
        <mask id={m}>
          <rect x="9" y="35" width="82" height="30" rx="9" fill="#fff" />
          <text x="50" y="51" textAnchor="middle" dominantBaseline="central"
            fontFamily="Spectral,Georgia,serif" fontWeight="700" fontSize="19" letterSpacing="2.5" fill="#000">ESSA</text>
        </mask>
      </defs>
      <rect x="9" y="35" width="82" height="30" rx="9" fill={`url(#${g})`} mask={`url(#${m})`} />
    </svg>
  );
}
