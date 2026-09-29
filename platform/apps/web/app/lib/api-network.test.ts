import { test } from 'node:test';
import assert from 'node:assert/strict';
// Node 24's type-stripping runner needs the explicit TypeScript extension.
// @ts-ignore -- standalone node --test import
import { apiFetch, apiUpload, ApiClientError } from './api.ts';
// @ts-ignore -- standalone node --test import
import { finishLogout } from './logout-flow.ts';

test('JSON actions and uploads report a clear network error instead of failing silently', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new TypeError('Failed to fetch'); };
  try {
    for (const request of [() => apiFetch('/health'), () => apiUpload('/files', new FormData())]) {
      await assert.rejects(request(), (error: unknown) => error instanceof ApiClientError && error.code === 'NETWORK_ERROR' && error.message.includes('تعذّر الاتصال'));
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('GET reads avoid JSON preflight while JSON writes retain their content type', async () => {
  const originalFetch = globalThis.fetch;
  const calls: RequestInit[] = [];
  globalThis.fetch = async (_input, init) => {
    calls.push(init ?? {});
    return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  try {
    await apiFetch('/health');
    await apiFetch('/example', { method: 'POST', body: JSON.stringify({ value: 1 }) });
    assert.equal(new Headers(calls[0]?.headers).has('Content-Type'), false);
    assert.equal(new Headers(calls[1]?.headers).get('Content-Type'), 'application/json');
  } finally { globalThis.fetch = originalFetch; }
});

test('failed logout remains on the authenticated page and explains the failure', async () => {
  let navigations = 0;
  const navigate = () => { navigations++; };
  const failure = await finishLogout(async () => { throw new Error('network down'); }, navigate);
  assert.match(failure!, /تعذّر تسجيل الخروج/);
  assert.equal(navigations, 0);
  assert.equal(await finishLogout(async () => undefined, navigate), null);
  assert.equal(navigations, 1);
});
