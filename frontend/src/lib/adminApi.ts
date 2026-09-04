let csrf='';
export type Admin = {id:string;locality_id:string;locality_name:string;slot:number;is_demo:boolean};
export type AdminVehicle = {id:string;number_plate:string;vehicle_use:'PUBLIC'|'PRIVATE';verification_status:string;admin_observation_consent:boolean;sharing_active?:boolean};
export type AdminDetail = {vehicle:AdminVehicle;session:{id:string;started_at:string;expires_at:string;gps_consent:boolean;photo_consent:boolean;video_consent:boolean}|null;gps:{captured_at:string;latitude:number;longitude:number;accuracy_m:number}[];media:{id:string;kind:string;captured_at:string;byte_size:number}[]};
export class AdminError extends Error {constructor(message:string,public status:number){super(message);}}
export async function adminRequest<T>(path:string,method='GET',data?:unknown,signal?:AbortSignal):Promise<T>{
  const controller=new AbortController();
  const abort=()=>controller.abort();
  if(signal?.aborted)abort();
  signal?.addEventListener('abort',abort,{once:true});
  const timeout=setTimeout(abort,10000);
  try {
    const r=await fetch('/api/v1/admin'+path,{method,credentials:'same-origin',signal:controller.signal,cache:'no-store',headers:{...(data!==undefined?{'Content-Type':'application/json'}:{}),...(method!=='GET'?{'X-Admin-CSRF':csrf}:{})},body:data!==undefined?JSON.stringify(data):undefined});
    if(!r.headers.get('content-type')?.includes('application/json'))throw new AdminError('The admin service is not connected.',503);
    const b=await r.json().catch(()=>({}));
    if(!r.ok)throw new AdminError(Array.isArray(b.detail)?'Check the ID, password, locality and admin slot.':b.detail||'Admin service unavailable',r.status);
    if(b.csrf)csrf=b.csrf;
    return b as T;
  } catch(e) {
    if(controller.signal.aborted&&!signal?.aborted)throw new AdminError('Admin request timed out. Displayed observations have been cleared; retry when connected.',408);
    throw e;
  } finally {clearTimeout(timeout);signal?.removeEventListener('abort',abort);}
}
