import request from 'supertest';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import {
  prisma,
  DeviceType,
  DeviceStatus,
  DeliveryStatus,
  NeedFulfillmentStatus,
  AccountStatus,
} from '@alzad/db';
import { AppModule } from '../src/app.module';
import { HttpExceptionFilter } from '../src/common/http-exception.filter';
import { EmailService } from '../src/modules/auth/email/email.service';
import { FakeEmailService } from '../src/modules/auth/email/fake-email.service';
import { cleanAuthState, seedTestFixtures } from './utils/fixtures';
import { loginAs } from './utils/node2-fixtures';
import { cleanNode3State, createBeneficiary, newOpId, seedNode3Fixtures, type Node3Fixtures } from './utils/node3-fixtures';
import { cleanNode4State, createAndSendBatch, confirmBatchRequest } from './utils/node4-fixtures';
import { startTestStorage, stopTestStorage } from './utils/storage-harness';

// 6MB JPEG-header-valid fixture — كافٍ لاجتياز فحص magic bytes (لا حاجة لصورة حقيقية كاملة للاختبار).
const JPEG_PROOF = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01]);

jest.setTimeout(60000);

/**
 * NODE-6 — مناديب + إسناد + مهام تسليم (تكامل حقيقي، بلا أي spy).
 * يغطي السلسلة الكاملة: NODE-5 يُكمل الاحتياجات → إنشاء مندوب حقيقي
 * (يعمل تسجيل دخوله فعليًا) → إسناد → تأكيد/فشل/إعادة محاولة → تحقّق
 * حالة DB نهائية. راجع deliveries.service.ts للقرار الموثَّق حول دمج
 * خطوتَي الإسناد والتسليم الفعلي للمندوب.
 */
describe('NODE-6 — مناديب وتسليمات (تكامل حقيقي)', () => {
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

  /** يحذف حسابات المناديب المُنشأة ديناميكيًا مع كل الصفوف التابعة (authCredential/authSession/idempotencyKey) — FK ترتيب صارم. */
  async function purgeDelegateAccounts(): Promise<void> {
    const delegateAccounts = await prisma.account.findMany({
      where: { role: 'DELEGATE', associationId: { in: [fx.associationAId, fx.associationBId] } },
      select: { id: true },
    });
    const ids = delegateAccounts.map((a) => a.id);
    if (ids.length === 0) return;
    await prisma.authCredential.deleteMany({ where: { accountId: { in: ids } } });
    await prisma.authSession.deleteMany({ where: { accountId: { in: ids } } });
    await prisma.idempotencyKey.deleteMany({ where: { accountId: { in: ids } } });
    await prisma.account.deleteMany({ where: { id: { in: ids } } });
  }

  beforeEach(async () => {
    await prisma.deliveryApproval.deleteMany({ where: { mission: { associationId: { in: [fx.associationAId, fx.associationBId] } } } });
    await prisma.deliveryAttempt.deleteMany({ where: { mission: { associationId: { in: [fx.associationAId, fx.associationBId] } } } });
    await prisma.deliveryMission.deleteMany({ where: { associationId: { in: [fx.associationAId, fx.associationBId] } } });
    await purgeDelegateAccounts();
    await cleanNode4State(fx);
    await cleanNode3State();
    await cleanAuthState();
    adminCookie = await loginAs(app, base.adminEmail, base.adminPassword);
    assocACookie = await loginAs(app, fx.assocAEmail, fx.assocAPassword);
  });

  afterAll(async () => {
    await prisma.deliveryApproval.deleteMany({ where: { mission: { associationId: { in: [fx.associationAId, fx.associationBId] } } } });
    await prisma.deliveryAttempt.deleteMany({ where: { mission: { associationId: { in: [fx.associationAId, fx.associationBId] } } } });
    await prisma.deliveryMission.deleteMany({ where: { associationId: { in: [fx.associationAId, fx.associationBId] } } });
    await purgeDelegateAccounts();
    await cleanNode4State(fx);
    await cleanNode3State();
    await app.close();
    await stopTestStorage();
  });

  const http = () => request(app.getHttpServer());

  async function stockWarehouse(associationId: string, deviceType: DeviceType, qty: number, confirmerCookie: string): Promise<void> {
    const { batchId, itemIds } = await createAndSendBatch(app, adminCookie, associationId, {
      items: [{ deviceType, spec: '18 قدم', sentQty: qty }],
    });
    await confirmBatchRequest(app, confirmerCookie, batchId, {
      items: [{ itemId: itemIds[0], receivedQty: qty, damagedQty: 0, missingQty: 0 }],
    }).expect((res) => {
      if (res.status !== 201 && res.status !== 200) throw new Error(`confirm failed: ${res.status} ${JSON.stringify(res.body)}`);
    });
  }

  /** مستفيد جاهز بالكامل للإسناد: مراجعة معتمدة + تخصيص تلقائي حقيقي يكمله (NODE-5). */
  async function readyBeneficiary(): Promise<string> {
    await stockWarehouse(fx.associationAId, DeviceType.REFRIGERATOR, 1, assocACookie);
    const { id, needIds } = await createBeneficiary(app, assocACookie, { associationId: fx.associationAId, deviceTypes: [DeviceType.REFRIGERATOR] });
    const res = await http()
      .post(`/api/v1/beneficiaries/${id}/review`)
      .set('Cookie', adminCookie)
      .send({ opId: newOpId('rev'), beneficiaryDecision: 'APPROVED', needDecisions: [{ needId: needIds[0], decision: 'APPROVED' }] });
    if (res.status !== 201) throw new Error(`review failed: ${res.status} ${JSON.stringify(res.body)}`);
    const listRes = await http().post(`/api/v1/beneficiaries/${id}/list-decision`).set('Cookie', adminCookie).send({ listType: 'MAIN', listRank: 1, reason: 'اختبار مسار التسليم', opId: newOpId('list') });
    if (listRes.status !== 201) throw new Error(`list decision failed: ${listRes.status} ${JSON.stringify(listRes.body)}`);
    return id;
  }

  async function createDelegate(): Promise<{ id: string; code: string }> {
    const res = await http().post('/api/v1/delegates').set('Cookie', assocACookie).send({ name: 'مندوب اختبار', phone: '0500000001', opId: newOpId('del') });
    if (res.status !== 201) throw new Error(`createDelegate failed: ${res.status} ${JSON.stringify(res.body)}`);
    return { id: res.body.delegateId, code: res.body.accessCode };
  }

  async function approveCompletedDelivery(missionId: string): Promise<void> {
    await http().post(`/api/v1/deliveries/${missionId}/association-approval`).set('Cookie', assocACookie)
      .send({ decision: 'APPROVED', opId: newOpId('assoc-approval') }).expect(201);
    await http().post(`/api/v1/deliveries/${missionId}/zaad-approval`).set('Cookie', adminCookie)
      .send({ decision: 'APPROVED', opId: newOpId('zaad-approval') }).expect(201);
  }

  it('السلسلة الكاملة: مندوب حقيقي يسجّل دخوله ← إسناد ← تأكيد تسليم بإثبات ← حالة DB نهائية صحيحة', async () => {
    const beneficiaryId = await readyBeneficiary();
    const { id: delegateId, code } = await createDelegate();

    // تسجيل دخول المندوب الحقيقي بالرمز الصادر — يثبت تكامل NODE-1↔NODE-6.
    const loginRes = await http().post('/api/v1/auth/login').send({ type: 'delegate', code });
    expect(loginRes.status).toBe(200);
    const delegateCookie = loginRes.headers['set-cookie'][0].split(';')[0];

    const assignRes = await http().post('/api/v1/deliveries/assign').set('Cookie', adminCookie).send({ beneficiaryId, delegateId, opId: newOpId('assign') });
    expect(assignRes.status).toBe(201);
    const missionId = assignRes.body.missionId;

    const device = await prisma.deviceUnit.findFirstOrThrow({ where: { associationId: fx.associationAId } });
    expect(device.status).toBe(DeviceStatus.ALLOCATED);
    const need = await prisma.beneficiaryNeed.findFirstOrThrow({ where: { beneficiaryId } });
    expect(need.fulfillmentStatus).toBe(NeedFulfillmentStatus.ASSIGNED_TO_DELEGATE_PENDING);
    const missionBeforeHandover = await prisma.deliveryMission.findUniqueOrThrow({ where: { id: missionId } });
    expect(missionBeforeHandover.status).toBe(DeliveryStatus.PENDING_DELEGATE_ACKNOWLEDGEMENT);
    expect(await prisma.deviceMovement.count({ where: { deviceId: device.id } })).toBe(0);

    // المندوب يرى مهمته في قائمته الخاصة.
    const listRes = await http().get('/api/v1/deliveries').set('Cookie', delegateCookie);
    expect(listRes.status).toBe(200);
    expect(listRes.body.items.map((m: { id: string }) => m.id)).toContain(missionId);

    const handoverOp = newOpId('handover');
    await http()
      .post(`/api/v1/deliveries/${missionId}/confirm-handover`)
      .set('Cookie', delegateCookie)
      .send({ opId: handoverOp })
      .expect(201);
    await http()
      .post(`/api/v1/deliveries/${missionId}/confirm-handover`)
      .set('Cookie', delegateCookie)
      .send({ opId: handoverOp })
      .expect(201);
    expect((await prisma.deliveryMission.findUniqueOrThrow({ where: { id: missionId } })).status).toBe(DeliveryStatus.OUT_WITH_DELEGATE);
    expect((await prisma.deviceUnit.findUniqueOrThrow({ where: { id: device.id } })).status).toBe(DeviceStatus.WITH_DELEGATE);
    expect((await prisma.beneficiaryNeed.findUniqueOrThrow({ where: { id: need.id } })).fulfillmentStatus).toBe(NeedFulfillmentStatus.OUT_WITH_DELEGATE);
    expect(await prisma.deviceMovement.count({ where: { deviceId: device.id, referenceId: missionId } })).toBe(1);

    const missingAcknowledgement = await http()
      .post(`/api/v1/deliveries/${missionId}/confirm`)
      .set('Cookie', delegateCookie)
      .field('opId', newOpId('confirm-without-acknowledgement'))
      .attach('proofPhoto', JPEG_PROOF, { filename: 'proof.jpg', contentType: 'image/jpeg' })
      .attach('recipientSignature', JPEG_PROOF, { filename: 'signature.jpg', contentType: 'image/jpeg' });
    expect(missingAcknowledgement.status).toBe(400);
    expect((await prisma.deliveryMission.findUniqueOrThrow({ where: { id: missionId } })).status).toBe(DeliveryStatus.OUT_WITH_DELEGATE);

    const confirmRes = await http()
      .post(`/api/v1/deliveries/${missionId}/confirm`)
      .set('Cookie', delegateCookie)
      .field('opId', newOpId('confirm'))
      .field('acknowledgement', 'true')
      .attach('proofPhoto', JPEG_PROOF, { filename: 'proof.jpg', contentType: 'image/jpeg' })
      .attach('recipientSignature', JPEG_PROOF, { filename: 'signature.jpg', contentType: 'image/jpeg' });
    expect(confirmRes.status).toBe(201);

    expect((await prisma.deliveryMission.findUniqueOrThrow({ where: { id: missionId } })).status).toBe(DeliveryStatus.PENDING_DELIVERY_APPROVAL);
    await approveCompletedDelivery(missionId);

    const missionAfter = await prisma.deliveryMission.findUniqueOrThrow({ where: { id: missionId } });
    expect(missionAfter.status).toBe(DeliveryStatus.DELIVERY_CLOSED);
    const deviceAfter = await prisma.deviceUnit.findUniqueOrThrow({ where: { id: device.id } });
    expect(deviceAfter.status).toBe(DeviceStatus.DELIVERED);
    const needAfter = await prisma.beneficiaryNeed.findUniqueOrThrow({ where: { id: need.id } });
    expect(needAfter.fulfillmentStatus).toBe(NeedFulfillmentStatus.DELIVERED);

    const attempt = await prisma.deliveryAttempt.findFirstOrThrow({ where: { missionId } });
    expect(attempt.status).toBe(DeliveryStatus.DELIVERY_CLOSED);
    expect(attempt.proofFileId).not.toBeNull();

    // إثبات التسليم قابل للعرض عبر رابط موقَّت.
    const proofRes = await http().get(`/api/v1/deliveries/attempts/${attempt.id}/proof`).set('Cookie', delegateCookie);
    expect(proofRes.status).toBe(200);
    expect(proofRes.body.url).toContain('http');
  });

  it('فشل التسليم ← إعادة محاولة ← تأكيد ناجح — الأجهزة تبقى مع المندوب طوال ذلك', async () => {
    const beneficiaryId = await readyBeneficiary();
    const { id: delegateId, code } = await createDelegate();
    const loginRes = await http().post('/api/v1/auth/login').send({ type: 'delegate', code });
    const delegateCookie = loginRes.headers['set-cookie'][0].split(';')[0];

    const assignRes = await http().post('/api/v1/deliveries/assign').set('Cookie', adminCookie).send({ beneficiaryId, delegateId, opId: newOpId('assign') });
    const missionId = assignRes.body.missionId;

    await http()
      .post(`/api/v1/deliveries/${missionId}/confirm-handover`)
      .set('Cookie', delegateCookie)
      .send({ opId: newOpId('handover') })
      .expect(201);

    const failRes = await http()
      .post(`/api/v1/deliveries/${missionId}/fail`)
      .set('Cookie', delegateCookie)
      .send({ failureReason: 'NO_ANSWER', notes: 'لا يرد', opId: newOpId('fail') });
    expect(failRes.status).toBe(201);

    let mission = await prisma.deliveryMission.findUniqueOrThrow({ where: { id: missionId } });
    expect(mission.status).toBe(DeliveryStatus.DELIVERY_FAILED);
    const deviceDuringFail = await prisma.deviceUnit.findFirstOrThrow({ where: { associationId: fx.associationAId } });
    expect(deviceDuringFail.status).toBe(DeviceStatus.WITH_DELEGATE); // لم يُعَد للمستودع

    const retryRes = await http().post(`/api/v1/deliveries/${missionId}/retry`).set('Cookie', delegateCookie).send({ opId: newOpId('retry') });
    expect(retryRes.status).toBe(201);
    mission = await prisma.deliveryMission.findUniqueOrThrow({ where: { id: missionId } });
    expect(mission.status).toBe(DeliveryStatus.OUT_WITH_DELEGATE);

    const confirmRes = await http()
      .post(`/api/v1/deliveries/${missionId}/confirm`)
      .set('Cookie', delegateCookie)
      .field('opId', newOpId('confirm'))
      .field('acknowledgement', 'true')
      .attach('proofPhoto', JPEG_PROOF, { filename: 'proof.jpg', contentType: 'image/jpeg' })
      .attach('recipientSignature', JPEG_PROOF, { filename: 'signature.jpg', contentType: 'image/jpeg' });
    expect(confirmRes.status).toBe(201);
    await approveCompletedDelivery(missionId);

    const attempts = await prisma.deliveryAttempt.findMany({ where: { missionId }, orderBy: { attemptedAt: 'asc' } });
    expect(attempts.map((a) => a.status)).toEqual([DeliveryStatus.DELIVERY_FAILED, DeliveryStatus.DELIVERY_CLOSED]); // السجل تراكمي، لا يُمحى شيء
  });

  it('يرفض الإسناد قبل اكتمال التخصيص التلقائي (لا مخزون بعد)', async () => {
    const { id: beneficiaryId, needIds } = await createBeneficiary(app, assocACookie, { associationId: fx.associationAId, deviceTypes: [DeviceType.REFRIGERATOR] });
    await http()
      .post(`/api/v1/beneficiaries/${beneficiaryId}/review`)
      .set('Cookie', adminCookie)
      .send({ opId: newOpId('rev'), beneficiaryDecision: 'APPROVED', needDecisions: [{ needId: needIds[0], decision: 'APPROVED' }] })
      .expect(201);

    const { id: delegateId } = await createDelegate();
    const assignRes = await http().post('/api/v1/deliveries/assign').set('Cookie', adminCookie).send({ beneficiaryId, delegateId, opId: newOpId('assign') });
    expect(assignRes.status).toBe(409);
    expect(assignRes.body.error.code).toBe('DELIVERY_NOT_READY');
  });

  it('عزل المناديب: مندوب لا يستطيع رؤية أو التصرف في مهمة مندوب آخر', async () => {
    const beneficiaryId = await readyBeneficiary();
    const { id: delegateId } = await createDelegate();

    // مندوب ثانٍ منفصل تمامًا.
    const otherDelegateRes = await http().post('/api/v1/delegates').set('Cookie', assocACookie).send({ name: 'مندوب آخر', phone: '0500000002', opId: newOpId('del2') });
    const otherCode = otherDelegateRes.body.accessCode;
    const otherLoginRes = await http().post('/api/v1/auth/login').send({ type: 'delegate', code: otherCode });
    const otherDelegateCookie = otherLoginRes.headers['set-cookie'][0].split(';')[0];

    const assignRes = await http().post('/api/v1/deliveries/assign').set('Cookie', adminCookie).send({ beneficiaryId, delegateId, opId: newOpId('assign') });
    const missionId = assignRes.body.missionId;

    await http()
      .post(`/api/v1/deliveries/${missionId}/confirm-handover`)
      .set('Cookie', otherDelegateCookie)
      .send({ opId: newOpId('handover-other') })
      .expect(404);

    const detailRes = await http().get(`/api/v1/deliveries/${missionId}`).set('Cookie', otherDelegateCookie);
    expect(detailRes.status).toBe(404); // لا كشف عن وجود المهمة أصلًا لمندوب لا يملكها

    const confirmRes = await http()
      .post(`/api/v1/deliveries/${missionId}/confirm`)
      .set('Cookie', otherDelegateCookie)
      .field('opId', newOpId('confirm'))
      .field('acknowledgement', 'true')
      .attach('proofPhoto', JPEG_PROOF, { filename: 'proof.jpg', contentType: 'image/jpeg' })
      .attach('recipientSignature', JPEG_PROOF, { filename: 'signature.jpg', contentType: 'image/jpeg' });
    expect(confirmRes.status).toBe(404);
  });

  it('تعطيل مندوب يُبطل جلسته فورًا، وإعادة توليد الرمز تُبطل الرمز القديم', async () => {
    const { id: delegateId, code } = await createDelegate();
    const loginRes = await http().post('/api/v1/auth/login').send({ type: 'delegate', code });
    const delegateCookie = loginRes.headers['set-cookie'][0].split(';')[0];

    await http().get('/api/v1/auth/me').set('Cookie', delegateCookie).expect(200);

    await http().post(`/api/v1/delegates/${delegateId}/status`).set('Cookie', assocACookie).send({ status: 'SUSPENDED' }).expect(201);
    await http().get('/api/v1/auth/me').set('Cookie', delegateCookie).expect(401);

    const delegateRow = await prisma.account.findUniqueOrThrow({ where: { id: delegateId } });
    expect(delegateRow.status).toBe(AccountStatus.SUSPENDED);

    await http().post(`/api/v1/delegates/${delegateId}/status`).set('Cookie', assocACookie).send({ status: 'ACTIVE' }).expect(201);
    const regenRes = await http().post(`/api/v1/delegates/${delegateId}/regenerate-code`).set('Cookie', assocACookie);
    expect(regenRes.status).toBe(201);
    const newCode = regenRes.body.accessCode;
    expect(newCode).not.toBe(code);

    await http().post('/api/v1/auth/login').send({ type: 'delegate', code }).expect(401); // الرمز القديم لم يعد صالحًا
    await http().post('/api/v1/auth/login').send({ type: 'delegate', code: newCode }).expect(200);
  });
});
