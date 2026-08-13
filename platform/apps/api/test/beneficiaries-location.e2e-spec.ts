import request from 'supertest';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import { prisma, DeviceType } from '@alzad/db';
import { AppModule } from '../src/app.module';
import { HttpExceptionFilter } from '../src/common/http-exception.filter';
import { EmailService } from '../src/modules/auth/email/email.service';
import { FakeEmailService } from '../src/modules/auth/email/fake-email.service';
import { cleanAuthState, seedTestFixtures } from './utils/fixtures';
import { loginAs } from './utils/node2-fixtures';
import { cleanNode3State, createBeneficiary, newOpId, seedNode3Fixtures, type Node3Fixtures } from './utils/node3-fixtures';
import { cleanNode4State, createAndSendBatch, confirmBatchRequest } from './utils/node4-fixtures';
import { startTestStorage, stopTestStorage } from './utils/storage-harness';

jest.setTimeout(60000);

/** BEN-016/017 — PATCH /beneficiaries/:id/location (تكامل حقيقي). المسار الوحيد المفتوح لِDELEGATE في وحدة المستفيدين كلها. */
describe('BEN-016/017 — تعديل موقع المستفيد (تكامل حقيقي)', () => {
  let app: INestApplication;
  let base: Awaited<ReturnType<typeof seedTestFixtures>>;
  let fx: Node3Fixtures;
  let adminCookie: string;
  let assocACookie: string;

  beforeAll(async () => {
    await startTestStorage();
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(EmailService)
      .useClass(FakeEmailService)
      .compile();

    app = moduleRef.createNestApplication();
    app.use(cookieParser());
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();

    base = await seedTestFixtures();
    fx = await seedNode3Fixtures();
  }, 60000);

  beforeEach(async () => {
    await prisma.deliveryAttempt.deleteMany({ where: { mission: { associationId: { in: [fx.associationAId, fx.associationBId] } } } });
    await prisma.deliveryMission.deleteMany({ where: { associationId: { in: [fx.associationAId, fx.associationBId] } } });
    const delegateAccounts = await prisma.account.findMany({ where: { role: 'DELEGATE', associationId: { in: [fx.associationAId, fx.associationBId] } }, select: { id: true } });
    const ids = delegateAccounts.map((a) => a.id);
    if (ids.length > 0) {
      await prisma.authCredential.deleteMany({ where: { accountId: { in: ids } } });
      await prisma.authSession.deleteMany({ where: { accountId: { in: ids } } });
      await prisma.idempotencyKey.deleteMany({ where: { accountId: { in: ids } } });
      await prisma.account.deleteMany({ where: { id: { in: ids } } });
    }
    await cleanNode4State(fx);
    await cleanNode3State();
    await cleanAuthState();
    adminCookie = await loginAs(app, base.adminEmail, base.adminPassword);
    assocACookie = await loginAs(app, fx.assocAEmail, fx.assocAPassword);
  });

  afterAll(async () => {
    await prisma.deliveryAttempt.deleteMany({ where: { mission: { associationId: { in: [fx.associationAId, fx.associationBId] } } } });
    await prisma.deliveryMission.deleteMany({ where: { associationId: { in: [fx.associationAId, fx.associationBId] } } });
    await cleanNode4State(fx);
    await cleanNode3State();
    await app.close();
    await stopTestStorage();
  });

  const http = () => request(app.getHttpServer());

  async function assignedBeneficiary(): Promise<{ beneficiaryId: string; delegateCookie: string; missionId: string }> {
    const { batchId, itemIds } = await createAndSendBatch(app, adminCookie, fx.associationAId, { items: [{ deviceType: DeviceType.REFRIGERATOR, spec: '18 قدم', sentQty: 1 }] });
    const confirmRes = await confirmBatchRequest(app, assocACookie, batchId, { items: [{ itemId: itemIds[0], receivedQty: 1, damagedQty: 0, missingQty: 0 }] });
    if (confirmRes.status !== 201 && confirmRes.status !== 200) throw new Error(`confirm failed: ${confirmRes.status} ${JSON.stringify(confirmRes.body)}`);

    const { id: beneficiaryId, needIds } = await createBeneficiary(app, assocACookie, { associationId: fx.associationAId, deviceTypes: [DeviceType.REFRIGERATOR] });
    const reviewRes = await http().post(`/api/v1/beneficiaries/${beneficiaryId}/review`).set('Cookie', adminCookie).send({ opId: newOpId('rev'), beneficiaryDecision: 'APPROVED', needDecisions: [{ needId: needIds[0], decision: 'APPROVED' }] });
    if (reviewRes.status !== 201) throw new Error(`review failed: ${reviewRes.status} ${JSON.stringify(reviewRes.body)}`);

    const delRes = await http().post('/api/v1/delegates').set('Cookie', assocACookie).send({ name: 'مندوب اختبار موقع', phone: '0500000099', opId: newOpId('del') });
    if (delRes.status !== 201) throw new Error(`createDelegate failed: ${delRes.status} ${JSON.stringify(delRes.body)}`);
    const delegateId = delRes.body.delegateId as string;
    const code = delRes.body.accessCode as string;

    const loginRes = await http().post('/api/v1/auth/login').send({ type: 'delegate', code });
    if (loginRes.status !== 200) throw new Error(`delegate login failed: ${loginRes.status}`);
    const delegateCookie = loginRes.headers['set-cookie'][0].split(';')[0];

    const assignRes = await http().post('/api/v1/deliveries/assign').set('Cookie', adminCookie).send({ beneficiaryId, delegateId, opId: newOpId('assign') });
    if (assignRes.status !== 201) throw new Error(`assign failed: ${assignRes.status} ${JSON.stringify(assignRes.body)}`);

    return { beneficiaryId, delegateCookie, missionId: assignRes.body.missionId };
  }

  it('DELEGATE يعدِّل موقع مستفيده المُسنَد له حاليًا ← يُحفَظ فعليًا', async () => {
    const { beneficiaryId, delegateCookie } = await assignedBeneficiary();
    const res = await http().patch(`/api/v1/beneficiaries/${beneficiaryId}/location`).set('Cookie', delegateCookie).send({ lat: 24.7136, lng: 46.6753, locationSource: 'CURRENT_LOCATION', opId: newOpId('loc') });
    expect(res.status).toBe(200);

    const row = await prisma.beneficiary.findUniqueOrThrow({ where: { id: beneficiaryId } });
    expect(Number(row.latitude)).toBeCloseTo(24.7136, 5);
    expect(Number(row.longitude)).toBeCloseTo(46.6753, 5);
  });

  it('DELEGATE لا يستطيع تعديل حقول أخرى عبر هذا المسار (name/phone) — الحقول غير مسموحة أصلًا في DTO', async () => {
    const { beneficiaryId, delegateCookie } = await assignedBeneficiary();
    const res = await http()
      .patch(`/api/v1/beneficiaries/${beneficiaryId}/location`)
      .set('Cookie', delegateCookie)
      .send({ lat: 24.7, lng: 46.6, name: 'محاولة تعديل الاسم', opId: newOpId('loc') });
    expect(res.status).toBe(400); // forbidNonWhitelisted يرفض حقل name غير المعرَّف في هذا الـDTO
  });

  it('DELEGATE ممنوع من تعديل موقع مستفيد لا يخصّه — 404 (لا كشف وجود)', async () => {
    const { beneficiaryId } = await assignedBeneficiary();
    const other = await http().post('/api/v1/delegates').set('Cookie', assocACookie).send({ name: 'مندوب آخر', phone: '0500000098', opId: newOpId('del2') });
    const otherLogin = await http().post('/api/v1/auth/login').send({ type: 'delegate', code: other.body.accessCode });
    const otherCookie = otherLogin.headers['set-cookie'][0].split(';')[0];

    const res = await http().patch(`/api/v1/beneficiaries/${beneficiaryId}/location`).set('Cookie', otherCookie).send({ lat: 24.7, lng: 46.6, opId: newOpId('loc') });
    expect(res.status).toBe(404);
  });

  it('لا مسح للموقع عبر هذا المسار — إحداثيات إلزامية (بلا lat/lng يُرفَض 400)', async () => {
    const { beneficiaryId, delegateCookie } = await assignedBeneficiary();
    const res = await http().patch(`/api/v1/beneficiaries/${beneficiaryId}/location`).set('Cookie', delegateCookie).send({ opId: newOpId('loc') });
    expect(res.status).toBe(400);
  });

  it('مستفيد اكتمل تسليمه: يُرفَض تعديل موقعه 409 — حتى لِADMIN', async () => {
    const { beneficiaryId, delegateCookie, missionId } = await assignedBeneficiary();
    const confirmRes = await http()
      .post(`/api/v1/deliveries/${missionId}/confirm`)
      .set('Cookie', delegateCookie)
      .field('opId', newOpId('confirm'))
      .attach('proofPhoto', Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01]), { filename: 'proof.jpg', contentType: 'image/jpeg' });
    expect(confirmRes.status).toBe(201);

    const res = await http().patch(`/api/v1/beneficiaries/${beneficiaryId}/location`).set('Cookie', adminCookie).send({ lat: 24.7, lng: 46.6, opId: newOpId('loc') });
    expect(res.status).toBe(409);
  });

  it('ADMIN وASSOCIATION يستطيعان تعديل الموقع أيضًا (ليس حصرًا على DELEGATE)', async () => {
    const { beneficiaryId } = await assignedBeneficiary();
    const res = await http().patch(`/api/v1/beneficiaries/${beneficiaryId}/location`).set('Cookie', adminCookie).send({ lat: 25.0, lng: 47.0, opId: newOpId('loc') });
    expect(res.status).toBe(200);
  });
});
