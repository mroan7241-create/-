import request from 'supertest';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import { prisma, DeviceType, DeviceStatus, NeedFulfillmentStatus } from '@alzad/db';
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

/**
 * DELIVERY-RETURN — POST /deliveries/:id/return (تكامل حقيقي). يوازي
 * الانتقال القديم "خرج مع المندوب" → "أعيد للجمعية/المستودع" مُبسَّطًا
 * لخطوة ذرّية واحدة. راجع STATE_MAPPING.md وPRODUCT_PARITY_MASTER.md §5.
 */
describe('DELIVERY-RETURN — إرجاع جهاز للمستودع نهائيًا (تكامل حقيقي)', () => {
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
    await prisma.deliveryApproval.deleteMany({ where: { mission: { associationId: { in: [fx.associationAId, fx.associationBId] } } } });
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
    await prisma.deliveryApproval.deleteMany({ where: { mission: { associationId: { in: [fx.associationAId, fx.associationBId] } } } });
    await prisma.deliveryAttempt.deleteMany({ where: { mission: { associationId: { in: [fx.associationAId, fx.associationBId] } } } });
    await prisma.deliveryMission.deleteMany({ where: { associationId: { in: [fx.associationAId, fx.associationBId] } } });
    await cleanNode4State(fx);
    await cleanNode3State();
    await app.close();
    await stopTestStorage();
  });

  const http = () => request(app.getHttpServer());

  async function approveCompletedDelivery(missionId: string): Promise<void> {
    await http().post(`/api/v1/deliveries/${missionId}/association-approval`).set('Cookie', assocACookie)
      .send({ decision: 'APPROVED', opId: newOpId('assoc-approval') }).expect(201);
    await http().post(`/api/v1/deliveries/${missionId}/zaad-approval`).set('Cookie', adminCookie)
      .send({ decision: 'APPROVED', opId: newOpId('zaad-approval') }).expect(201);
  }

  async function assignedBeneficiary(): Promise<{ beneficiaryId: string; delegateCookie: string; missionId: string; deviceId: string }> {
    const { batchId, itemIds } = await createAndSendBatch(app, adminCookie, fx.associationAId, { items: [{ deviceType: DeviceType.REFRIGERATOR, spec: '18 قدم', sentQty: 1 }] });
    const confirmRes = await confirmBatchRequest(app, assocACookie, batchId, { items: [{ itemId: itemIds[0], receivedQty: 1, damagedQty: 0, missingQty: 0 }] });
    if (confirmRes.status !== 201 && confirmRes.status !== 200) throw new Error(`confirm failed: ${confirmRes.status} ${JSON.stringify(confirmRes.body)}`);

    const { id: beneficiaryId, needIds } = await createBeneficiary(app, assocACookie, { associationId: fx.associationAId, deviceTypes: [DeviceType.REFRIGERATOR] });
    const reviewRes = await http().post(`/api/v1/beneficiaries/${beneficiaryId}/review`).set('Cookie', adminCookie).send({ opId: newOpId('rev'), beneficiaryDecision: 'APPROVED', needDecisions: [{ needId: needIds[0], decision: 'APPROVED' }] });
    if (reviewRes.status !== 201) throw new Error(`review failed: ${reviewRes.status} ${JSON.stringify(reviewRes.body)}`);
    const listRes = await http().post(`/api/v1/beneficiaries/${beneficiaryId}/list-decision`).set('Cookie', adminCookie).send({ listType: 'MAIN', listRank: 1, reason: 'اختبار مسار الإرجاع', opId: newOpId('list') });
    if (listRes.status !== 201) throw new Error(`list decision failed: ${listRes.status} ${JSON.stringify(listRes.body)}`);

    const device = await prisma.deviceUnit.findFirstOrThrow({ where: { associationId: fx.associationAId } });

    const delRes = await http().post('/api/v1/delegates').set('Cookie', assocACookie).send({ name: 'مندوب اختبار إرجاع', phone: '0500000077', opId: newOpId('del') });
    if (delRes.status !== 201) throw new Error(`createDelegate failed: ${delRes.status} ${JSON.stringify(delRes.body)}`);
    const delegateId = delRes.body.delegateId as string;
    const code = delRes.body.accessCode as string;

    const loginRes = await http().post('/api/v1/auth/login').send({ type: 'delegate', code });
    if (loginRes.status !== 200) throw new Error(`delegate login failed: ${loginRes.status}`);
    const delegateCookie = loginRes.headers['set-cookie'][0].split(';')[0];

    const assignRes = await http().post('/api/v1/deliveries/assign').set('Cookie', adminCookie).send({ beneficiaryId, delegateId, opId: newOpId('assign') });
    if (assignRes.status !== 201) throw new Error(`assign failed: ${assignRes.status} ${JSON.stringify(assignRes.body)}`);
    const handoverRes = await http().post(`/api/v1/deliveries/${assignRes.body.missionId}/confirm-handover`).set('Cookie', delegateCookie).send({ opId: newOpId('handover') });
    if (handoverRes.status !== 201) throw new Error(`handover failed: ${handoverRes.status} ${JSON.stringify(handoverRes.body)}`);

    return { beneficiaryId, delegateCookie, missionId: assignRes.body.missionId, deviceId: device.id };
  }

  it('طلب الإرجاع يحفظ العهدة حتى تأكيد الجمعية، ثم يحرر التخصيص ويعيد التقييم + المهمة RETURNED', async () => {
    const { beneficiaryId, delegateCookie, missionId, deviceId } = await assignedBeneficiary();

    const res = await http().post(`/api/v1/deliveries/${missionId}/return`).set('Cookie', delegateCookie).send({ notes: 'المستفيد انتقل خارج المنطقة', opId: newOpId('ret') });
    expect(res.status).toBe(201);

    const pendingDevice = await prisma.deviceUnit.findUniqueOrThrow({ where: { id: deviceId } });
    expect(pendingDevice.status).toBe(DeviceStatus.WITH_DELEGATE);
    await http().post(`/api/v1/deliveries/${missionId}/confirm-return`).set('Cookie', assocACookie)
      .send({ condition: 'GOOD', notes: 'تم استلام الجهاز فعليًا بحالة جيدة', opId: newOpId('confirm-return') }).expect(201);

    const device = await prisma.deviceUnit.findUniqueOrThrow({ where: { id: deviceId } });
    // بعد تأكيد الإرجاع يصبح الجهاز حرًا، ثم يعيد المشغّل تخصيصه فورًا لنفس
    // المستفيد المؤهل الوحيد؛ لذلك الحالة النهائية ALLOCATED لا WAREHOUSE.
    expect(device.status).toBe(DeviceStatus.ALLOCATED);

    const need = await prisma.beneficiaryNeed.findFirstOrThrow({ where: { beneficiaryId } });
    expect(need.fulfillmentStatus).toBe(NeedFulfillmentStatus.AWAITING_DELEGATE_ASSIGNMENT);

    const mission = await prisma.deliveryMission.findUniqueOrThrow({ where: { id: missionId } });
    expect(mission.status).toBe('RETURNED');

    const releasedAllocation = await prisma.deviceAllocation.findFirst({ where: { deviceId, status: 'RELEASED', releaseReason: 'physical-return-confirmed' } });
    expect(releasedAllocation).not.toBeNull();
    const activeAllocation = await prisma.deviceAllocation.findFirst({ where: { deviceId, status: 'ACTIVE' } });
    expect(activeAllocation?.beneficiaryId).toBe(beneficiaryId);

    const movement = await prisma.deviceMovement.findFirstOrThrow({ where: { deviceId, referenceId: missionId, reason: 'physical-return-confirmed' } });
    expect(movement.fromLocationType).toBe('DELEGATE');
    expect(movement.toLocationType).toBe('WAREHOUSE');
  });

  it('إرجاع جهاز محرَّر يُعاد تخصيصه فورًا لمستفيد آخر جاهز (allocation trigger يعمل بعد الإرجاع)', async () => {
    const { missionId, deviceId } = await assignedBeneficiary();

    // مستفيد آخر بنفس نوع الجهاز، معتمَد، بانتظار مخزون — سيلتقط الجهاز المُعاد فور تحرّره.
    const { id: otherBeneficiaryId, needIds: otherNeedIds } = await createBeneficiary(app, assocACookie, { associationId: fx.associationAId, deviceTypes: [DeviceType.REFRIGERATOR] });
    const otherReview = await http().post(`/api/v1/beneficiaries/${otherBeneficiaryId}/review`).set('Cookie', adminCookie).send({ opId: newOpId('rev2'), beneficiaryDecision: 'APPROVED', needDecisions: [{ needId: otherNeedIds[0], decision: 'APPROVED' }] });
    expect(otherReview.status).toBe(201);
    const otherList = await http().post(`/api/v1/beneficiaries/${otherBeneficiaryId}/list-decision`).set('Cookie', adminCookie).send({ listType: 'MAIN', listRank: 2, reason: 'اختبار إعادة التخصيص', opId: newOpId('list2') });
    expect(otherList.status).toBe(201);
    // بلا مخزون كافٍ بعد — الاحتياج يبقى AWAITING_DEVICE إلى أن يُحرَّر الجهاز أدناه.
    const otherNeedBefore = await prisma.beneficiaryNeed.findUniqueOrThrow({ where: { id: otherNeedIds[0] } });
    expect(otherNeedBefore.fulfillmentStatus).toBe(NeedFulfillmentStatus.APPROVED_ENTITLEMENT);

    // استخدام مسار الإرجاع عبر ADMIN لتبسيط الاختبار (الدور مسموح أيضًا).
    const res = await http().post(`/api/v1/deliveries/${missionId}/return`).set('Cookie', adminCookie).send({ opId: newOpId('ret2') });
    expect(res.status).toBe(201);
    const originalMission = await prisma.deliveryMission.findUniqueOrThrow({ where: { id: missionId }, select: { beneficiaryId: true } });
    await http().post(`/api/v1/beneficiaries/${originalMission.beneficiaryId}/list-decision`).set('Cookie', adminCookie)
      .send({ listType: 'REJECTED', reason: 'استبعاد من إعادة التخصيص بعد الإرجاع', opId: newOpId('exclude-original') }).expect(201);
    await http().post(`/api/v1/deliveries/${missionId}/admin-return-override`).set('Cookie', adminCookie)
      .send({ condition: 'GOOD', notes: 'تحقق إداري من الاستلام الفعلي', opId: newOpId('override-return') }).expect(201);

    const otherNeedAfter = await prisma.beneficiaryNeed.findUniqueOrThrow({ where: { id: otherNeedIds[0] } });
    expect(otherNeedAfter.fulfillmentStatus).toBe(NeedFulfillmentStatus.AWAITING_DELEGATE_ASSIGNMENT);
    const newAllocation = await prisma.deviceAllocation.findFirst({ where: { deviceId, status: 'ACTIVE' } });
    expect(newAllocation?.beneficiaryId).toBe(otherBeneficiaryId);
  });

  it('لا يمكن إرجاع مهمة مُسلَّمة بالفعل — 409', async () => {
    const { missionId, delegateCookie } = await assignedBeneficiary();
    const confirmRes = await http()
      .post(`/api/v1/deliveries/${missionId}/confirm`)
      .set('Cookie', delegateCookie)
      .field('opId', newOpId('confirm'))
      .attach('proofPhoto', Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01]), { filename: 'proof.jpg', contentType: 'image/jpeg' })
      .attach('recipientSignature', Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01]), { filename: 'signature.jpg', contentType: 'image/jpeg' });
    expect(confirmRes.status).toBe(201);
    await approveCompletedDelivery(missionId);

    const res = await http().post(`/api/v1/deliveries/${missionId}/return`).set('Cookie', delegateCookie).send({ opId: newOpId('ret3') });
    expect(res.status).toBe(409);
  });

  it('DELEGATE ممنوع من إرجاع مهمة لا تخصّه — 404', async () => {
    const { missionId } = await assignedBeneficiary();
    const otherDelRes = await http().post('/api/v1/delegates').set('Cookie', assocACookie).send({ name: 'مندوب آخر', phone: '0500000078', opId: newOpId('del2') });
    const otherLogin = await http().post('/api/v1/auth/login').send({ type: 'delegate', code: otherDelRes.body.accessCode });
    const otherCookie = otherLogin.headers['set-cookie'][0].split(';')[0];

    const res = await http().post(`/api/v1/deliveries/${missionId}/return`).set('Cookie', otherCookie).send({ opId: newOpId('ret4') });
    expect(res.status).toBe(404);
  });

  it('opId معاد بنفس الحمولة ← نفس الرد بلا تكرار تأثير (idempotent)', async () => {
    const { missionId, delegateCookie } = await assignedBeneficiary();
    const opId = newOpId('ret5');
    const first = await http().post(`/api/v1/deliveries/${missionId}/return`).set('Cookie', delegateCookie).send({ opId });
    expect(first.status).toBe(201);
    const second = await http().post(`/api/v1/deliveries/${missionId}/return`).set('Cookie', delegateCookie).send({ opId });
    expect(second.status).toBe(201);
    expect(second.body.attemptId).toBe(first.body.attemptId);

    const attempts = await prisma.deliveryAttempt.count({ where: { missionId, status: 'PENDING_RETURN_APPROVAL' } });
    expect(attempts).toBe(1);
  });
});
