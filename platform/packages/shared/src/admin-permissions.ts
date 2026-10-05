/** One catalog for server authorization and the owner-managed checkbox UI. */
export const ADMIN_PERMISSION_CATALOG = [
  { key: 'dashboard.read', label: 'عرض لوحة التحكم', group: 'نظرة عامة' },
  { key: 'applications.read', label: 'عرض طلبات الانضمام', group: 'طلبات الانضمام' },
  { key: 'applications.review', label: 'مراجعة الأهلية وطلب الاستكمال', group: 'طلبات الانضمام' },
  { key: 'applications.evaluate', label: 'تقييم الطلبات', group: 'طلبات الانضمام' },
  { key: 'applications.select', label: 'اعتماد الأساسية والاحتياط', group: 'طلبات الانضمام' },
  { key: 'participations.read', label: 'عرض الاتفاقيات والمشاركات', group: 'المشاركات' },
  { key: 'participations.manage', label: 'إدارة الاتفاقيات والتفعيل', group: 'المشاركات' },
  { key: 'associations.read', label: 'عرض الجمعيات', group: 'الكيانات' },
  { key: 'associations.manage', label: 'إدارة الجمعيات', group: 'الكيانات' },
  { key: 'beneficiaries.read', label: 'عرض المستفيدين', group: 'الكيانات' },
  { key: 'beneficiaries.manage', label: 'إدارة المستفيدين', group: 'الكيانات' },
  { key: 'delegates.read', label: 'عرض المناديب', group: 'الكيانات' },
  { key: 'delegates.manage', label: 'إدارة المناديب', group: 'الكيانات' },
  { key: 'inventory.read', label: 'عرض المخزون', group: 'العمليات' },
  { key: 'inventory.manage', label: 'إدارة المخزون', group: 'العمليات' },
  { key: 'receipts.read', label: 'عرض محاضر الاستلام', group: 'العمليات' },
  { key: 'receipts.manage', label: 'إدارة محاضر الاستلام', group: 'العمليات' },
  { key: 'deliveries.read', label: 'عرض عمليات التسليم', group: 'العمليات' },
  { key: 'deliveries.manage', label: 'إدارة عمليات التسليم', group: 'العمليات' },
  { key: 'procurement.read', label: 'عرض المشتريات والشحنات', group: 'العمليات' },
  { key: 'procurement.manage', label: 'إدارة المشتريات والشحنات', group: 'العمليات' },
  { key: 'allocation.read', label: 'عرض التخصيص', group: 'العمليات' },
  { key: 'allocation.manage', label: 'إدارة التخصيص', group: 'العمليات' },
  { key: 'escalations.read', label: 'عرض التصعيدات', group: 'المتابعة' },
  { key: 'escalations.manage', label: 'إدارة التصعيدات', group: 'المتابعة' },
  { key: 'reports.read', label: 'عرض التقارير', group: 'المتابعة' },
  { key: 'reports.manage', label: 'إدارة تقارير الإغلاق', group: 'المتابعة' },
  { key: 'activities.read', label: 'عرض متابعة المشروع', group: 'المتابعة' },
  { key: 'activities.manage', label: 'إدارة متابعة المشروع', group: 'المتابعة' },
  { key: 'audit.read', label: 'عرض سجل العمليات', group: 'السجل والإعدادات' },
  { key: 'reference.read', label: 'عرض البيانات المرجعية', group: 'السجل والإعدادات' },
  { key: 'reference.manage', label: 'إدارة البيانات المرجعية', group: 'السجل والإعدادات' },
  { key: 'settings.manage', label: 'إدارة إعدادات النظام وموعد التقديم', group: 'السجل والإعدادات' },
  { key: 'abanmi.manage', label: 'إدارة حسابات أبانمي', group: 'الحسابات والإشعارات' },
  { key: 'notifications.manage', label: 'إدارة الإشعارات والإرسال', group: 'الحسابات والإشعارات' },
] as const;

export type AdminPermission = (typeof ADMIN_PERMISSION_CATALOG)[number]['key'];
const knownPermissions = new Set<string>(ADMIN_PERMISSION_CATALOG.map((item) => item.key));

export function isAdminPermission(value: unknown): value is AdminPermission {
  return typeof value === 'string' && knownPermissions.has(value);
}

/** Actions imply only their own domain read grant; never another domain. */
export function normalizeAdminPermissions(input: readonly string[] | null | undefined): AdminPermission[] {
  const grants = new Set<AdminPermission>();
  for (const permission of input ?? []) {
    if (!isAdminPermission(permission)) continue;
    grants.add(permission);
    const read = `${permission.split('.')[0]}.read`;
    if (isAdminPermission(read)) grants.add(read);
  }
  return ADMIN_PERMISSION_CATALOG.map((item) => item.key).filter((key) => grants.has(key));
}

export function hasAdminPermission(fullAccess: boolean | null | undefined, permissions: readonly string[] | null | undefined, required: AdminPermission): boolean {
  return fullAccess === true || normalizeAdminPermissions(permissions).includes(required);
}
