import { useEffect, useRef, useState } from 'react';
import { Camera, LocateFixed, Radio, Square, Upload, ImagePlus } from 'lucide-react';
import { contributorRequest, contributorUpload, POLICY_VERSION, type ContributorVehicle } from '@/lib/contributorApi';

type Props = { vehicles: ContributorVehicle[]; contactsVerified:boolean; onSaved:()=>void };
type Active = {id:string;gps:boolean;video:boolean;photo:boolean;expires_at:string};

export function CapturePanel({vehicles,contactsVerified,onSaved}:Props) {
  const [selected,setSelected] = useState('');
  const [gpsConsent,setGpsConsent] = useState(false);
  const [videoConsent,setVideoConsent] = useState(false);
  const [photoConsent,setPhotoConsent] = useState(false);
  const [active,setActive] = useState<Active|null>(null);
  const [cameraReady,setCameraReady] = useState(false);
  const [gpsReady,setGpsReady] = useState(false);
  const [devices,setDevices] = useState<MediaDeviceInfo[]>([]);
  const [deviceId,setDeviceId] = useState('');
  const [position,setPosition] = useState<GeolocationPosition|null>(null);
  const [message,setMessage] = useState('Nothing is being collected. Device previews stay on your device.');
  const [error,setError] = useState('');
  const [starting,setStarting] = useState(false);
  const [uploaded,setUploaded] = useState(0);
  const [recordedAt,setRecordedAt] = useState('');
  const video = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream|null>(null);
  const recorder = useRef<MediaRecorder|null>(null);
  const watch = useRef<number|null>(null);
  const live = useRef<Active|null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>|null>(null);
  const expiry = useRef<ReturnType<typeof setTimeout>|null>(null);
  const requests = useRef(new Set<AbortController>());
  const gpsBusy = useRef(false);
  const lastGps = useRef(0);
  const generation = useRef(0);
  const chosen = vehicles.find(v=>v.id===selected) ?? vehicles[0];
  const eligible = contactsVerified && chosen?.rc_uploaded && ['SELF_DECLARED','MANUAL_REVIEWED','RTO_VERIFIED'].includes(chosen.verification_status);

  function releaseDevices() {
    generation.current++;
    if(timer.current) clearTimeout(timer.current);
    if(expiry.current) clearTimeout(expiry.current);
    if(recorder.current?.state==='recording') recorder.current.stop();
    recorder.current=null;
    stream.current?.getTracks().forEach(track=>track.stop());
    stream.current=null;
    if(watch.current!==null) navigator.geolocation.clearWatch(watch.current);
    watch.current=null;
    requests.current.forEach(controller=>controller.abort());
    requests.current.clear();
    setCameraReady(false);setGpsReady(false);gpsBusy.current=false;
  }

  async function stop(reason='Sharing stopped. Camera and GPS released.') {
    const session=live.current;
    live.current=null;setActive(null);releaseDevices();setMessage(reason);
    if(session) {
      try {await contributorRequest('/sharing/'+session.id+'/stop','POST');onSaved();}
      catch {setError('Device collection stopped locally. Server could not confirm stop; session will expire automatically.');}
    }
  }

  useEffect(()=>{
    const leave=()=>{void stop('Sharing paused because the page was hidden or closed.');};
    const hidden=()=>{if(document.visibilityState==='hidden') leave();};
    document.addEventListener('visibilitychange',hidden);
    window.addEventListener('pagehide',leave);
    return ()=>{
      document.removeEventListener('visibilitychange',hidden);window.removeEventListener('pagehide',leave);
      void stop();
    };
  },[]);

  async function enableCamera(id=deviceId) {
    setError('');
    if(!navigator.mediaDevices?.getUserMedia) {setError('Camera access needs HTTPS or localhost and a supported browser.');return;}
    stream.current?.getTracks().forEach(t=>t.stop());
    const attempt=++generation.current;
    try {
      const result=await navigator.mediaDevices.getUserMedia({audio:false,video:id?{deviceId:{exact:id},width:{ideal:1280},height:{ideal:720}}:{facingMode:{ideal:'environment'},width:{ideal:1280},height:{ideal:720}}});
      if(attempt!==generation.current){result.getTracks().forEach(t=>t.stop());return;}
      stream.current=result;
      result.getVideoTracks()[0].onended=()=>void stop('Camera disconnected; sharing stopped.');
      if(video.current) video.current.srcObject=result;
      setDevices((await navigator.mediaDevices.enumerateDevices()).filter(d=>d.kind==='videoinput'));
      setCameraReady(true);setMessage('Camera preview is local. Audio is off. Nothing is uploaded until Start sharing.');
    } catch {setCameraReady(false);setError('Camera permission was denied, the device is busy, or it is unavailable. Connect a USB camera or upload a dashcam file.');}
  }

  function enableGps() {
    setError('');
    if(!navigator.geolocation || !window.isSecureContext){setError('GPS requires HTTPS or localhost and browser permission.');return;}
    if(watch.current!==null) navigator.geolocation.clearWatch(watch.current);
    watch.current=navigator.geolocation.watchPosition(pos=>{
      setPosition(pos);setGpsReady(true);
      const session=live.current;
      if(!session?.gps || gpsBusy.current || Date.now()-lastGps.current<2000)return;
      gpsBusy.current=true;lastGps.current=Date.now();
      const controller=new AbortController();requests.current.add(controller);
      void contributorRequest('/sharing/'+session.id+'/gps','POST',{points:[{
        captured_at:new Date(pos.timestamp).toISOString(),latitude:pos.coords.latitude,longitude:pos.coords.longitude,
        accuracy_m:pos.coords.accuracy,speed_mps:pos.coords.speed,heading:pos.coords.heading,
      }]},controller.signal).then(()=>{onSaved();}).catch(err=>{
        if(!controller.signal.aborted) {setError(String(err.message));void stop('GPS upload failed; sharing stopped.');}
      }).finally(()=>{gpsBusy.current=false;requests.current.delete(controller);});
    },()=>{setGpsReady(false);setError('GPS permission denied or position unavailable. No location was fabricated.');if(live.current)void stop();},
    {enableHighAccuracy:true,maximumAge:0,timeout:15000});
  }

  async function sendMedia(blob:Blob,kind:'photo'|'video',time:string,session:Active) {
    if(live.current?.id!==session.id)return;
    const controller=new AbortController();requests.current.add(controller);
    try {
      const query=new URLSearchParams({kind,captured_at:time,client_key:crypto.randomUUID()});
      await contributorUpload('/sharing/'+session.id+'/media?'+query,blob,'POST',controller.signal);
      if(live.current?.id===session.id){setUploaded(n=>n+1);onSaved();}
    } finally {requests.current.delete(controller);}
  }

  function recordClip(session:Active) {
    if(live.current?.id!==session.id || !stream.current || !session.video)return;
    const mime=['video/webm;codecs=vp8','video/webm','video/mp4'].find(t=>MediaRecorder.isTypeSupported(t));
    if(!mime){setError('This browser has no supported video recorder. Use file upload.');void stop();return;}
    const parts:BlobPart[]=[];const start=new Date().toISOString();
    const rec=new MediaRecorder(stream.current,{mimeType:mime,videoBitsPerSecond:800000});recorder.current=rec;
    rec.ondataavailable=e=>{if(e.data.size)parts.push(e.data);};
    rec.onerror=()=>{setError('Recording failed.');void stop();};
    rec.onstop=()=>{
      if(live.current?.id!==session.id)return;
      const blob=new Blob(parts,{type:mime});
      void sendMedia(blob,'video',start,session).then(()=>recordClip(session)).catch(err=>{
        if(live.current){setError(err.message);void stop('Video upload failed; sharing stopped. No offline queue is kept.');}
      });
    };
    rec.start();timer.current=setTimeout(()=>{if(rec.state==='recording')rec.stop();},5000);
  }

  async function start() {
    if(!eligible || !chosen)return;
    if(gpsConsent&&!gpsReady){setError('Enable GPS preview first.');return;}
    if(videoConsent&&chosen.setup_type!=='DASHCAM_FILE'&&!cameraReady){setError('Enable camera preview first, or select dashcam file setup.');return;}
    if(videoConsent&&chosen.setup_type!=='DASHCAM_FILE'&&typeof MediaRecorder==='undefined'){setError('Video recording is unsupported; use file upload.');return;}
    const attempt=generation.current;
    setStarting(true);setError('');
    try {
      const result=await contributorRequest<{id:string;expires_at:string}>('/sharing','POST',{
        vehicle_id:chosen.id,gps:gpsConsent,video:videoConsent,photo:photoConsent,policy_version:POLICY_VERSION,
      });
      if(attempt!==generation.current){await contributorRequest('/sharing/'+result.id+'/stop','POST');return;}
      const session={...result,gps:gpsConsent,video:videoConsent,photo:photoConsent};
      live.current=session;setActive(session);setMessage('Sharing only the selected data with this project. Keep this page visible.');
      expiry.current=setTimeout(()=>void stop('Two-hour session limit reached.'),Math.max(0,new Date(result.expires_at).getTime()-Date.now()));
      if(videoConsent&&chosen.setup_type!=='DASHCAM_FILE')recordClip(session);
    } catch(err){setError((err as Error).message);}finally{setStarting(false);}
  }

  async function snapshot() {
    const session=live.current;if(!session?.photo||!video.current?.videoWidth)return;
    const canvas=document.createElement('canvas');canvas.width=video.current.videoWidth;canvas.height=video.current.videoHeight;
    canvas.getContext('2d')?.drawImage(video.current,0,0);
    canvas.toBlob(blob=>{if(blob)void sendMedia(blob,'photo',new Date().toISOString(),session).catch(e=>setError(e.message));},'image/jpeg',0.8);
  }

  async function uploadFile(file?:File) {
    const session=live.current;if(!session||!file)return;
    const kind=file.type.startsWith('image/')?'photo':'video';
    if(!session[kind]){setError('This data type was not consented to for this session.');return;}
    if(!recordedAt){setError('Provide the original footage capture time; we will not assign your current GPS to it.');return;}
    if(file.size>(kind==='photo'?5:25)*1024*1024){setError('File exceeds upload limit.');return;}
    try {await sendMedia(file,kind,new Date(recordedAt).toISOString(),session);setMessage('File saved privately. Its location was not inferred from current GPS.');}
    catch(err){setError((err as Error).message);}
  }

  return <section className="provider-card space-y-5">
    <div className="flex items-center justify-between gap-3"><div><p className="provider-eyebrow">03 / YOUR DEVICES, YOUR CONTROL</p><h2 className="mt-1 text-xl font-semibold">Road data studio</h2></div><span className={'rounded-full px-3 py-1 text-xs '+(active?'bg-emerald-300 text-slate-950':'bg-white/5 text-slate-400')}>{active?'SHARING':'NOT SHARING'}</span></div>
    {!eligible&&<p className="provider-notice">Verify both contacts and submit your RC with self-declaration or review before uploading. Self-declaration is NOT government verification. Device previews remain local.</p>}
    <label className="provider-label">Vehicle<select className="provider-input" value={chosen?.id??''} disabled={!!active} onChange={e=>setSelected(e.target.value)}>{vehicles.length===0&&<option value="">Add a vehicle first</option>}{vehicles.map(v=><option key={v.id} value={v.id}>{v.number_plate} · {v.vehicle_use.toLowerCase()} · {v.verification_status.toLowerCase().replaceAll('_',' ')}</option>)}</select></label>
    <div className="grid gap-4 lg:grid-cols-2"><div className="overflow-hidden rounded-2xl border border-white/10 bg-black"><video ref={video} autoPlay muted playsInline className="aspect-video w-full object-contain"/><p className="px-3 py-2 text-xs text-slate-400">Local preview · microphone disabled</p></div><div className="space-y-3">
      <button className="provider-secondary w-full" disabled={!!active} onClick={()=>void enableCamera()}><Camera size={16}/>Enable camera preview</button>
      {devices.length>0&&<select aria-label="Camera device" className="provider-input" value={deviceId} disabled={!!active} onChange={e=>{setDeviceId(e.target.value);void enableCamera(e.target.value);}}><option value="">Default / rear camera</option>{devices.map(d=><option key={d.deviceId} value={d.deviceId}>{d.label||'Camera'}</option>)}</select>}
      <button className="provider-secondary w-full" disabled={!!active} onClick={enableGps}><LocateFixed size={16}/>Enable GPS preview</button>
      <p className="text-xs leading-6 text-slate-400">{position?`${position.coords.latitude.toFixed(6)}, ${position.coords.longitude.toFixed(6)} · ±${Math.round(position.coords.accuracy)} m`:'No GPS permission requested. Position stays local until sharing starts.'}</p>
      <p className="text-xs text-slate-500">A browser can use phone/USB cameras, not arbitrary Wi-Fi/RTSP dashcams. Upload their recordings here; a vendor/edge connector is separate work.</p>
    </div></div>
    <fieldset disabled={!!active} className="space-y-2 text-sm"><legend className="mb-2 font-semibold">Choose what to send to this project</legend>
      <label className="provider-check"><input type="checkbox" checked={gpsConsent} onChange={e=>setGpsConsent(e.target.checked)}/>Precise GPS while this page is visible</label>
      <label className="provider-check"><input type="checkbox" checked={videoConsent} onChange={e=>setVideoConsent(e.target.checked)}/>Road-facing video / uploaded dashcam clips</label>
      <label className="provider-check"><input type="checkbox" checked={photoConsent} onChange={e=>setPhotoConsent(e.target.checked)}/>Road photos / explicit snapshots</label>
    </fieldset>
    <p className="text-xs leading-6 text-slate-400">Do not operate this page while driving. Ask a passenger or configure it while parked. Stop releases both camera and GPS; collection pauses when you leave or hide this page. No background tracking or offline upload queue.</p>
    {error&&<p role="alert" className="provider-error">{error}</p>}<p role="status" className="text-sm text-slate-300">{message}</p>
    <div className="flex flex-wrap gap-3"><button className="provider-primary" disabled={!eligible||!!active||starting||!(gpsConsent||videoConsent||photoConsent)} onClick={()=>void start()}><Radio size={16}/>{starting?'Starting…':'Start sharing selected data'}</button><button className="provider-secondary" onClick={()=>void stop()}><Square size={16}/>Stop / release devices</button>{active?.photo&&cameraReady&&<button className="provider-secondary" onClick={()=>void snapshot()}><ImagePlus size={16}/>Send one photo</button>}</div>
    {active&&(active.video||active.photo)&&<div className="space-y-3 rounded-xl bg-white/5 p-4"><p className="text-sm font-semibold">Upload an existing recording or photo</p><label className="provider-label">Original capture time (last 24 hours)<input type="datetime-local" className="provider-input" value={recordedAt} onChange={e=>setRecordedAt(e.target.value)}/></label><label className="provider-secondary cursor-pointer"><Upload size={16}/>Choose file<input type="file" className="sr-only" accept="image/png,image/jpeg,video/mp4,video/webm" onChange={e=>{void uploadFile(e.target.files?.[0]);e.target.value='';}}/></label><p className="text-xs text-slate-400">PNG/JPEG ≤5 MB · MP4/WebM ≤25 MB and 3 minutes. Remove audio and unrelated personal content before uploading. {uploaded} files received this visit.</p></div>}
  </section>;
}
