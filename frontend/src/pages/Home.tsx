import { useEffect, useMemo, useRef, useState } from "react";
import { Activity, Bot, BusFront, Camera, ChevronRight, CircleGauge, Clock3, Gauge, Map, MapPinned, Radio, RefreshCw, Route, Users, X, type LucideIcon } from "lucide-react";
import { useLocation } from "wouter";

import { WestDelhiFleetMap } from "@/components/fleet/WestDelhiFleetMap";
import { analyzeBusFrame, cameraUrl, DUMMY_BUSES, getBuses, type Bus, type BusFrameAnalysis } from "@/lib/busOperations";

function statusLabel(status: Bus["status"]) {
  return status === "ON_ROUTE" ? "On route" : status === "AT_STOP" ? "At stop" : "Delayed";
}

export default function Home() {
  const [buses, setBuses] = useState(DUMMY_BUSES);
  const [selectedId, setSelectedId] = useState(DUMMY_BUSES[0].id);
  const [cameraBus, setCameraBus] = useState<Bus | null>(null);
  const [sourceMode, setSourceMode] = useState<"api" | "dummy">("dummy");
  const [analysis, setAnalysis] = useState<BusFrameAnalysis | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [, setLocation] = useLocation();

  const selectedBus = buses.find((bus) => bus.id === selectedId) ?? buses[0];
  const averageSpeed = Math.round(buses.reduce((sum, bus) => sum + bus.speedKmh, 0) / buses.length);
  const activeCount = buses.filter((bus) => bus.status !== "AT_STOP").length;
  const updatedAt = useMemo(() => new Date(), [buses]);
  const metrics: Array<[string, string | number, LucideIcon, string]> = [
    ["Fleet online", `${buses.length}/${buses.length}`, BusFront, "text-cyan-300"],
    ["Moving now", activeCount, Activity, "text-emerald-300"],
    ["Average speed", `${averageSpeed} km/h`, Gauge, "text-amber-300"],
    ["Route alerts", buses.filter((bus) => bus.status === "DELAYED").length, Clock3, "text-rose-300"],
  ];

  useEffect(() => {
    const controller = new AbortController();
    getBuses(controller.signal).then((items) => {
      setBuses(items);
      setSourceMode("api");
    }).catch(() => setSourceMode("dummy"));
    return () => controller.abort();
  }, []);

  function focusBus(bus: Bus) {
    setSelectedId(bus.id);
    document.querySelector("#fleet-map")?.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  async function runAnalysis() {
    if (!cameraBus) return;
    setAnalyzing(true);
    setAnalysisError(null);
    try {
      let imageDataUrl: string | undefined;
      const video = videoRef.current;
      if (video && video.readyState >= 2 && video.videoWidth > 0) {
        const canvas = document.createElement("canvas");
        canvas.width = Math.min(video.videoWidth, 960);
        canvas.height = Math.round((canvas.width / video.videoWidth) * video.videoHeight);
        canvas.getContext("2d")?.drawImage(video, 0, 0, canvas.width, canvas.height);
        imageDataUrl = canvas.toDataURL("image/jpeg", 0.72);
      }
      setAnalysis(await analyzeBusFrame(cameraBus.id, imageDataUrl));
    } catch {
      setAnalysisError("Analysis could not be completed. Check the local API and try again.");
    } finally {
      setAnalyzing(false);
    }
  }

  return (
    <div className="min-h-screen bg-[#04101b] text-slate-200">
      <header className="sticky top-0 z-30 border-b border-white/10 bg-[#061421]/95 backdrop-blur-xl">
        <div className="mx-auto flex max-w-[1500px] items-center justify-between gap-4 px-4 py-3 sm:px-6">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-cyan-300 text-[#04101b]"><BusFront size={22} /></div>
            <div><h1 className="text-base font-extrabold text-white sm:text-lg">Drishti Bus Command</h1><p className="text-[9px] font-bold uppercase tracking-[.2em] text-slate-500">Step 5 · West Delhi fleet operations</p></div>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={() => setLocation("/gis")}
              className="flex items-center gap-2 rounded-lg border border-emerald-300/30 bg-emerald-300/10 px-3 py-2 text-xs font-bold text-emerald-300 hover:bg-emerald-300/20"
            >
              <Map size={14} />
              <span>GIS Map</span>
            </button>
            <button onClick={() => setLocation('/contribute')} className="rounded-lg border border-emerald-300/30 px-3 py-2 text-xs text-emerald-300">Contribute data</button>
            <button onClick={() => setLocation('/admin')} className="rounded-lg border border-amber-300/30 px-3 py-2 text-xs text-amber-200">Admin desk</button>
            <span className="hidden items-center gap-2 rounded-full border border-emerald-300/20 bg-emerald-300/10 px-3 py-1.5 text-[10px] font-bold text-emerald-300 sm:flex"><i className="h-2 w-2 animate-pulse rounded-full bg-emerald-300" /> LIVE MONITORING</span>
            <span className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-[10px] text-slate-400">{sourceMode === "api" ? "LOCAL API" : "DUMMY MODE"}</span>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[1500px] space-y-5 px-4 py-5 sm:px-6">
        <section className="flex flex-col justify-between gap-3 lg:flex-row lg:items-end">
          <div><p className="text-[10px] font-bold uppercase tracking-[.2em] text-cyan-300">Fleet overview</p><h2 className="mt-1 text-2xl font-extrabold text-white sm:text-3xl">West Delhi buses, one operational view.</h2><p className="mt-2 max-w-2xl text-sm text-slate-400">Track bus locations, inspect routes and open the onboard camera. All current records are safe dummy data.</p></div>
          <p className="mono text-[9px] text-slate-500">SYNCED {updatedAt.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</p>
        </section>

        <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {metrics.map(([label, value, Icon, tone]) => <article key={label} className="rounded-2xl border border-white/10 bg-[#091827] p-4 shadow-xl"><div className="flex items-center justify-between text-xs text-slate-500"><span>{label}</span><Icon size={17} className={tone} /></div><p className="mt-3 text-2xl font-extrabold text-white">{value}</p></article>)}
        </section>

        <section className="grid gap-5 xl:grid-cols-[minmax(0,1.6fr)_minmax(360px,.8fr)]">
          <WestDelhiFleetMap buses={buses} selectedId={selectedId} onSelect={(bus) => setSelectedId(bus.id)} />
          <aside className="overflow-hidden rounded-[22px] border border-white/10 bg-[#091827]">
            <div className="flex items-center justify-between border-b border-white/10 px-5 py-4"><div><p className="text-[10px] font-bold uppercase tracking-[.18em] text-slate-500">Fleet directory</p><h2 className="mt-1 font-bold text-white">Buses in service</h2></div><RefreshCw size={17} className="text-slate-500" /></div>
            <div className="max-h-[535px] divide-y divide-white/[.07] overflow-y-auto">
              {buses.map((bus) => {
                const active = bus.id === selectedId;
                return <article key={bus.id} className={`p-4 transition ${active ? "bg-cyan-300/[.07]" : "hover:bg-white/[.025]"}`}>
                  <div className="flex items-start justify-between gap-3"><button onClick={() => focusBus(bus)} className="min-w-0 text-left"><div className="flex items-center gap-2"><span className="rounded-md bg-cyan-300 px-2 py-1 text-xs font-black text-[#04101b]">{bus.routeNumber}</span><span className="font-bold text-white">{bus.numberPlate}</span></div><p className="mt-2 truncate text-xs text-slate-400">{bus.route}</p></button><span className={`rounded-full px-2 py-1 text-[9px] font-bold ${bus.status === "DELAYED" ? "bg-amber-300/10 text-amber-300" : "bg-emerald-300/10 text-emerald-300"}`}>{statusLabel(bus.status)}</span></div>
                  <div className="mt-3 grid grid-cols-3 gap-2 text-center"><div className="rounded-lg bg-black/20 p-2"><p className="text-xs font-bold text-white">{bus.speedKmh}</p><p className="text-[8px] text-slate-500">KM/H</p></div><div className="rounded-lg bg-black/20 p-2"><p className="text-xs font-bold text-white">{bus.occupancy}%</p><p className="text-[8px] text-slate-500">LOAD</p></div><div className="rounded-lg bg-black/20 p-2"><p className="text-xs font-bold text-white">{bus.etaMinutes}m</p><p className="text-[8px] text-slate-500">NEXT STOP</p></div></div>
                  <div className="mt-3 flex gap-2"><button onClick={() => focusBus(bus)} className="flex flex-1 items-center justify-center gap-2 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-[10px] font-bold text-slate-300 hover:border-cyan-300/30"><MapPinned size={13}/> GPS location</button><button onClick={() => { setCameraBus(bus); setAnalysis(null); setAnalysisError(null); }} className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-cyan-300 px-3 py-2 text-[10px] font-black text-[#04101b] hover:bg-cyan-200"><Camera size={13}/> Open camera</button></div>
                </article>;
              })}
            </div>
          </aside>
        </section>

        {selectedBus && <section className="grid gap-3 rounded-2xl border border-cyan-300/15 bg-cyan-300/[.045] p-4 sm:grid-cols-[1.2fr_1fr_1fr_auto] sm:items-center"><div><p className="text-[9px] font-bold uppercase tracking-[.16em] text-cyan-300">Selected bus</p><p className="mt-1 font-bold text-white">{selectedBus.numberPlate} · Route {selectedBus.routeNumber}</p></div><div><p className="text-[9px] text-slate-500">CURRENT LOCATION</p><p className="mt-1 text-xs text-slate-200">{selectedBus.currentStop}</p></div><div><p className="text-[9px] text-slate-500">NEXT STOP</p><p className="mt-1 text-xs text-slate-200">{selectedBus.nextStop} · {selectedBus.etaMinutes} min</p></div><button onClick={() => setCameraBus(selectedBus)} className="flex items-center gap-2 rounded-lg border border-cyan-300/25 px-4 py-2 text-xs font-bold text-cyan-300">View feed <ChevronRight size={14}/></button></section>}
      </main>

      {cameraBus && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-3 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label={`Camera for ${cameraBus.numberPlate}`}>
        <div className="w-full max-w-5xl overflow-hidden rounded-[24px] border border-white/15 bg-[#071522] shadow-2xl">
          <div className="flex items-center justify-between border-b border-white/10 px-5 py-4"><div className="flex items-center gap-3"><span className="flex items-center gap-2 rounded-full bg-rose-400/10 px-2.5 py-1 text-[9px] font-bold text-rose-300"><Radio size={11} className="animate-pulse"/> DEMO FEED</span><div><p className="text-sm font-bold text-white">{cameraBus.numberPlate} · Route {cameraBus.routeNumber}</p><p className="text-[10px] text-slate-500">{cameraBus.currentStop}, West Delhi</p></div></div><button onClick={() => setCameraBus(null)} className="rounded-lg border border-white/10 p-2 text-slate-400 hover:text-white" aria-label="Close camera"><X size={18}/></button></div>
          <div className="grid lg:grid-cols-[1.55fr_.75fr]">
            <div className="scanlines relative min-h-[300px] bg-black"><video ref={videoRef} src={cameraUrl(cameraBus.id)} controls autoPlay muted loop playsInline crossOrigin="anonymous" className="h-full max-h-[560px] w-full object-contain"/><div className="pointer-events-none absolute left-4 top-4 z-20 rounded bg-black/60 px-2 py-1 text-[9px] font-bold text-white">CAM-01 · {new Date().toLocaleTimeString("en-IN")}</div></div>
            <div className="border-t border-white/10 p-5 lg:border-l lg:border-t-0"><div className="flex items-center gap-2"><Bot size={18} className="text-cyan-300"/><h3 className="font-bold text-white">OpenAI scene check</h3></div><p className="mt-2 text-xs leading-5 text-slate-400">Captures one frame and sends it through the protected backend. GPS data stays with the fleet service.</p><button onClick={() => void runAnalysis()} disabled={analyzing} className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-cyan-300 px-4 py-3 text-xs font-black text-[#04101b] disabled:opacity-60">{analyzing ? <CircleGauge size={16} className="animate-spin"/> : <Bot size={16}/>} {analyzing ? "Analyzing frame…" : "Run AI check"}</button>
              {analysis && <div className="mt-4 space-y-3 rounded-xl border border-white/10 bg-black/20 p-4"><div className="flex items-center justify-between"><span className="text-[9px] font-bold uppercase tracking-wider text-emerald-300">Analysis ready</span><span className="text-[8px] text-slate-500">{analysis.mode === "openai" ? analysis.model : "DUMMY RESULT"}</span></div><p className="text-xs leading-5 text-white">{analysis.summary}</p><div className="grid grid-cols-2 gap-2"><div className="rounded-lg bg-white/5 p-2"><p className="text-[8px] text-slate-500">ROAD</p><p className="mt-1 text-[10px] font-bold text-white">{analysis.roadCondition}</p></div><div className="rounded-lg bg-white/5 p-2"><p className="text-[8px] text-slate-500">TRAFFIC</p><p className="mt-1 text-[10px] font-bold text-white">{analysis.trafficLevel}</p></div></div>{analysis.alerts.map((alert) => <p key={alert} className="text-[10px] text-amber-200">• {alert}</p>)}</div>}
              {analysisError && <p className="mt-4 rounded-lg bg-rose-400/10 p-3 text-xs text-rose-200">{analysisError}</p>}
              <div className="mt-5 space-y-3 border-t border-white/10 pt-4 text-[10px] text-slate-500"><p className="flex items-center justify-between"><span className="flex items-center gap-2"><Route size={12}/> Next stop</span><strong className="text-slate-300">{cameraBus.nextStop}</strong></p><p className="flex items-center justify-between"><span className="flex items-center gap-2"><Users size={12}/> Occupancy</span><strong className="text-slate-300">{cameraBus.occupancy}%</strong></p><p className="flex items-center justify-between"><span className="flex items-center gap-2"><Gauge size={12}/> Speed</span><strong className="text-slate-300">{cameraBus.speedKmh} km/h</strong></p></div>
            </div>
          </div>
        </div>
      </div>}
    </div>
  );
}
