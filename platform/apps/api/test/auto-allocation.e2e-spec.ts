import request from 'supertest';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import {
  prisma,
  DeviceType,
  DeviceStatus,
  DeviceAllocationStatus,
  NeedFulfillmentStatus,
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

// كل اختبار هنا يسلسل عدة طلبات HTTP حقيقية (إنشاء/إرسال/تأكيد محضر ثم مراجعة)
// فوق مُجمِّع Supabase عن بُعد — أبطأ من المهلة الافتراضية 30s أحيانًا رغم صحة المنطق تمامًا.
jest.setTimeout(60000);

/**
 * NODE-5 — اختبارات تكامل حقيقية لمحرّك التخصيص التلقائي على PostgreSQL
 * فعلي، بلا أي spy على ALLOCATION_TRIGGER_PORT — المحرّك الحقيقي
 * (AutoAllocationService) يعمل هنا فعليًا عبر مسارَي الاستدعاء الحقيقيَّين
 * (تأكيد محضر استلام / مراجعة احتياجات مستفيد)، تمامًا كما سيعمل في
 * الإنتاج. يوازي جوهر phase31-test.js (راجع platform/docs/audit/
 * 04-legacy-allocation-receipts.md) على مستوى HTTP + DB حقيقيَّين.
 */
describe('NODE-5 — AutoAllocationService (تكامل حقيقي)', () => {
  let app: INestApplication;
  let base: Awaited<ReturnType<typeof seedTestFixtures>>;
  let fx: Node3Fixtures;
  let adminCookie: string;
  let assocACookie: string;
  let assocBCookie: string;

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
    assocBCookie = await loginAs(app, fx.assocBEmail, fx.assocBPassword);
  });

  afterAll(async () => {
    await cleanNode4State(fx);
    await cleanNode3State();
    await app.close();
    await stopTestStorage();
  });

  const http = () => request(app.getHttpServer());

  /** يُدخل N جهازًا بحالة WAREHOUSE فعليًا للجمعية عبر المسار الحقيقي الكامل (إنشاء محضر → إرسال → تأكيد الجمعية). */
  async function stockWarehouse(associationId: string, deviceType: DeviceType, qty: number): Promise<void> {
    const confirmerCookie = associationId === fx.associationBId ? assocBCookie : assocACookie;
    const { batchId, itemIds } = await createAndSendBatch(app, adminCookie, associationId, {
      items: [{ deviceType, spec: '18 قدم', sentQty: qty }],
    });
    await confirmBatchRequest(app, confirmerCookie, batchId, {
      items: [{ itemId: itemIds[0], receivedQty: qty, damagedQty: 0, missingQty: 0 }],
    }).expect((res) => {
      if (res.status !== 201 && res.status !== 200) throw new Error(`confirm failed: ${res.status} ${JSON.stringify(res.body)}`);
    });
  }

  const review = (id: string, body: Record<string, unknown>) =>
    http().post(`/api/v1/beneficiaries/${id}/review`).set('Cookie', adminCookie).send({ opId: newOpId('rev'), ...body });

  const setMain = (id: string, listRank: number) =>
    http().post(`/api/v1/beneficiaries/${id}/list-decision`).set('Cookie', adminCookie)
      .send({ listType: 'MAIN', listRank, reason: 'اختبار التخصيص التلقائي', opId: newOpId('list') });

  it('اعتماد احتياج واحد بمخزون كافٍ ⇒ تخصيص فعلي حقيقي + انتقال جماعي لبانتظار تعيين مندوب', async () => {
    await stockWarehouse(fx.associationAId, DeviceType.REFRIGERATOR, 1);

    const { id: beneficiaryId, needIds } = await createBeneficiary(app, assocACookie, {
      associationId: fx.associationAId,
      deviceTypes: [DeviceType.REFRIGERATOR],
    });

    await review(beneficiaryId, {
      beneficiaryDecision: 'APPROVED',
      needDecisions: [{ needId: needIds[0], decision: 'APPROVED' }],
    }).expect(201);
    await setMain(beneficiaryId, 1).expect(201);

    // المحرّك الحقيقي يعمل بعد commit المراجعة مباشرة — لا استقصاء/انتظار، المعاملة تكون قد التزمت فعليًا عند عودة الاستجابة.
    const need = await prisma.beneficiaryNeed.findUniqueOrThrow({ where: { id: needIds[0] } });
    expect(need.fulfillmentStatus).toBe(NeedFulfillmentStatus.AWAITING_DELEGATE_ASSIGNMENT);

    const allocation = await prisma.deviceAllocation.findFirstOrThrow({ where: { beneficiaryNeedId: needIds[0] } });
    expect(allocation.status).toBe(DeviceAllocationStatus.ACTIVE);
    expect(allocation.beneficiaryId).toBe(beneficiaryId);

    const device = await prisma.deviceUnit.findUniqueOrThrow({ where: { id: allocation.deviceId } });
    expect(device.status).toBe(DeviceStatus.ALLOCATED);
  });

  it('لا مخزون كافٍ ⇒ الاحتياج يبقى "استحقاق معتمد" بلا أي تخصيص، بلا أي خطأ يُسقط قرار المراجعة', async () => {
    const { id: beneficiaryId, needIds } = await createBeneficiary(app, assocACookie, {
      associationId: fx.associationAId,
      deviceTypes: [DeviceType.REFRIGERATOR],
    });

    const res = await review(beneficiaryId, {
      beneficiaryDecision: 'APPROVED',
      needDecisions: [{ needId: needIds[0], decision: 'APPROVED' }],
    });
    expect(res.status).toBe(201); // القرار ينجح دومًا حتى لو فشل/تعذّر التخصيص التالي له
    await setMain(beneficiaryId, 1).expect(201);

    const need = await prisma.beneficiaryNeed.findUniqueOrThrow({ where: { id: needIds[0] } });
    expect(need.fulfillmentStatus).toBe(NeedFulfillmentStatus.APPROVED_ENTITLEMENT);
    const allocation = await prisma.deviceAllocation.findFirst({ where: { beneficiaryNeedId: needIds[0] } });
    expect(allocation).toBeNull();
  });

  it('الاسترجاع الحقيقي (rebalancing): مستفيد جزئي التخصيص يخسر جهازه الجاهز لصالح إكمال مستفيد آخر', async () => {
    await stockWarehouse(fx.associationAId, DeviceType.REFRIGERATOR, 1);

    // C: يحتاج ثلاجة + فرنًا. مخزون ثلاجة واحد فقط ⇒ يُخصَّص له جزئيًا (ثلاجة فقط)، لا يكتمل (لا فرن متاحًا).
    const beneficiaryC = await createBeneficiary(app, assocACookie, {
      associationId: fx.associationAId,
      deviceTypes: [DeviceType.REFRIGERATOR, DeviceType.OVEN],
    });
    await review(beneficiaryC.id, {
      beneficiaryDecision: 'APPROVED',
      needDecisions: beneficiaryC.needIds.map((needId) => ({ needId, decision: 'APPROVED' })),
    }).expect(201);
    await setMain(beneficiaryC.id, 2).expect(201);

    const cNeeds = await prisma.beneficiaryNeed.findMany({ where: { beneficiaryId: beneficiaryC.id } });
    const cFridgeNeed = cNeeds.find((n) => n.deviceType === DeviceType.REFRIGERATOR)!;
    const cOvenNeed = cNeeds.find((n) => n.deviceType === DeviceType.OVEN)!;
    expect(cFridgeNeed.fulfillmentStatus).toBe(NeedFulfillmentStatus.DEVICE_READY); // جاهز جزئيًا
    expect(cOvenNeed.fulfillmentStatus).toBe(NeedFulfillmentStatus.APPROVED_ENTITLEMENT); // فجوة

    // D: يحتاج ثلاجة فقط. لا مخزون حر متبقٍّ (استهلكه C) — يكتمل فقط عبر استرجاع ثلاجة C.
    const beneficiaryD = await createBeneficiary(app, assocACookie, {
      associationId: fx.associationAId,
      deviceTypes: [DeviceType.REFRIGERATOR],
    });
    await review(beneficiaryD.id, {
      beneficiaryDecision: 'APPROVED',
      needDecisions: [{ needId: beneficiaryD.needIds[0], decision: 'APPROVED' }],
    }).expect(201);
    await setMain(beneficiaryD.id, 1).expect(201);

    const dNeed = await prisma.beneficiaryNeed.findUniqueOrThrow({ where: { id: beneficiaryD.needIds[0] } });
    expect(dNeed.fulfillmentStatus).toBe(NeedFulfillmentStatus.AWAITING_DELEGATE_ASSIGNMENT); // D اكتمل

    const cFridgeAfter = await prisma.beneficiaryNeed.findUniqueOrThrow({ where: { id: cFridgeNeed.id } });
    expect(cFridgeAfter.fulfillmentStatus).toBe(NeedFulfillmentStatus.AWAITING_DEVICE); // ثلاجة C استُرجِعت — تراجعت إلى فجوة من جديد

    const releasedAllocation = await prisma.deviceAllocation.findFirstOrThrow({
      where: { beneficiaryNeedId: cFridgeNeed.id, status: DeviceAllocationStatus.RELEASED },
    });
    const newAllocation = await prisma.deviceAllocation.findFirstOrThrow({
      where: { beneficiaryNeedId: dNeed.id, status: DeviceAllocationStatus.ACTIVE },
    });
    expect(newAllocation.deviceId).toBe(releasedAllocation.deviceId); // نفس الجهاز الفعلي انتقل
  });

  it('العزل بين الجمعيات: مخزون جمعية B لا يُستهلَك أبدًا لصالح احتياج جمعية A', async () => {
    await stockWarehouse(fx.associationBId, DeviceType.REFRIGERATOR, 5);

    const { id: beneficiaryId, needIds } = await createBeneficiary(app, assocACookie, {
      associationId: fx.associationAId,
      deviceTypes: [DeviceType.REFRIGERATOR],
    });
    await review(beneficiaryId, {
      beneficiaryDecision: 'APPROVED',
      needDecisions: [{ needId: needIds[0], decision: 'APPROVED' }],
    }).expect(201);
    await setMain(beneficiaryId, 1).expect(201);

    const need = await prisma.beneficiaryNeed.findUniqueOrThrow({ where: { id: needIds[0] } });
    expect(need.fulfillmentStatus).toBe(NeedFulfillmentStatus.APPROVED_ENTITLEMENT); // لم يُخصَّص رغم توفر مخزون — لكنه في جمعية أخرى
  });
});
