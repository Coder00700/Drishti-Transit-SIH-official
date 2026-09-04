import { useCallback, useEffect, useState } from "react";

import {
  drishtiApi,
  type ApiReadiness,
  type Camera,
  type Evidence,
  type GpsPoint,
  type GridCell,
  type Observation,
  type Recording,
  type ProcessingRun,
  type FrameFinding,
  type RoadSegment,
  type SafetyEvent,
  type WorkOrder,
} from "@/lib/drishtiApi";

export type DashboardData = {
  roads: RoadSegment[];
  gridCells: GridCell[];
  cameras: Camera[];
  recordings: Recording[];
  processingRuns: ProcessingRun[];
  frameFindings: FrameFinding[];
  gpsPoints: GpsPoint[];
  observations: Observation[];
  evidence: Evidence[];
  safetyEvents: SafetyEvent[];
  workOrders: WorkOrder[];
};

const EMPTY_DATA: DashboardData = {
  roads: [],
  gridCells: [],
  cameras: [],
  recordings: [],
  processingRuns: [],
  frameFindings: [],
  gpsPoints: [],
  observations: [],
  evidence: [],
  safetyEvents: [],
  workOrders: [],
};

export function useDatabaseDashboard(pollIntervalMs = 10_000) {
  const [data, setData] = useState<DashboardData>(EMPTY_DATA);
  const [readiness, setReadiness] = useState<ApiReadiness | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const refresh = useCallback(async () => {
    try {
      await drishtiApi.health();
      const currentReadiness = await drishtiApi.readiness();
      setReadiness(currentReadiness);

      if (currentReadiness.status !== "ready") {
        setData(EMPTY_DATA);
        setError("PostgreSQL/PostGIS setup is required before live records can be loaded.");
        return;
      }

      const [roads, gridCells, cameras, recordings, processingRuns, frameFindings, gpsPoints, observations, evidence, safetyEvents, workOrders] =
        await Promise.all([
          drishtiApi.roads(),
          drishtiApi.gridCells(),
          drishtiApi.cameras(),
          drishtiApi.recordings(),
          drishtiApi.processingRuns(),
          drishtiApi.frameFindings(),
          drishtiApi.gpsPoints(),
          drishtiApi.observations(),
          drishtiApi.evidence(),
          drishtiApi.safetyEvents(),
          drishtiApi.workOrders(),
        ]);

      setData({ roads, gridCells, cameras, recordings, processingRuns, frameFindings, gpsPoints, observations, evidence, safetyEvents, workOrders });
      setError(null);
      setLastUpdated(new Date());
    } catch {
      setReadiness(null);
      setData(EMPTY_DATA);
      setError("The local FastAPI service is unavailable.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(refresh, pollIntervalMs);
    return () => window.clearInterval(timer);
  }, [pollIntervalMs, refresh]);

  return { data, readiness, loading, error, lastUpdated, refresh };
}
