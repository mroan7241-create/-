import request from 'supertest';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import { prisma, DeviceType, DeviceStatus } from '@alzad/db';
import { AppModule } from '../src/app.module';
import { HttpExceptionFilter } from '../src/common/http-exception.filter';
import { EmailService } from '../src/modules/auth/email/email.service';
import { FakeEmailService } from '../src/modules/auth/email/fake-email.service';
import { cleanAuthState, seedTestFixtures } from './utils/fixtures';
import { loginAs } from './utils/node2-fixtures';
import { cleanNode3State, createBeneficiary, seedNode3Fixtures, type Node3Fixtures } from './utils/node3-fixtures';
import { cleanNode4State, createAndSendBatch, confirmBatchRequest, newOpId } from './utils/node4-fixtures';
import { startTestStorage, stopTestStorage } from './utils/storage-harness';

jest.setTimeout(60000);

/**
 * DEV-005/006 (نطاق مصغَّر) — PATCH /inventory/devices/:id وPOST
 * .../mark-damaged (تكامل حقيقي). النطاق مقصور على أجهزة WAREHOUSE فقط —
 * راجع inventory.service.ts للقرار الموثَّق حول عدم تجاوز NODE-5/6.
 */
describe('DEV-005/006 — تصحيح جهاز ووَسمه تالفًا (تكامل حقيقي)', () => {
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
    await cleanNode4State(fx);
    await cleanNode3State();
    await cleanAuthState();
    adminCookie = await loginAs(app, base.adminEmail, base.adminPassword);
    assocACookie = await loginAs(app, fx.assocAEmail, fx.assocAPassword);
  });

  afterAll(async () => {
    await cleanNode4State(fx);
    await cleanNode3State();
    await app.close();
    await stopTestStorage();
  });

  const http = () => request(app.getHttpServer());

  async function warehouseDevice(): Promise<string> {
    const { batchId, itemIds } = await createAndSendBatch(app, adminCookie, fx.associationAId, {
      items: [{ deviceType: DeviceType.REFRIGERATOR, spec: '18 قدم', sentQty: 1 }],
    });
    const confirmRes = await confirmBatchRequest(app, assocACookie, batchId, {
      items: [{ itemId: itemIds[0], receivedQty: 1, damagedQty: 0, missingQty: 0 }],
    });
    if (confirmRes.status !== 201 && confirmRes.status !== 200) {
      throw new Error(`confirm failed: ${confirmRes.status} ${JSON.stringify(confirmRes.body)}`);
    }
    const device = await prisma.deviceUnit.findFirstOrThrow({ where: { associationId: fx.associationAId } });
    return device.id;
  }

  it('ADMIN يصحّح مواصفة جهاز WAREHOUSE ← تُحفَظ فعليًا', async () => {
    const deviceId = await warehouseDevice();
    const res = await http().patch(`/api/v1/inventory/devices/${deviceId}`).set('Cookie', adminCookie).send({ spec: '16 قدم', opId: newOpId('dev') });
    expect(res.status).toBe(200);

    const row = await prisma.deviceUnit.findUniqueOrThrow({ where: { id: deviceId } });
    expect(row.spec).toBe('16 قدم');
  });

  it('ADMIN يَسم جهاز WAREHOUSE تالفًا ← DAMAGED + DAMAGED_HOLDING', async () => {
    const deviceId = await warehouseDevice();
    const res = await http().post(`/api/v1/inventory/devices/${deviceId}/mark-damaged`).set('Cookie', adminCookie).send({ opId: newOpId('dev') });
    expect(res.status).toBe(201);

    const row = await prisma.deviceUnit.findUniqueOrThrow({ where: { id: deviceId } });
    expect(row.status).toBe(DeviceStatus.DAMAGED);
    expect(row.currentLocationType).toBe('DAMAGED_HOLDING');
    expect(row.currentLocationRef).toBeNull();
  });

  it('جهاز ALLOCATED (بعد التخصيص التلقائي) يُرفَض تعديله/وَسمه 409 — لا تجاوز لِNODE-5', async () => {
    const deviceId = await warehouseDevice();
    // مستفيد جاهز + مراجعة معتمدة يُشغِّل التخصيص التلقائي فعليًا (NODE-5) فينقل الجهاز WAREHOUSE→ALLOCATED.
    const { id: beneficiaryId, needIds } = await createBeneficiary(app, assocACookie, { associationId: fx.associationAId, deviceTypes: [DeviceType.REFRIGERATOR] });
    const reviewRes = await http()
      .post(`/api/v1/beneficiaries/${beneficiaryId}/review`)
      .set('Cookie', adminCookie)
      .send({ opId: newOpId('rev'), beneficiaryDecision: 'APPROVED', needDecisions: [{ needId: needIds[0], decision: 'APPROVED' }] });
    if (reviewRes.status !== 201) throw new Error(`review failed: ${reviewRes.status} ${JSON.stringify(reviewRes.body)}`);

    const row = await prisma.deviceUnit.findUniqueOrThrow({ where: { id: deviceId } });
    expect(row.status).toBe(DeviceStatus.ALLOCATED);

    const patchRes = await http().patch(`/api/v1/inventory/devices/${deviceId}`).set('Cookie', adminCookie).send({ spec: '24 قدم', opId: newOpId('dev') });
    expect(patchRes.status).toBe(409);

    const damageRes = await http().post(`/api/v1/inventory/devices/${deviceId}/mark-damaged`).set('Cookie', adminCookie).send({ opId: newOpId('dev') });
    expect(damageRes.status).toBe(409);
  });

  it('غير معروف (spec) خارج قائمة DEVICE_SPEC المعتمدة يُرفَض 400', async () => {
    const deviceId = await warehouseDevice();
    const res = await http().patch(`/api/v1/inventory/devices/${deviceId}`).set('Cookie', adminCookie).send({ spec: 'مواصفة غير موجودة إطلاقًا', opId: newOpId('dev') });
    expect(res.status).toBe(400);
  });

  it('ASSOCIATION ممنوعة من تعديل/وَسم الأجهزة (ADMIN فقط)', async () => {
    const deviceId = await warehouseDevice();
    const patchRes = await http().patch(`/api/v1/inventory/devices/${deviceId}`).set('Cookie', assocACookie).send({ spec: '24 قدم', opId: newOpId('dev') });
    expect(patchRes.status).toBe(403);

    const damageRes = await http().post(`/api/v1/inventory/devices/${deviceId}/mark-damaged`).set('Cookie', assocACookie).send({ opId: newOpId('dev') });
    expect(damageRes.status).toBe(403);
  });
});
