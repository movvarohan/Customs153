"use client";

// Interactive hub map: a simplified real world landmass backdrop, one origin
// + N destination hubs auto-framed to their bounding box, shipping-lane arcs
// with great-circle distance, and de-collided label pills with leader lines so
// names never overlap. Hovering a hub highlights its lane, enlarges the pin,
// and shows a detail tooltip while dimming the rest.

import { useState } from "react";
import { WORLD_LAND } from "./world-land";

export interface MapPoint {
  lat: number;
  lng: number;
  label: string;
  sub: string;
  feasibility?: "high" | "medium" | "low";
  best?: boolean;
}

const FEAS = (f?: "high" | "medium" | "low") =>
  f === "high" ? "#0ea672" : f === "medium" ? "#3b82f6" : f === "low" ? "#e0922f" : "#3b82f6";

function haversineKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const la1 = (a.lat * Math.PI) / 180;
  const la2 = (b.lat * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(h)));
}

interface Placed {
  p: MapPoint;
  i: number;
  x: number;
  y: number;
  side: "left" | "right";
  labelY: number;
  isOrigin: boolean;
  color: string;
  km: number;
}

export function HubMap({ origin, hubs, height = 380 }: { origin: MapPoint; hubs: MapPoint[]; height?: number }) {
  const [hover, setHover] = useState<number | null>(null);
  const W = 760;
  const H = height;
  const pad = 46;

  const all = [origin, ...hubs];
  const lats = all.map((p) => p.lat);
  const lngs = all.map((p) => p.lng);
  const span = Math.max(Math.max(...lats) - Math.min(...lats), (Math.max(...lngs) - Math.min(...lngs)) * 0.6, 12);
  const cLat = (Math.max(...lats) + Math.min(...lats)) / 2;
  const cLng = (Math.max(...lngs) + Math.min(...lngs)) / 2;
  const minLat = cLat - span * 0.55;
  const maxLat = cLat + span * 0.55;
  const minLng = cLng - span * 0.9;
  const maxLng = cLng + span * 0.9;
  const latSpan = maxLat - minLat || 1;
  const lngSpan = maxLng - minLng || 1;

  const px = (lng: number) => pad + ((lng - minLng) / lngSpan) * (W - 2 * pad);
  const py = (lat: number) => pad + ((maxLat - lat) / latSpan) * (H - 2 * pad);

  const ox = px(origin.lng);
  const oy = py(origin.lat);

  const landPaths = WORLD_LAND.map((ring) => "M" + ring.map(([lng, lat]) => `${px(lng).toFixed(1)} ${py(lat).toFixed(1)}`).join(" L") + " Z");

  // Place labels: side away from the frame center, then de-collide vertically
  // within each side so pills never overlap.
  const placed: Placed[] = all.map((p, i) => {
    const x = px(p.lng);
    const y = py(p.lat);
    return {
      p, i, x, y,
      side: x > W / 2 ? "left" : "right",
      labelY: y,
      isOrigin: i === 0,
      color: i === 0 ? "#f5b942" : FEAS(p.feasibility),
      km: i === 0 ? 0 : haversineKm(origin, p),
    };
  });
  const MIN_GAP = 22;
  for (const side of ["left", "right"] as const) {
    const group = placed.filter((q) => q.side === side).sort((a, b) => a.y - b.y);
    for (let k = 1; k < group.length; k++) {
      const cur = group[k];
      const prev = group[k - 1];
      if (cur && prev && cur.labelY - prev.labelY < MIN_GAP) cur.labelY = prev.labelY + MIN_GAP;
    }
    // Keep within frame.
    const last = group[group.length - 1];
    const overflow = (last ? last.labelY : 0) - (H - pad - 6);
    if (overflow > 0) for (const g of group) g.labelY -= overflow;
  }

  const lngTicks: number[] = [];
  for (let g = Math.ceil(minLng / 15) * 15; g < maxLng; g += 15) lngTicks.push(g);
  const latTicks: number[] = [];
  for (let g = Math.ceil(minLat / 10) * 10; g < maxLat; g += 10) latTicks.push(g);
  const fmtLng = (g: number) => `${Math.abs(Math.round(g))}°${g < 0 ? "W" : "E"}`;
  const fmtLat = (g: number) => `${Math.abs(Math.round(g))}°${g < 0 ? "S" : "N"}`;

  const kmPerDegLng = 111.32 * Math.cos((cLat * Math.PI) / 180);
  const scalePx = (1000 / kmPerDegLng / lngSpan) * (W - 2 * pad);

  const pillW = (text: string) => Math.max(46, text.length * 6.6 + 18);

  return (
    <div className="overflow-hidden rounded-lg border border-cardline bg-[#0b2545]">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Hub relocation map" onMouseLeave={() => setHover(null)}>
        <defs>
          <linearGradient id="hubmap-ocean" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#123a63" />
            <stop offset="100%" stopColor="#0b2545" />
          </linearGradient>
          <clipPath id="hubmap-frame"><rect x={pad} y={pad} width={W - 2 * pad} height={H - 2 * pad} /></clipPath>
          <filter id="hubmap-pin-shadow" x="-50%" y="-50%" width="200%" height="200%">
            <feDropShadow dx="0" dy="1" stdDeviation="1.2" floodColor="#000" floodOpacity="0.45" />
          </filter>
        </defs>

        <rect x={0} y={0} width={W} height={H} fill="url(#hubmap-ocean)" />

        <g clipPath="url(#hubmap-frame)">
          {landPaths.map((d, i) => (
            <path key={`land${i}`} d={d} fill="#21527f" stroke="#3d76a6" strokeWidth={0.6} strokeOpacity={0.7} />
          ))}
          {lngTicks.map((g) => <line key={`v${g}`} x1={px(g)} y1={pad} x2={px(g)} y2={H - pad} stroke="#ffffff" strokeOpacity={0.06} />)}
          {latTicks.map((g) => <line key={`h${g}`} x1={pad} y1={py(g)} x2={W - pad} y2={py(g)} stroke="#ffffff" strokeOpacity={0.06} />)}

          {/* Shipping lanes */}
          {placed.slice(1).map((q) => {
            const mx = (ox + q.x) / 2;
            const my = (oy + q.y) / 2 - Math.abs(q.x - ox) * 0.16 - 26;
            const active = hover === null || hover === q.i;
            return (
              <g key={`arc${q.i}`}>
                <path d={`M ${ox} ${oy} Q ${mx} ${my} ${q.x} ${q.y}`} fill="none"
                  stroke={q.p.best ? "#34d399" : "#9cc2f0"}
                  strokeOpacity={active ? (q.p.best ? 0.95 : 0.6) : 0.15}
                  strokeWidth={hover === q.i ? 2.75 : q.p.best ? 2.25 : 1.5}
                  strokeDasharray={q.p.best ? "1 0" : "5 5"} strokeLinecap="round" />
                {(hover === q.i || (hover === null && q.p.best)) && (
                  <text x={mx} y={my + 4} textAnchor="middle" fontSize={9.5} fontWeight={600} fill="#dce8f7">{q.km.toLocaleString()} km</text>
                )}
              </g>
            );
          })}
        </g>

        <rect x={pad} y={pad} width={W - 2 * pad} height={H - 2 * pad} fill="none" stroke="#ffffff" strokeOpacity={0.18} />
        {lngTicks.map((g) => <text key={`vl${g}`} x={px(g)} y={pad - 4} textAnchor="middle" fontSize={8.5} fill="#7f9cc0">{fmtLng(g)}</text>)}
        {latTicks.map((g) => <text key={`hl${g}`} x={pad - 6} y={py(g) + 3} textAnchor="end" fontSize={8.5} fill="#7f9cc0">{fmtLat(g)}</text>)}

        {/* Leader lines + label pills */}
        {placed.map((q) => {
          const w = pillW(q.p.label);
          const px0 = q.side === "right" ? q.x + 10 : q.x - 10 - w;
          const dim = hover !== null && hover !== q.i;
          return (
            <g key={`lab${q.i}`} opacity={dim ? 0.35 : 1} style={{ transition: "opacity 120ms" }}>
              <line x1={q.x} y1={q.y} x2={q.side === "right" ? px0 : px0 + w} y2={q.labelY} stroke="#9cc2f0" strokeOpacity={0.45} strokeWidth={1} />
              <rect x={px0} y={q.labelY - 9} width={w} height={18} rx={9} fill="#0b2545" stroke={q.color} strokeOpacity={0.8} strokeWidth={hover === q.i ? 1.5 : 1} />
              <circle cx={px0 + 10} cy={q.labelY} r={3} fill={q.color} />
              <text x={px0 + 18} y={q.labelY + 3.3} fontSize={10.5} fontWeight={600} fill="#ffffff">{q.p.label}</text>
            </g>
          );
        })}

        {/* Pins */}
        {placed.map((q) => {
          const big = hover === q.i;
          return (
            <g key={`pin${q.i}`} onMouseEnter={() => setHover(q.i)} style={{ cursor: "pointer" }}>
              {q.p.best && <circle cx={q.x} cy={q.y} r={13} fill={q.color} opacity={0.18} />}
              <g filter="url(#hubmap-pin-shadow)" transform={`translate(${q.x} ${q.y}) scale(${big ? 1.25 : 1})`}>
                <path d="M0 0 C -7 -10 -6 -20 0 -20 C 6 -20 7 -10 0 0 Z" fill={q.color} stroke="#0b2545" strokeWidth={1} transform="translate(0 1)" />
                <circle cx={0} cy={-13} r={3.4} fill="#0b2545" opacity={0.85} />
              </g>
              {/* generous invisible hit target */}
              <circle cx={q.x} cy={q.y - 9} r={16} fill="transparent" />
            </g>
          );
        })}

        {/* Hover tooltip */}
        {hover !== null && placed[hover] && (() => {
          const q = placed[hover]!;
          const lines = [q.p.sub, q.isOrigin ? "current origin" : q.km > 0 ? `${q.km.toLocaleString()} km from origin` : ""].filter(Boolean) as string[];
          if (q.p.feasibility && !q.isOrigin) lines.push(`${q.p.feasibility} feasibility`);
          const tw = Math.max(q.p.label.length, ...lines.map((l) => l.length)) * 6.2 + 22;
          let tx = q.x + 14;
          if (tx + tw > W - 6) tx = q.x - 14 - tw;
          const th = 16 + lines.length * 13 + 8;
          let ty = q.y - 24 - th;
          if (ty < pad + 2) ty = q.y + 6;
          return (
            <g pointerEvents="none">
              <rect x={tx} y={ty} width={tw} height={th} rx={7} fill="#0b1f3a" stroke={q.color} strokeOpacity={0.85} strokeWidth={1.25} filter="url(#hubmap-pin-shadow)" />
              <text x={tx + 11} y={ty + 17} fontSize={11.5} fontWeight={700} fill="#ffffff">{q.p.label}</text>
              {lines.map((l, k) => (
                <text key={k} x={tx + 11} y={ty + 31 + k * 13} fontSize={9.5} fill="#bcd0ec">{l}</text>
              ))}
            </g>
          );
        })()}

        {/* Scale bar + legend */}
        <g transform={`translate(${pad + 6}, ${H - pad + 16})`}>
          <line x1={0} y1={0} x2={scalePx} y2={0} stroke="#cfe0f5" strokeWidth={1.5} />
          <line x1={0} y1={-3} x2={0} y2={3} stroke="#cfe0f5" strokeWidth={1.5} />
          <line x1={scalePx} y1={-3} x2={scalePx} y2={3} stroke="#cfe0f5" strokeWidth={1.5} />
          <text x={scalePx + 6} y={3} fontSize={9} fill="#9cc2f0">1,000 km</text>
        </g>
        <g transform={`translate(${W - pad - 150}, ${H - pad + 13})`}>
          <circle cx={6} cy={0} r={4} fill="#f5b942" />
          <text x={14} y={3} fontSize={9} fill="#cfe0f5">origin</text>
          <circle cx={64} cy={0} r={4} fill="#0ea672" />
          <text x={72} y={3} fontSize={9} fill="#cfe0f5">destination</text>
        </g>
      </svg>
    </div>
  );
}
