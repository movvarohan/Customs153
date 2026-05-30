"use client";

// Schematic-but-real hub map: a simplified world landmass backdrop, one origin
// + N destination hubs auto-framed to their bounding box, shipping-lane arcs
// from the origin to each hub (with a great-circle distance estimate), labeled
// graticule, teardrop pins, and a scale bar. Used by the Catalog sourcing view
// and the Policy Lab.

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

function haversineKm(a: MapPoint, b: { lat: number; lng: number }): number {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const la1 = (a.lat * Math.PI) / 180;
  const la2 = (b.lat * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(h)));
}

export function HubMap({ origin, hubs, height = 380 }: { origin: MapPoint; hubs: MapPoint[]; height?: number }) {
  const W = 760;
  const H = height;
  const pad = 46;

  const all = [origin, ...hubs];
  const lats = all.map((p) => p.lat);
  const lngs = all.map((p) => p.lng);
  // Generous, roughly equal margins so the land context around the hubs shows
  // and the projection doesn't distort too far from square.
  const span = Math.max(Math.max(...lats) - Math.min(...lats), (Math.max(...lngs) - Math.min(...lngs)) * 0.6, 12);
  const cLat = (Math.max(...lats) + Math.min(...lats)) / 2;
  const cLng = (Math.max(...lngs) + Math.min(...lngs)) / 2;
  const marginLat = span * 0.55;
  const marginLng = span * 0.9;
  const minLat = cLat - marginLat;
  const maxLat = cLat + marginLat;
  const minLng = cLng - marginLng;
  const maxLng = cLng + marginLng;
  const latSpan = maxLat - minLat || 1;
  const lngSpan = maxLng - minLng || 1;

  const px = (lng: number) => pad + ((lng - minLng) / lngSpan) * (W - 2 * pad);
  const py = (lat: number) => pad + ((maxLat - lat) / latSpan) * (H - 2 * pad);

  const ox = px(origin.lng);
  const oy = py(origin.lat);

  // Land polygons clipped to the frame via SVG clipPath.
  const landPaths = WORLD_LAND.map((ring) => "M" + ring.map(([lng, lat]) => `${px(lng).toFixed(1)} ${py(lat).toFixed(1)}`).join(" L") + " Z");

  // Graticule every 10° (lat) / 15° (lng), with edge labels.
  const lngTicks: number[] = [];
  for (let g = Math.ceil(minLng / 15) * 15; g < maxLng; g += 15) lngTicks.push(g);
  const latTicks: number[] = [];
  for (let g = Math.ceil(minLat / 10) * 10; g < maxLat; g += 10) latTicks.push(g);
  const fmtLng = (g: number) => `${Math.abs(Math.round(g))}°${g < 0 ? "W" : "E"}`;
  const fmtLat = (g: number) => `${Math.abs(Math.round(g))}°${g < 0 ? "S" : "N"}`;

  // Scale bar: width of 1000 km at the map's center latitude.
  const kmPerDegLng = 111.32 * Math.cos((cLat * Math.PI) / 180);
  const scaleKm = 1000;
  const scalePx = (scaleKm / kmPerDegLng / lngSpan) * (W - 2 * pad);

  return (
    <div className="overflow-hidden rounded-lg border border-cardline bg-[#0b2545]">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Hub relocation map">
        <defs>
          <linearGradient id="hubmap-ocean" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#123a63" />
            <stop offset="100%" stopColor="#0b2545" />
          </linearGradient>
          <clipPath id="hubmap-frame">
            <rect x={pad} y={pad} width={W - 2 * pad} height={H - 2 * pad} />
          </clipPath>
          <filter id="hubmap-pin-shadow" x="-50%" y="-50%" width="200%" height="200%">
            <feDropShadow dx="0" dy="1" stdDeviation="1.2" floodColor="#000" floodOpacity="0.45" />
          </filter>
        </defs>

        <rect x={0} y={0} width={W} height={H} fill="url(#hubmap-ocean)" />

        <g clipPath="url(#hubmap-frame)">
          {/* Land */}
          {landPaths.map((d, i) => (
            <path key={`land${i}`} d={d} fill="#21527f" stroke="#3d76a6" strokeWidth={0.6} strokeOpacity={0.7} />
          ))}

          {/* Graticule */}
          {lngTicks.map((g) => (
            <line key={`v${g}`} x1={px(g)} y1={pad} x2={px(g)} y2={H - pad} stroke="#ffffff" strokeOpacity={0.07} />
          ))}
          {latTicks.map((g) => (
            <line key={`h${g}`} x1={pad} y1={py(g)} x2={W - pad} y2={py(g)} stroke="#ffffff" strokeOpacity={0.07} />
          ))}

          {/* Shipping lanes origin → hub */}
          {hubs.map((p, i) => {
            const hx = px(p.lng);
            const hy = py(p.lat);
            const mx = (ox + hx) / 2;
            const my = (oy + hy) / 2 - Math.abs(hx - ox) * 0.16 - 26;
            const km = haversineKm(origin, p);
            const lx = mx;
            const ly = my + 4;
            return (
              <g key={`arc${i}`}>
                <path d={`M ${ox} ${oy} Q ${mx} ${my} ${hx} ${hy}`} fill="none"
                  stroke={p.best ? "#34d399" : "#9cc2f0"} strokeOpacity={p.best ? 0.95 : 0.6}
                  strokeWidth={p.best ? 2.25 : 1.5} strokeDasharray={p.best ? "1 0" : "5 5"} strokeLinecap="round" />
                <text x={lx} y={ly} textAnchor="middle" fontSize={9} fontWeight={600} fill="#cfe0f5" opacity={0.85}>
                  {km.toLocaleString()} km
                </text>
              </g>
            );
          })}
        </g>

        {/* Frame */}
        <rect x={pad} y={pad} width={W - 2 * pad} height={H - 2 * pad} fill="none" stroke="#ffffff" strokeOpacity={0.18} />

        {/* Graticule labels */}
        {lngTicks.map((g) => (
          <text key={`vl${g}`} x={px(g)} y={pad - 4} textAnchor="middle" fontSize={8.5} fill="#7f9cc0">{fmtLng(g)}</text>
        ))}
        {latTicks.map((g) => (
          <text key={`hl${g}`} x={pad - 6} y={py(g) + 3} textAnchor="end" fontSize={8.5} fill="#7f9cc0">{fmtLat(g)}</text>
        ))}

        {/* Pins */}
        {all.map((p, i) => {
          const x = px(p.lng);
          const y = py(p.lat);
          const isOrigin = i === 0;
          const color = isOrigin ? "#f5b942" : FEAS(p.feasibility);
          const labelLeft = x > W - 170;
          const anchor = labelLeft ? "end" : "start";
          const lx = labelLeft ? x - 13 : x + 13;
          return (
            <g key={`pin${i}`}>
              {p.best && <circle cx={x} cy={y} r={13} fill={color} opacity={0.18} />}
              {/* teardrop pin */}
              <g filter="url(#hubmap-pin-shadow)" transform={`translate(${x} ${y})`}>
                <path d="M0 0 C -7 -10 -6 -20 0 -20 C 6 -20 7 -10 0 0 Z" fill={color} stroke="#0b2545" strokeWidth={1} transform="translate(0 1)" />
                <circle cx={0} cy={-13} r={3.4} fill="#0b2545" opacity={0.85} />
              </g>
              {/* label plate */}
              <text x={lx} y={y - 16} textAnchor={anchor} fontSize={11.5} fontWeight={700} fill="#ffffff"
                style={{ paintOrder: "stroke", stroke: "#0b2545", strokeWidth: 3, strokeLinejoin: "round" }}>
                {p.label}
              </text>
              <text x={lx} y={y - 4} textAnchor={anchor} fontSize={9} fill="#bcd0ec"
                style={{ paintOrder: "stroke", stroke: "#0b2545", strokeWidth: 2.5, strokeLinejoin: "round" }}>
                {isOrigin ? `${p.sub}` : `${p.sub}${p.feasibility ? ` · ${p.feasibility}` : ""}`}
              </text>
            </g>
          );
        })}

        {/* Scale bar */}
        <g transform={`translate(${pad + 6}, ${H - pad + 16})`}>
          <line x1={0} y1={0} x2={scalePx} y2={0} stroke="#cfe0f5" strokeWidth={1.5} />
          <line x1={0} y1={-3} x2={0} y2={3} stroke="#cfe0f5" strokeWidth={1.5} />
          <line x1={scalePx} y1={-3} x2={scalePx} y2={3} stroke="#cfe0f5" strokeWidth={1.5} />
          <text x={scalePx + 6} y={3} fontSize={9} fill="#9cc2f0">{scaleKm.toLocaleString()} km</text>
        </g>

        {/* Legend */}
        <g transform={`translate(${W - pad - 150}, ${H - pad + 10})`}>
          <circle cx={6} cy={0} r={4} fill="#f5b942" />
          <text x={14} y={3} fontSize={9} fill="#cfe0f5">origin</text>
          <circle cx={64} cy={0} r={4} fill="#0ea672" />
          <text x={72} y={3} fontSize={9} fill="#cfe0f5">destination</text>
        </g>
      </svg>
    </div>
  );
}
