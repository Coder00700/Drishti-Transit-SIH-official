import test from 'node:test';
import assert from 'node:assert/strict';
import {onRequest} from '../functions/api/[[path]].js';

const env = {RENDER_API_ORIGIN: 'https://test-service.onrender.com', EDGE_SHARED_SECRET: 'x'.repeat(48)};
const origin = 'https://drishti-test.pages.dev';
const call = (path, options = {}, settings = env) => onRequest({request: new Request(origin + path, options), env: settings});

test('authority rollout is opt-in and sessions stay separate', async () => {
  assert.equal((await call('/api/v1/authority/login')).status,404);
  const original=globalThis.fetch;
  try {
    globalThis.fetch=async(url,options)=>{
      assert.equal(options.headers.get('Cookie'),'drishti_authority=authority-token');
      assert.equal(options.headers.get('X-Authority-CSRF'),'authority-csrf');
      assert.equal(options.headers.get('X-Contributor-CSRF'),null);
      return Response.json({ok:true});
    };
    const response=await call('/api/v1/authority/logout',{method:'POST',body:'{}',headers:{Origin:origin,'Content-Type':'application/json',
      Cookie:'drishti_contributor=user-token; drishti_authority=authority-token','X-Authority-CSRF':'authority-csrf','X-Contributor-CSRF':'user-csrf'}},{...env,AUTHORITY_ENABLED:'true'});
    assert.equal(response.status,200);
    assert.equal((await call('/api/v1/authority/arbitrary',{},{...env,AUTHORITY_ENABLED:'true'})).status,404);
  } finally {globalThis.fetch=original;}
});
test('authority uploads have a bounded two-MB limit', async()=>{
  const options={method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:'x'.repeat(2*1024*1024+1)};
  assert.equal((await call('/api/v1/authority/imports',options,{...env,AUTHORITY_ENABLED:'true'})).status,413);
});

test('local, administrator, worker and unexpected routes are denied', async () => {
  for (const path of ['/api/v1/recordings', '/api/v1/admin/login', '/api/v1/internal/assessment-batches', '/api/v1/contributors/vehicles']) {
    assert.equal((await call(path)).status, 404);
  }
});
test('origin, method and upload limits', async () => {
  assert.equal((await call('/api/v1/contributors/login', {method: 'POST', headers: {Origin: 'https://evil.test'}})).status, 403);
  assert.equal((await call('/api/v1/public/overview', {method: 'POST', headers: {Origin: origin}})).status, 405);
  assert.equal((await call('/api/v1/contributors/login', {method: 'POST', headers: {Origin: origin, 'Content-Type': 'application/json'}, body: 'x'.repeat(16385)})).status, 413);
});
test('missing configuration and arbitrary upstreams fail closed', async () => {
  for (const url of ['http://localhost:8000', 'https://evil.test', 'https://x.onrender.com/extra', 'https://user:pass@x.onrender.com']) {
    assert.equal((await call('/api/v1/public/overview', {}, {...env, RENDER_API_ORIGIN: url})).status, 503);
  }
});
test('gateway replaces forged trust headers and forwards only the session cookie', async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async (url, options) => {
      assert.equal(url.origin, env.RENDER_API_ORIGIN);
      assert.equal(options.headers.get('X-Drishti-Edge'), env.EDGE_SHARED_SECRET);
      assert.equal(options.headers.get('X-Drishti-Client-IP'), '192.0.2.3');
      assert.equal(options.headers.get('Cookie'), 'drishti_contributor=abc');
      assert.equal(options.headers.get('Authorization'), null);
      assert.equal(options.redirect, 'manual');
      return Response.json({csrf: 'test'}, {headers: {'Set-Cookie': 'drishti_contributor=new; Secure; HttpOnly; SameSite=Strict; Path=/api/v1/contributors'}});
    };
    const response = await call('/api/v1/contributors/me', {headers: {
      'X-Drishti-Edge': 'forged', 'X-Drishti-Client-IP': 'forged', 'CF-Connecting-IP': '192.0.2.3',
      Authorization: 'ignored', Cookie: 'tracking=none; drishti_contributor=abc',
    }});
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('Cache-Control'), 'no-store');
    assert.match(response.headers.get('Set-Cookie'), /Secure/);
  } finally {globalThis.fetch = original;}
});
test('public calls never forward private sessions or return session cookies', async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async (url, options) => {
      assert.equal(options.headers.get('Cookie'), null);
      return Response.json({}, {headers: {'Set-Cookie': 'unwanted=1'}});
    };
    const response = await call('/api/v1/public/overview', {headers: {Cookie: 'drishti_contributor=abc'}});
    assert.equal(response.headers.get('Set-Cookie'), null);
  } finally {globalThis.fetch = original;}
});
test('cold-start HTML and redirects never masquerade as API success', async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async () => new Response('<html>Starting</html>', {headers: {'Content-Type': 'text/html'}});
    assert.equal((await call('/api/v1/public/overview')).status, 503);
    globalThis.fetch = async () => new Response(null, {status: 302, headers: {Location: 'https://evil.test'}});
    assert.equal((await call('/api/v1/public/overview')).status, 502);
  } finally {globalThis.fetch = original;}
});
