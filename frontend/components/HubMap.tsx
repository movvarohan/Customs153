"use client";

// Schematic equirectangular hub map: one origin + N destination hubs, auto-framed
// to their bounding box, with quadratic arcs from the origin to each hub and pins
// colored by feasibility. Used by the Catalog sourcing view and the Policy Lab.

export interface MapPoint {
  lat: number;
  lng: number;
  label: string;
  sub: string;
  feasibility?: "high" | "medium" | "low";
  best?: boolean;
}

const FEAS = (f?: "high" | "medium" | "low") =>
  f === "high" ? "#0ea672" : f === "medium" ? "#2f5fd0" : f === "low" ? "#d08a2f" : "#2f5fd0";

export function HubMap({ origin, hubs, height = 360 }: { origin: MapPoint; hubs: MapPoint[]; height?: number }) {
  const W = 720;
  const H = height;
  const pad = 44;

  const all = [origin, ...hubs];
  const lats = all.map((p) => p.lat);
  const lngs = all.map((p) => p.lng);
  const marginLat = Math.max(6, (Math.max(...lats) - Math.min(...lats)) * 0.35);
  const marginLng = Math.max(6, (Math.max(...lngs) - Math.min(...lngs)) * 0.25);
  const minLat = Math.min(...lats) - marginLat;
  const maxLat = Math.max(...lats) + marginLat;
  const minLng = Math.min(...lngs) - marginLng;
  const maxLng = Math.max(...lngs) + marginLng;
  const latSpan = maxLat - minLat || 1;
  const lngSpan = maxLng - minLng || 1;

  const px = (lng: number) => pad + ((lng - minLng) / lngSpan) * (W - 2 * pad);
  const py = (lat: number) => pad + ((maxLat - lat) / latSpan) * (H - 2 * pad);

  const ox = px(origin.lng);
  const oy = py(origin.lat);

  const lngTicks: number[] = [];
  for (let g = Math.ceil(minLng / 15) * 15; g < maxLng; g += 15) lngTicks.push(g);
  const latTicks: number[] = [];
  for (let g = Math.ceil(minLat / 10) * 10; g < maxLat; g += 10) latTicks.push(g);

  return (
    <div className="overflow-hidden rounded-md border border-cardline bg-[#0b1f3a]">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Hub relocation map">
        <defs>
          <radialGradient id="hubmap-ocean" cx="50%" cy="40%" r="80%">
            <stop offset="0%" stopColor="#10294a" />
            <stop offset="100%" stopColor="#0b1f3a" />
          </radialGradient>
        </defs>
        <rect x={0} y={0} width={W} height={H} fill="url(#hubmap-ocean)" />

        {lngTicks.map((g) => (
          <line key={`v${g}`} x1={px(g)} y1={pad} x2={px(g)} y2={H - pad} stroke="#ffffff" strokeOpacity={0.06} />
        ))}
        {latTicks.map((g) => (
          <line key={`h${g}`} x1={pad} y1={py(g)} x2={W - pad} y2={py(g)} stroke="#ffffff" strokeOpacity={0.06} />
        ))}
        <rect x={pad} y={pad} width={W - 2 * pad} height={H - 2 * pad} fill="none" stroke="#ffffff" strokeOpacity={0.12} />

        {hubs.map((p, i) => {
          const hx = px(p.lng);
          const hy = py(p.lat);
          const mx = (ox + hx) / 2;
          const my = (oy + hy) / 2 - Math.abs(hx - ox) * 0.18 - 24;
          return (
            <path key={`arc${i}`} d={`M ${ox} ${oy} Q ${mx} ${my} ${hx} ${hy}`} fill="none"
              stroke={p.best ? "#36d399" : "#7fa6e8"} strokeOpacity={p.best ? 0.9 : 0.45}
              strokeWidth={p.best ? 2 : 1.25} strokeDasharray={p.best ? undefined : "4 4"} />
          );
        })}

        {all.map((p, i) => {
          const x = px(p.lng);
          const y = py(p.lat);
          const isOrigin = i === 0;
          const color = isOrigin ? "#f5b942" : FEAS(p.feasibility);
          const labelLeft = x > W - 150;
          return (
            <g key={`pin${i}`}>
              {p.best && <circle cx={x} cy={y} r={11} fill="none" stroke="#36d399" strokeOpacity={0.8} strokeWidth={1.5} />}
              <circle cx={x} cy={y} r={isOrigin ? 6 : 5} fill={color} stroke="#0b1f3a" strokeWidth={1.5} />
              <text x={labelLeft ? x - 9 : x + 9} y={y - 5} textAnchor={labelLeft ? "end" : "start"} fontSize={11} fontWeight={700} fill="#ffffff">{p.label}</text>
              <text x={labelLeft ? x - 9 : x + 9} y={y + 7} textAnchor={labelLeft ? "end" : "start"} fontSize={9} fill="#9db8e0">{p.sub}</text>
            </g>
          );
        })}

        <g transform={`translate(${pad + 6}, ${H - pad - 28})`}>
          <circle cx={6} cy={0} r={5} fill="#f5b942" />
          <text x={16} y={4} fontSize={10} fill="#cbd9f0">current origin</text>
          <circle cx={6} cy={16} r={5} fill="#0ea672" />
          <text x={16} y={20} fontSize={10} fill="#cbd9f0">destination hub</text>
        </g>
      </svg>
    </div>
  );
}
