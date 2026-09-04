import { useMemo, useState } from "react";
import { MapPin } from "lucide-react";

import type { Camera, GridCell, Observation, RoadSegment, SafetyEvent } from "@/lib/drishtiApi";

type Coordinate = [number, number];

type WestDelhiMapProps = {
  roads: RoadSegment[];
  gridCells: GridCell[];
  observations: Observation[];
  cameras: Camera[];
  safetyEvents: SafetyEvent[];
};

const WIDTH = 1000;
const HEIGHT = 520;
const PADDING = 54;

export function WestDelhiMap({ roads, gridCells, observations, cameras, safetyEvents }: WestDelhiMapProps) {
  const [selectedRoadId, setSelectedRoadId] = useState<string | null>(null);

  const geometry = useMemo(() => {
    const roadCoordinates = roads.flatMap((road) => road.centerline.coordinates);
    const gridCoordinates = gridCells.flatMap((cell) => cell.boundary.coordinates.flat());
    const observationCoordinates: Coordinate[] = observations.map((item) => [
      item.longitude,
      item.latitude,
    ]);
    const cameraCoordinates: Coordinate[] = cameras.map((item) => [item.longitude, item.latitude]);
    const eventCoordinates: Coordinate[] = safetyEvents.map((item) => [item.longitude, item.latitude]);
    const coordinates = [...roadCoordinates, ...gridCoordinates, ...observationCoordinates, ...cameraCoordinates, ...eventCoordinates];

    if (coordinates.length === 0) return null;

    const longitudes = coordinates.map(([longitude]) => longitude);
    const latitudes = coordinates.map(([, latitude]) => latitude);
    const minLongitude = Math.min(...longitudes);
    const maxLongitude = Math.max(...longitudes);
    const minLatitude = Math.min(...latitudes);
    const maxLatitude = Math.max(...latitudes);
    const longitudeRange = Math.max(maxLongitude - minLongitude, 0.01);
    const latitudeRange = Math.max(maxLatitude - minLatitude, 0.01);

    const project = ([longitude, latitude]: Coordinate): Coordinate => [
      PADDING + ((longitude - minLongitude) / longitudeRange) * (WIDTH - PADDING * 2),
      HEIGHT - PADDING - ((latitude - minLatitude) / latitudeRange) * (HEIGHT - PADDING * 2),
    ];

    return { project, minLongitude, maxLongitude, minLatitude, maxLatitude };
  }, [cameras, gridCells, observations, roads, safetyEvents]);

  const selectedRoad = roads.find((road) => road.id === selectedRoadId) ?? null;

  if (!geometry) {
    return (
      <div className="flex h-[420px] flex-col items-center justify-center rounded-2xl border border-dashed border-white/15 bg-[#061525] text-center">
        <MapPin className="mb-3 text-[#71869e]" size={28} />
        <p className="text-sm font-semibold text-white">No spatial records available</p>
        <p className="mt-1 max-w-sm text-xs text-[#71869e]">
          Road centerlines and grid cells will render here directly from PostGIS.
        </p>
      </div>
    );
  }

  return (
    <div className="relative overflow-hidden rounded-2xl border border-white/10 bg-[#04111f]">
      <div className="absolute left-4 top-4 z-10 rounded-lg border border-[#64d7aa]/20 bg-[#07172a]/90 px-3 py-2 backdrop-blur-xl">
        <p className="mono text-[9px] font-bold text-[#64d7aa]">POSTGIS · EPSG:4326</p>
        <p className="mono mt-1 text-[8px] text-[#71869e]">
          {geometry.minLatitude.toFixed(4)}–{geometry.maxLatitude.toFixed(4)} N · {geometry.minLongitude.toFixed(4)}–{geometry.maxLongitude.toFixed(4)} E
        </p>
      </div>

      {selectedRoad && (
        <div className="absolute right-4 top-4 z-10 max-w-xs rounded-lg border border-[#adc6ff]/20 bg-[#07172a]/90 px-3 py-2 text-right backdrop-blur-xl">
          <p className="text-xs font-semibold text-white">{selectedRoad.name}</p>
          <p className="mono mt-1 text-[8px] text-[#8ea4bd]">
            {selectedRoad.code} · importance {selectedRoad.importance}
          </p>
        </div>
      )}

      <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} className="h-[420px] w-full" role="img" aria-label="West Delhi PostGIS road map">
        <defs>
          <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
            <path d="M 40 0 L 0 0 0 40" fill="none" stroke="#adc6ff" strokeOpacity="0.06" strokeWidth="1" />
          </pattern>
          <filter id="roadGlow">
            <feGaussianBlur stdDeviation="3" result="blur" />
            <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
        </defs>
        <rect width={WIDTH} height={HEIGHT} fill="#04111f" />
        <rect width={WIDTH} height={HEIGHT} fill="url(#grid)" />

        {gridCells.map((cell) => (
          <polygon
            key={cell.id}
            points={cell.boundary.coordinates[0]
              .map((coordinate) => geometry.project(coordinate as Coordinate).join(","))
              .join(" ")}
            fill="#64d7aa"
            fillOpacity="0.07"
            stroke="#64d7aa"
            strokeOpacity="0.32"
            strokeDasharray="7 6"
          />
        ))}

        {roads.map((road) => {
          const selected = road.id === selectedRoadId;
          return (
            <polyline
              key={road.id}
              points={road.centerline.coordinates
                .map((coordinate) => geometry.project(coordinate as Coordinate).join(","))
                .join(" ")}
              fill="none"
              stroke={selected ? "#ffb95f" : "#adc6ff"}
              strokeWidth={selected ? 7 : 4}
              strokeLinecap="round"
              strokeLinejoin="round"
              filter="url(#roadGlow)"
              className="cursor-pointer transition-all"
              onClick={() => setSelectedRoadId(road.id)}
            />
          );
        })}

        {observations.map((observation) => {
          const [x, y] = geometry.project([observation.longitude, observation.latitude]);
          return (
            <g key={observation.id} transform={`translate(${x} ${y})`}>
              <circle r="11" fill="#ff716c" fillOpacity="0.18" />
              <circle r="5" fill="#ff716c" />
              <title>{`${observation.kind} · ${(observation.confidence * 100).toFixed(1)}%`}</title>
            </g>
          );
        })}

        {safetyEvents.map((event) => {
          const [x, y] = geometry.project([event.longitude, event.latitude]);
          return (
            <g key={event.id} transform={`translate(${x} ${y})`}>
              <circle r="15" fill="#ffb95f" fillOpacity="0.16" stroke="#ffb95f" strokeWidth="2" />
              <circle r="4" fill="#ffb95f" />
              <title>{`${event.title} · risk ${event.riskScore.toFixed(1)}`}</title>
            </g>
          );
        })}

        {cameras.map((camera) => {
          const [x, y] = geometry.project([camera.longitude, camera.latitude]);
          return (
            <g key={camera.id} transform={`translate(${x} ${y})`}>
              <rect x="-7" y="-7" width="14" height="14" rx="3" fill={camera.status === "ONLINE" ? "#64d7aa" : "#71869e"} />
              <title>{`${camera.name} · ${camera.status}`}</title>
            </g>
          );
        })}
      </svg>

      <div className="flex flex-wrap gap-4 border-t border-white/10 px-4 py-3 text-[10px] text-[#8ea4bd]">
        <span><i className="mr-2 inline-block h-0.5 w-5 bg-[#adc6ff] align-middle" />Road centerlines</span>
        <span><i className="mr-2 inline-block h-3 w-3 border border-dashed border-[#64d7aa] align-middle" />Grid cells</span>
        <span><i className="mr-2 inline-block h-2 w-2 rounded-full bg-[#ff716c] align-middle" />Observations</span>
        <span><i className="mr-2 inline-block h-2 w-2 rounded-sm bg-[#64d7aa] align-middle" />Cameras</span>
        <span><i className="mr-2 inline-block h-3 w-3 rounded-full border-2 border-[#ffb95f] align-middle" />Safety events</span>
      </div>
    </div>
  );
}
