import request from 'supertest';
import { randomInt, randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { AccountRole, AccountStatus, AuthCredentialType, prisma } from '@alzad/db';
import { createTestApp } from './utils/bootstrap';
import { hashSecret } from './utils/fixtures';
import { assertE2eNotTargetingProduction } from './utils/production-target.guard';
import type { AdminApplicationScope } from '@alzad/shared';

/** The suite setup also verifies the database canary. Never run against production. */
describe('owner-managed ADMIN staff permission boundary', () => {
  let app: INestApplication;
  let ownerId: string;
  let ownerCookie: string;
  let ownerCreated = false;
  let ownerPrevious: { status: AccountStatus; mustChangePassword: boolean; adminFullAccess: boolean; lastLoginAt: Date | null } | undefined;
  const suffix = randomUUID();
  const ownerEmail = `admin-owner-${suffix}@example.org`;
  const ownerPassword = 'OwnerE2eSecurePass123!';
  const staffIds: string[] = [];
  const applicationIds: string[] = [];
  const participationIds: string[] = [];
  const http = () => request(app.getHttpServer());
  const cookie = (response: { headers: Record<string, unknown> }) => (response.headers['set-cookie'] as string[])[0].split(';')[0];

  beforeAll(async () => {
    assertE2eNotTargetingProduction();
    ({ app } = await createTestApp());
    const existing = await prisma.account.findUnique({ where: { publicCode: 'ADM-000001' } });
    if (existing) {
      ownerPrevious = { status: existing.status, mustChangePassword: existing.mustChangePassword, adminFullAccess: existing.adminFullAccess, lastLoginAt: existing.lastLoginAt };
      if (existing.role !== AccountRole.ADMIN || existing.archivedAt) throw new Error('E2E owner fixture must be an unarchived ADMIN');
      ownerId = existing.id;
      await prisma.account.update({ where: { id: ownerId }, data: { status: AccountStatus.ACTIVE, mustChangePassword: false, adminFullAccess: true } });
    } else {
      const owner = await prisma.account.create({ data: { publicCode: 'ADM-000001', name: 'مالك اختبار الصلاحيات', role: AccountRole.ADMIN, adminFullAccess: true } });
      ownerId = owner.id; ownerCreated = true;
    }
    // Dedicated credential leaves the owner's original credentials unchanged.
    await prisma.authCredential.create({ data: { accountId: ownerId, type: AuthCredentialType.EMAIL_PASSWORD, identifier: ownerEmail, secretHash: await hashSecret(ownerPassword) } });
    // The database migration normally reconciles this counter; this also supports an empty test DB.
    await prisma.publicCodeCounter.upsert({ where: { prefix: 'ADM' }, create: { prefix: 'ADM', nextValue: 1 }, update: {} });
    const loggedIn = await http().post('/api/v1/auth/login').send({ type: 'user', email: ownerEmail, password: ownerPassword }).expect(200);
    ownerCookie = cookie(loggedIn);
  }, 60_000);

  afterAll(async () => {
    if (!app) return;
    assertE2eNotTargetingProduction();
    await prisma.idempotencyKey.deleteMany({ where: { accountId: { in: staffIds } } });
    await prisma.projectParticipation.deleteMany({ where: { id: { in: participationIds } } });
    await prisma.associationApplication.deleteMany({ where: { id: { in: applicationIds } } });
    await prisma.auditLog.deleteMany({ where: { OR: [{ actorAccountId: { in: staffIds } }, { entityId: { in: [...staffIds, ...applicationIds] } }] } });
    await prisma.authSession.deleteMany({ where: { accountId: { in: staffIds } } });
    await prisma.passwordResetToken.deleteMany({ where: { accountId: { in: staffIds } } });
    await prisma.authCredential.deleteMany({ where: { accountId: { in: staffIds } } });
    await prisma.account.deleteMany({ where: { id: { in: staffIds } } });
    await prisma.authCredential.deleteMany({ where: { type: AuthCredentialType.EMAIL_PASSWORD, identifier: ownerEmail } });
    // Remove just the owner session created here, preserving other suite sessions.
    if (ownerCookie) await http().post('/api/v1/auth/logout').set('Cookie', ownerCookie);
    if (ownerCreated) {
      await prisma.auditLog.deleteMany({ where: { actorAccountId: ownerId } });
      await prisma.authSession.deleteMany({ where: { accountId: ownerId } });
      await prisma.account.delete({ where: { id: ownerId } });
    } else if (ownerPrevious) await prisma.account.update({ where: { id: ownerId }, data: ownerPrevious });
    await app.close();
  });

  async function newStaff(adminPermissions: string[] = [], adminApplicationScope: AdminApplicationScope = { allRegions: true }) {
    const email = `admin-staff-${randomUUID()}@example.org`;
    const created = await http().post('/api/v1/accounts/admins').set('Cookie', ownerCookie).send({ name: 'سارة موظفة التقييم', email, adminPermissions, adminApplicationScope }).expect(201);
    const id = created.body.accountId as string; staffIds.push(id);
    expect(created.body.temporaryPassword).toEqual(expect.any(String));
    const login = await http().post('/api/v1/auth/login').send({ type: 'user', email, password: created.body.temporaryPassword }).expect(200);
    return { id, email, temporaryPassword: created.body.temporaryPassword as string, cookie: cookie(login) };
  }

  async function readyStaff(adminPermissions: string[], adminApplicationScope: AdminApplicationScope = { allRegions: true }) {
    const staff = await newStaff(adminPermissions, adminApplicationScope);
    const password = `StaffE2e-${randomUUID()}!`;
    await http().patch('/api/v1/auth/password').set('Cookie', staff.cookie).send({ currentPassword: staff.temporaryPassword, newPassword: password }).expect(200);
    await http().get('/api/v1/auth/me').set('Cookie', staff.cookie).expect(401);
    const login = await http().post('/api/v1/auth/login').send({ type: 'user', email: staff.email, password }).expect(200);
    return { ...staff, password, cookie: cookie(login) };
  }

  async function application(regionOfficialCode: string | null = null) {
    const key = randomUUID();
    const row = await prisma.associationApplication.create({ data: { publicCode: `STAFF-E2E-${key}`, clientRequestId: key, name: 'جمعية اختبار الصلاحيات', region: 'الرياض', regionOfficialCode, city: 'الرياض', phone: `05${randomInt(10_000_000, 99_999_999)}`, email: `application-${key}@example.org`, contactName: 'ممثل اختبار', eligibilityStatus: 'PASSED', processingStartedAt: new Date() } });
    applicationIds.push(row.id);
    return row.id;
  }

  const ratings = () => ({ operationalReadiness: 5, technicalCapability: 4, previousExperience: 3, integrityTransparency: 5, participationCommitment: 4, sustainabilityImpact: 5, opId: randomUUID() });

  it('uses existing temporary-password flow, defaults to no grants, and exposes no stored credentials', async () => {
    const staff = await newStaff();
    const me = await http().get('/api/v1/auth/me').set('Cookie', staff.cookie).expect(200);
    expect(me.body).toMatchObject({ name: 'سارة موظفة التقييم', role: 'ADMIN', adminFullAccess: false, adminPermissions: [], mustChangePassword: true });
    await http().get('/api/v1/association-applications').set('Cookie', staff.cookie).expect(403);
    const listed = await http().get('/api/v1/accounts/admins').set('Cookie', ownerCookie).expect(200);
    const row = listed.body.find((account: { id: string }) => account.id === staff.id);
    expect(row).not.toHaveProperty('temporaryPassword'); expect(row).not.toHaveProperty('credentials'); expect(row).not.toHaveProperty('secretHash');
    expect(await prisma.authCredential.findFirst({ where: { accountId: staff.id } })).toMatchObject({ secretHash: expect.stringContaining('$argon2id$') });
  });

  it('checks mandatory password change even for granted staff business routes', async () => {
    const staff = await newStaff(['applications.evaluate']);
    const denied = await http().get('/api/v1/association-applications').set('Cookie', staff.cookie).expect(403);
    expect(denied.body.error.code).toBe('AUTH_PASSWORD_CHANGE_REQUIRED');
    await http().patch('/api/v1/auth/password').set('Cookie', staff.cookie).send({ currentPassword: staff.temporaryPassword, newPassword: 'NewStaffSecurePass123!' }).expect(200);
    await http().get('/api/v1/auth/me').set('Cookie', staff.cookie).expect(401);
  });

  it('combines independent grants, attributes evaluation to the named person, and revokes grants on the same session', async () => {
    const staff = await readyStaff(['applications.evaluate', 'activities.read']);
    const id = await application();
    await http().get('/api/v1/association-applications').set('Cookie', staff.cookie).expect(200);
    await http().get('/api/v1/activities').set('Cookie', staff.cookie).expect(200);
    await http().post(`/api/v1/association-applications/${id}/evaluation`).set('Cookie', staff.cookie).send(ratings()).expect(201);
    const detail = await http().get(`/api/v1/association-applications/${id}`).set('Cookie', staff.cookie).expect(200);
    expect(detail.body.evaluator).toMatchObject({ id: staff.id, name: 'سارة موظفة التقييم' });
    const audit = await http().get(`/api/v1/audit?entityId=${id}`).set('Cookie', ownerCookie).expect(200);
    expect(audit.body.items).toEqual(expect.arrayContaining([expect.objectContaining({ action: 'APPLICATION_EVALUATED', actorAccount: expect.objectContaining({ name: 'سارة موظفة التقييم' }) })]));
    await http().post(`/api/v1/association-applications/${id}/selection-decision`).set('Cookie', staff.cookie).send({ decision: 'RESERVE', opId: randomUUID() }).expect(403);
    await http().patch(`/api/v1/accounts/admins/${staff.id}`).set('Cookie', ownerCookie).send({ adminPermissions: ['applications.evaluate', 'applications.select', 'activities.read'] }).expect(200);
    await http().post(`/api/v1/association-applications/${id}/selection-decision`).set('Cookie', staff.cookie).send({ decision: 'RESERVE', workflowVersion: 2, opId: randomUUID() }).expect(201);
    await http().patch(`/api/v1/accounts/admins/${staff.id}`).set('Cookie', ownerCookie).send({ adminPermissions: [] }).expect(200);
    await http().get('/api/v1/association-applications').set('Cookie', staff.cookie).expect(403);
    await http().get('/api/v1/activities').set('Cookie', staff.cookie).expect(403);
    await http().get('/api/v1/auth/me').set('Cookie', staff.cookie).expect(200).expect(({ body }) => expect(body.adminPermissions).toEqual([]));
  });

  it('denies mutation to read-only staff including legacy alternatives, settings and covenant operations', async () => {
    const staff = await readyStaff(['applications.read']);
    const id = await application();
    await http().get(`/api/v1/association-applications/${id}`).set('Cookie', staff.cookie).expect(200);
    for (const path of [`association-applications/${id}/evaluation`, `association-applications/${id}/eligibility`, `association-applications/${id}/selection-decision`, `association-applications/${id}/review`, 'association-applications/selection/commit', `participations/${id}/activate`, `participations/${id}/signing-account`]) {
      await http().post(`/api/v1/${path}`).set('Cookie', staff.cookie).send({}).expect(403);
    }
    await http().put('/api/v1/settings').set('Cookie', staff.cookie).send({ key: 'application.intakeClosesAt', value: null }).expect(403);
    await http().get('/api/v1/associations').set('Cookie', staff.cookie).expect(403);
    await http().post('/api/v1/accounts/admins').set('Cookie', staff.cookie).send({}).expect(403);
  });

  it('enforces official regional scope on lists, details, files, actions, mixed bulk, reports and the same session after reassignment', async () => {
    const staff = await readyStaff(['applications.review', 'applications.evaluate', 'applications.select', 'participations.manage', 'dashboard.read', 'reports.read', 'audit.read'], { regionCodes: ['0001'] });
    const allowed = await application('0001'); const outside = await application('0013'); const historical = await application();
    for (const id of [allowed,outside]) await prisma.auditLog.create({ data: { entityType:'association_applications',entityId:id,action:'REGIONAL_SCOPE_TEST',metadata:{fixture:true} } });
    const allowedParticipation=await prisma.projectParticipation.create({data:{applicationId:allowed,status:'APPROVED_AWAITING_SETUP',activationBasis:'AGREEMENT_COMPLETED'}});
    const outsideParticipation=await prisma.projectParticipation.create({data:{applicationId:outside,status:'APPROVED_AWAITING_SETUP',activationBasis:'AGREEMENT_COMPLETED'}});
    participationIds.push(allowedParticipation.id,outsideParticipation.id);
    await prisma.associationApplication.updateMany({where:{id:{in:[allowed,outside]}},data:{selectionList:'MAIN'}});
    const participations=await http().get('/api/v1/participations').set('Cookie',staff.cookie).expect(200);
    expect(participations.body.map((row:{id:string})=>row.id)).toContain(allowedParticipation.id);
    expect(participations.body.map((row:{id:string})=>row.id)).not.toContain(outsideParticipation.id);
    await http().get(`/api/v1/reports/closure/readiness/${outsideParticipation.id}`).set('Cookie',staff.cookie).expect(403);
    await http().post(`/api/v1/participations/${outsideParticipation.id}/setup-complete`).set('Cookie',staff.cookie).send({opId:randomUUID()}).expect(403);
    await prisma.associationApplication.updateMany({where:{id:{in:[allowed,outside]}},data:{selectionList:'NONE'}});
    const listed = await http().get('/api/v1/association-applications?pageSize=100').set('Cookie', staff.cookie).expect(200);
    const ids = listed.body.items.map((row: { id: string }) => row.id);
    expect(ids).toContain(allowed); expect(ids).not.toContain(outside); expect(ids).not.toContain(historical);
    await http().get(`/api/v1/association-applications/${allowed}`).set('Cookie', staff.cookie).expect(200);
    for (const id of [outside, historical]) {
      for (const suffix of ['', '/license-file', '/eligibility-evidence']) await http().get(`/api/v1/association-applications/${id}${suffix}`).set('Cookie', staff.cookie).expect(403);
      await http().post(`/api/v1/association-applications/${id}/evaluation`).set('Cookie', staff.cookie).send(ratings()).expect(403);
      await http().post(`/api/v1/association-applications/${id}/selection-decision`).set('Cookie', staff.cookie).send({ decision: 'RESERVE', workflowVersion: 2, opId: randomUUID() }).expect(403);
    }
    await prisma.associationApplication.updateMany({ where: { id: { in: [allowed, outside] } }, data: { processingStartedAt: null } });
    await http().post('/api/v1/association-applications/processing/start').set('Cookie', staff.cookie).send({ applicationIds: [allowed, outside], opId: randomUUID() }).expect(403);
    expect((await prisma.associationApplication.findUniqueOrThrow({ where: { id: allowed } })).processingStartedAt).toBeNull();
    const report = await http().get('/api/v1/reports/admin').set('Cookie', staff.cookie).expect(200);
    const reportIds = report.body.applications.map((row: { id: string }) => row.id);
    expect(reportIds).toContain(allowed); expect(reportIds).not.toContain(outside); expect(reportIds).not.toContain(historical);
    expect(report.body.projectClosure).toBeNull();
    await http().get('/api/v1/reports/closure/project').set('Cookie', staff.cookie).expect(403);
    await http().get('/api/v1/dashboard/admin').set('Cookie', staff.cookie).expect(200);
    await http().get(`/api/v1/audit?entityId=${outside}`).set('Cookie', staff.cookie).expect(200).expect(({ body }) => expect(body.items).toEqual([]));
    await http().get(`/api/v1/audit?entityId=${allowed}`).set('Cookie', staff.cookie).expect(200).expect(({body})=>expect(body.items).toEqual(expect.arrayContaining([expect.objectContaining({action:'REGIONAL_SCOPE_TEST'})])));
    await http().patch(`/api/v1/accounts/admins/${staff.id}`).set('Cookie', ownerCookie).send({ adminApplicationScope: { regionCodes: ['0013'] } }).expect(200);
    await http().get(`/api/v1/association-applications/${allowed}`).set('Cookie', staff.cookie).expect(403);
    await http().get(`/api/v1/association-applications/${outside}`).set('Cookie', staff.cookie).expect(200);
    await http().get('/api/v1/auth/me').set('Cookie', staff.cookie).expect(200).expect(({ body }) => expect(body.adminApplicationScope).toEqual({ regionCodes: ['0013'] }));
  });

  it('rejects missing, forged and empty scope without creating a staff account', async () => {
    for (const adminApplicationScope of [undefined, null, {}, { regionCodes: [] }, { regionCodes: ['0001', '0001'] }, { regionCodes: ['0100'] }, { allRegions: true, regionCodes: ['0001'] }]) {
      await http().post('/api/v1/accounts/admins').set('Cookie', ownerCookie).send({ name: 'اختبار نطاق مرفوض', email: `invalid-scope-${randomUUID()}@example.org`, adminPermissions: [], adminApplicationScope }).expect(400);
    }
  });

  it('rejects escalation fields and protects the owner account from staff-management mutations', async () => {
    for (const extra of [{ adminFullAccess: true }, { role: 'ADMIN' }, { owner: true }, { associationId: randomUUID() }]) {
      await http().post('/api/v1/accounts/admins').set('Cookie', ownerCookie).send({ name: 'محاولة اختبار', email: `reject-${randomUUID()}@example.org`, adminPermissions: [], adminApplicationScope: { allRegions: true }, ...extra }).expect(400);
    }
    await http().patch(`/api/v1/accounts/admins/${ownerId}`).set('Cookie', ownerCookie).send({ adminPermissions: [] }).expect(403);
    await http().patch(`/api/v1/accounts/admins/${ownerId}/status`).set('Cookie', ownerCookie).send({ status: 'SUSPENDED' }).expect(403);
    await http().post(`/api/v1/accounts/admins/${ownerId}/reset-password`).set('Cookie', ownerCookie).expect(403);
  });

  it('revokes existing sessions on suspension and owner password reset', async () => {
    const staff = await readyStaff(['applications.read']);
    await http().patch(`/api/v1/accounts/admins/${staff.id}/status`).set('Cookie', ownerCookie).send({ status: 'SUSPENDED' }).expect(200);
    await http().get('/api/v1/auth/me').set('Cookie', staff.cookie).expect(401);
    await http().patch(`/api/v1/accounts/admins/${staff.id}/status`).set('Cookie', ownerCookie).send({ status: 'ACTIVE' }).expect(200);
    const relogin = await http().post('/api/v1/auth/login').send({ type: 'user', email: staff.email, password: staff.password }).expect(200);
    const oldCookie = cookie(relogin);
    const reset = await http().post(`/api/v1/accounts/admins/${staff.id}/reset-password`).set('Cookie', ownerCookie).expect(201);
    await http().get('/api/v1/auth/me').set('Cookie', oldCookie).expect(401);
    const fresh = await http().post('/api/v1/auth/login').send({ type: 'user', email: staff.email, password: reset.body.temporaryPassword }).expect(200);
    await http().get('/api/v1/association-applications').set('Cookie', cookie(fresh)).expect(403).expect(({ body }) => expect(body.error.code).toBe('AUTH_PASSWORD_CHANGE_REQUIRED'));
    expect(await prisma.authSession.count({ where: { accountId: staff.id, revokedAt: { not: null } } })).toBeGreaterThanOrEqual(3);
  });
});
