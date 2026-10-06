import { isAdminApplicationScope, type AdminPermission } from '@alzad/shared';
import { AccountRole, type Prisma, prisma } from '@alzad/db';
import { ApiError } from '../../common/api-error';
import type { AuthContext } from './auth.types';

/** Null is intentionally legacy/unrestricted. Malformed persisted scope fails closed. */
export function adminApplicationRegionCodes(ctx: AuthContext): string[] | null {
  if (ctx.role !== AccountRole.ADMIN || ctx.adminFullAccess === true || ctx.adminApplicationScope == null) return null;
  const scope: unknown = ctx.adminApplicationScope;
  if (!isAdminApplicationScope(scope)) return [];
  return 'allRegions' in scope ? null : scope.regionCodes;
}
export function adminApplicationScopeWhere(ctx: AuthContext): Prisma.AssociationApplicationWhereInput {
  const codes = adminApplicationRegionCodes(ctx);
  return codes === null ? {} : { regionOfficialCode: { in: codes } };
}
export function assertAdminApplicationScope(ctx: AuthContext, regionOfficialCode: string | null | undefined): void {
  const codes = adminApplicationRegionCodes(ctx);
  if (codes !== null && (!regionOfficialCode || !codes.includes(regionOfficialCode))) throw new ApiError('ADMIN_APPLICATION_SCOPE_FORBIDDEN', 'هذا الطلب خارج المناطق المسموح بها لحسابك', 403);
}
export function adminAssociationScopeWhere(ctx: AuthContext): Prisma.AssociationWhereInput {
  const codes = adminApplicationRegionCodes(ctx);
  return codes === null ? {} : { participation: { is: { application: { is: adminApplicationScopeWhere(ctx) } } } };
}
/** Fresh account scope for a write transaction; never trust the client's region. */
export async function lockAdminApplicationScope(tx: Pick<Prisma.TransactionClient, 'account' | '$queryRaw'>, ctx: AuthContext): Promise<AuthContext> {
  if (ctx.role !== AccountRole.ADMIN) return ctx;
  await tx.$queryRaw`SELECT "id" FROM "accounts" WHERE "id" = ${ctx.accountId}::uuid FOR SHARE`;
  const account = await tx.account.findUnique({ where: { id: ctx.accountId }, select: { role: true, status: true, archivedAt: true, adminFullAccess: true, adminApplicationScope: true } });
  if (!account || account.role !== AccountRole.ADMIN || account.status !== 'ACTIVE' || account.archivedAt) throw new ApiError('ADMIN_APPLICATION_SCOPE_FORBIDDEN', 'الحساب الإداري غير متاح', 403);
  return { ...ctx, adminFullAccess: account.adminFullAccess, adminApplicationScope: account.adminApplicationScope as AuthContext['adminApplicationScope'] };
}
export async function assertAdminApplicationScopeCurrent(tx: Pick<Prisma.TransactionClient, 'account' | '$queryRaw'>, ctx: AuthContext, regionOfficialCode: string | null | undefined): Promise<void> {
  assertAdminApplicationScope(await lockAdminApplicationScope(tx, ctx), regionOfficialCode);
}
export async function assertAdminAssociationScope(ctx: AuthContext, associationId: string, tx: Pick<Prisma.TransactionClient, 'projectParticipation'> = prisma): Promise<void> {
  if (adminApplicationRegionCodes(ctx) === null) return;
  const participation = await tx.projectParticipation.findUnique({ where: { associationId }, select: { application: { select: { regionOfficialCode: true } } } });
  assertAdminApplicationScope(ctx, participation?.application?.regionOfficialCode);
}
/** Only explicitly linked entities are visible; unknown historical events fail closed. */
export async function adminAuditScopeWhere(ctx: AuthContext): Promise<Prisma.AuditLogWhereInput> {
  if (adminApplicationRegionCodes(ctx) === null) return {};
  const applications = await prisma.associationApplication.findMany({ where: adminApplicationScopeWhere(ctx), select: { id: true } });
  const applicationIds = applications.map((row) => row.id);
  const participations = await prisma.projectParticipation.findMany({ where: { applicationId: { in: applicationIds } }, select: { id: true, agreements: { select: { id: true } } } });
  return { OR: [
    { association: { is: adminAssociationScopeWhere(ctx) } },
    { entityType: 'association_applications', entityId: { in: applicationIds } },
    { entityType: 'project_participations', entityId: { in: participations.map((row) => row.id) } },
    { entityType: 'participation_agreements', entityId: { in: participations.flatMap((row) => row.agreements.map((agreement) => agreement.id)) } },
  ] };
}

/** Exact registered method/path contracts. Unknown restricted ADMIN routes deny. */
export const ADMIN_ROUTE_POLICIES: Readonly<Record<string, AdminPermission | 'self' | 'owner'>> = {
  'GET /auth/me': 'self', 'POST /auth/logout': 'self', 'PATCH /auth/password': 'self',
  'GET /accounts/admins': 'owner', 'POST /accounts/admins': 'owner',
  'PATCH /accounts/admins/:id': 'owner', 'PATCH /accounts/admins/:id/status': 'owner',
  'POST /accounts/admins/:id/reset-password': 'owner',
  'GET /accounts/abanmi': 'abanmi.manage', 'POST /accounts/abanmi': 'abanmi.manage',
  'POST /auth/associations/:id/reset-password': 'associations.manage',
  'GET /dashboard/admin': 'dashboard.read',
  'GET /association-applications': 'applications.read',
  'GET /association-applications/:id': 'applications.read',
  'GET /association-applications/:id/license-file': 'applications.read',
  'GET /association-applications/:id/eligibility-evidence': 'applications.read',
  'POST /association-applications/selection/preview': 'applications.read',
  'POST /association-applications/:id/review': 'owner',
  'POST /association-applications/processing/start': 'applications.review',
  'POST /association-applications/:id/eligibility': 'applications.review',
  'POST /association-applications/:id/eligibility/resend-rejection': 'applications.review',
  'POST /association-applications/:id/information-request': 'applications.review',
  'POST /association-applications/:id/information-request/resend': 'applications.review',
  'POST /association-applications/:id/evaluation': 'applications.evaluate',
  'POST /association-applications/:id/selection-decision': 'applications.select',
  'POST /association-applications/:id/selection-decision/resend': 'applications.select',
  'POST /association-applications/selection/commit': 'applications.select',
  'GET /associations': 'associations.read', 'GET /associations/:id': 'associations.read',
  'POST /associations': 'associations.manage', 'PATCH /associations/:id': 'associations.manage',
  'GET /beneficiaries': 'beneficiaries.read', 'GET /beneficiaries/:id': 'beneficiaries.read',
  'GET /beneficiaries/import/template.xlsx': 'beneficiaries.read',
  'POST /beneficiaries/import/preview-xlsx': 'beneficiaries.manage',
  'POST /beneficiaries/import': 'beneficiaries.manage', 'POST /beneficiaries': 'beneficiaries.manage',
  'POST /beneficiaries/bulk-review': 'beneficiaries.manage', 'PATCH /beneficiaries/:id': 'beneficiaries.manage',
  'PATCH /beneficiaries/:id/location': 'beneficiaries.manage', 'POST /beneficiaries/:id/review': 'beneficiaries.manage',
  'POST /beneficiaries/:id/list-decision': 'beneficiaries.manage', 'POST /beneficiaries/:id/promote-reserve': 'beneficiaries.manage',
  'POST /beneficiaries/:id/replace': 'beneficiaries.manage', 'DELETE /beneficiaries/needs/:needId': 'beneficiaries.manage',
  'GET /delegates': 'delegates.read', 'GET /delegates/:id': 'delegates.read',
  'POST /delegates': 'delegates.manage', 'PATCH /delegates/:id': 'delegates.manage',
  'POST /delegates/:id/status': 'delegates.manage', 'POST /delegates/:id/regenerate-code': 'delegates.manage',
  'GET /inventory/devices': 'inventory.read', 'GET /inventory/devices/:id': 'inventory.read',
  'PATCH /inventory/devices/:id': 'inventory.manage', 'POST /inventory/devices/:id/mark-damaged': 'inventory.manage',
  'GET /inventory/damage-cases': 'inventory.read', 'POST /inventory/damage-cases/:id/decision': 'inventory.manage',
  'GET /central-stock': 'inventory.read', 'POST /central-stock/contract': 'inventory.manage', 'POST /central-stock/receipts': 'inventory.manage',
  'GET /receipts': 'receipts.read', 'GET /receipts/:id': 'receipts.read',
  'GET /receipts/:id/evidence/:evidenceType': 'receipts.read',
  'POST /receipts': 'receipts.manage', 'POST /receipts/:id/send': 'receipts.manage',
  'GET /deliveries': 'deliveries.read', 'GET /deliveries/:id': 'deliveries.read',
  'GET /deliveries/attempts/:attemptId/proof': 'deliveries.read', 'GET /deliveries/attempts/:attemptId/signature': 'deliveries.read',
  'POST /deliveries/assign': 'deliveries.manage', 'POST /deliveries/:id/retry': 'deliveries.manage',
  'POST /deliveries/:id/return': 'deliveries.manage', 'POST /deliveries/:id/zaad-approval': 'deliveries.manage',
  'POST /deliveries/:id/reschedule': 'deliveries.manage', 'POST /deliveries/:id/resume': 'deliveries.manage',
  'POST /deliveries/:id/admin-return-override': 'deliveries.manage',
  'GET /procurement/orders': 'procurement.read', 'POST /procurement/orders': 'procurement.manage',
  'POST /procurement/orders/:id/transition': 'procurement.manage', 'POST /procurement/shipments': 'procurement.manage',
  'POST /procurement/shipments/:id/transition': 'procurement.manage', 'POST /procurement/reconciliation-issues/:id/decision': 'procurement.manage',
  'GET /allocation/_module-status': 'allocation.read', 'GET /allocation/baskets': 'allocation.read', 'POST /allocation/run': 'allocation.manage',
  'GET /escalations': 'escalations.read', 'POST /escalations': 'escalations.manage', 'POST /escalations/:id/decision': 'escalations.manage',
  'GET /activities': 'activities.read', 'POST /activities': 'activities.manage', 'POST /activities/catalog/import': 'activities.manage',
  'GET /audit': 'audit.read', 'POST /reference-values': 'reference.manage',
  'GET /settings': 'settings.manage', 'PUT /settings': 'settings.manage', 'GET /settings/_module-status': 'settings.manage',
  'GET /notifications': 'notifications.manage', 'POST /notifications/:id/read': 'notifications.manage',
  'GET /notifications/outbox': 'notifications.manage', 'POST /notifications/process': 'notifications.manage',
  'POST /notifications/operations/step1-completion': 'notifications.manage',
  'GET /participations': 'participations.read', 'GET /participations/agreements/:id/final': 'participations.read',
  'POST /participations/:id/agreements': 'participations.manage', 'POST /participations/agreements/:id/transition': 'participations.manage',
  'POST /participations/:id/signing-account': 'participations.manage', 'POST /participations/agreements/:id/party-one-session': 'participations.manage',
  'POST /participations/:id/setup-complete': 'participations.manage', 'POST /participations/:id/activate': 'participations.manage',
  'POST /participations/:id/coordinator-change': 'participations.manage', 'POST /participations/coordinator-changes/:id/decision': 'participations.manage',
  'GET /reports/abanmi': 'reports.read', 'GET /reports/admin': 'reports.read',
  'GET /reports/abanmi/export.xlsx': 'reports.read', 'GET /reports/admin/export.xlsx': 'reports.read',
  'GET /reports/reconciliation/:associationId': 'reports.read', 'GET /reports/closure/readiness/:participationId': 'reports.read',
  'GET /reports/closure/project': 'reports.read', 'POST /reports/closure/organization/:id/transition': 'reports.manage',
  'POST /reports/closure/organization/:id/reopen': 'reports.manage', 'POST /reports/closure/project/generate': 'reports.manage',
  'POST /reports/closure/project/transition': 'reports.manage',
};

export function adminRoutePolicy(method: string, registeredPath: string | undefined) {
  if (!registeredPath) return undefined;
  // Express supplies the matched route template; IDs and query input cannot alter policy.
  const path = registeredPath.replace(/^\/api\/v1(?=\/|$)/, '');
  return ADMIN_ROUTE_POLICIES[`${method.toUpperCase()} ${path}`];
}
