import { useCallback, useEffect, useState } from 'react';
import { MapContainer, TileLayer, LayersControl, GeoJSON, CircleMarker, Popup, useMapEvents } from 'react-leaflet';
import type { FeatureCollection } from 'geojson';
import 'leaflet/dist/leaflet.css';
import { PublicHeader } from '@/components/PublicHeader';
import { publicRequest, type PublicOverview, type PublicVehicle } from '@/lib/publicApi';
import { CLOUD_DEPLOYMENT } from '@/lib/deployment';

function Viewport({change}:{change:(query:string)=>void}){
  const map=useMapEvents({moveend:()=>update()});
  function update(){const b=map.getBounds();change(new URLSearchParams({minLng:String(b.getWest()),minLat:String(b.getSouth()),maxLng:String(b.getEast()),maxLat:String(b.getNorth())}).toString())}
  useEffect(()=>{update()},[map,change]);
  return null;
}

export default function PublicGis(){
  const [bounds,setBounds]=useState(''),[roads,setRoads]=useState<FeatureCollection|null>(null),[grid,setGrid]=useState<FeatureCollection|null>(null);
  const [overview,setOverview]=useState<PublicOverview|null>(null),[vehicles,setVehicles]=useState<PublicVehicle[]>([]);
  const [error,setError]=useState(''),[fleetError,setFleetError]=useState(''),[updatesError,setUpdatesError]=useState(''),[truncated,setTruncated]=useState(false);
  const [showGrid,setShowGrid]=useState(false),[showFleet,setShowFleet]=useState(true),[showReports,setShowReports]=useState(true),[showAi,setShowAi]=useState(true);
  const viewport=useCallback((query:string)=>setBounds(query),[]);
  useEffect(()=>{const timer=setInterval(()=>setVehicles(previous=>{const fresh=previous.filter(v=>Date.now()-new Date(v.captured_at).getTime()<=90000);return fresh.length===previous.length?previous:fresh}),1000);return()=>clearInterval(timer)},[]);
  useEffect(()=>{if(!bounds)return;const c=new AbortController();setError('');setRoads(null);setGrid(null);setTruncated(false);
    Promise.all([publicRequest<FeatureCollection & {truncated:boolean}>('roads?'+bounds,c.signal),publicRequest<FeatureCollection & {truncated:boolean}>('grid?'+bounds,c.signal)])
    .then(([r,g])=>{if(c.signal.aborted)return;setRoads(r);setGrid(g);setTruncated(r.truncated||g.truncated)})
    .catch(()=>{if(!c.signal.aborted)setError('Map coverage could not load. Zoom in or move the map to retry.')});return()=>c.abort()},[bounds]);
  useEffect(()=>{if(CLOUD_DEPLOYMENT)return;let timer:ReturnType<typeof setTimeout>;let active:AbortController|null=null;let disposed=false;
    async function poll(){if(disposed)return;if(document.hidden){setVehicles([]);timer=setTimeout(poll,10000);return;}active=new AbortController();
      try{const result=await publicRequest<{vehicles:PublicVehicle[]}>('vehicles',active.signal);if(disposed||active.signal.aborted)return;setVehicles(result.vehicles.filter(v=>Date.now()-new Date(v.captured_at).getTime()<=90000));setFleetError('')}
      catch{if(!disposed){setVehicles([]);setFleetError('Live locations unavailable. Previous markers have been cleared.')}}
      if(!disposed)timer=setTimeout(poll,10000);
    }
    const hide=()=>{if(document.hidden){active?.abort();setVehicles([])}};document.addEventListener('visibilitychange',hide);void poll();return()=>{disposed=true;clearTimeout(timer);active?.abort();document.removeEventListener('visibilitychange',hide)}
  },[]);
  useEffect(()=>{const c=new AbortController();publicRequest<PublicOverview>('overview',c.signal).then(setOverview).catch(()=>{if(!c.signal.aborted)setUpdatesError('Published updates are temporarily unavailable.')});return()=>c.abort()},[]);
  return <div className="min-h-screen bg-[#04101b] text-slate-200"><PublicHeader/><main className="mx-auto max-w-[1600px] space-y-4 px-4 py-6"><div className="flex flex-wrap items-end justify-between gap-3"><div><p className="text-xs uppercase tracking-widest text-emerald-300">Public map · West Delhi</p><h1 className="mt-2 text-2xl font-semibold">Roads, progress & public transport</h1></div><span className="text-xs text-slate-400">{vehicles.length} authorized public vehicles reporting</span></div>
    <div className="flex flex-wrap gap-4 rounded-xl border border-white/10 bg-[#091827] p-4 text-sm">{[{label:'50 m grid',value:showGrid,set:setShowGrid},{label:'Public transport',value:showFleet,set:setShowFleet},{label:'Published reports',value:showReports,set:setShowReports},{label:'OmniView reviewed checks',value:showAi,set:setShowAi}].map(x=><label key={x.label} className="flex items-center gap-2"><input className="accent-emerald-300" type="checkbox" checked={x.value} onChange={e=>x.set(e.target.checked)}/>{x.label}</label>)}</div>
    <p className="text-xs leading-6 text-slate-400">Street / satellite switch: top right of map. Satellite imagery is historical, not live. No private vehicles, number plates, RC or camera streams are published.</p>
    {CLOUD_DEPLOYMENT&&<p role="status" className="rounded-xl border border-amber-300/30 p-3 text-sm text-amber-200">Basemap preview only. Local PostGIS road layers and reviewed severity results have not been published to the cloud yet. Recorded GPS is not a live vehicle feed. OmniView batch assessment is a separate, deferred service.</p>}
    {(error||fleetError||updatesError)&&<p role="alert" className="rounded-xl border border-amber-300/30 p-3 text-sm text-amber-200">{[error,fleetError,updatesError].filter(Boolean).join(' ')}</p>}
    {truncated&&<p role="status" className="text-xs text-amber-200">Some features are outside the display limit. Zoom in for more detail.</p>}
    <section aria-label="Public geographic map" className="h-[65vh] min-h-[420px] overflow-hidden rounded-2xl border border-white/10"><MapContainer center={[28.65,77.08]} zoom={12} minZoom={9} maxZoom={19} className="h-full w-full" scrollWheelZoom>
      <Viewport change={viewport}/><LayersControl position="topright"><LayersControl.BaseLayer checked name="Streets"><TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>'/></LayersControl.BaseLayer><LayersControl.BaseLayer name="Satellite / aerial"><TileLayer url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}" attribution="Tiles © Esri — Source: Esri, Maxar, Earthstar Geographics and the GIS User Community"/></LayersControl.BaseLayer></LayersControl>
      {roads&&<GeoJSON key={'roads'+bounds} data={roads} style={{color:'#38bdf8',weight:3,opacity:.8}}/>}
      {grid&&showGrid&&<GeoJSON key={'grid'+bounds} data={grid} style={{color:'#94a3b8',weight:1,fillOpacity:.06}}/>}
      {showFleet&&vehicles.map(v=><CircleMarker key={v.public_id} center={[v.latitude,v.longitude]} radius={8} pathOptions={{color:'#ecfdf5',fillColor:'#34d399',fillOpacity:1,weight:2}}><Popup><strong>{v.label}</strong><p>Camera-mounted public vehicle</p><p>Reported {new Date(v.captured_at).toLocaleTimeString()} · accuracy ±{Math.round(v.accuracy_m)} m</p><p>Location only · no camera stream</p></Popup></CircleMarker>)}
      {overview?.updates.filter(u=>u.latitude!==null&&u.longitude!==null&&((u.category==='REPORT'&&showReports)||(u.category==='OMNIVIEW'&&showAi))).map(u=><CircleMarker key={u.id} center={[u.latitude!,u.longitude!]} radius={7} pathOptions={{color:u.status==='RESOLVED'?'#34d399':'#fbbf24',fillOpacity:.9}}><Popup><strong>{u.title}</strong><p>{u.status.replaceAll('_',' ')}</p><p>{u.summary}</p><p>Published {new Date(u.updated_at).toLocaleDateString()}</p></Popup></CircleMarker>)}
    </MapContainer></section>
    <div className="flex flex-wrap gap-5 text-xs"><span className="text-sky-300">Blue — mapped roads</span><span className="text-slate-400">Grey — unassessed grid</span><span className="text-emerald-300">Green vehicle — recently reported location</span><span className="text-amber-200">Amber report — not resolved</span><span className="text-emerald-300">Green report — resolved</span></div>
    {!vehicles.length&&!fleetError&&<p className="rounded-xl bg-white/5 p-4 text-sm text-slate-400">No authorized public-vehicle feed is currently available. We do not show simulated locations as live.</p>}
    <p className="text-xs text-slate-500">OmniView model validation is pending. Grey/unobserved areas are not certified safe. Locations older than 90 seconds are excluded on refresh. Not for navigation or enforcement.</p>
  </main></div>
}
