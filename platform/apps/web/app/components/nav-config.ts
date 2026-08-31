import type { LucideIcon } from 'lucide-react';
import {
  Bike,
  Boxes,
  Building2,
  ClipboardList,
  Database,
  FileBarChart,
  Inbox,
  LayoutDashboard,
  Package,
  ScrollText,
  Settings,
  Target,
  TrendingUp,
  Truck,
  Users,
  Workflow,
} from 'lucide-react';
import type { CurrentUser } from '../lib/api';

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  roles: CurrentUser['role'][];
  available: boolean;
  group: string;
}

export const NAV_ITEMS: NavItem[] = [
  { href: '/admin', label: 'لوحة التحكم', icon: LayoutDashboard, roles: ['ADMIN'], available: true, group: 'نظرة عامة' },
  { href: '/admin/selection', label: 'التقييم والاختيار', icon: Target, roles: ['ADMIN'], available: false, group: 'نظرة عامة' },
  { href: '/admin/applications', label: 'طلبات الانضمام', icon: Inbox, roles: ['ADMIN'], available: true, group: 'إدارة البرنامج' },
  { href: '/admin/operations', label: 'دورات العمل', icon: Workflow, roles: ['ADMIN'], available: false, group: 'إدارة البرنامج' },
  { href: '/admin/associations', label: 'الجمعيات', icon: Building2, roles: ['ADMIN'], available: true, group: 'الكيانات' },
  { href: '/admin/beneficiaries', label: 'المستفيدون', icon: Users, roles: ['ADMIN'], available: true, group: 'الكيانات' },
  { href: '/admin/delegates', label: 'المناديب', icon: Bike, roles: ['ADMIN'], available: true, group: 'الكيانات' },
  { href: '/admin/abanmi', label: 'حسابات أبانمي', icon: Users, roles: ['ADMIN'], available: true, group: 'الكيانات' },
  { href: '/admin/inventory', label: 'المخزون', icon: Package, roles: ['ADMIN'], available: true, group: 'العمليات' },
  { href: '/admin/allocation', label: 'التخصيص', icon: Boxes, roles: ['ADMIN'], available: true, group: 'العمليات' },
  { href: '/admin/receipts', label: 'محاضر الاستلام', icon: ClipboardList, roles: ['ADMIN'], available: true, group: 'العمليات' },
  { href: '/admin/deliveries', label: 'عمليات التسليم', icon: Truck, roles: ['ADMIN'], available: true, group: 'العمليات' },
  { href: '/admin/activities', label: 'متابعة المشروع', icon: TrendingUp, roles: ['ADMIN'], available: true, group: 'المتابعة' },
  { href: '/admin/participation', label: 'الاتفاقيات والتفعيل', icon: Workflow, roles: ['ADMIN'], available: true, group: 'المتابعة' },
  { href: '/admin/procurement', label: 'المشتريات والشحنات', icon: ClipboardList, roles: ['ADMIN'], available: true, group: 'العمليات' },
  { href: '/admin/escalations', label: 'التصعيدات والإغلاق', icon: Target, roles: ['ADMIN'], available: true, group: 'المتابعة' },
  { href: '/admin/audit', label: 'سجل العمليات', icon: ScrollText, roles: ['ADMIN'], available: true, group: 'السجل والبيانات' },
  { href: '/admin/reference-data', label: 'البيانات المرجعية', icon: Database, roles: ['ADMIN'], available: true, group: 'السجل والبيانات' },

  { href: '/association', label: 'لوحة التحكم', icon: LayoutDashboard, roles: ['ASSOCIATION'], available: true, group: 'نظرة عامة' },
  { href: '/association/operations', label: 'دورات العمل', icon: Workflow, roles: ['ASSOCIATION'], available: false, group: 'نظرة عامة' },
  { href: '/association/beneficiaries', label: 'المستفيدون', icon: Users, roles: ['ASSOCIATION'], available: true, group: 'العمليات' },
  { href: '/association/inventory', label: 'المخزون', icon: Package, roles: ['ASSOCIATION'], available: true, group: 'العمليات' },
  { href: '/association/receipts', label: 'محاضر الاستلام', icon: ClipboardList, roles: ['ASSOCIATION'], available: true, group: 'العمليات' },
  { href: '/association/delegates', label: 'المناديب', icon: Bike, roles: ['ASSOCIATION'], available: true, group: 'العمليات' },
  { href: '/association/deliveries', label: 'عمليات التسليم', icon: Truck, roles: ['ASSOCIATION'], available: true, group: 'العمليات' },
  { href: '/association/reports', label: 'التقارير', icon: FileBarChart, roles: ['ASSOCIATION'], available: true, group: 'المتابعة' },
  { href: '/association/participation', label: 'الاتفاقيات والإغلاق', icon: Workflow, roles: ['ASSOCIATION'], available: true, group: 'المتابعة' },
  { href: '/association/escalations', label: 'التصعيدات', icon: Target, roles: ['ASSOCIATION'], available: true, group: 'المتابعة' },
  { href: '/association/audit', label: 'سجل العمليات', icon: ScrollText, roles: ['ASSOCIATION'], available: true, group: 'السجل والإعدادات' },
  { href: '/association/settings', label: 'الإعدادات', icon: Settings, roles: ['ASSOCIATION'], available: true, group: 'السجل والإعدادات' },

  { href: '/abanmi', label: 'لوحة المشروع', icon: LayoutDashboard, roles: ['ABANMI'], available: true, group: 'نظرة عامة' },
  { href: '/abanmi/reports', label: 'التقارير', icon: FileBarChart, roles: ['ABANMI'], available: true, group: 'المتابعة' },
  { href: '/abanmi/activities', label: 'متابعة المشروع', icon: TrendingUp, roles: ['ABANMI'], available: true, group: 'المتابعة' },
];

export function navForRole(role: CurrentUser['role']): NavItem[] {
  return NAV_ITEMS.filter((item) => item.roles.includes(role) && item.available);
}

export function navGroupsForRole(role: CurrentUser['role']): { group: string; items: NavItem[] }[] {
  const items = navForRole(role);
  const order: string[] = [];
  const byGroup = new Map<string, NavItem[]>();
  for (const item of items) {
    if (!byGroup.has(item.group)) {
      byGroup.set(item.group, []);
      order.push(item.group);
    }
    byGroup.get(item.group)!.push(item);
  }
  return order.map((group) => ({ group, items: byGroup.get(group)! }));
}

export const ROLE_LABELS: Record<CurrentUser['role'], string> = {
  ADMIN: 'إدارة',
  ASSOCIATION: 'جمعية',
  DELEGATE: 'مندوب',
  ABANMI: 'أبانمي',
};

export function homeForRole(role: CurrentUser['role']): string {
  if (role === 'ADMIN') return '/admin';
  if (role === 'ASSOCIATION') return '/association';
  if (role === 'DELEGATE') return '/delegate';
  return '/abanmi';
}
