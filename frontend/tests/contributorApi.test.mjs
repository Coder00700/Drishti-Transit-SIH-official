import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import {onRequest} from '../../deployment/cloudflare/functions/api/[[path]].js';

const source = readFileSync(new URL('../src/lib/contributorApi.ts', import.meta.url), 'utf8');
const js = ts.transpileModule(source, {compilerOptions:{module:ts.ModuleKind.ESNext, target:ts.ScriptTarget.ES2022}}).outputText;
const {contributorRequest} = await import('data:text/javascript;base64,' + Buffer.from(js).toString('base64'));
const origin = 'https://portal-test.pages.dev';
const env = {RENDER_API_ORIGIN:'https://test-service.onrender.com', EDGE_SHARED_SECRET:'x'.repeat(48)};

test('bodyless account actions carry JSON and preserve CSRF', async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async () => Response.json({csrf:'test-csrf'});
    await contributorRequest('/me');
    for (const path of ['/logout', '/withdraw', '/deletion-request']) {
      globalThis.fetch = async (url, options) => {
        assert.equal(url, '/api/v1/contributors' + path);
        assert.equal(options.headers['Content-Type'], 'application/json');
        assert.equal(options.headers['X-Contributor-CSRF'], 'test-csrf');
        assert.equal(options.body, '{}');
        assert.equal(options.credentials, 'same-origin');
        return Response.json({detail:'Synthetic failure'}, {status:503});
      };
      await assert.rejects(contributorRequest(path, 'POST'), /Synthetic failure/);
    }
  } finally { globalThis.fetch = original; }
});

test('successful logout crosses the real gateway and clears in-memory CSRF', async () => {
  const original = globalThis.fetch;
  let reachedLogout = false;
  try {
    globalThis.fetch = async () => Response.json({csrf:'test-csrf'});
    await contributorRequest('/me');
    globalThis.fetch = async (url, options) => {
      if (typeof url === 'string') {
        const headers = new Headers(options.headers);
        headers.set('Origin', origin);
        headers.set('Cookie', 'drishti_contributor=synthetic-session');
        return onRequest({env, request:new Request(origin + url, {...options, headers})});
      }
      assert.equal(url.origin, env.RENDER_API_ORIGIN);
      assert.equal(url.pathname, '/api/v1/contributors/logout');
      assert.equal(options.headers.get('Content-Type'), 'application/json');
      assert.equal(options.headers.get('X-Contributor-CSRF'), 'test-csrf');
      assert.equal(options.headers.get('Cookie'), 'drishti_contributor=synthetic-session');
      assert.equal(options.headers.get('X-Drishti-Edge'), env.EDGE_SHARED_SECRET);
      assert.equal(new TextDecoder().decode(options.body), '{}');
      reachedLogout = true;
      return Response.json({status:'signed_out'}, {headers:{
        'Set-Cookie':'drishti_contributor=; Max-Age=0; Path=/api/v1/contributors; Secure; HttpOnly; SameSite=Strict'
      }});
    };
    assert.deepEqual(await contributorRequest('/logout','POST'), {status:'signed_out'});
    assert.equal(reachedLogout, true);
    globalThis.fetch = async (url, options) => {
      assert.equal(options.headers['X-Contributor-CSRF'], '');
      return Response.json({});
    };
    await contributorRequest('/logout','POST');
  } finally { globalThis.fetch = original; }
});

test('GET stays bodyless and explicit JSON payloads are unchanged', async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async (url, options) => {
      assert.equal(options.body, undefined);
      assert.equal(options.headers['Content-Type'], undefined);
      return Response.json({});
    };
    await contributorRequest('/capabilities');
    globalThis.fetch = async (url, options) => {
      assert.equal(options.body, JSON.stringify({accepted:true}));
      assert.equal(options.headers['Content-Type'], 'application/json');
      return Response.json({});
    };
    await contributorRequest('/consent','POST',{accepted:true});
  } finally { globalThis.fetch = original; }
});
