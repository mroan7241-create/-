import { hasAdminPermission, type AdminPermission } from '@alzad/shared';
import type { CurrentUser } from './api';

type AccessUser = Pick<CurrentUser, 'role' | 'publicCode' | 'adminFullAccess' | 'adminPermissions'>;

/** Display compatibility while an existing owner session meets a rolling API deployment. */
export function isAdminOwner(user: AccessUser | null | undefined): boolean {
  return user?.role === 'ADMIN' && user.publicCode === 'ADM-000001' && (user.adminFullAccess === true || typeof user.adminFullAccess === 'undefined');
}

export function canAdmin(user: AccessUser | null | undefined, permission: AdminPermission): boolean {
  return user?.role === 'ADMIN' && (isAdminOwner(user) || (user.adminFullAccess === false && hasAdminPermission(false, user.adminPermissions ?? [], permission)));
}

export function canAdminAll(user: AccessUser | null | undefined, permissions: AdminPermission[]): boolean {
  return permissions.every((permission) => canAdmin(user, permission));
}

const ADMIN_ROUTES: Record<string, AdminPermission[]> = {
  '/admin': ['dashboard.read'],
  '/admin/applications': ['applications.read', 'participations.read', 'settings.manage'],
  '/admin/selection': ['applications.read', 'settings.manage'],
  '/admin/participation': ['participations.read', 'notifications.manage', 'reports.read'],
  '/admin/operations': ['participations.read', 'notifications.manage', 'reports.read'],
  '/admin/associations': ['associations.read'],
  '/admin/beneficiaries': ['beneficiaries.read'],
  '/admin/delegates': ['delegates.read'],
  '/admin/abanmi': ['abanmi.manage'],
  '/admin/inventory': ['inventory.read'],
  '/admin/central-stock': ['inventory.read'],
  '/admin/allocation': ['allocation.read'],
  '/admin/receipts': ['receipts.read'],
  '/admin/deliveries': ['deliveries.read'],
  '/admin/procurement': ['procurement.read'],
  '/admin/escalations': ['escalations.read'],
  '/admin/reports': ['reports.read'],
  '/admin/activities': ['activities.read'],
  '/admin/audit': ['audit.read'],
  '/admin/reference-data': ['reference.read'],
};

export function canAccessAdminPath(user: AccessUser | null | undefined, href: string): boolean {
  if (user?.role !== 'ADMIN') return false;
  const path = href.split('?')[0];
  if (path === '/admin/access-empty') return true;
  if (path === '/admin/accounts' || path.startsWith('/admin/accounts/')) return isAdminOwner(user);
  const route = Object.keys(ADMIN_ROUTES).find((key) => path === key || (key !== '/admin' && path.startsWith(`${key}/`)));
  return !!route && ADMIN_ROUTES[route].some((permission) => canAdmin(user, permission));
}
