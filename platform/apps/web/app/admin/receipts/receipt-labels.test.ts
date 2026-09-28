import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

test('admin and association receipt lines render device types through the Arabic label map', () => {
  const admin = readFileSync(new URL('./page.tsx', import.meta.url), 'utf8');
  const association = readFileSync(new URL('../../association/receipts/page.tsx', import.meta.url), 'utf8');

  for (const page of [admin, association]) {
    assert.match(page, /DEVICE_TYPE_LABELS\[it\.deviceType\]/);
    assert.doesNotMatch(page, /\{it\.deviceType\}/);
  }
});
