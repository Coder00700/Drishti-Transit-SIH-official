export type PublicUpdate = {
  id: string;
  category: "PROJECT" | "REPORT" | "OMNIVIEW";
  title: string;
  summary: string;
  status: string;
  source_url: string | null;
  updated_at: string;
  latitude: number | null;
  longitude: number | null;
};
export type PublicOverview = {
  coverage: { roads: number; cells: number };
  updates: PublicUpdate[];
  reports: {
    published: number;
    resolved: number;
    in_progress: number;
    window: string;
  };
  model: { status: string; label: string };
  as_of: string;
};
export type PublicVehicle = {
  public_id: string;
  label: string;
  latitude: number;
  longitude: number;
  captured_at: string;
  accuracy_m: number;
};
export type DemoUpdate = {
  id: string;
  area_id: string;
  locality_name?: string;
  title: string;
  summary?: string;
  status: string;
  updated_at: string;
  synthetic?: boolean;
};
export type DemoOverview = {
  coverage: { roads: number; localities: number };
  updates: DemoUpdate[];
  data_mode: "DEMO";
  synthetic: true;
  disclaimer: string;
};
export type WeatherSnapshot = {
  provider: string;
  fallback?: boolean;
  temperature_c: number;
  feels_like_c: number;
  humidity_percent: number;
  precipitation_mm: number;
  wind_kmh: number;
  weather_code: number;
  rain_probability_percent: number | null;
  observed_at: string;
  live: boolean;
};
export type AirQualitySnapshot = {
  provider: string;
  attribution: string;
  us_aqi: number | null;
  pm2_5: number | null;
  pm10: number | null;
  observed_at: string;
  live: boolean;
};
export type TrafficSnapshot = GeoJSON.FeatureCollection & {
  provider: string;
  configured: boolean;
  live: boolean;
  advisory_url?: string;
  notice?: string;
};
export async function publicRequest<T>(
  path: string,
  signal?: AbortSignal
): Promise<T> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (signal?.aborted) abort();
  signal?.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(abort, 10000);
  try {
    const response = await fetch("/api/v1/public/" + path, {
      signal: controller.signal,
      credentials: "omit",
      cache: "no-store",
    });
    if (!response.ok)
      throw new Error(
        "Public data is temporarily unavailable. Please retry shortly."
      );
    if (!response.headers.get("content-type")?.includes("application/json"))
      throw new Error("The public data service is not connected.");
    return await response.json();
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", abort);
  }
}
