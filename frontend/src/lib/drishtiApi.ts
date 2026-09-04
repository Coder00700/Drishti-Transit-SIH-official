/** Typed client for the local Drishti Transit FastAPI/PostGIS service. */

export type ApiHealth = {
  status: "ok";
  service: string;
  version: string;
};

export type ApiReadiness = {
  status: "ready" | "not_ready";
  configured: boolean;
  database: "ready" | "not_configured" | "unavailable";
  postgis: "ready" | "not_enabled" | "unknown";
  postgresVersion?: string | null;
  postgisVersion?: string | null;
};

export type GeoJsonPoint = { type: "Point"; coordinates: [number, number] };
export type GeoJsonLineString = {
  type: "LineString";
  coordinates: [number, number][];
};
export type GeoJsonPolygon = {
  type: "Polygon";
  coordinates: [number, number][][];
};

export type RoadSegment = {
  id: string;
  code: string;
  name: string;
  roadClass: string | null;
  importance: number;
  speedLimitKmh: number | null;
  centerline: GeoJsonLineString;
  createdAt: string;
};

export type GridCell = {
  id: string;
  code: string;
  resolutionM: number;
  boundary: GeoJsonPolygon;
  createdAt: string;
};

export type Camera = {
  id: string;
  code: string;
  name: string;
  roadSegmentId: string | null;
  sourceType: string;
  sourceUri: string | null;
  latitude: number;
  longitude: number;
  directionDegrees: number | null;
  status: "ONLINE" | "OFFLINE" | "DEGRADED";
  lastSeenAt: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};

export type Recording = {
  id: string;
  cameraId: string | null;
  sourceType: string;
  sourceLabel: string | null;
  filePath: string;
  capturedAt: string;
  durationSeconds: number | null;
  fileSizeBytes: number | null;
  sha256: string | null;
  metadata: Record<string, unknown>;
  widthPixels: number | null;
  heightPixels: number | null;
  framesPerSecond: number | null;
  frameCount: number | null;
  processingStatus: "PENDING" | "INSPECTING" | "READY" | "PROCESSING" | "COMPLETED" | "FAILED";
  processedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ProcessingRun = {
  id: string; recordingId: string; pipelineName: string; pipelineVersion: string;
  inferenceType: "HEURISTIC" | "MODEL"; configHash: string; config: Record<string, unknown>;
  status: "PENDING" | "RUNNING" | "COMPLETED" | "FAILED"; framesSampled: number;
  findingsCount: number; evidenceCount: number; summary: Record<string, unknown>;
  errorMessage: string | null; startedAt: string | null; completedAt: string | null; createdAt: string;
};

export type FrameFinding = {
  id: string; processingRunId: string; recordingId: string;
  category: "ROAD_SURFACE_DAMAGE" | "DAMAGED_EDGE" | "DEBRIS" | "WATERLOGGING";
  frameNumber: number; videoOffsetMs: number; observedAt: string; confidence: number;
  boundingBox: Record<string, number> | null; scoreComponents: Record<string, number>;
  evidenceFilePath: string | null; evidenceSha256: string | null;
  locationState: "unknown" | "camera-provisional" | "gps-confirmed";
  reviewStatus: "UNREVIEWED" | "CONFIRMED" | "REJECTED"; createdAt: string;
};

export type GpsPoint = {
  id: string;
  recordingId: string;
  capturedAt: string;
  latitude: number;
  longitude: number;
  speedKmh: number | null;
  headingDegrees: number | null;
  accuracyM: number | null;
  createdAt: string;
};

export type Observation = {
  id: string;
  cameraId: string | null;
  recordingId: string | null;
  roadSegmentId: string | null;
  gridCellId: string | null;
  kind: string;
  observedAt: string;
  latitude: number;
  longitude: number;
  confidence: number;
  severity: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL" | null;
  evidenceFilePath: string | null;
  modelName: string | null;
  modelVersion: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
};

export type Evidence = {
  id: string;
  observationId: string | null;
  mediaType: "IMAGE" | "VIDEO_CLIP" | "DOCUMENT";
  filePath: string;
  sha256: string | null;
  redacted: boolean;
  capturedAt: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
};

export type SafetyEvent = {
  id: string;
  eventType: string;
  title: string;
  severity: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  riskScore: number;
  latitude: number;
  longitude: number;
  roadSegmentId: string | null;
  gridCellId: string | null;
  status: "NEW" | "VERIFIED" | "ASSIGNED" | "IN_PROGRESS" | "RESOLVED" | "DISMISSED";
  firstSeenAt: string;
  lastSeenAt: string;
  verifiedAt: string | null;
  resolvedAt: string | null;
  riskFactors: Record<string, number>;
  notes: string | null;
  observationIds: string[];
  createdAt: string;
  updatedAt: string;
};

export type WorkOrder = {
  id: string;
  observationId: string;
  title: string;
  description: string | null;
  assignedAgency: string | null;
  priority: number;
  status: "OPEN" | "ASSIGNED" | "IN_PROGRESS" | "RESOLVED" | "CANCELLED";
  dueAt: string | null;
  resolvedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type GeoJsonFeature<G = GeoJsonLineString | GeoJsonPolygon | GeoJsonPoint, P = Record<string, unknown>> = {
  type: "Feature";
  id: string;
  geometry: G;
  properties: P;
};

export type GeoJsonFeatureCollection<G = GeoJsonLineString | GeoJsonPolygon | GeoJsonPoint, P = Record<string, unknown>> = {
  type: "FeatureCollection";
  features: GeoJsonFeature<G, P>[];
  truncated?: boolean;
  limit?: number;
};

export type RoadProperties = {
  id: string;
  code: string;
  name: string;
  roadClass: string | null;
  importance: number;
  speedLimitKmh: number | null;
  dataSource: "prototype" | "osm";
  osmWayId: number | null;
  osmTags: Record<string, string>;
  importKey: string | null;
  importedAt: string | null;
  createdAt: string;
};

export type GridCellProperties = {
  id: string;
  code: string;
  resolutionM: number;
  dataSource: "prototype" | "osm-derived";
  health: string | null;
  riskLevel: string | null;
  roadSegmentIds: string[];
  createdAt: string;
};

export type MapSummary = {
  totalRoads: number;
  osmRoads: number;
  prototypeRoads: number;
  totalGridCells: number;
  gridCells50m: number;
  gridCells1000m: number;
  totalCameras: number;
  totalObservations: number;
  totalSafetyEvents: number;
  lastOsmImportAt: string | null;
  extent: {
    minLng: number;
    minLat: number;
    maxLng: number;
    maxLat: number;
  } | null;
  dataSourceAttribution: string;
};

export type BoundingBox = {
  minLng: number;
  minLat: number;
  maxLng: number;
  maxLat: number;
};

export const DRISHTI_API_BASE = (import.meta.env.VITE_DRISHTI_API_URL || "").replace(
  /\/$/,
  ""
);

async function request<T>(path: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(`${DRISHTI_API_BASE}${path}`, {
    headers: { Accept: "application/json" },
    signal,
  });
  if (!response.ok) {
    throw new Error(`Drishti API returned ${response.status}`);
  }
  return (await response.json()) as T;
}

export function getApiHealth(signal?: AbortSignal) {
  return request<ApiHealth>("/health", signal);
}

export function getApiReadiness(signal?: AbortSignal) {
  return fetch(`${DRISHTI_API_BASE}/ready`, {
    headers: { Accept: "application/json" },
    signal,
  }).then(async (response) => {
    if (response.status !== 200 && response.status !== 503) {
      throw new Error(`Drishti API returned ${response.status}`);
    }
    return (await response.json()) as ApiReadiness;
  });
}

export const drishtiApi = {
  health: getApiHealth,
  readiness: getApiReadiness,
  roads: (signal?: AbortSignal) => request<RoadSegment[]>("/api/v1/roads", signal),
  gridCells: (signal?: AbortSignal) =>
    request<GridCell[]>("/api/v1/grid-cells", signal),
  cameras: (signal?: AbortSignal) =>
    request<Camera[]>("/api/v1/cameras", signal),
  recordings: (signal?: AbortSignal) =>
    request<Recording[]>("/api/v1/recordings", signal),
  processingRuns: (signal?: AbortSignal) =>
    request<ProcessingRun[]>("/api/v1/processing-runs", signal),
  frameFindings: (signal?: AbortSignal) =>
    request<FrameFinding[]>("/api/v1/frame-findings", signal),
  gpsPoints: (recordingId?: string, signal?: AbortSignal) => {
    const query = recordingId ? `?recording_id=${encodeURIComponent(recordingId)}` : "";
    return request<GpsPoint[]>(`/api/v1/gps-points${query}`, signal);
  },
  observations: (signal?: AbortSignal) =>
    request<Observation[]>("/api/v1/observations", signal),
  evidence: (signal?: AbortSignal) =>
    request<Evidence[]>("/api/v1/evidence", signal),
  safetyEvents: (signal?: AbortSignal) =>
    request<SafetyEvent[]>("/api/v1/safety-events", signal),
  workOrders: (signal?: AbortSignal) =>
    request<WorkOrder[]>("/api/v1/work-orders", signal),
  mapRoads: (bbox?: BoundingBox, dataSource?: string, roadClasses?: string, limit?: number, signal?: AbortSignal) => {
    const params = new URLSearchParams();
    if (bbox) {
      params.append("minLng", bbox.minLng.toString());
      params.append("minLat", bbox.minLat.toString());
      params.append("maxLng", bbox.maxLng.toString());
      params.append("maxLat", bbox.maxLat.toString());
    }
    if (dataSource) params.append("dataSource", dataSource);
    if (roadClasses) params.append("roadClasses", roadClasses);
    if (limit) params.append("limit", limit.toString());
    const query = params.toString() ? `?${params.toString()}` : "";
    return request<GeoJsonFeatureCollection<GeoJsonLineString, RoadProperties>>(`/api/v1/map/roads${query}`, signal);
  },
  mapGridCells: (bbox?: BoundingBox, dataSource?: string, resolutionM?: number, limit?: number, signal?: AbortSignal) => {
    const params = new URLSearchParams();
    if (bbox) {
      params.append("minLng", bbox.minLng.toString());
      params.append("minLat", bbox.minLat.toString());
      params.append("maxLng", bbox.maxLng.toString());
      params.append("maxLat", bbox.maxLat.toString());
    }
    if (dataSource) params.append("dataSource", dataSource);
    if (resolutionM) params.append("resolutionM", resolutionM.toString());
    if (limit) params.append("limit", limit.toString());
    const query = params.toString() ? `?${params.toString()}` : "";
    return request<GeoJsonFeatureCollection<GeoJsonPolygon, GridCellProperties>>(`/api/v1/map/grid-cells${query}`, signal);
  },
  mapSummary: (signal?: AbortSignal) =>
    request<MapSummary>("/api/v1/map/summary", signal),
};
