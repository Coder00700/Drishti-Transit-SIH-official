import { useEffect, useMemo, useState } from "react";
import { Link } from "wouter";
import {
  AlertTriangle,
  ArrowUpRight,
  BusFront,
  CheckCircle2,
  CloudRain,
  Construction,
  MapPinned,
  Moon,
  Navigation,
  Sun,
  TrainFront,
  Wind,
} from "lucide-react";
import {
  CircleMarker,
  MapContainer,
  Polyline,
  Popup,
  TileLayer,
} from "react-leaflet";
import { useTheme } from "@/contexts/ThemeContext";
import {
  publicRequest,
  type DemoOverview,
  type AirQualitySnapshot,
  type PublicOverview,
  type TrafficSnapshot,
  type WeatherSnapshot,
} from "@/lib/publicApi";
import "leaflet/dist/leaflet.css";
import "./theme-preview.css";

const demoRoads: Array<{
  name: string;
  points: [number, number][];
  color: string;
  status: string;
}> = [
  {
    name: "Rohtak Road · Nangloi",
    points: [
      [28.681, 77.064],
      [28.676, 77.08],
      [28.67, 77.096],
    ],
    color: "#ef4444",
    status: "High severity · demo",
  },
  {
    name: "Najafgarh Road · Uttam Nagar",
    points: [
      [28.621, 77.041],
      [28.623, 77.061],
      [28.624, 77.082],
    ],
    color: "#f59e0b",
    status: "Moderate severity · demo",
  },
  {
    name: "Outer Ring Road · Paschim Vihar",
    points: [
      [28.67, 77.104],
      [28.661, 77.117],
      [28.651, 77.128],
    ],
    color: "#22c55e",
    status: "Resolved · demo",
  },
];

const updates = [
  {
    locality: "Nangloi",
    title: "Surface repair work tracked",
    status: "In progress",
    icon: Construction,
    tone: "amber",
  },
  {
    locality: "Uttam Nagar",
    title: "Drainage risk inspection scheduled",
    status: "Reported",
    icon: CloudRain,
    tone: "blue",
  },
  {
    locality: "Paschim Vihar",
    title: "Maintenance follow-up completed",
    status: "Resolved",
    icon: CheckCircle2,
    tone: "green",
  },
];

export default function ThemePreview() {
  const { theme, toggleTheme } = useTheme();
  const dark = theme === "dark";
  const [publicData, setPublicData] = useState<PublicOverview | null>(null);
  const [demo, setDemo] = useState<DemoOverview | null>(null);
  const [weather, setWeather] = useState<WeatherSnapshot | null>(null);
  const [weatherFailed, setWeatherFailed] = useState(false);
  const [airQuality, setAirQuality] = useState<AirQualitySnapshot | null>(null);
  const [traffic, setTraffic] = useState<TrafficSnapshot | null>(null);
  useEffect(() => {
    const c = new AbortController();
    Promise.allSettled([
      publicRequest<PublicOverview>("overview", c.signal).then(setPublicData),
      publicRequest<DemoOverview>("demo/overview", c.signal).then(setDemo),
      publicRequest<WeatherSnapshot>("weather", c.signal).then(setWeather).catch(() => setWeatherFailed(true)),
      publicRequest<AirQualitySnapshot>("air-quality", c.signal).then(setAirQuality),
      publicRequest<TrafficSnapshot>("traffic", c.signal).then(setTraffic),
    ]);
    return () => c.abort();
  }, []);
  const mapTiles = useMemo(
    () =>
      dark
        ? "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
        : "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
    [dark]
  );
  return (
    <div className="preview-shell">
      <header className="preview-header">
        <Link href="/design-preview" className="preview-brand">
          <span className="preview-logo">
            <MapPinned size={22} />
          </span>
          <span>
            DRISHTI<small>Delhi road intelligence</small>
          </span>
        </Link>
        <nav aria-label="Preview navigation">
          <a href="#overview">Overview</a>
          <a href="#map">Live map</a>
          <a href="#updates">Updates</a>
        </nav>
        <div className="preview-actions">
          <span className="demo-pill">DEMO MODE</span>
          <button
            type="button"
            className="theme-button"
            onClick={toggleTheme}
            aria-label={`Switch to ${dark ? "light" : "dark"} mode`}
          >
            {dark ? <Sun size={18} /> : <Moon size={18} />}
          </button>
          <Link href="/contribute/login" className="contributor-link">
            Contribute <ArrowUpRight size={16} />
          </Link>
        </div>
      </header>

      <main className="preview-main">
        <section
          className="preview-hero"
          style={{
            backgroundImage: `linear-gradient(90deg, ${dark ? "rgba(5,15,35,.96),rgba(5,15,35,.45)" : "rgba(248,250,255,.97),rgba(248,250,255,.42)"}, transparent), url(/home_image.png)`,
          }}
        >
          <div className="hero-copy">
            <p className="eyebrow">PUBLIC ROAD PROGRESS · DELHI</p>
            <h1>
              One view of the roads
              <br />
              that keep Delhi moving.
            </h1>
            <p>
              See reviewed road conditions, authority work updates, transit
              movement and current travel context—without exposing contributor
              information.
            </p>
            <div className="hero-buttons">
              <a href="#map" className="primary-action">
                <Navigation size={18} />
                Explore the map
              </a>
              <a href="#updates" className="secondary-action">
                View public updates
              </a>
            </div>
          </div>
          <div className="hero-status">
            <span>
              <i /> Public services available
            </span>
            <strong>{demo?.coverage.localities ?? "—"}</strong>
            <small>
              localities represented in clearly labelled demonstration data
            </small>
          </div>
        </section>

        <section
          id="overview"
          className="metric-grid"
          aria-label="Public overview"
        >
          <article>
            <span className="metric-icon weather">
              <CloudRain />
            </span>
            <div>
              <small>Delhi weather</small>
              <strong>
                {weather?.temperature_c === undefined
                  ? weatherFailed ? "Unavailable" : "—"
                  : Math.round(weather.temperature_c) + "°C"}
              </strong>
              <p>
                {weather
                  ? `${weather.rain_probability_percent ?? 0}% rain · ${weather.humidity_percent ?? 0}% humidity`
                  : weatherFailed ? "Weather providers are temporarily unavailable" : "Weather feed loading"}
              </p>
            </div>
            <em>{weather?.live ? (weather.fallback ? "Backup live" : "Live") : weatherFailed ? "Offline" : "Waiting"}</em>
          </article>
          <article>
            <span className="metric-icon transit">
              <TrainFront />
            </span>
            <div>
              <small>Public transport</small>
              <strong>Metro + Bus</strong>
              <p>Routes and stops layer ready</p>
            </div>
            <em>Static feed</em>
          </article>
          <article>
            <span className="metric-icon traffic">
              <Navigation />
            </span>
            <div>
              <small>Traffic information</small>
              <strong>{traffic?.live ? `${traffic.features.length} incidents` : "Advisories"}</strong>
              <p>{traffic?.live ? "Licensed live traffic feed" : "Official Delhi Police notices"}</p>
            </div>
            <em>{traffic?.live ? "Live" : "Official link"}</em>
          </article>
          <article>
            <span className="metric-icon weather"><Wind /></span>
            <div>
              <small>Delhi air quality</small>
              <strong>{airQuality?.us_aqi == null ? "—" : `AQI ${Math.round(airQuality.us_aqi)}`}</strong>
              <p>{airQuality ? `PM2.5 ${airQuality.pm2_5 ?? "—"} µg/m³` : "Air-quality feed loading"}</p>
            </div>
            <em>{airQuality?.live ? "Live" : "Waiting"}</em>
          </article>
          <article>
            <span className="metric-icon alert">
              <AlertTriangle />
            </span>
            <div>
              <small>Published reports</small>
              <strong>{publicData?.reports.published ?? 0}</strong>
              <p>
                {publicData?.reports.in_progress ?? 0} in progress ·{" "}
                {publicData?.reports.resolved ?? 0} resolved
              </p>
            </div>
            <em>Verified</em>
          </article>
        </section>

        <section id="map" className="map-workspace">
          <div className="section-heading">
            <div>
              <p className="eyebrow">CITY OPERATIONS VIEW</p>
              <h2>Roads, transit and traffic</h2>
            </div>
            <div className="freshness">
              <i /> Updated for preview · 11:42
            </div>
          </div>
          <div className="map-layout">
            <div className="map-card">
              <div className="map-chips">
                <button className="active">Road severity</button>
                <button>
                  <TrainFront size={15} /> Metro
                </button>
                <button>
                  <BusFront size={15} /> Buses
                </button>
                <button>Traffic</button>
              </div>
              <MapContainer
                center={[28.65, 77.08]}
                zoom={12}
                minZoom={10}
                className="preview-map"
                scrollWheelZoom
              >
                <TileLayer
                  key={mapTiles}
                  url={mapTiles}
                  attribution="&copy; OpenStreetMap contributors &copy; CARTO"
                />
                {demoRoads.map(road => (
                  <Polyline
                    key={road.name}
                    positions={road.points}
                    pathOptions={{ color: road.color, weight: 7, opacity: 0.9 }}
                  >
                    <Popup>
                      <strong>{road.name}</strong>
                      <br />
                      {road.status}
                      <br />
                      <small>Synthetic demonstration</small>
                    </Popup>
                  </Polyline>
                ))}
                <CircleMarker
                  center={[28.657, 77.099]}
                  radius={9}
                  pathOptions={{
                    color: "#fff",
                    fillColor: "#3156e8",
                    fillOpacity: 1,
                  }}
                >
                  <Popup>Metro interchange · demonstration marker</Popup>
                </CircleMarker>
              </MapContainer>
              <div className="map-legend">
                <span>
                  <i className="critical" />
                  High severity
                </span>
                <span>
                  <i className="moderate" />
                  Moderate
                </span>
                <span>
                  <i className="resolved" />
                  Resolved
                </span>
                <span>
                  <i className="metro" />
                  Transit
                </span>
              </div>
            </div>
            <aside className="travel-panel">
              <div className="travel-title">
                <span>
                  <Wind size={18} />
                </span>
                <div>
                  <small>TRAVEL CONTEXT</small>
                  <strong>West Delhi</strong>
                </div>
              </div>
              <div className="traffic-meter">
                <div>
                  <span>Traffic source</span>
                  <b>{traffic?.live ? "Live incidents" : "Official advisories"}</b>
                </div>
                {traffic?.live && <progress value={Math.min(traffic.features.length, 100)} max="100" />}
                <small>{traffic?.notice ?? traffic?.provider ?? "Checking traffic provider"}</small>
                {traffic?.advisory_url && <a href={traffic.advisory_url} target="_blank" rel="noreferrer">Open Delhi Traffic Police advisories</a>}
              </div>
              <div className="alert-card">
                <AlertTriangle />
                <div>
                  <strong>Waterlogging watch</strong>
                  <p>Two demonstration alerts near low-lying corridors.</p>
                  <button>Show on map</button>
                </div>
              </div>
              <div className="line-list">
                <p>TRANSIT LAYERS</p>
                <span>
                  <i className="blue-line" />
                  Blue Line metro <b>Visible</b>
                </span>
                <span>
                  <i className="green-line" />
                  Delhi bus routes <b>Ready</b>
                </span>
                <span>
                  <i className="grey-line" />
                  Railway stations <b>Ready</b>
                </span>
              </div>
            </aside>
          </div>
        </section>

        <section id="updates" className="updates-section">
          <div className="section-heading">
            <div>
              <p className="eyebrow">AUTHORITY PUBLICATIONS</p>
              <h2>Latest locality updates</h2>
            </div>
            <span className="demo-disclaimer">
              Synthetic demonstration data · not official field reports
            </span>
          </div>
          <div className="update-grid">
            {(
              demo?.updates?.slice(0, 6) ??
              updates.map((u, i) => ({
                id: String(i),
                area_id: u.locality,
                title: u.title,
                status: u.status,
                updated_at: "2026-09-05T09:00:00Z",
              }))
            ).map((u, i) => {
              const Icon = [Construction, CloudRain, CheckCircle2][i % 3];
              const tone = ["amber", "blue", "green"][i % 3];
              const locality = String(
                ("locality_name" in u && u.locality_name) ||
                  u.area_id.replaceAll("-", " ")
              );
              return (
                <article key={u.id}>
                  <span className={`update-icon ${tone}`}>
                    <Icon />
                  </span>
                  <p>{locality}</p>
                  <h3>{u.title}</h3>
                  <div>
                    <span>{u.status.replaceAll("_", " ")}</span>
                    <time>
                      {new Date(u.updated_at).toLocaleDateString("en-IN")}
                    </time>
                  </div>
                  <button>
                    Demo details <ArrowUpRight size={15} />
                  </button>
                </article>
              );
            })}
          </div>
        </section>
      </main>
      <footer className="preview-footer">
        <span>Drishti Transit · Independent prototype</span>
        <span>
          Demo information is visibly separated from verified publications.
        </span>
      </footer>
    </div>
  );
}
