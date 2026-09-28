import { test } from 'node:test';
import assert from 'node:assert/strict';
// Node 24's type-stripping runner needs the explicit TypeScript extension.
// @ts-ignore -- standalone node --test import
import { apiFetch, apiUpload, ApiClientError } from './api.ts';

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
