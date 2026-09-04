export type PublicUpdate = {id:string;category:'PROJECT'|'REPORT'|'OMNIVIEW';title:string;summary:string;status:string;source_url:string|null;updated_at:string;latitude:number|null;longitude:number|null};
export type PublicOverview = {coverage:{roads:number;cells:number};updates:PublicUpdate[];reports:{published:number;resolved:number;in_progress:number;window:string};model:{status:string;label:string};as_of:string};
export type PublicVehicle = {public_id:string;label:string;latitude:number;longitude:number;captured_at:string;accuracy_m:number};
export async function publicRequest<T>(path:string,signal?:AbortSignal):Promise<T> {
  const controller=new AbortController();
  const abort=()=>controller.abort();
  if(signal?.aborted)abort();
  signal?.addEventListener('abort',abort,{once:true});
  const timer=setTimeout(abort,10000);
  try {
    const response=await fetch('/api/v1/public/'+path,{signal:controller.signal,credentials:'omit',cache:'no-store'});
    if(!response.ok)throw new Error('Public data is temporarily unavailable. Please retry shortly.');
    if(!response.headers.get('content-type')?.includes('application/json'))throw new Error('The public data service is not connected.');
    return await response.json();
  } finally {clearTimeout(timer);signal?.removeEventListener('abort',abort)}
}
