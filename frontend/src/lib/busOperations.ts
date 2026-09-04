import { DRISHTI_API_BASE } from "@/lib/drishtiApi";

export type BusStatus = "ON_ROUTE" | "DELAYED" | "AT_STOP";

export type Bus = {
  id: string;
  numberPlate: string;
  routeNumber: string;
  route: string;
  currentStop: string;
  nextStop: string;
  latitude: number;
  longitude: number;
  speedKmh: number;
  occupancy: number;
  status: BusStatus;
  etaMinutes: number;
  cameraStatus: "ONLINE" | "DEGRADED" | "OFFLINE";
  updatedAt: string;
};

export type BusFrameAnalysis = {
  mode: "dummy" | "openai";
  model: string;
  summary: string;
  roadCondition: "DRY" | "WET" | "DAMAGED" | "UNKNOWN";
  trafficLevel: "LIGHT" | "MODERATE" | "HEAVY" | "UNKNOWN";
  alerts: string[];
  analyzedAt: string;
};

export const DUMMY_BUSES: Bus[] = [
  { id: "bus-101", numberPlate: "DL 1PC 7284", routeNumber: "883", route: "Uttam Nagar Terminal → Nangloi", currentStop: "District Centre, Janakpuri", nextStop: "Tilak Nagar", latitude: 28.6291, longitude: 77.0817, speedKmh: 31, occupancy: 64, status: "ON_ROUTE", etaMinutes: 6, cameraStatus: "ONLINE", updatedAt: "now" },
  { id: "bus-102", numberPlate: "DL 1PD 4921", routeNumber: "817N", route: "Najafgarh Terminal → Peeragarhi", currentStop: "Nangloi Metro Station", nextStop: "Udyog Nagar", latitude: 28.6821, longitude: 77.0632, speedKmh: 18, occupancy: 82, status: "DELAYED", etaMinutes: 11, cameraStatus: "ONLINE", updatedAt: "now" },
  { id: "bus-103", numberPlate: "DL 1PC 9386", routeNumber: "764", route: "Nehru Place → Najafgarh", currentStop: "Dwarka Mor", nextStop: "Nawada", latitude: 28.6205, longitude: 77.0328, speedKmh: 24, occupancy: 47, status: "ON_ROUTE", etaMinutes: 4, cameraStatus: "ONLINE", updatedAt: "now" },
  { id: "bus-104", numberPlate: "DL 1PD 6150", routeNumber: "879", route: "Janakpuri D-Block → Shahbad Dairy", currentStop: "Paschim Vihar", nextStop: "Peeragarhi Chowk", latitude: 28.6694, longitude: 77.0948, speedKmh: 0, occupancy: 36, status: "AT_STOP", etaMinutes: 2, cameraStatus: "DEGRADED", updatedAt: "now" },
];

export async function getBuses(signal?: AbortSignal): Promise<Bus[]> {
  const response = await fetch(`${DRISHTI_API_BASE}/api/v1/buses`, { signal });
  if (!response.ok) throw new Error("Fleet feed unavailable");
  return response.json() as Promise<Bus[]>;
}

export function cameraUrl(busId: string) {
  return `${DRISHTI_API_BASE}/api/v1/buses/${encodeURIComponent(busId)}/camera`;
}

export async function analyzeBusFrame(busId: string, imageDataUrl?: string) {
  const response = await fetch(`${DRISHTI_API_BASE}/api/v1/ai/analyze-bus-frame`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ busId, imageDataUrl }),
  });
  if (!response.ok) throw new Error("Scene analysis unavailable");
  return response.json() as Promise<BusFrameAnalysis>;
}
