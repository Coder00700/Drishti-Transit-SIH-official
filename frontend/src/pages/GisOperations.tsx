import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "wouter";
import { Map, Layers, RefreshCw, Database, AlertTriangle, Camera, MapPinned, Loader2 } from "lucide-react";

import { LeafletGisMap } from "@/components/gis/LeafletGisMap";
import {
  drishtiApi,
  type BoundingBox,
  type GeoJsonFeatureCollection,
  type GeoJsonLineString,
  type GeoJsonPolygon,
  type RoadProperties,
  type GridCellProperties,
  type Camera as CameraType,
  type Observation,
  type SafetyEvent,
  type MapSummary,
} from "@/lib/drishtiApi";

type LoadingState = "idle" | "loading" | "ready" | "error";

export default function GisOperations() {
  const [loadingState, setLoadingState] = useState<LoadingState>("loading");
  const [error, setError] = useState<string | null>(null);
  const [viewportError, setViewportError] = useState<string | null>(null);
  const [viewportLoading, setViewportLoading] = useState(false);
  const initialRequest = useRef<AbortController | null>(null);
  const viewportRequest = useRef<AbortController | null>(null);

  const [roads, setRoads] = useState<GeoJsonFeatureCollection<GeoJsonLineString, RoadProperties> | null>(null);
  const [gridCells, setGridCells] = useState<GeoJsonFeatureCollection<GeoJsonPolygon, GridCellProperties> | null>(null);
  const [cameras, setCameras] = useState<CameraType[]>([]);
  const [observations, setObservations] = useState<Observation[]>([]);
  const [safetyEvents, setSafetyEvents] = useState<SafetyEvent[]>([]);
  const [summary, setSummary] = useState<MapSummary | null>(null);

  const [currentBbox, setCurrentBbox] = useState<BoundingBox | null>(null);
  const [showRoads, setShowRoads] = useState(true);
  const [showGrid, setShowGrid] = useState(true);
  const [showCameras, setShowCameras] = useState(true);
  const [showObservations, setShowObservations] = useState(true);
  const [showEvents, setShowEvents] = useState(true);

  // Load initial summary and operational data
  const loadInitialData = useCallback(async () => {
    initialRequest.current?.abort();
    const controller = new AbortController();
    initialRequest.current = controller;
    const signal = controller.signal;
    try {
      setError(null);

      // Check API readiness
      const readiness = await drishtiApi.readiness(signal);
      if (signal.aborted) return;
      if (readiness.status !== "ready") {
        setError("PostgreSQL/PostGIS setup is required. Please run database migrations.");
        setLoadingState("error");
        return;
      }

      // Load summary, cameras, observations, safety events
      const [summaryData, camerasData, observationsData, eventsData] = await Promise.all([
        drishtiApi.mapSummary(signal),
        drishtiApi.cameras(signal),
        drishtiApi.observations(signal),
        drishtiApi.safetyEvents(signal),
      ]);
      if (signal.aborted) return;
      setSummary(summaryData);
      setCameras(camerasData);
      setObservations(observationsData);
      setSafetyEvents(eventsData);

      setLoadingState("ready");
    } catch (err) {
      if (signal.aborted) return;
      console.error("Failed to load GIS data:", err);
      setError("The local FastAPI service is unavailable. Please start the backend.");
      setLoadingState("error");
    }
  }, []);

  useEffect(() => {
    void loadInitialData();
    return () => {
      initialRequest.current?.abort();
      viewportRequest.current?.abort();
    };
  }, [loadInitialData]);

  // Load viewport-specific roads and grid cells
  const loadViewportData = useCallback(async (bbox: BoundingBox) => {
    viewportRequest.current?.abort();
    const controller = new AbortController();
    viewportRequest.current = controller;
    const signal = controller.signal;
    setViewportLoading(true);
    setViewportError(null);
    setRoads(null);
    setGridCells(null);
    try {
      const [roadsData, gridData] = await Promise.all([
        drishtiApi.mapRoads(bbox, "osm", undefined, 2000, signal),
        drishtiApi.mapGridCells(bbox, "osm-derived", 50, 5000, signal),
      ]);
      if (signal.aborted) return;
      setRoads(roadsData);
      setGridCells(gridData);
    } catch (err) {
      if (signal.aborted) return;
      console.error("Failed to load viewport data:", err);
      setViewportError("Could not load this map area. Refresh to retry.");
    } finally {
      if (!signal.aborted) setViewportLoading(false);
    }
  }, []);

  const handleViewportChange = useCallback(
    (bbox: BoundingBox) => {
      setCurrentBbox(bbox);
      void loadViewportData(bbox);
    },
    [loadViewportData]
  );

  const handleRefresh = () => {
    void loadInitialData();
    if (currentBbox) {
      void loadViewportData(currentBbox);
    }
  };

  if (loadingState === "loading") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#04101b]">
        <div className="text-center">
          <Loader2 className="mx-auto mb-4 h-12 w-12 animate-spin text-cyan-300" />
          <p className="text-sm font-semibold text-white">Loading GIS data...</p>
          <p className="mt-1 text-xs text-slate-400">Connecting to PostgreSQL/PostGIS backend</p>
        </div>
      </div>
    );
  }

  if (loadingState === "error") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#04101b]">
        <div className="max-w-md rounded-2xl border border-red-500/20 bg-red-500/5 p-8 text-center">
          <AlertTriangle className="mx-auto mb-4 h-12 w-12 text-red-400" />
          <p className="text-sm font-semibold text-white">GIS Data Unavailable</p>
          <p className="mt-2 text-xs leading-relaxed text-slate-300">{error}</p>
          <button
            onClick={handleRefresh}
            className="mt-6 flex items-center gap-2 rounded-lg bg-cyan-300 px-4 py-2 text-sm font-bold text-[#04101b] hover:bg-cyan-200"
          >
            <RefreshCw size={14} />
            Retry Connection
          </button>
        </div>
      </div>
    );
  }

  const roadCount = roads?.features.length || 0;
  const gridCount = gridCells?.features.length || 0;

  return (
    <div className="min-h-screen bg-[#04101b] text-slate-200">
      {/* Header */}
      <header className="sticky top-0 z-30 border-b border-white/10 bg-[#061421]/95 backdrop-blur-xl">
        <div className="mx-auto flex max-w-[1600px] items-center justify-between gap-4 px-4 py-3 sm:px-6">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-300 text-[#04101b]">
              <Map size={22} />
            </div>
            <div>
              <h1 className="text-base font-extrabold text-white sm:text-lg">Drishti GIS Operations</h1>
              <p className="text-[9px] font-bold uppercase tracking-[.2em] text-slate-500">
                Real OpenStreetMap · West Delhi
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <Link href="/" className="text-xs text-cyan-300 hover:underline">Bus dashboard</Link>
            <Link href="/contribute" className="text-xs text-emerald-300 hover:underline">Contribute data</Link>
            <Link href="/admin" className="text-xs text-amber-200 hover:underline">Admin desk</Link>
            <button
              onClick={handleRefresh}
              className="flex items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs font-bold text-slate-300 hover:border-cyan-300/30 hover:bg-white/10"
            >
              <RefreshCw size={14} />
              <span className="hidden sm:inline">Refresh</span>
            </button>
            <span className="rounded-lg border border-emerald-300/20 bg-emerald-300/10 px-3 py-2 text-[10px] font-bold text-emerald-300">
              LIVE POSTGIS
            </span>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[1600px] space-y-5 px-4 py-5 sm:px-6">
        {viewportError && <p role="alert" className="rounded-xl border border-red-400/30 bg-red-400/10 p-3 text-sm text-red-200">{viewportError}</p>}
        {(roads?.truncated || gridCells?.truncated) && <p role="status" className="rounded-xl border border-amber-400/30 bg-amber-400/10 p-3 text-sm text-amber-200">This area has more features than the display limit. Zoom in to see all roads and cells.</p>}
        {summary?.osmRoads === 0 && <p role="status" className="rounded-xl bg-amber-400/10 p-3 text-sm text-amber-200">No OSM roads imported yet. Import roads and generate the 50 m grid before using this map.</p>}
        <p className="text-xs text-slate-400">Grey cells are unassessed, not safe. Camera, observation and event records may include prototype data. Refresh for latest records.</p>
        {/* Summary Stats */}
        <section className="grid grid-cols-2 gap-3 lg:grid-cols-5">
          <StatCard
            icon={Database}
            label="OSM Roads"
            value={summary?.osmRoads || 0}
            color="text-blue-300"
          />
          <StatCard
            icon={Layers}
            label="50m Grid Cells"
            value={summary?.gridCells50m || 0}
            color="text-emerald-300"
          />
          <StatCard
            icon={Camera}
            label="Cameras"
            value={summary?.totalCameras || 0}
            color="text-purple-300"
          />
          <StatCard
            icon={AlertTriangle}
            label="Observations"
            value={summary?.totalObservations || 0}
            color="text-red-300"
          />
          <StatCard
            icon={MapPinned}
            label="Safety Events"
            value={summary?.totalSafetyEvents || 0}
            color="text-amber-300"
          />
        </section>

        {/* Layer Controls */}
        <section className="rounded-2xl border border-white/10 bg-[#091827] p-4">
          <div className="flex flex-wrap items-center gap-3">
            <p className="text-xs font-bold text-slate-400">Layers:</p>
            <LayerToggle label="Roads" checked={showRoads} onChange={setShowRoads} color="bg-blue-500" />
            <LayerToggle label="Grid Cells" checked={showGrid} onChange={setShowGrid} color="bg-emerald-500" />
            <LayerToggle label="Cameras" checked={showCameras} onChange={setShowCameras} color="bg-purple-500" />
            <LayerToggle
              label="Observations"
              checked={showObservations}
              onChange={setShowObservations}
              color="bg-red-500"
            />
            <LayerToggle
              label="Safety Events"
              checked={showEvents}
              onChange={setShowEvents}
              color="bg-amber-500"
            />
            <div className="ml-auto text-xs text-slate-500">
              {viewportLoading ? "Loading map area…" : `Viewport: ${roadCount} roads · ${gridCount} cells`}
            </div>
          </div>
        </section>

        {/* Map */}
        <section className="h-[calc(100vh-280px)] min-h-[500px] overflow-hidden rounded-2xl border border-white/10 bg-[#091827] shadow-2xl">
          <LeafletGisMap
            roads={roads}
            gridCells={gridCells}
            cameras={cameras}
            observations={observations}
            safetyEvents={safetyEvents}
            onViewportChange={handleViewportChange}
            showRoads={showRoads}
            showGrid={showGrid}
            showCameras={showCameras}
            showObservations={showObservations}
            showEvents={showEvents}
          />
        </section>

        {/* Attribution */}
        <section className="rounded-xl border border-slate-700/40 bg-slate-900/40 p-3 text-center text-xs text-slate-400">
          {summary?.dataSourceAttribution || "© OpenStreetMap contributors, ODbL 1.0"} · Prototype data is not
          suitable for navigation or enforcement · West Delhi MVP coverage
        </section>
      </main>
    </div>
  );
}

function StatCard({
  icon: Icon,
  label,
  value,
  color,
}: {
  icon: typeof Map;
  label: string;
  value: number;
  color: string;
}) {
  return (
    <article className="rounded-2xl border border-white/10 bg-[#091827] p-4 shadow-xl">
      <div className="flex items-center justify-between text-xs text-slate-500">
        <span>{label}</span>
        <Icon size={17} className={color} />
      </div>
      <p className="mt-3 text-2xl font-extrabold text-white">{value.toLocaleString()}</p>
    </article>
  );
}

function LayerToggle({
  label,
  checked,
  onChange,
  color,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  color: string;
}) {
  return (
    <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-white/10 bg-black/20 px-3 py-1.5 text-xs font-semibold text-slate-300 transition hover:border-white/20 hover:bg-black/30">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="peer sr-only"
      />
      <span
        className={`h-3 w-3 rounded ${color} transition peer-checked:opacity-100 ${
          checked ? "opacity-100" : "opacity-30"
        }`}
      />
      {label}
    </label>
  );
}
