import { BusFront, LocateFixed } from "lucide-react";

import type { Bus } from "@/lib/busOperations";

type Props = { buses: Bus[]; selectedId: string; onSelect: (bus: Bus) => void };

const MIN_LNG = 76.96;
const MAX_LNG = 77.14;
const MIN_LAT = 28.57;
const MAX_LAT = 28.73;

function project(latitude: number, longitude: number) {
  return {
    x: 58 + ((longitude - MIN_LNG) / (MAX_LNG - MIN_LNG)) * 884,
    y: 472 - ((latitude - MIN_LAT) / (MAX_LAT - MIN_LAT)) * 410,
  };
}

const corridors = [
  { name: "Rohtak Road", points: [[28.690, 76.991], [28.684, 77.029], [28.682, 77.063], [28.672, 77.105]] },
  { name: "Najafgarh Road", points: [[28.613, 76.989], [28.6205, 77.0328], [28.6291, 77.0817], [28.646, 77.119]] },
  { name: "Outer Ring Road", points: [[28.584, 77.041], [28.620, 77.068], [28.6694, 77.0948], [28.711, 77.109]] },
];

export function WestDelhiFleetMap({ buses, selectedId, onSelect }: Props) {
  const selected = buses.find((bus) => bus.id === selectedId);
  return (
    <section id="fleet-map" className="map-shell overflow-hidden rounded-[22px] border border-white/10">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 bg-[#09182a]/90 px-5 py-4">
        <div><p className="text-[10px] font-bold uppercase tracking-[0.18em] text-cyan-300">Restricted operating zone</p><h2 className="mt-1 text-lg font-bold text-white">West Delhi live map</h2></div>
        <div className="flex items-center gap-2 rounded-full border border-emerald-300/20 bg-emerald-300/10 px-3 py-1.5 text-[10px] font-bold text-emerald-300"><LocateFixed size={13} /> GPS SIMULATION ACTIVE</div>
      </div>
      <div className="relative">
        {selected && <div className="absolute right-4 top-4 z-10 max-w-[240px] rounded-xl border border-cyan-300/20 bg-[#071321]/95 p-3 shadow-xl backdrop-blur"><p className="text-xs font-bold text-white">Route {selected.routeNumber} · {selected.numberPlate}</p><p className="mt-1 text-[10px] leading-4 text-slate-400">{selected.currentStop} → {selected.nextStop}</p><p className="mono mt-2 text-[9px] text-cyan-300">{selected.latitude.toFixed(4)}° N, {selected.longitude.toFixed(4)}° E</p></div>}
        <svg viewBox="0 0 1000 520" className="h-[420px] w-full bg-[#06121e] lg:h-[510px]" role="img" aria-label="West Delhi bus GPS map">
          <defs><pattern id="minor-grid" width="30" height="30" patternUnits="userSpaceOnUse"><path d="M30 0H0V30" fill="none" stroke="#8fb6d8" strokeOpacity=".055" /></pattern><filter id="bus-glow"><feGaussianBlur stdDeviation="5" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs>
          <rect width="1000" height="520" fill="url(#minor-grid)" />
          <path d="M96 82 L286 54 L476 86 L626 50 L856 92 L936 218 L908 386 L748 470 L552 446 L394 484 L204 430 L74 296 Z" fill="#0b2230" stroke="#1e7082" strokeWidth="2" strokeDasharray="7 8" />
          <path d="M140 155 C260 118 338 198 450 160 S670 122 866 178" fill="none" stroke="#15384b" strokeWidth="18" /><path d="M116 353 C250 301 333 365 470 320 S711 267 902 312" fill="none" stroke="#15384b" strokeWidth="14" />
          {corridors.map((corridor) => <polyline key={corridor.name} points={corridor.points.map(([lat, lng]) => { const p = project(lat, lng); return `${p.x},${p.y}`; }).join(" ")} fill="none" stroke="#70a7c7" strokeOpacity=".55" strokeWidth="5" strokeLinecap="round"><title>{corridor.name}</title></polyline>)}
          {["Najafgarh", "Dwarka", "Janakpuri", "Nangloi", "Paschim Vihar", "Punjabi Bagh"].map((name, index) => { const positions = [[160,410],[330,380],[545,335],[440,170],[654,210],[808,140]]; const [x,y] = positions[index]; return <text key={name} x={x} y={y} fill="#728ba3" fontSize="13" fontWeight="600">{name}</text>; })}
          {buses.map((bus) => { const point = project(bus.latitude, bus.longitude); const active = bus.id === selectedId; return <g key={bus.id} transform={`translate(${point.x} ${point.y})`} className="cursor-pointer" onClick={() => onSelect(bus)} role="button" aria-label={`Show ${bus.numberPlate} location`}>{active && <circle r="29" fill="#4de1ff" fillOpacity=".11" stroke="#4de1ff" strokeOpacity=".45"><animate attributeName="r" values="20;34;20" dur="2.4s" repeatCount="indefinite" /></circle>}<circle r={active ? 17 : 14} fill={bus.status === "DELAYED" ? "#f59e0b" : "#19d3a2"} stroke="#06121e" strokeWidth="5" filter="url(#bus-glow)" /><text textAnchor="middle" y="4" fill="#04111c" fontSize="10" fontWeight="900">{bus.routeNumber}</text><title>{`${bus.numberPlate} · ${bus.currentStop}`}</title></g>; })}
          <g transform="translate(78 475)"><BusFront size={16} color="#19d3a2"/><text x="24" y="13" fill="#7890a6" fontSize="11">Click a bus to inspect its GPS position</text></g>
        </svg>
      </div>
    </section>
  );
}
