import type { ApplicationSummary } from '../../lib/api';
// @ts-ignore -- Node's standalone type-stripping test runner needs the extension.
import { fetchPagedItems } from '../selection/selection-load.ts';

export function fileCityKey(app: ApplicationSummary) { return `${app.regionOfficialCode ?? app.region}:${app.centerOfficialCode ?? app.governorateOfficialCode ?? ''}:${app.city}`; }
export async function loadFileApplications(fetchPage: (page: number) => Promise<{ items: ApplicationSummary[]; total: number; totalPages: number }>) {
  let expected: number | null = null;
  const items = await fetchPagedItems(async page => {
    const result = await fetchPage(page);
    if (expected == null) expected = result.total;
    if (result.total !== expected) throw new Error('تغيرت قائمة الطلبات أثناء التحميل؛ حدّث القائمة.');
    return result;
  });
  if (items.length !== expected || new Set(items.map(item => item.id)).size !== items.length) throw new Error('لم تكتمل قائمة الطلبات؛ حدّث القائمة قبل الفرز.');
  return items;
}

export interface FileFilters { search: string; status: string; workflow: string; city: string; sector: string }
export function applicationSectors(application: ApplicationSummary): string[] {
  const organization = application.v2Payload?.organization as Record<string, unknown> | undefined;
  const values = Array.isArray(organization?.sectors) ? organization.sectors : (application.sector ?? '').split(/[,،;؛]/);
  return [...new Set([...values, organization?.sectorOther].filter((value): value is string => typeof value === 'string' && !!value.trim()).map(value => value.trim()))];
}
export function fileFilterOptions(applications: readonly ApplicationSummary[]) {
  const cities = new Map<string, string>();
  for (const app of applications) if (app.city?.trim()) cities.set(fileCityKey(app), `${app.city} — ${app.region}`);
  return {
    cities: [...cities].map(([value, label]) => ({ value, label })).sort((a,b) => a.label.localeCompare(b.label, 'ar')),
    sectors: [...new Set(applications.flatMap(applicationSectors))].sort((a,b) => a.localeCompare(b, 'ar')),
  };
}
export function filterFileApplications(applications: readonly ApplicationSummary[], filters: FileFilters): ApplicationSummary[] {
  const q = filters.search.trim().toLocaleLowerCase('ar');
  return applications.filter(app => (!filters.status || app.status === filters.status)
    && (!filters.city || fileCityKey(app) === filters.city)
    && (!filters.sector || applicationSectors(app).includes(filters.sector))
    && (!q || [app.name, app.publicCode, app.email, app.contactName, app.licenseNumber].some(value => value?.toLocaleLowerCase('ar').includes(q)))
    && (!filters.workflow || (filters.workflow === 'new' ? !app.processingStartedAt : filters.workflow === 'processing' ? !!app.processingStartedAt : app.eligibilityStatus === 'NEEDS_INFO')));
}

export function savedEvaluationRows(application: ApplicationSummary, criteria: readonly { key: string; label: string; weight: number }[]) {
  const raw = application.evaluationBreakdown?.raw as Record<string, unknown> | undefined;
  const weighted = application.evaluationBreakdown?.weighted as Record<string, unknown> | undefined;
  return criteria.map(criterion => {
    const value = raw?.[criterion.key]; const points = weighted?.[criterion.key];
    return { ...criterion, score: typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 5 ? value : null,
      points: typeof points === 'number' && Number.isFinite(points) ? points : null };
  });
}
