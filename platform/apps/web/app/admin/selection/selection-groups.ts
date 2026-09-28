import type { ApplicationSummary } from '../../lib/api';

export type SelectionGroup = 'ACTION' | 'NEW' | 'PROCESSING' | 'PASSED_UNSELECTED' | 'MAIN' | 'RESERVE' | 'NEEDS_INFO' | 'FAILED' | 'ALL';

export const SELECTION_GROUPS: Array<{ key: SelectionGroup; label: string }> = [
  { key: 'ACTION', label: 'بانتظار إجراء' },
  { key: 'NEW', label: 'طلبات جديدة' },
  { key: 'PROCESSING', label: 'قيد المراجعة' },
  { key: 'PASSED_UNSELECTED', label: 'مجتازة بانتظار الاختيار' },
  { key: 'MAIN', label: 'المجتازة الأساسية' },
  { key: 'RESERVE', label: 'المجتازة الاحتياطية' },
  { key: 'NEEDS_INFO', label: 'تحتاج استكمالًا' },
  { key: 'FAILED', label: 'غير مجتازة' },
  { key: 'ALL', label: 'جميع الطلبات' },
];

export function selectionGroup(application: Pick<ApplicationSummary, 'eligibilityStatus' | 'selectionList' | 'processingStartedAt'>): Exclude<SelectionGroup, 'ACTION' | 'ALL'> {
  if (application.eligibilityStatus === 'FAILED') return 'FAILED';
  if (application.eligibilityStatus === 'NEEDS_INFO') return 'NEEDS_INFO';
  if (application.eligibilityStatus === 'PENDING') return application.processingStartedAt ? 'PROCESSING' : 'NEW';
  if (application.selectionList === 'MAIN') return 'MAIN';
  if (application.selectionList === 'RESERVE') return 'RESERVE';
  return 'PASSED_UNSELECTED';
}
