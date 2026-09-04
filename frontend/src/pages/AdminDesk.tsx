import { useEffect, useState } from 'react';
import { Link } from 'wouter';
import { ShieldCheck, MapPin, LogOut, Radio, Car, BusFront, LockKeyhole } from 'lucide-react';
import { adminRequest, AdminError, type Admin, type AdminVehicle, type AdminDetail } from '@/lib/adminApi';
import './contributors.css';

export default function AdminDesk(){
  const [admin,setAdmin]=useState<Admin|null>(null);
  const [localities,setLocalities]=useState<{id:string;name:string}[]>([]);
  const [loading,setLoading]=useState(true);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const [vehicles,setVehicles]=useState<AdminVehicle[]>([]);
  const [truncated,setTruncated]=useState(false);
  const [selected,setSelected]=useState('');
  const [detail,setDetail]=useState<AdminDetail|null>(null);
  const [filter,setFilter]=useState('ALL');
  const [search,setSearch]=useState('');
  const [updated,setUpdated]=useState('');
  useEffect(()=>{const c=new AbortController();
    void adminRequest<{id:string;name:string}[]>('/localities','GET',undefined,c.signal).then(setLocalities).catch(e=>{if(e.name!=='AbortError')setError(e.message);});
    void adminRequest<{admin:Admin}>('/me','GET',undefined,c.signal).then(x=>setAdmin(x.admin)).catch(e=>{if(e.name!=='AbortError'&&e.status!==401)setError(e.message);}).finally(()=>setLoading(false));
    return()=>c.abort();
  },[]);
  useEffect(()=>{
    if(!admin)return;
    const c=new AbortController();let timer:ReturnType<typeof setTimeout>;
    async function poll(){
      if(document.hidden){setVehicles([]);setDetail(null);setUpdated('');timer=setTimeout(poll,5000);return;}
      try{
        const r=await adminRequest<{vehicles:AdminVehicle[];truncated:boolean}>('/vehicles','GET',undefined,c.signal);
        const d=selected?await adminRequest<AdminDetail>('/vehicles/'+selected,'GET',undefined,c.signal):null;
        if(!c.signal.aborted&&!document.hidden){setVehicles(r.vehicles);setTruncated(r.truncated);setDetail(d);setUpdated(new Date().toLocaleTimeString());setError('');}
      }catch(e){if(!c.signal.aborted){setVehicles([]);setDetail(null);setUpdated('');setError((e as Error).message);if(e instanceof AdminError&&e.status===401)setAdmin(null);if(e instanceof AdminError&&e.status===404)setSelected('');}}
      if(!c.signal.aborted)timer=setTimeout(poll,5000);
    }
    void poll();
    // Remove displayed footage immediately when this tab is hidden.
    const hide=()=>{if(document.hidden){setDetail(null);setVehicles([]);setUpdated('');}};
    document.addEventListener('visibilitychange',hide);
    return()=>{c.abort();clearTimeout(timer);document.removeEventListener('visibilitychange',hide);};
  },[admin,selected]);
  const shown=vehicles.filter(v=>(filter==='ALL'||v.vehicle_use===filter)&&v.number_plate.toLowerCase().includes(search.toLowerCase().replace(/\s/g,'')));
  async function signIn(e:React.FormEvent<HTMLFormElement>){
    e.preventDefault();setBusy(true);setError('');const f=new FormData(e.currentTarget);
    try{await adminRequest('/login','POST',{locality_id:f.get('locality'),slot:Number(f.get('slot')),secure_id:f.get('secure_id'),password:f.get('password')});const p=await adminRequest<{admin:Admin}>('/me');setAdmin(p.admin);}catch(e){setError((e as Error).message);}finally{setBusy(false);}
  }
  async function signOut(){
    setBusy(true);
    try{await adminRequest('/logout','POST');setAdmin(null);setVehicles([]);setSelected('');setDetail(null);setUpdated('');}
    catch(e){setError((e as Error).message);}finally{setBusy(false);}
  }
  return <div className="provider-page"><header className="provider-header"><Link href="/" className="flex items-center gap-3 font-semibold"><ShieldCheck className="text-emerald-300"/>Drishti / Admin desk</Link><nav className="flex gap-4 text-xs text-slate-400"><Link href="/gis">GIS + satellite</Link><Link href="/contribute">Contributors</Link></nav></header>
    <main className="mx-auto max-w-7xl space-y-6 px-5 py-10">
      <div className="flex flex-wrap items-start justify-between gap-4"><div><p className="provider-eyebrow">LOCALITY OPERATIONS / RESTRICTED ACCESS</p><h1 className="mt-3 text-3xl font-semibold sm:text-4xl">{admin?admin.locality_name+' command desk':'One locality. Two accountable admins.'}</h1><p className="mt-3 max-w-2xl text-sm leading-6 text-slate-400">A focused view of registered public vehicles and consenting private contributors. No city-wide tracking, no access outside your assigned locality.</p></div>{admin&&<button className="provider-secondary" disabled={busy} onClick={()=>void signOut()}><LogOut size={15}/>Sign out</button>}</div>
      <div className="provider-notice text-xs leading-6"><strong className="text-amber-200">Local demo only.</strong> The requested dummy login is not production security. Real deployments need unique strong credentials, HTTPS and an operator security review. No demo journeys are mixed into this desk.</div>
      {error&&<p role="alert" className="provider-error">{error}</p>}
      {loading?<p>Checking admin session…</p>:!admin?<section className="grid gap-6 lg:grid-cols-2"><form onSubmit={signIn} className="provider-card space-y-5"><div className="flex items-center gap-3"><LockKeyhole className="text-emerald-300"/><h2 className="text-xl font-semibold">Admin sign in</h2></div><div className="grid gap-4 sm:grid-cols-2"><label className="provider-label">Assigned locality<select required name="locality" className="provider-input"><option value="">Choose locality</option>{localities.map(l=><option key={l.id} value={l.id}>{l.name}</option>)}</select></label><label className="provider-label">Admin slot<select name="slot" className="provider-input"><option value="1">Admin 1</option><option value="2">Admin 2</option></select></label></div><label className="provider-label">Secure ID number<input required name="secure_id" autoComplete="username" inputMode="numeric" pattern="[0-9]{6,32}" maxLength={32} className="provider-input"/></label><label className="provider-label">Password<input required name="password" type="password" maxLength={128} autoComplete="current-password" className="provider-input"/></label><button disabled={busy||!localities.length} className="provider-primary w-full">{busy?'Signing in…':'Open my locality desk'}</button><p className="text-xs text-slate-500">Local dummy ID: <code>654321</code> · Password: <code>123456</code><br/>Choose either locality and Admin 1 or Admin 2.</p></form><aside className="provider-card space-y-5"><p className="provider-eyebrow">ACCESS BOUNDARIES</p>{[['Public vehicles','Assigned, acknowledged public-vehicle roster. GPS and camera access still require observation consent.'],['Private vehicles','Visible only after the contributor opts into this locality’s admin observation.'],['Live observations','Verified contacts, reviewed vehicle and a new active sharing session are required. Stop or withdrawal blocks further access.'],['Two separate slots','Admin 1 and Admin 2 have equal observation rights in their own locality. Neither can switch scope after login.']].map(([h,p])=><div key={h}><h3 className="text-sm font-semibold text-emerald-200">{h}</h3><p className="mt-2 text-sm leading-6 text-slate-400">{p}</p></div>)}</aside></section>:<>
        <section className="grid gap-4 sm:grid-cols-3">{[[<MapPin key="i"/>,admin.locality_name,'Admin '+admin.slot+' · assigned operating area'],[<BusFront key="i"/>,String(vehicles.filter(v=>v.vehicle_use==='PUBLIC').length),'Public vehicles listed'],[<Radio key="i"/>,String(vehicles.filter(v=>v.sharing_active).length),'Permitted active sessions']].map(([icon,value,label],i)=><article key={i} className="provider-card"><div className="mb-3 text-emerald-300">{icon}</div><p className="text-2xl font-semibold">{value}</p><p className="mt-2 text-xs text-slate-400">{label}</p></article>)}</section>
        <section className="grid items-start gap-5 lg:grid-cols-[.95fr_1.2fr]"><div className="provider-card space-y-4"><div><p className="provider-eyebrow">LOCAL VEHICLE ROSTER</p><h2 className="mt-2 text-xl font-semibold">Vehicles you can observe</h2></div><div className="flex flex-wrap gap-2"><input aria-label="Search number plate" placeholder="Search number plate" className="provider-input flex-1" value={search} onChange={e=>setSearch(e.target.value)}/><select aria-label="Vehicle type filter" className="provider-input !w-auto" value={filter} onChange={e=>setFilter(e.target.value)}><option value="ALL">All types</option><option value="PUBLIC">Public</option><option value="PRIVATE">Private / opt-in</option></select></div>{!shown.length?<div className="rounded-xl border border-dashed border-white/15 px-5 py-10 text-center"><Car className="mx-auto mb-4 text-slate-500"/><p className="text-sm">No matching vehicles yet</p><p className="mt-2 text-xs leading-6 text-slate-500">An owner must register a vehicle and save its operating locality in the contributor portal. Private vehicles also need admin observation consent. No external public-fleet feed is connected.</p></div>:shown.map(v=><button key={v.id} onClick={()=>{setDetail(null);setSelected(v.id);}} className={'block w-full rounded-xl border p-4 text-left '+(selected===v.id?'border-emerald-300/50 bg-emerald-300/5':'border-white/10')}><span className="flex justify-between gap-3"><strong className="tracking-wider">{v.number_plate}</strong><span className="text-xs text-emerald-300">{v.vehicle_use}</span></span><span className="mt-2 block text-xs text-slate-400">{v.verification_status.replaceAll('_',' ')} · {v.sharing_active?'Active sharing':v.admin_observation_consent?'Consented / no active session':'Roster only'}</span></button>)}{truncated&&<p className="text-xs text-amber-200">Showing the latest 500 permitted vehicles.</p>}<p className="text-xs text-slate-500">Refreshes every 5 seconds while visible · {updated?'Last checked '+updated:'Awaiting data'}</p></div>
          <div className="provider-card space-y-5"><p className="provider-eyebrow">CONSENTED OBSERVATION</p>{!selected?<p className="py-12 text-center text-sm text-slate-500">Select a vehicle to inspect its permitted active session.</p>:!detail?<p className="text-sm text-slate-400">Checking vehicle access…</p>:<><div><h2 className="text-2xl font-semibold tracking-wide">{detail.vehicle.number_plate}</h2><p className="mt-2 text-xs text-slate-400">{detail.vehicle.verification_status==='MANUAL_REVIEWED'?'Manually reviewed · not government verified':detail.vehicle.verification_status.replaceAll('_',' ')}</p></div>{!detail.session?<p className="provider-notice text-sm">No permitted active sharing session. Registration or public-vehicle status alone does not grant access to GPS or footage.</p>:<><p className="text-xs text-emerald-200">Sharing until {new Date(detail.session.expires_at).toLocaleTimeString()} · Observation consent enabled</p><div className="rounded-xl bg-white/5 p-4"><h3 className="text-sm font-semibold">Latest shared GPS</h3>{detail.gps[0]?<><p className="mt-3 font-mono text-lg">{detail.gps[0].latitude.toFixed(6)}, {detail.gps[0].longitude.toFixed(6)}</p><p className="mt-2 text-xs text-slate-400">±{Math.round(detail.gps[0].accuracy_m)} m · Captured {new Date(detail.gps[0].captured_at).toLocaleString()}</p><p className="mt-2 text-xs text-amber-200">Last received position, not proof of the vehicle’s current location.</p></>:<p className="mt-3 text-xs text-slate-500">{detail.session.gps_consent?'No GPS received in this session.':'GPS not permitted.'}</p>}</div><h3 className="text-sm font-semibold">Recent permitted footage / photos</h3>{!detail.media.length?<p className="text-xs text-slate-500">No permitted files received in this active session.</p>:<div className="grid gap-4 sm:grid-cols-2">{detail.media.map(m=><article key={m.id} className="overflow-hidden rounded-xl border border-white/10">{m.kind==='photo'?<img src={'/api/v1/admin/media/'+m.id} alt="Consented road observation" className="aspect-video w-full object-contain"/>:<video controls preload="none" src={'/api/v1/admin/media/'+m.id} className="aspect-video w-full"/>}<p className="p-3 text-xs text-slate-400">{new Date(m.captured_at).toLocaleString()} · {(m.byte_size/1024/1024).toFixed(1)} MB</p></article>)}</div>}<p className="text-xs leading-6 text-slate-500">Sampled clips, not continuous streaming. Coordinates and footage stay separate; automatic GPS/video matching is not implemented. Revocation removes future access; previously viewed data cannot be recalled.</p></>}</>}</div>
        </section></>}
    </main></div>;
}
