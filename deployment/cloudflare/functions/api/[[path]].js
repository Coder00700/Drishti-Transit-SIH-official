// Only /api requests invoke a Pages Function. Static pages/assets stay on the CDN.
export async function onRequest({request, env}) {
  const json = (detail, status) => Response.json({detail}, {status, headers: {
    'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer', 'X-Frame-Options': 'DENY',
  }});
  const url = new URL(request.url);
  // Prevent the public gateway from reaching local operations, admin or worker APIs.
  const publicPath = /^\/api\/v1\/public\/(overview|roads|grid|vehicles|assessments|weather|transit|traffic|demo\/(overview|roads))$/.test(url.pathname);
  const contributorPath = /^\/api\/v1\/contributors\/(capabilities|register|login|me|logout|consent|withdraw|deletion-request|activity|otp\/(send|check))$/.test(url.pathname);
  if (!publicPath && !contributorPath) return json('This API is not exposed by the cloud portal.', 404);
  if (!['GET', 'POST'].includes(request.method) || (publicPath && request.method !== 'GET')) return json('Method not allowed.', 405);
  if (request.method === 'POST' && request.headers.get('Origin') !== url.origin) return json('Invalid request origin.', 403);
  if (request.method === 'POST' && !request.headers.get('Content-Type')?.toLowerCase().startsWith('application/json')) return json('Use JSON for account requests.', 415);
  let upstream;
  try {
    upstream = new URL(env.RENDER_API_ORIGIN);
    if (upstream.protocol !== 'https:' || !upstream.hostname.endsWith('.onrender.com') || upstream.username || upstream.password || upstream.port || upstream.pathname !== '/' || upstream.search || upstream.hash) throw new Error();
    if (typeof env.EDGE_SHARED_SECRET !== 'string' || env.EDGE_SHARED_SECRET.length < 32) throw new Error();
  } catch { return json('Cloud API connection is not configured.', 503); }
  let body;
  if (request.method === 'POST') {
    const reader = request.body?.getReader();
    const chunks = [];
    let size = 0;
    if (reader) while (true) {
      const {done, value} = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 16384) { await reader.cancel(); return json('Request is too large. Media ingestion is deferred.', 413); }
      chunks.push(value);
    }
    body = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength; }
  }
  const headers = new Headers({Accept: 'application/json', 'X-Drishti-Edge': env.EDGE_SHARED_SECRET,
    'X-Drishti-Client-IP': request.headers.get('CF-Connecting-IP') || 'unknown'});
  // Never trust client-supplied forwarding, gateway secrets or destination headers.
  for (const name of ['Content-Type', 'Origin', 'X-Contributor-CSRF']) {
    if (request.headers.has(name)) headers.set(name, request.headers.get(name));
  }
  if (contributorPath && request.headers.has('Cookie')) {
    const session = request.headers.get('Cookie').split(';').map(v => v.trim()).find(v => v.startsWith('drishti_contributor='));
    if (session && session.length <= 160) headers.set('Cookie', session);
  }
  upstream.pathname = url.pathname;
  upstream.search = url.search;
  try {
    const response = await fetch(upstream, {method: request.method, headers, body,
      redirect: 'manual', signal: AbortSignal.timeout(20000)});
    // Render's cold-start HTML is not a successful JSON login response.
    if (response.status >= 300 && response.status < 400) return json('Unexpected API redirect was blocked.', 502);
    if (!response.headers.get('Content-Type')?.includes('application/json')) return json('API is starting or unavailable. Wait a minute and retry.', 503);
    const outgoing = new Headers({'Content-Type': 'application/json', 'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'X-Frame-Options': 'DENY'});
    // Host-only Secure cookies become same-origin cookies on the Pages domain.
    if (contributorPath && response.headers.has('Set-Cookie')) outgoing.set('Set-Cookie', response.headers.get('Set-Cookie'));
    if (response.headers.has('Retry-After')) outgoing.set('Retry-After', response.headers.get('Retry-After'));
    return new Response(response.body, {status: response.status, headers: outgoing});
  } catch { return json('API is starting or unavailable. Wait a minute and retry.', 503); }
}
