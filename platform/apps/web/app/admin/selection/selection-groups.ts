import type { ApplicationSummary, GeographicUnit } from '../../lib/api';

export type SelectionGroup = 'ACTION' | 'NEW' | 'RETURNED' | 'PROCESSING' | 'PASSED_UNSELECTED' | 'MAIN' | 'RESERVE' | 'NEEDS_INFO' | 'FAILED' | 'DECLINED' | 'ALL';

export const SELECTION_GROUPS: Array<{ key: SelectionGroup; label: string }> = [
  { key: 'ACTION', label: 'بانتظار إجراء' },
  { key: 'NEW', label: 'طلبات جديدة' },
  { key: 'RETURNED', label: 'استكمال وارد للمراجعة' },
  { key: 'PROCESSING', label: 'قيد المراجعة' },
  { key: 'PASSED_UNSELECTED', label: 'مجتازة بانتظار الاختيار' },
  { key: 'MAIN', label: 'المجتازة الأساسية' },
  { key: 'RESERVE', label: 'المجتازة الاحتياطية' },
  { key: 'NEEDS_INFO', label: 'تحتاج استكمالًا' },
  { key: 'FAILED', label: 'غير مجتازة' },
  { key: 'DECLINED', label: 'عدم قبول نهائي' },
  { key: 'ALL', label: 'جميع الطلبات' },
];

/** Presentation only: never sort or mutate the complete source list. */
export function regionApplications<T extends { region: string }>(applications: readonly T[], region: string): T[] {
  return applications.filter((application) => !region || application.region === region);
}

export const PROJECT_GROUP_LABELS: Record<string, string> = { RIYADH: 'الرياض', QASSIM: 'القصيم', HAIL: 'حائل', NORTHERN_BORDERS: 'الحدود الشمالية', WEST: 'الغربية', SOUTH: 'الجنوبية', JOUF: 'الجوف' };

type FilterableApplication = Pick<ApplicationSummary, 'name' | 'publicCode' | 'region' | 'city' | 'regionOfficialCode' | 'governorateOfficialCode'>;
export function applicationProjectGroup(application: FilterableApplication, regions: readonly GeographicUnit[]): string {
  const official = regions.find((unit) => application.regionOfficialCode ? unit.officialCode === application.regionOfficialCode : unit.nameAr.replace(/^منطقة\s+/, '') === application.region);
  return official?.projectScopeGroup ?? '';
}
export function applicationCityKey(application: FilterableApplication): string {
  return `${application.regionOfficialCode ?? application.region}:${application.governorateOfficialCode ?? application.city}`;
}
export function filterApplications<T extends FilterableApplication>(applications: readonly T[], regions: readonly GeographicUnit[], filters: { search: string; projectGroup: string; city: string }): T[] {
  const query = filters.search.trim().toLocaleLowerCase('ar');
  return applications.filter((application) => (!filters.projectGroup || applicationProjectGroup(application, regions) === filters.projectGroup)
    && (!filters.city || applicationCityKey(application) === filters.city)
    && (!query || application.name.toLocaleLowerCase('ar').includes(query) || application.publicCode.toLocaleLowerCase('ar').includes(query)));
}
export function groupApplications<T extends Parameters<typeof selectionGroup>[0]>(applications: readonly T[], filter: SelectionGroup, actionableGroups: readonly string[]): T[] {
  return applications.filter((application) => filter === 'ALL' || (filter === 'ACTION' ? actionableGroups.includes(selectionGroup(application)) : selectionGroup(application) === filter));
}

export function selectionGroup(application: Pick<ApplicationSummary, 'eligibilityStatus' | 'selectionList' | 'processingStartedAt'> & { status?: ApplicationSummary['status']; latestInformationRequest?: ApplicationSummary['latestInformationRequest'] }): Exclude<SelectionGroup, 'ACTION' | 'ALL'> {
  if (application.eligibilityStatus === 'FAILED') return 'FAILED';
  if (application.status === 'REJECTED') return 'DECLINED';
  if (application.eligibilityStatus === 'NEEDS_INFO') return 'NEEDS_INFO';
  if (application.eligibilityStatus === 'PENDING') {
    if (application.latestInformationRequest?.status === 'SUBMITTED') return 'RETURNED';
    return application.processingStartedAt ? 'PROCESSING' : 'NEW';
  }
  if (application.selectionList === 'MAIN') return 'MAIN';
  if (application.selectionList === 'RESERVE') return 'RESERVE';
  return 'PASSED_UNSELECTED';
}
