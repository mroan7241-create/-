import type { AbanmiReport } from '../../lib/api';

export type ReportFilters = { from: string; to: string; associationId: string; region: string };

/** Reject a mismatched response rather than printing another region's data. */
export async function fetchScopedReport(filters: ReportFilters, fetchReport: (filters: ReportFilters) => Promise<AbanmiReport>): Promise<AbanmiReport> {
  const report = await fetchReport(filters);
  if (filters.region && (
    report.associations.some((row) => row.region !== filters.region) ||
    report.applications.some((row) => row.region !== filters.region) ||
    report.byRegion.some((row) => row.region !== filters.region)
  )) throw new Error('REPORT_SCOPE_MISMATCH');
  if (filters.associationId && report.associations.some((row) => row.id !== filters.associationId)) {
    throw new Error('REPORT_SCOPE_MISMATCH');
  }
  return report;
}
