import { test } from 'node:test';
import assert from 'node:assert/strict';
// Node 24's type-stripping runner needs the explicit TypeScript extension.
// @ts-ignore -- standalone node --test import
import { apiFetch, apiUpload, ApiClientError, sendAdminAccountInvitation, resetAdminAccountPassword } from './api.ts';
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

test('staff invitation uses its non-destructive route and never falls back to manual password reset', async () => {
  const originalFetch = globalThis.fetch;
  const calls: Array<{ url: string; init: RequestInit }> = [];
  globalThis.fetch = async (input, init) => {
    calls.push({ url: String(input), init: init ?? {} });
    return new Response(JSON.stringify({ ok: true, emailQueued: true }), { status: 201, headers: { 'Content-Type': 'application/json' } });
  };
  try {
    await sendAdminAccountInvitation('staff-test');
    await resetAdminAccountPassword('staff-test');
    assert.ok(calls[0].url.endsWith('/accounts/admins/staff-test/invitation'));
    assert.equal(calls[0].init.method, 'POST');
    assert.equal(calls[0].init.body, undefined);
    assert.equal(calls[1].init.body, undefined);
    assert.ok(calls[1].url.endsWith('/accounts/admins/staff-test/reset-password'));
    assert.notEqual(calls[1].url, calls[0].url);
  } finally { globalThis.fetch = originalFetch; }
});

test('an old backend without invitation support fails safely without issuing password reset', async () => {
  const originalFetch = globalThis.fetch;
  const urls: string[] = [];
  globalThis.fetch = async (input) => {
    urls.push(String(input));
    return new Response(JSON.stringify({ error: { code: 'NOT_FOUND', message: 'Not Found' } }), { status: 404, headers: { 'Content-Type': 'application/json' } });
  };
  try {
    await assert.rejects(sendAdminAccountInvitation('staff-test'), ApiClientError);
    assert.equal(urls.length, 1);
    assert.ok(urls[0].endsWith('/invitation'));
  } finally { globalThis.fetch = originalFetch; }
});
