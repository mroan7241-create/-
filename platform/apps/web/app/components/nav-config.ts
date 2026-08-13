import type { CurrentUser } from '../lib/api';

/**
 * تعريف التنقّل حسب الدور — مطابق لبنية `navFor(role)`/`NAV_LABELS` في
 * النظام القديم (Index.html): نفس الشريط الجانبي لـADMIN/ASSOCIATION مع
 * عناصر إضافية للإدارة فقط، وتجربة منفصلة تمامًا لـDELEGATE (بلا شريط
 * جانبي — راجع platform/docs/PRODUCT_PARITY_MASTER.md §2.5 UI-008).
 *
 * عناصر NODE-6/NODE-7 (delegates/activities/audit) مُدرجة هنا مسبقًا
 * بحيث لا يحتاج نقل الشريط الجانبي لاحقًا — لكنها لا تُعرض إلا بعد أن
 * يصبح الـbackend الحقيقي جاهزًا (`available: false` تُخفي العنصر الآن،
 * لا تعرضه معطَّلًا بلا وظيفة — لا "أزرار بلا فعل" مسموح بها).
 */
export interface NavItem {
  href: string;
  label: string;
  icon: string;
  roles: CurrentUser['role'][];
  /** false = الميزة موثَّقة في خارطة الطريق لكن الـbackend غير جاهز بعد — لا تُعرض. */
  available: boolean;
}

export const NAV_ITEMS: NavItem[] = [
  { href: '/admin', label: 'لوحة التحكم', icon: '\u{1F3E0}', roles: ['ADMIN'], available: true },
  { href: '/association', label: 'لوحة التحكم', icon: '\u{1F3E0}', roles: ['ASSOCIATION'], available: true },
  { href: '/admin/applications', label: 'طلبات الانضمام', icon: '\u{1F4E5}', roles: ['ADMIN'], available: true },
  { href: '/admin/associations', label: 'الجمعيات', icon: '\u{1F3DB}', roles: ['ADMIN'], available: true },
  { href: '/admin/beneficiaries', label: 'المستفيدون', icon: '\u{1F465}', roles: ['ADMIN'], available: true },
  { href: '/association/beneficiaries', label: 'المستفيدون', icon: '\u{1F465}', roles: ['ASSOCIATION'], available: true },
  { href: '/admin/inventory', label: 'المخزون', icon: '\u{1F4E6}', roles: ['ADMIN'], available: true },
  { href: '/admin/receipts', label: 'محاضر الاستلام', icon: '\u{1F4CB}', roles: ['ADMIN'], available: true },
  { href: '/association/receipts', label: 'محاضر الاستلام', icon: '\u{1F4CB}', roles: ['ASSOCIATION'], available: true },
  // NODE-6
  { href: '/admin/delegates', label: 'المناديب', icon: '\u{1F6F5}', roles: ['ADMIN'], available: true },
  { href: '/association/delegates', label: 'المناديب', icon: '\u{1F6F5}', roles: ['ASSOCIATION'], available: true },
  { href: '/admin/deliveries', label: 'عمليات التسليم', icon: '\u{1F69A}', roles: ['ADMIN'], available: true },
  { href: '/association/deliveries', label: 'عمليات التسليم', icon: '\u{1F69A}', roles: ['ASSOCIATION'], available: true },
  // NODE-7
  { href: '/admin/activities', label: 'متابعة المشروع', icon: '\u{1F4C8}', roles: ['ADMIN'], available: true },
  { href: '/admin/audit', label: 'سجل العمليات', icon: '\u{1F4DC}', roles: ['ADMIN'], available: true },
  { href: '/association/audit', label: 'سجل العمليات', icon: '\u{1F4DC}', roles: ['ASSOCIATION'], available: true },
  { href: '/association/settings', label: 'الإعدادات', icon: '\u{2699}', roles: ['ASSOCIATION'], available: true },
  { href: '/admin/reference-data', label: 'البيانات المرجعية', icon: '\u{1F5C2}', roles: ['ADMIN'], available: true },
];

export function navForRole(role: CurrentUser['role']): NavItem[] {
  return NAV_ITEMS.filter((item) => item.roles.includes(role) && item.available);
}

export const ROLE_LABELS: Record<CurrentUser['role'], string> = {
  ADMIN: 'إدارة',
  ASSOCIATION: 'جمعية',
  DELEGATE: 'مندوب',
};

/** الصفحة الرئيسية المناسبة لكل دور بعد تسجيل الدخول. */
export function homeForRole(role: CurrentUser['role']): string {
  if (role === 'ADMIN') return '/admin';
  if (role === 'ASSOCIATION') return '/association';
  return '/delegate';
}
