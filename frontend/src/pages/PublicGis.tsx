import { useCallback, useEffect, useState } from "react";
import {
  MapContainer,
  TileLayer,
  LayersControl,
  GeoJSON,
  CircleMarker,
  Popup,
  useMapEvents,
} from "react-leaflet";
import type { FeatureCollection } from "geojson";
import "leaflet/dist/leaflet.css";
import { PublicHeader } from "@/components/PublicHeader";
import {
  publicRequest,
  type PublicOverview,
  type PublicVehicle,
} from "@/lib/publicApi";
import { CLOUD_DEPLOYMENT } from "@/lib/deployment";

function Viewport({ change }: { change: (query: string) => void }) {
  const map = useMapEvents({ moveend: () => update() });
  function update() {
    const b = map.getBounds();
    change(
      new URLSearchParams({
        minLng: String(b.getWest()),
        minLat: String(b.getSouth()),
        maxLng: String(b.getEast()),
        maxLat: String(b.getNorth()),
      }).toString()
    );
  }
  useEffect(() => {
    update();
  }, [map, change]);
  return null;
}

export default function PublicGis() {
  const [bounds, setBounds] = useState(""),
    [roads, setRoads] = useState<FeatureCollection | null>(null),
    [grid, setGrid] = useState<FeatureCollection | null>(null);
  const [demoRoads, setDemoRoads] = useState<FeatureCollection | null>(null),
    [transit, setTransit] = useState<FeatureCollection | null>(null),
    [traffic, setTraffic] = useState<FeatureCollection | null>(null);
  const [overview, setOverview] = useState<PublicOverview | null>(null),
    [vehicles, setVehicles] = useState<PublicVehicle[]>([]);
  const [error, setError] = useState(""),
    [fleetError, setFleetError] = useState(""),
    [updatesError, setUpdatesError] = useState(""),
    [truncated, setTruncated] = useState(false);
  const [showGrid, setShowGrid] = useState(false),
    [showFleet, setShowFleet] = useState(true),
    [showReports, setShowReports] = useState(true),
    [showAi, setShowAi] = useState(true),
    [showDemo, setShowDemo] = useState(true),
    [showTransit, setShowTransit] = useState(true),
    [showTraffic, setShowTraffic] = useState(true);
  const viewport = useCallback((query: string) => setBounds(query), []);
  useEffect(() => {
    const timer = setInterval(
      () =>
        setVehicles(previous => {
          const fresh = previous.filter(
            v => Date.now() - new Date(v.captured_at).getTime() <= 90000
          );
          return fresh.length === previous.length ? previous : fresh;
        }),
      1000
    );
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    if (!bounds) return;
    const c = new AbortController();
    setError("");
    setRoads(null);
    setGrid(null);
    setTruncated(false);
    Promise.all([
      publicRequest<FeatureCollection & { truncated: boolean }>(
        "roads?" + bounds,
        c.signal
      ),
      publicRequest<FeatureCollection & { truncated: boolean }>(
        "grid?" + bounds,
        c.signal
      ),
    ])
      .then(([r, g]) => {
        if (c.signal.aborted) return;
        setRoads(r);
        setGrid(g);
        setTruncated(r.truncated || g.truncated);
      })
      .catch(() => {
        if (!c.signal.aborted)
          setError(
            "Map coverage could not load. Zoom in or move the map to retry."
          );
      });
    return () => c.abort();
  }, [bounds]);
  useEffect(() => {
    if (CLOUD_DEPLOYMENT) return;
    let timer: ReturnType<typeof setTimeout>;
    let active: AbortController | null = null;
    let disposed = false;
    async function poll() {
      if (disposed) return;
      if (document.hidden) {
        setVehicles([]);
        timer = setTimeout(poll, 10000);
        return;
      }
      active = new AbortController();
      try {
        const result = await publicRequest<{ vehicles: PublicVehicle[] }>(
          "vehicles",
          active.signal
        );
        if (disposed || active.signal.aborted) return;
        setVehicles(
          result.vehicles.filter(
            v => Date.now() - new Date(v.captured_at).getTime() <= 90000
          )
        );
        setFleetError("");
      } catch {
        if (!disposed) {
          setVehicles([]);
          setFleetError(
            "Live locations unavailable. Previous markers have been cleared."
          );
        }
      }
      if (!disposed) timer = setTimeout(poll, 10000);
    }
    const hide = () => {
      if (document.hidden) {
        active?.abort();
        setVehicles([]);
      }
    };
    document.addEventListener("visibilitychange", hide);
    void poll();
    return () => {
      disposed = true;
      clearTimeout(timer);
      active?.abort();
      document.removeEventListener("visibilitychange", hide);
    };
  }, []);
  useEffect(() => {
    const c = new AbortController();
    publicRequest<PublicOverview>("overview", c.signal)
      .then(setOverview)
      .catch(() => {
        if (!c.signal.aborted)
          setUpdatesError("Published updates are temporarily unavailable.");
      });
    return () => c.abort();
  }, []);
  useEffect(() => {
    const c = new AbortController();
    Promise.allSettled([
      publicRequest<FeatureCollection>("transit", c.signal).then(setTransit),
      publicRequest<FeatureCollection>("traffic", c.signal).then(setTraffic),
    ]);
    return () => c.abort();
  }, []);
  useEffect(() => {
    if (!bounds) return;
    const c = new AbortController();
    publicRequest<FeatureCollection>("demo/roads?" + bounds, c.signal)
      .then(setDemoRoads)
      .catch(() => {
        if (!c.signal.aborted) setDemoRoads(null);
      });
    return () => c.abort();
  }, [bounds]);
  return (
    <div className="preview-shell min-h-screen">
      <PublicHeader />
      <main className="mx-auto max-w-[1600px] space-y-4 px-4 py-6">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="eyebrow">PUBLIC MAP · DELHI</p>
            <h1 className="mt-2 text-2xl font-semibold">
              Roads, progress & public transport
            </h1>
          </div>
          <span className="freshness">
            <i />
            {vehicles.length} authorized public vehicles reporting
          </span>
        </div>
        <div className="map-filter-bar">
          {[
            { label: "50 m grid", value: showGrid, set: setShowGrid },
            { label: "Metro & rail", value: showTransit, set: setShowTransit },
            { label: "Public vehicles", value: showFleet, set: setShowFleet },
            {
              label: "Traffic incidents",
              value: showTraffic,
              set: setShowTraffic,
            },
            {
              label: "Published reports",
              value: showReports,
              set: setShowReports,
            },
            { label: "OmniView checks", value: showAi, set: setShowAi },
            { label: "Demo roads", value: showDemo, set: setShowDemo },
          ].map(x => (
            <label key={x.label}>
              <input
                type="checkbox"
                checked={x.value}
                onChange={e => x.set(e.target.checked)}
              />
              {x.label}
            </label>
          ))}
        </div>
        <p className="text-xs leading-6 text-slate-400">
          Street / satellite switch: top right of map. Satellite imagery is
          historical, not live. No private vehicles, number plates, RC or camera
          streams are published.
        </p>
        {CLOUD_DEPLOYMENT && (
          <p role="status" className="demo-disclaimer">
            {demoRoads?.features.length ?? 0} PostGIS demo road features in this
            view. Geometry: OpenStreetMap. Severity: synthetic demonstration.
            Verified publications remain separate.
          </p>
        )}
        {(error || fleetError || updatesError) && (
          <p
            role="alert"
            className="rounded-xl border border-amber-300/30 p-3 text-sm text-amber-200"
          >
            {[error, fleetError, updatesError].filter(Boolean).join(" ")}
          </p>
        )}
        {truncated && (
          <p role="status" className="text-xs text-amber-200">
            Some features are outside the display limit. Zoom in for more
            detail.
          </p>
        )}
        <section
          aria-label="Public geographic map"
          className="h-[65vh] min-h-[420px] overflow-hidden rounded-2xl border border-white/10"
        >
          <MapContainer
            center={[28.65, 77.08]}
            zoom={12}
            minZoom={9}
            maxZoom={19}
            className="h-full w-full"
            scrollWheelZoom
          >
            <Viewport change={viewport} />
            <LayersControl position="topright">
              <LayersControl.BaseLayer checked name="Streets">
                <TileLayer
                  url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                  attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>'
                />
              </LayersControl.BaseLayer>
              <LayersControl.BaseLayer name="Satellite / aerial">
                <TileLayer
                  url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
                  attribution="Tiles © Esri — Source: Esri, Maxar, Earthstar Geographics and the GIS User Community"
                />
              </LayersControl.BaseLayer>
            </LayersControl>
            {roads && (
              <GeoJSON
                key={"roads" + bounds}
                data={roads}
                style={{ color: "#38bdf8", weight: 3, opacity: 0.8 }}
              />
            )}
            {demoRoads && showDemo && (
              <GeoJSON
                key={"demo-roads" + bounds}
                data={demoRoads}
                style={feature => ({
                  color:
                    feature?.properties?.severity === "HIGH"
                      ? "#ef4444"
                      : feature?.properties?.severity === "MODERATE"
                        ? "#f59e0b"
                        : "#22c55e",
                  weight: 3,
                  opacity: 0.78,
                })}
                onEachFeature={(feature, layer) =>
                  layer.bindPopup(
                    `<strong>${feature.properties?.name || feature.properties?.locality_name || "Delhi road"}</strong><br>${feature.properties?.severity} demo severity<br><b>Real OSM geometry · synthetic condition</b>`
                  )
                }
              />
            )}
            {transit && showTransit && (
              <GeoJSON
                key="transit"
                data={transit}
                filter={f => f.geometry.type !== "Point"}
                style={{ color: "#3156e8", weight: 3, opacity: 0.7 }}
                onEachFeature={(feature, layer) =>
                  layer.bindPopup(
                    `<strong>${feature.properties?.name || "Rail corridor"}</strong><br>Source: OpenStreetMap`
                  )
                }
              />
            )}
            {traffic && showTraffic && (
              <GeoJSON
                key="traffic"
                data={traffic}
                style={{ color: "#dc2626", weight: 5, opacity: 0.8 }}
              />
            )}
            {grid && showGrid && (
              <GeoJSON
                key={"grid" + bounds}
                data={grid}
                style={{ color: "#94a3b8", weight: 1, fillOpacity: 0.06 }}
              />
            )}
            {showFleet &&
              vehicles.map(v => (
                <CircleMarker
                  key={v.public_id}
                  center={[v.latitude, v.longitude]}
                  radius={8}
                  pathOptions={{
                    color: "#ecfdf5",
                    fillColor: "#34d399",
                    fillOpacity: 1,
                    weight: 2,
                  }}
                >
                  <Popup>
                    <strong>{v.label}</strong>
                    <p>Camera-mounted public vehicle</p>
                    <p>
                      Reported {new Date(v.captured_at).toLocaleTimeString()} ·
                      accuracy ±{Math.round(v.accuracy_m)} m
                    </p>
                    <p>Location only · no camera stream</p>
                  </Popup>
                </CircleMarker>
              ))}
            {overview?.updates
              .filter(
                u =>
                  u.latitude !== null &&
                  u.longitude !== null &&
                  ((u.category === "REPORT" && showReports) ||
                    (u.category === "OMNIVIEW" && showAi))
              )
              .map(u => (
                <CircleMarker
                  key={u.id}
                  center={[u.latitude!, u.longitude!]}
                  radius={7}
                  pathOptions={{
                    color: u.status === "RESOLVED" ? "#34d399" : "#fbbf24",
                    fillOpacity: 0.9,
                  }}
                >
                  <Popup>
                    <strong>{u.title}</strong>
                    <p>{u.status.replaceAll("_", " ")}</p>
                    <p>{u.summary}</p>
                    <p>
                      Published {new Date(u.updated_at).toLocaleDateString()}
                    </p>
                  </Popup>
                </CircleMarker>
              ))}
          </MapContainer>
        </section>
        <div className="map-legend">
          <span>
            <i className="metro" />
            Metro / rail
          </span>
          <span>
            <i className="critical" />
            High-severity demo
          </span>
          <span>
            <i className="moderate" />
            Moderate demo
          </span>
          <span>
            <i className="resolved" />
            Resolved
          </span>
        </div>
        {!vehicles.length && !fleetError && (
          <p className="rounded-xl bg-white/5 p-4 text-sm text-slate-400">
            No authorized public-vehicle feed is currently available. We do not
            show simulated locations as live.
          </p>
        )}
        <p className="text-xs text-slate-500">
          OmniView model validation is pending. Grey/unobserved areas are not
          certified safe. Locations older than 90 seconds are excluded on
          refresh. Not for navigation or enforcement.
        </p>
      </main>
    </div>
  );
}
