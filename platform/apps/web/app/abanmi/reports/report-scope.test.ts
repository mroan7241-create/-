import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { AbanmiReport } from '../../lib/api';
// @ts-ignore -- Node's type-stripping runner uses the explicit TypeScript extension.
import { fetchScopedReport } from './report-scope.ts';

const filters = { from: '', to: '', associationId: '', region: 'القصيم' };
const report = {
  associations: [{ id: 'a', region: 'القصيم' }],
  applications: [{ id: 'app-a', region: 'القصيم' }],
  byRegion: [{ region: 'القصيم', associations: 1 }],
} as AbanmiReport;

test('PDF preparation requests the currently selected region', async () => {
  let requested = '';
  const result = await fetchScopedReport(filters, async (selected) => { requested = selected.region; return report; });
  assert.equal(requested, 'القصيم');
  assert.equal(result, report);
});

test('PDF preparation rejects associations from another region', async () => {
  await assert.rejects(() => fetchScopedReport(filters, async () => ({ ...report,
    associations: [{ ...report.associations[0], id: 'b', region: 'الرياض' }],
  })), /REPORT_SCOPE_MISMATCH/);
});

test('PDF preparation rejects application or regional totals from another region', async () => {
  await assert.rejects(() => fetchScopedReport(filters, async () => ({ ...report,
    applications: [{ ...report.applications[0], region: 'الرياض' }],
  })), /REPORT_SCOPE_MISMATCH/);
  await assert.rejects(() => fetchScopedReport(filters, async () => ({ ...report,
    byRegion: [{ region: 'الرياض', associations: 1 }],
  })), /REPORT_SCOPE_MISMATCH/);
});
