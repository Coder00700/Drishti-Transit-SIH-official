import { useEffect, useRef, useCallback, useState } from "react";
import { escapeHtml, gridColor } from "@/lib/gisDisplay";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

import type {
  GeoJsonFeatureCollection,
  GeoJsonLineString,
  GeoJsonPolygon,
  RoadProperties,
  GridCellProperties,
  Camera,
  Observation,
  SafetyEvent,
  BoundingBox,
} from "@/lib/drishtiApi";

// Fix Leaflet's default icon path issues in bundled React
delete (L.Icon.Default.prototype as unknown as Record<string, unknown>)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
  iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
  shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
});

export type LeafletGisMapProps = {
  roads: GeoJsonFeatureCollection<GeoJsonLineString, RoadProperties> | null;
  gridCells: GeoJsonFeatureCollection<GeoJsonPolygon, GridCellProperties> | null;
  cameras: Camera[];
  observations: Observation[];
  safetyEvents: SafetyEvent[];
  onViewportChange?: (bbox: BoundingBox) => void;
  onSelectFeature?: (type: string, data: unknown) => void;
  showRoads?: boolean;
  showGrid?: boolean;
  showCameras?: boolean;
  showObservations?: boolean;
  showEvents?: boolean;
};

// West Delhi default center
const DEFAULT_CENTER: [number, number] = [28.64, 77.08];
const DEFAULT_ZOOM = 15;

export function LeafletGisMap({
  roads,
  gridCells,
  cameras,
  observations,
  safetyEvents,
  onViewportChange,
  onSelectFeature,
  showRoads = true,
  showGrid = true,
  showCameras = true,
  showObservations = true,
  showEvents = true,
}: LeafletGisMapProps) {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);
  const [tileError,setTileError] = useState(false);
  const layersRef = useRef<{
    roads?: L.GeoJSON;
    grid?: L.GeoJSON;
    cameras?: L.LayerGroup;
    observations?: L.LayerGroup;
    events?: L.LayerGroup;
  }>({});

  const debounceTimerRef = useRef<number | null>(null);

  // Initialize Leaflet map
  useEffect(() => {
    if (!mapContainerRef.current || mapInstanceRef.current) return;

    const map = L.map(mapContainerRef.current, {
      center: DEFAULT_CENTER,
      zoom: DEFAULT_ZOOM,
      zoomControl: true,
      preferCanvas: true,
      minZoom: 10,
      maxBounds: [[28.3, 76.7], [29.0, 77.5]],
    });
    map.createPane("gis-grid").style.zIndex = "390";
    map.createPane("gis-roads").style.zIndex = "410";

    // Standard OSM tiles for interactive local viewing; browser caching remains enabled.
    const street = L.tileLayer(
      "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
      {
        attribution:
          '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
        maxZoom: 19,
      }
    ).addTo(map);

    // Interactive imagery only: no offline download/export. Provider attribution stays visible.
    const satellite = L.tileLayer('https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
      maxZoom:19,
      attribution:'Imagery &copy; <a href="https://www.esri.com/">Esri</a>, Maxar, Earthstar Geographics and the GIS User Community · <a href="https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer" target="_blank" rel="noopener noreferrer">Source credits</a>',
    });
    satellite.on('tileerror',()=>setTileError(true));
    map.on('baselayerchange',()=>setTileError(false));
    L.control.layers({'Streets':street,'Satellite / aerial':satellite},undefined,{collapsed:false,position:'topright'}).addTo(map);

    // Viewport change handler (debounced)
    const handleMoveEnd = () => {
      if (!onViewportChange) return;
      if (debounceTimerRef.current) window.clearTimeout(debounceTimerRef.current);

      debounceTimerRef.current = window.setTimeout(() => {
        const bounds = map.getBounds();
        onViewportChange({
          minLng: bounds.getWest(),
          minLat: bounds.getSouth(),
          maxLng: bounds.getEast(),
          maxLat: bounds.getNorth(),
        });
      }, 300);
    };

    map.on("moveend", handleMoveEnd);
    mapInstanceRef.current = map;
    const resizeObserver = new ResizeObserver(() => map.invalidateSize());
    resizeObserver.observe(mapContainerRef.current);

    // Initial bbox trigger
    handleMoveEnd();

    return () => {
      if (debounceTimerRef.current) window.clearTimeout(debounceTimerRef.current);
      resizeObserver.disconnect();
      map.remove();
      mapInstanceRef.current = null;
      layersRef.current = {};
    };
  }, [onViewportChange]);

  // Road styling helper
  const getRoadStyle = useCallback((feature: GeoJsonFeatureCollection<GeoJsonLineString, RoadProperties>["features"][0]) => {
    const isOsm = feature.properties.dataSource === "osm";
    const roadClass = feature.properties.roadClass;

    let color = "#3b82f6"; // default blue
    let weight = 3;

    if (roadClass === "motorway" || roadClass === "motorway_link") {
      color = "#ef4444";
      weight = 5;
    } else if (roadClass === "trunk" || roadClass === "trunk_link") {
      color = "#f97316";
      weight = 4.5;
    } else if (roadClass === "primary" || roadClass === "primary_link") {
      color = "#eab308";
      weight = 4;
    } else if (roadClass === "secondary" || roadClass === "secondary_link") {
      color = "#06b6d4";
      weight = 3;
    }

    return {
      color,
      weight,
      opacity: isOsm ? 0.85 : 0.6,
      dashArray: isOsm ? undefined : "6, 6",
    };
  }, []);

  // Update Road Layer
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map) return;

    if (layersRef.current.roads) {
      map.removeLayer(layersRef.current.roads);
      layersRef.current.roads = undefined;
    }

    if (showRoads && roads && roads.features.length > 0) {
      const roadLayer = L.geoJSON(roads as unknown as GeoJSON.GeoJsonObject, {
        pane: "gis-roads",
        style: (feature) => getRoadStyle(feature as unknown as GeoJsonFeatureCollection<GeoJsonLineString, RoadProperties>["features"][0]),
        onEachFeature: (feature, layer) => {
          const props = feature.properties as RoadProperties;
          const content = `
            <div style="font-family: sans-serif; font-size: 12px; color: #1e293b;">
              <strong style="font-size: 13px; color: #0f172a;">${escapeHtml(props.name)}</strong><br/>
              <span style="display:inline-block; padding: 2px 6px; border-radius: 4px; background: #e2e8f0; font-size: 10px; font-weight: bold; margin-top: 4px;">
                ${escapeHtml(props.roadClass || "unclassified")}
              </span>
              <span style="display:inline-block; padding: 2px 6px; border-radius: 4px; background: ${props.dataSource === 'osm' ? '#dcfce7' : '#fef3c7'}; color: ${props.dataSource === 'osm' ? '#166534' : '#92400e'}; font-size: 10px; font-weight: bold; margin-left: 4px;">
                ${escapeHtml(props.dataSource.toUpperCase())}
              </span>
              <div style="margin-top: 6px; font-size: 11px; color: #64748b;">
                Code: <code>${escapeHtml(props.code)}</code><br/>
                Importance: ${props.importance}/100<br/>
                ${props.speedLimitKmh ? `Speed Limit: ${props.speedLimitKmh} km/h<br/>` : ""}
                ${props.osmWayId ? `OSM Way ID: <a href="https://www.openstreetmap.org/way/${props.osmWayId}" target="_blank" rel="noopener noreferrer" style="color: #2563eb;">${props.osmWayId}</a><br/>` : ""}
                ${props.importedAt ? `Imported: ${new Date(props.importedAt).toLocaleDateString()}` : ""}
              </div>
            </div>
          `;
          layer.bindPopup(content);
          layer.on("click", () => {
            if (onSelectFeature) onSelectFeature("road", props);
          });
        },
      });

      roadLayer.addTo(map);
      layersRef.current.roads = roadLayer;
    }
  }, [roads, showRoads, getRoadStyle, onSelectFeature]);

  // Update Grid Cell Layer
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map) return;

    if (layersRef.current.grid) {
      map.removeLayer(layersRef.current.grid);
      layersRef.current.grid = undefined;
    }

    if (showGrid && gridCells && gridCells.features.length > 0) {
      const gridLayer = L.geoJSON(gridCells as unknown as GeoJSON.GeoJsonObject, {
        pane: "gis-grid",
        style: (feature) => {
          const props = feature?.properties as GridCellProperties;
          const is50m = props?.resolutionM === 50;

          // Health / risk coloring
          const fillColor = gridColor(props?.health, props?.riskLevel);

          return {
            fillColor,
            fillOpacity: is50m ? 0.15 : 0.08,
            color: is50m ? fillColor : "#6366f1",
            weight: is50m ? 1 : 2,
            dashArray: is50m ? undefined : "4, 4",
          };
        },
        onEachFeature: (feature, layer) => {
          const props = feature.properties as GridCellProperties;
          const content = `
            <div style="font-family: sans-serif; font-size: 12px; color: #1e293b;">
              <strong style="font-size: 13px; color: #0f172a;">Grid Cell ${escapeHtml(props.code)}</strong><br/>
              <span style="display:inline-block; padding: 2px 6px; border-radius: 4px; background: #e0e7ff; color: #3730a3; font-size: 10px; font-weight: bold; margin-top: 4px;">
                ${props.resolutionM}m resolution
              </span>
              <span style="display:inline-block; padding: 2px 6px; border-radius: 4px; background: ${props.dataSource === 'osm-derived' ? '#dcfce7' : '#fef3c7'}; color: ${props.dataSource === 'osm-derived' ? '#166534' : '#92400e'}; font-size: 10px; font-weight: bold; margin-left: 4px;">
                ${escapeHtml(props.dataSource.toUpperCase())}
              </span>
              <div style="margin-top: 6px; font-size: 11px; color: #64748b;">
                Health: <strong>${escapeHtml(props.health || "unknown")}</strong><br/>
                Risk: <strong>${escapeHtml(props.riskLevel || "unknown")}</strong><br/>
                Linked Roads: ${props.roadSegmentIds?.length || 0} segments
              </div>
            </div>
          `;
          layer.bindPopup(content);
          layer.on("click", () => {
            if (onSelectFeature) onSelectFeature("gridCell", props);
          });
        },
      });

      gridLayer.addTo(map);
      layersRef.current.grid = gridLayer;
    }
  }, [gridCells, showGrid, onSelectFeature]);

  // Update Camera Markers
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map) return;

    if (layersRef.current.cameras) {
      map.removeLayer(layersRef.current.cameras);
      layersRef.current.cameras = undefined;
    }

    if (showCameras && cameras.length > 0) {
      const cameraGroup = L.layerGroup();

      cameras.forEach((camera) => {
        const marker = L.circleMarker([camera.latitude, camera.longitude], {
          pane: "markerPane",
          radius: 7,
          fillColor: camera.status === "ONLINE" ? "#10b981" : "#94a3b8",
          color: "#ffffff",
          weight: 2,
          opacity: 1,
          fillOpacity: 0.9,
        });

        marker.bindPopup(`
          <div style="font-family: sans-serif; font-size: 12px;">
            <strong>📷 ${escapeHtml(camera.name)}</strong><br/>
            Code: <code>${escapeHtml(camera.code)}</code><br/>
            Status: <strong style="color: ${camera.status === 'ONLINE' ? '#10b981' : '#94a3b8'};">${escapeHtml(camera.status)}</strong><br/>
            Source: ${escapeHtml(camera.sourceType)}
          </div>
        `);

        marker.on("click", () => {
          if (onSelectFeature) onSelectFeature("camera", camera);
        });

        cameraGroup.addLayer(marker);
      });

      cameraGroup.addTo(map);
      layersRef.current.cameras = cameraGroup;
    }
  }, [cameras, showCameras, onSelectFeature]);

  // Update Observation Markers
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map) return;

    if (layersRef.current.observations) {
      map.removeLayer(layersRef.current.observations);
      layersRef.current.observations = undefined;
    }

    if (showObservations && observations.length > 0) {
      const obsGroup = L.layerGroup();

      observations.forEach((obs) => {
        const marker = L.circleMarker([obs.latitude, obs.longitude], {
          pane: "markerPane",
          radius: 5,
          fillColor: "#ef4444",
          color: "#ffffff",
          weight: 1.5,
          opacity: 1,
          fillOpacity: 0.85,
        });

        marker.bindPopup(`
          <div style="font-family: sans-serif; font-size: 12px;">
            <strong>⚠️ ${escapeHtml(obs.kind)}</strong><br/>
            Severity: <strong>${escapeHtml(obs.severity || "N/A")}</strong><br/>
            Confidence: ${(obs.confidence * 100).toFixed(0)}%<br/>
            Observed: ${new Date(obs.observedAt).toLocaleString()}
          </div>
        `);

        marker.on("click", () => {
          if (onSelectFeature) onSelectFeature("observation", obs);
        });

        obsGroup.addLayer(marker);
      });

      obsGroup.addTo(map);
      layersRef.current.observations = obsGroup;
    }
  }, [observations, showObservations, onSelectFeature]);

  // Update Safety Event Markers
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map) return;

    if (layersRef.current.events) {
      map.removeLayer(layersRef.current.events);
      layersRef.current.events = undefined;
    }

    if (showEvents && safetyEvents.length > 0) {
      const eventGroup = L.layerGroup();

      safetyEvents.forEach((event) => {
        const marker = L.circleMarker([event.latitude, event.longitude], {
          pane: "markerPane",
          radius: 9,
          fillColor: "#f59e0b",
          color: "#78350f",
          weight: 2,
          opacity: 1,
          fillOpacity: 0.85,
        });

        marker.bindPopup(`
          <div style="font-family: sans-serif; font-size: 12px;">
            <strong>🚨 ${escapeHtml(event.title)}</strong><br/>
            Type: ${escapeHtml(event.eventType)}<br/>
            Severity: <strong style="color: #f59e0b;">${escapeHtml(event.severity)}</strong><br/>
            Risk Score: <strong>${event.riskScore.toFixed(1)}/100</strong><br/>
            Status: <strong>${escapeHtml(event.status)}</strong>
          </div>
        `);

        marker.on("click", () => {
          if (onSelectFeature) onSelectFeature("safetyEvent", event);
        });

        eventGroup.addLayer(marker);
      });

      eventGroup.addTo(map);
      layersRef.current.events = eventGroup;
    }
  }, [safetyEvents, showEvents, onSelectFeature]);

  return (
    <div className="relative h-full w-full">
      <div ref={mapContainerRef} className="h-full w-full rounded-2xl" />
      <div className="absolute left-14 top-3 z-[1000] max-w-[55%] rounded-lg bg-slate-950/85 px-3 py-2 text-[10px] text-slate-200">Satellite imagery is not live. Dates and detail vary by area.{tileError&&<p role="alert" className="mt-1 text-amber-200">Imagery unavailable. Switch to Streets or check your connection.</p>}</div>

      {/* Map Legend */}
      <div className="absolute bottom-4 left-4 z-[1000] rounded-xl border border-slate-700/60 bg-slate-900/90 p-3 shadow-xl backdrop-blur-md">
        <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Map Legend</p>
        <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs text-slate-200">
          <div className="flex items-center gap-1.5">
            <span className="h-1.5 w-4 rounded-full bg-red-500" />
            <span className="text-[11px]">Motorway</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="h-1.5 w-4 rounded-full bg-orange-500" />
            <span className="text-[11px]">Trunk</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="h-1.5 w-4 rounded-full bg-yellow-500" />
            <span className="text-[11px]">Primary</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="h-1.5 w-4 rounded-full bg-cyan-500" />
            <span className="text-[11px]">Secondary</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="h-3 w-3 rounded border border-slate-400 bg-slate-400/20" />
            <span className="text-[11px]">50m · Unassessed</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full bg-amber-500 ring-2 ring-amber-900" />
            <span className="text-[11px]">Safety Event</span>
          </div>
        </div>
      </div>
    </div>
  );
}
