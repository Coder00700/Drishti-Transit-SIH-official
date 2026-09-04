const BASE = '/api/v1/contributors';
let csrf = '';

export type Contributor = { id: string; full_name: string; email: string; phone: string; email_verified: boolean; phone_verified: boolean; withdrawn_at: string | null; privacy_version:string };
export type ContributorVehicle = { id: string; number_plate: string; vehicle_use: 'PUBLIC' | 'PRIVATE'; setup_type: string; verification_status: string; rc_uploaded: boolean; locality_id:string|null; public_listing_accepted:boolean; admin_observation_consent:boolean };
export type Profile = { user: Contributor; vehicles: ContributorVehicle[]; csrf: string };
export type Capabilities = { sms_otp: boolean; email_otp: boolean; rto_api: boolean; rto_note: string; policy_version: string; identity_store?:string; registration_enabled?:boolean; vehicle_onboarding?:boolean; capture?:boolean; notice?:string };
export type Activity = {
  sessions: {id:string; number_plate:string; started_at:string; ended_at:string|null; expires_at:string; gps_points:number; media_files:number}[];
  gps: {captured_at:string;latitude:number;longitude:number;accuracy_m:number}[];
  media: {id:string;kind:string;captured_at:string;byte_size:number}[];
};
export const POLICY_VERSION = '2026-09-04-v2';

export async function contributorRequest<T>(path: string, method = 'GET', data?: unknown, signal?: AbortSignal): Promise<T> {
  method = method.toUpperCase();
  const mutating = !['GET', 'HEAD', 'OPTIONS'].includes(method);
  // Even bodyless actions (logout/withdraw) must satisfy the cloud JSON boundary.
  const payload = data === undefined && mutating ? {} : data;
  const response = await fetch(BASE + path, {
    method, credentials: 'same-origin', signal,
    headers: { ...(payload !== undefined ? {'Content-Type':'application/json'} : {}), ...(mutating ? {'X-Contributor-CSRF':csrf} : {}) },
    body: payload !== undefined ? JSON.stringify(payload) : undefined,
  });
  const result = await parseResponse<T>(response);
  // Keep the token on failure: a failed request has not ended the server session.
  if (path === '/logout' && method === 'POST') csrf = '';
  return result;
}

async function parseResponse<T>(response: Response): Promise<T> {
  if (!response.headers.get('content-type')?.includes('application/json')) {
    throw new Error('The private contributor service is not connected. No account or upload was confirmed.');
  }
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = Array.isArray(body.detail) ? body.detail.map((e: {msg:string}) => e.msg).join('; ') : body.detail;
    throw new Error(detail || `Request failed (${response.status})`);
  }
  if (body.csrf) csrf = body.csrf;
  return body as T;
}

export async function contributorUpload(path: string, blob: Blob, method = 'POST', signal?: AbortSignal) {
  const response = await fetch(BASE + path, {method, body:blob, credentials:'same-origin', signal,
    headers:{'Content-Type':blob.type || 'application/octet-stream','X-Contributor-CSRF':csrf}});
  return parseResponse<{id?:string;status:string;bytes?:number}>(response);
}

export const mediaUrl = (id:string) => BASE + '/media/' + encodeURIComponent(id);
export const rcUrl = (id:string) => BASE + '/vehicles/' + encodeURIComponent(id) + '/rc';
