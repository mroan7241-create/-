import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { INestApplication } from '@nestjs/common';
import { AccountRole, AccountStatus, AgreementStatus, AssociationSelectionList, AuthCredentialType, EligibilityStatus, OutboxEventStatus, OutboxEventType, Prisma, prisma } from '@alzad/db';
import { createTestApp } from './utils/bootstrap';
import { seedTestFixtures } from './utils/fixtures';
import { loginAs } from './utils/node2-fixtures';
import { assertE2eNotTargetingProduction } from './utils/production-target.guard';
import { startTestStorage, stopTestStorage } from './utils/storage-harness';
import { ApplicationV2Service } from '../src/modules/applications/application-v2.service';
import { ApplicationAccessService } from '../src/modules/applications/application-access.service';
import { ApplicationsService } from '../src/modules/applications/applications.service';
import { ParticipationsService } from '../src/modules/participations/participations.service';
import { NotificationsService } from '../src/modules/notifications/notifications.service';
import type { FakeEmailService } from '../src/modules/auth/email/fake-email.service';
import { decryptEmailDelivery, type EmailDeliveryPayload } from '../src/modules/auth/email/email.service';
import type { AuthContext } from '../src/modules/auth/auth.types';

// Jest setup requires both an isolated target and a PostgreSQL safety canary.
describe('selection V2 internal decisions, delivery and unsigned owner correction', () => {
  const prefix = 'FLOW-V2-E2E-';
  let app: INestApplication, fakeEmail: FakeEmailService, v2: ApplicationV2Service, access: ApplicationAccessService, participationService: ParticipationsService, owner: AuthContext;
  let ownerCreated = false, ownerPrevious: { status: AccountStatus; adminFullAccess: boolean } | undefined;
  let adminCookie: string;
  let previousCapacity: Awaited<ReturnType<typeof prisma.systemSetting.findUnique>>;
  let existingOutbox: string[];
  const applicationIds: string[] = [], accountIds: string[] = [], associationIds: string[] = [];
  const op = () => `${prefix}${randomUUID()}`;
  const signature = { buffer: readFileSync(join(process.cwd(), 'test', 'assets', 'synthetic-signature.png')), declaredMimeType: 'image/png' };
  const decision = (id: string, value: 'MAIN' | 'RESERVE' | 'NONE' | 'DECLINED', correction = false) => v2.decideSelection(owner, id, { decision: value, workflowVersion: 2, opId: op(), ...(correction || value === 'DECLINED' ? { reason: 'تصحيح اصطناعي معتمد للاختبار', ownerCorrection: correction } : {}) });

  beforeAll(async () => {
    assertE2eNotTargetingProduction();
    await startTestStorage(); ({ app, fakeEmail } = await createTestApp());
    const fixtures = await seedTestFixtures(); adminCookie = await loginAs(app, fixtures.adminEmail, fixtures.adminPassword);
    app.get(NotificationsService).onModuleDestroy(); // Tests explicitly own worker scheduling.
    const current = await prisma.account.findUnique({ where: { publicCode: 'ADM-000001' } });
    if (current && (current.role !== AccountRole.ADMIN || current.archivedAt)) throw new Error('Isolated owner fixture must be an unarchived ADMIN');
    if (current) ownerPrevious = { status: current.status, adminFullAccess: current.adminFullAccess };
    const account = current ? await prisma.account.update({ where: { id: current.id }, data: { status: AccountStatus.ACTIVE, adminFullAccess: true } }) : await prisma.account.create({ data: { publicCode: 'ADM-000001', name: prefix, role: AccountRole.ADMIN, adminFullAccess: true } });
    ownerCreated = !current;
    owner = { accountId: account.id, role: AccountRole.ADMIN, associationId: null, sessionId: randomUUID(), mustChangePassword: false, adminFullAccess: true, meSnapshot: { publicCode: 'ADM-000001', name: prefix, covenantRequired: false, covenantStatus: null } };
    previousCapacity = await prisma.systemSetting.findUnique({ where: { key: 'selection.mainTargetCount' } });
    await prisma.systemSetting.deleteMany({ where: { key: 'selection.mainTargetCount' } });
    existingOutbox = (await prisma.outboxEvent.findMany({ select: { id: true } })).map(row => row.id);
    v2 = app.get(ApplicationV2Service); access = app.get(ApplicationAccessService); participationService = app.get(ParticipationsService);
  }, 60_000);

  afterAll(async () => {
    if (!app) return;
    assertE2eNotTargetingProduction();
    const agreements = await prisma.participationAgreement.findMany({ where: { participation: { applicationId: { in: applicationIds } } } });
    const fileIds = agreements.flatMap(row => [row.orgSignatureFileId, row.partyOneSignatureFileId, row.finalFileId].filter((id): id is string => Boolean(id)));
    await prisma.systemSetting.deleteMany({ where: { key: { in: agreements.map(row => `COVENANT_COMPLETION_EMAIL:${row.id}`) } } });
    await prisma.outboxEvent.deleteMany({ where: { id: { notIn: existingOutbox } } });
    await prisma.participationAgreement.deleteMany({ where: { id: { in: agreements.map(row => row.id) } } });
    await prisma.projectParticipation.deleteMany({ where: { applicationId: { in: applicationIds } } });
    const drafts = await prisma.associationApplicationDraft.findMany({ where: { submittedApplicationId: { in: applicationIds } }, select: { id: true } });
    await prisma.applicationAccessToken.deleteMany({ where: { draftId: { in: drafts.map(row => row.id) } } });
    await prisma.associationApplicationDraft.deleteMany({ where: { id: { in: drafts.map(row => row.id) } } });
    await prisma.associationApplication.deleteMany({ where: { id: { in: applicationIds } } });
    await prisma.authSession.deleteMany({ where: { accountId: { in: accountIds } } });
    await prisma.passwordResetToken.deleteMany({ where: { accountId: { in: accountIds } } });
    await prisma.authCredential.deleteMany({ where: { accountId: { in: accountIds } } });
    await prisma.fileObject.deleteMany({ where: { id: { in: fileIds } } });
    await prisma.idempotencyKey.deleteMany({ where: { OR: [{ key: { startsWith: prefix } }, { accountId: { in: accountIds } }] } });
    await prisma.account.deleteMany({ where: { id: { in: accountIds } } });
    await prisma.association.deleteMany({ where: { id: { in: associationIds } } });
    await prisma.auditLog.deleteMany({ where: { OR: [{ actorAccountId: owner.accountId }, { entityId: { in: [...applicationIds, ...drafts.map(row => row.id), ...agreements.map(row => row.id)] } }] } });
    if (ownerCreated) await prisma.account.delete({ where: { id: owner.accountId } });
    else if (ownerPrevious) await prisma.account.update({ where: { id: owner.accountId }, data: ownerPrevious });
    if (previousCapacity) await prisma.systemSetting.upsert({ where: { key: previousCapacity.key }, create: { key: previousCapacity.key, value: previousCapacity.value === null ? Prisma.JsonNull : previousCapacity.value }, update: { value: previousCapacity.value === null ? Prisma.JsonNull : previousCapacity.value } });
    await app.close(); await stopTestStorage();
  });

  async function readyApplication() {
    const suffix = randomUUID();
    const row = await prisma.associationApplication.create({ data: { schemaVersion: 2, publicCode: `${prefix}${suffix}`, clientRequestId: suffix, name: `${prefix}جمعية`, region: 'الرياض', regionOfficialCode: '0001', city: 'الرياض', email: `workflow-${suffix}@example.org`, phone: '0550000000', contactName: 'ممثل اصطناعي', pledgeAccepted: true, eligibilityStatus: EligibilityStatus.PASSED, evaluationScore: 80 } });
    applicationIds.push(row.id);
    await prisma.associationApplicationDraft.create({ data: { publicCode: `${prefix}D-${suffix}`, resumeTokenHash: randomUUID(), status: 'SUBMITTED', submittedApplicationId: row.id, contactEmail: row.email, expiresAt: new Date(Date.now() + 86_400_000) } });
    return row;
  }

  async function prepare(row: Awaited<ReturnType<typeof readyApplication>>) {
    await decision(row.id, 'MAIN');
    const participation = await prisma.projectParticipation.findUniqueOrThrow({ where: { applicationId: row.id } });
    const agreement = await participationService.createAgreement(owner, participation.id, { version: 1, templateVersion: '1.0' });
    await participationService.transitionAgreement(owner, agreement.id, AgreementStatus.SENT, undefined, op());
    await participationService.completeSetup(owner, participation.id, op());
    return { participation, agreement };
  }

  async function signingAccount(row: Awaited<ReturnType<typeof readyApplication>>) {
    const prepared = await prepare(row);
    const result = await participationService.prepareSigningAccount(owner, prepared.participation.id, op());
    accountIds.push(result.accountId); associationIds.push(result.associationId);
    const ctx: AuthContext = { accountId: result.accountId, role: AccountRole.ASSOCIATION, associationId: result.associationId, sessionId: randomUUID(), mustChangePassword: true };
    return { ...prepared, result, ctx };
  }

  function sign(ctx: AuthContext, password: string) {
    return participationService.signAssociation(ctx, { representativeName: 'ممثل اصطناعي', representativeTitle: 'مدير الجمعية', authorizedAcknowledgement: 'true', acceptanceAcknowledgement: 'true', completionAcknowledgement: 'true', currentPassword: password, opId: op() }, signature);
  }

  it('rejects obsolete Web contracts, keeps reserve/internal MAIN silent, and keeps NONE distinct from terminal rejection', async () => {
    const row = await readyApplication();
    await request(app.getHttpServer()).post(`/api/v1/association-applications/${row.id}/selection-decision`).set('Cookie', adminCookie).send({ decision: 'MAIN', opId: op() }).expect(400);
    const before = await prisma.outboxEvent.count();
    expect(await decision(row.id, 'RESERVE')).toMatchObject({ emailQueued: false });
    expect(await decision(row.id, 'NONE')).toMatchObject({ emailQueued: false });
    expect(await decision(row.id, 'MAIN')).toMatchObject({ emailQueued: false });
    expect(await prisma.outboxEvent.count()).toBe(before);
    await decision(row.id, 'RESERVE');
    expect(await decision(row.id, 'DECLINED')).toMatchObject({ emailQueued: true });
    const declined = await prisma.associationApplication.findUniqueOrThrow({ where: { id: row.id } });
    expect(declined).toMatchObject({ selectionList: 'NONE', status: 'REJECTED', eligibilityStatus: 'PASSED' }); expect(Number(declined.evaluationScore)).toBe(80);
    await expect(decision(row.id, 'MAIN')).rejects.toMatchObject({ code: 'APPLICATION_SELECTION_NOT_READY' });
    const preview = await app.get(ApplicationsService).previewSelection(owner);
    expect(preview.items.some(item => item.id === row.id)).toBe(false);
  });

  it('explicit sending is idempotent; cancellation consumes only its candidate, and a later internal MAIN ignores old receipts', async () => {
    const row = await readyApplication(); await decision(row.id, 'MAIN');
    const dto = { workflowVersion: 2 as const, operation: 'SEND_MAIN' as const, applicationIds: [row.id], opId: op() };
    await expect(v2.commitSelection(owner, dto)).resolves.toEqual({ ok: true, queued: 1 });
    const marker = await prisma.auditLog.findFirstOrThrow({ where: { action: 'APPLICATION_ACCESS_EMAIL_QUEUED', metadata: { path: ['applicationId'], equals: row.id } } });
    const eventId = (marker.metadata as { eventId: string }).eventId;
    await v2.commitSelection(owner, dto);
    await expect(v2.commitSelection(owner, { ...dto, opId: op() })).rejects.toMatchObject({ code: 'APPLICATION_SELECTION_EMAIL_EXISTS' });
    await decision(row.id, 'RESERVE');
    expect(await prisma.outboxEvent.findUniqueOrThrow({ where: { id: eventId } })).toMatchObject({ status: 'FAILED', lastError: 'MAIL_STATE_INVALID' });
    await decision(row.id, 'MAIN'); await decision(row.id, 'RESERVE');
    const reserve = await prisma.associationApplication.findUniqueOrThrow({ where: { id: row.id } });
    expect(reserve).toMatchObject({ selectionList: 'RESERVE', eligibilityStatus: 'PASSED' }); expect(Number(reserve.evaluationScore)).toBe(80);
  });

  it('does not cancel or repeat a real in-flight SMTP attempt; owner correction retains its definite receipt', async () => {
    const row = await readyApplication(); await decision(row.id, 'MAIN');
    await v2.commitSelection(owner, { workflowVersion: 2, operation: 'SEND_MAIN', applicationIds: [row.id], opId: op() });
    const marker = await prisma.auditLog.findFirstOrThrow({ where: { action: 'APPLICATION_ACCESS_EMAIL_QUEUED', metadata: { path: ['applicationId'], equals: row.id } } });
    const eventId = (marker.metadata as { eventId: string }).eventId;
    const event = await prisma.outboxEvent.update({ where: { id: eventId }, data: { status: OutboxEventStatus.PROCESSING, lockedAt: new Date() } });
    let entered!: () => void, release!: () => void;
    const started = new Promise<void>(resolve => { entered = resolve; }); const wait = new Promise<void>(resolve => { release = resolve; });
    const original = fakeEmail.sendApplicationAccess.bind(fakeEmail);
    fakeEmail.sendApplicationAccess = async params => { entered(); await wait; await original(params); };
    const work = app.get(NotificationsService)['processEmailEvent'](event);
    try {
      await Promise.race([started, work.then(() => { throw new Error('Mail worker ended before the SMTP barrier'); })]);
      expect((await prisma.outboxEvent.findUniqueOrThrow({ where: { id: eventId } })).payload).toMatchObject({ phase: 'SMTP_STARTED' });
      const current = await prisma.associationApplication.findUniqueOrThrow({ where: { id: row.id } });
      expect(await access.selectionDelivery(prisma, row.id, current.selectionApprovedAt)).toMatchObject({ status: 'UNKNOWN' });
      await expect(decision(row.id, 'RESERVE')).rejects.toMatchObject({ code: 'APPLICATION_SELECTION_EMAIL_STARTED' });
      await decision(row.id, 'RESERVE', true);
      expect((await prisma.outboxEvent.findUniqueOrThrow({ where: { id: eventId } })).payload).toMatchObject({ phase: 'SMTP_STARTED' });
    } finally { release(); await work; fakeEmail.sendApplicationAccess = original; }
    expect((await prisma.outboxEvent.findUniqueOrThrow({ where: { id: eventId } })).payload).toMatchObject({ phase: 'SMTP_ACCEPTED' });
    expect(await prisma.auditLog.findFirst({ where: { action: 'APPLICATION_ACCESS_EMAIL_SENT', metadata: { path: ['eventId'], equals: eventId } } })).toMatchObject({ metadata: expect.objectContaining({ stale: true }) });
  });

  it('serializes signing-account creation against owner correction and never leaves a usable orphan account', async () => {
    const row = await readyApplication(); const prepared = await prepare(row);
    const [account, correction] = await Promise.allSettled([participationService.prepareSigningAccount(owner, prepared.participation.id, op()), decision(row.id, 'RESERVE', true)]);
    expect(correction.status).toBe('fulfilled');
    if (account.status === 'fulfilled') { accountIds.push(account.value.accountId); associationIds.push(account.value.associationId); expect(await prisma.account.findUniqueOrThrow({ where: { id: account.value.accountId } })).toMatchObject({ status: 'SUSPENDED' }); }
    expect(await prisma.participationAgreement.findUniqueOrThrow({ where: { id: prepared.agreement.id } })).toMatchObject({ status: 'CANCELLED', signedByOrgAt: null, signedByZaadAt: null });
    expect(await prisma.associationApplication.findUniqueOrThrow({ where: { id: row.id } })).toMatchObject({ selectionList: 'RESERVE' });
  });

  it('revokes existing restricted access and queued credentials, then safely reuses the same unsigned account', async () => {
    const row = await readyApplication(); const prepared = await signingAccount(row);
    const expiry = new Date(Date.now() + 86_400_000);
    const session = await prisma.authSession.create({ data: { accountId: prepared.result.accountId, tokenHash: randomUUID(), expiresAt: expiry, absoluteExpiresAt: expiry } });
    const reset = await prisma.passwordResetToken.create({ data: { accountId: prepared.result.accountId, emailNormalized: row.email!, tokenHash: randomUUID(), expiresAt: expiry } });
    await decision(row.id, 'RESERVE', true);
    expect((await prisma.authSession.findUniqueOrThrow({ where: { id: session.id } })).revokedAt).not.toBeNull();
    expect((await prisma.passwordResetToken.findUniqueOrThrow({ where: { id: reset.id } })).consumedAt).not.toBeNull();
    const account = await prisma.account.findUniqueOrThrow({ where: { id: prepared.result.accountId } }); expect(account.status).toBe('SUSPENDED');
    for (const event of await prisma.outboxEvent.findMany({ where: { type: OutboxEventType.EMAIL_DELIVERY, id: { notIn: existingOutbox } } })) {
      const delivery = decryptEmailDelivery(event.id, event.payload as unknown as EmailDeliveryPayload);
      if (delivery.context.type === 'credentials' && delivery.context.accountId === account.id) expect(event).toMatchObject({ status: 'FAILED', lastError: 'MAIL_STATE_INVALID' });
    }
    await expect(sign(prepared.ctx, prepared.result.temporaryPassword!)).rejects.toMatchObject({ code: 'COVENANT_ALREADY_SIGNED_OR_INVALID' });
    await decision(row.id, 'MAIN');
    const reopened = await participationService.createAgreement(owner, prepared.participation.id, { version: 1, templateVersion: '1.0' }); expect(reopened.id).toBe(prepared.agreement.id);
    await participationService.transitionAgreement(owner, reopened.id, AgreementStatus.SENT, undefined, op());
    await participationService.completeSetup(owner, prepared.participation.id, op());
    const next = await participationService.prepareSigningAccount(owner, prepared.participation.id, op());
    expect(next.accountId).toBe(account.id); expect(next.associationId).toBe(prepared.result.associationId); expect(next.temporaryPassword).not.toBe(prepared.result.temporaryPassword);
    expect(await prisma.account.count({ where: { associationId: next.associationId } })).toBe(1);
    expect(await prisma.authCredential.count({ where: { accountId: next.accountId, type: AuthCredentialType.EMAIL_PASSWORD } })).toBe(1);
  });

  it('allows exactly one winner when owner correction competes with association signing', async () => {
    const row = await readyApplication(); const prepared = await signingAccount(row);
    const [signed, corrected] = await Promise.allSettled([sign(prepared.ctx, prepared.result.temporaryPassword!), decision(row.id, 'RESERVE', true)]);
    expect([signed, corrected].filter(result => result.status === 'fulfilled')).toHaveLength(1);
    const agreement = await prisma.participationAgreement.findUniqueOrThrow({ where: { id: prepared.agreement.id } });
    if (signed.status === 'fulfilled') {
      expect(corrected).toMatchObject({ status: 'rejected', reason: expect.objectContaining({ code: 'APPLICATION_MAIN_ALREADY_STARTED' }) });
      expect(agreement.orgSignatureFileId).not.toBeNull();
      expect((await prisma.associationApplication.findUniqueOrThrow({ where: { id: row.id } })).selectionList).toBe(AssociationSelectionList.MAIN);
    } else { expect(agreement).toMatchObject({ status: 'CANCELLED', orgSignatureFileId: null, signedByOrgAt: null }); }
  });

  it('does not undo an account suspension changed after its selection-correction receipt', async () => {
    const row = await readyApplication(); const prepared = await signingAccount(row);
    await decision(row.id, 'RESERVE', true);
    const suspended = await prisma.account.findUniqueOrThrow({ where: { id: prepared.result.accountId } });
    await prisma.account.update({ where: { id: suspended.id }, data: { name: `${prefix}إيقاف مستقل لاحق`, updatedAt: new Date(suspended.updatedAt.getTime() + 1000) } });
    await decision(row.id, 'MAIN');
    await participationService.createAgreement(owner, prepared.participation.id, { version: 1, templateVersion: '1.0' });
    await participationService.transitionAgreement(owner, prepared.agreement.id, AgreementStatus.SENT, undefined, op());
    await participationService.completeSetup(owner, prepared.participation.id, op());
    await expect(participationService.prepareSigningAccount(owner, prepared.participation.id, op())).rejects.toMatchObject({ code: 'COVENANT_SIGNING_ACCOUNT_EXISTS' });
    expect((await prisma.account.findUniqueOrThrow({ where: { id: suspended.id } })).status).toBe('SUSPENDED');
  });

  it('never retracts the organization signature when correction competes with party-one completion', async () => {
    const row = await readyApplication(); const prepared = await signingAccount(row);
    await sign(prepared.ctx, prepared.result.temporaryPassword!);
    const session = await participationService.issuePartyOneSigningSession(owner, prepared.agreement.id);
    const [partyOne, correction] = await Promise.allSettled([participationService.signPartyOne(session.token, op(), signature), decision(row.id, 'RESERVE', true)]);
    expect(partyOne.status).toBe('fulfilled');
    expect(correction).toMatchObject({ status: 'rejected', reason: expect.objectContaining({ code: 'APPLICATION_MAIN_ALREADY_STARTED' }) });
    const final = await prisma.participationAgreement.findUniqueOrThrow({ where: { id: prepared.agreement.id } });
    expect(final).toMatchObject({ status: 'SIGNED' }); expect(final.orgSignatureFileId).not.toBeNull(); expect(final.partyOneSignatureFileId).not.toBeNull();
    expect((await prisma.associationApplication.findUniqueOrThrow({ where: { id: row.id } })).selectionList).toBe(AssociationSelectionList.MAIN);
  });
});
