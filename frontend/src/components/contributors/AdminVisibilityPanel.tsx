import { useEffect, useState } from 'react';
import { contributorRequest, type ContributorVehicle } from '@/lib/contributorApi';

export function AdminVisibilityPanel({vehicle,refresh}:{vehicle:ContributorVehicle;refresh:()=>Promise<unknown>}) {
  const [localities,setLocalities]=useState<{id:string;name:string}[]>([]);
  const [area,setArea]=useState(vehicle.locality_id||'');
  const [observe,setObserve]=useState(vehicle.admin_observation_consent);
  const [listing,setListing]=useState(vehicle.public_listing_accepted);
  const [message,setMessage]=useState('');
  const [busy,setBusy]=useState(false);
  useEffect(()=>{const c=new AbortController();void fetch('/api/v1/admin/localities',{signal:c.signal}).then(r=>{if(!r.ok)throw Error('Localities unavailable');return r.json();}).then(setLocalities).catch(e=>{if(e.name!=='AbortError')setMessage('Localities unavailable. Retry after the backend is running.');});return()=>c.abort();},[]);
  return <form className="w-full space-y-3 border-t border-white/10 pt-4" onSubmit={async e=>{
    e.preventDefault();setBusy(true);setMessage('');
    try{await contributorRequest('/vehicles/'+vehicle.id+'/admin-visibility','PUT',{locality_id:area||null,observe:!!area&&observe,public_listing_accepted:!!area&&listing,policy_version:'locality-observation-v1'});await refresh();setMessage('Saved. Previous sharing stopped; start a new session to share with this locality.');}
    catch(e){setMessage((e as Error).message);}finally{setBusy(false);}
  }}>
    <label className="provider-label">Operating locality for {vehicle.number_plate}<select className="provider-input" value={area} onChange={e=>{setArea(e.target.value);setObserve(false);setListing(false);}}><option value="">Unassigned / no admin access</option>{localities.map(l=><option key={l.id} value={l.id}>{l.name}</option>)}</select></label>
    <p className="text-xs leading-6 text-slate-400">This assigns a local operating desk, not a verified GPS boundary. Only its Admin 1 and Admin 2 can observe a permitted session. They do not receive your email, phone or RC.</p>
    {area&&vehicle.vehicle_use==='PUBLIC'&&<label className="provider-check text-xs leading-6"><input type="checkbox" checked={listing} required onChange={e=>setListing(e.target.checked)}/>I acknowledge that this locality’s desk will list my public vehicle’s plate, type and verification status. This does not grant GPS or camera access.</label>}
    {area&&<label className="provider-check text-xs leading-6"><input type="checkbox" checked={observe} onChange={e=>setObserve(e.target.checked)}/>I allow this locality’s two admins to observe my vehicle and the GPS/photos/video I separately choose to share during new active sessions. Stopping or revoking removes further access. Already viewed information cannot be recalled. (locality-observation-v1)</label>}
    <button className="provider-secondary" disabled={busy}>{busy?'Saving…':'Save locality & admin permission'}</button>
    {message&&<p role="status" className="text-xs text-amber-200">{message}</p>}
  </form>;
}
