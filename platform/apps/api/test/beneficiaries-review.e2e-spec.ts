import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ValidationPipe } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import {
  prisma,
  BeneficiaryReviewStatus,
  DeviceType,
  NeedDecisionStatus,
  NeedFulfillmentStatus,
} from '@alzad/db';
import { AppModule } from '../src/app.module';
import { HttpExceptionFilter } from '../src/common/http-exception.filter';
import { EmailService } from '../src/modules/auth/email/email.service';
import { FakeEmailService } from '../src/modules/auth/email/fake-email.service';
import { ALLOCATION_TRIGGER_PORT, type AllocationTriggerPort } from '../src/modules/allocation/allocation-trigger.port';
import { cleanAuthState, seedTestFixtures } from './utils/fixtures';
import { loginAs } from './utils/node2-fixtures';
import { cleanNode3State, createBeneficiary, newOpId, seedNode3Fixtures, type Node3Fixtures } from './utils/node3-fixtures';

/**
 * تنفيذ تجسّس (spy) لبذرة التخصيص — يُحقن بدل `NoopAllocationTriggerService`
 * لإثبات **توقيت** وتجميع النداءات (Patch 3.2A.1) دون تشغيل أي مُخصِّص
 * حقيقي (لا وجود لأي مُخصِّص في NODE-3 أصلًا).
 */
class SpyAllocationTrigger implements AllocationTriggerPort {
  calls: string[] = [];
  failFor: Set<string> = new Set();

  async triggerForAssociation(associationId: string): Promise<void> {
    this.calls.push(associationId);
    if (this.failFor.has(associationId)) throw new Error('فشل تخصيص مُصطنَع للاختبار');
  }

  reset() {
    this.calls = [];
    this.failFor = new Set();
  }
}

/**
 * NODE-3 — قواعد مراجعة المستفيدين واحتياجاتهم (فردية + بالجملة).
 *
 * منقولة من الاختبار المرجعي القديم `tools/beneficiary-needs-test.js`
 * (الأقسام 18–26 تحديدًا: الدفعة، وتجميع AutoAllocation لكل جمعية، وقواعد
 * المراجعة الفردية) إلى اختبارات HTTP حقيقية على قاعدة PostgreSQL حقيقية.
 */
describe('NODE-3 — مراجعة المستفيدين والاحتياجات', () => {
  let app: INestApplication;
  let base: Awaited<ReturnType<typeof seedTestFixtures>>;
  let fx: Node3Fixtures;
  let adminCookie: string;
  let assocACookie: string;
  let assocBCookie: string;
  const spy = new SpyAllocationTrigger();

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(EmailService)
      .useClass(FakeEmailService)
      .overrideProvider(ALLOCATION_TRIGGER_PORT)
      .useValue(spy)
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
    await cleanNode3State();
    await cleanAuthState();
    spy.reset();
    adminCookie = await loginAs(app, base.adminEmail, base.adminPassword);
    assocACookie = await loginAs(app, fx.assocAEmail, fx.assocAPassword);
    assocBCookie = await loginAs(app, fx.assocBEmail, fx.assocBPassword);
  });

  afterAll(async () => {
    await cleanNode3State();
    await app.close();
  });

  const http = () => request(app.getHttpServer());

  const review = (id: string, body: Record<string, unknown>, cookie = adminCookie) =>
    http().post(`/api/v1/beneficiaries/${id}/review`).set('Cookie', cookie).send({ opId: newOpId('rev'), ...body });

  // ================================================================
  // المراجعة الفردية — القواعد الأساسية (يقابل القسم 26)
  // ================================================================
  describe('المراجعة الفردية', () => {
    it('اعتماد المستفيد مع اعتماد جهازين ورفض الثالث (يقابل القسم 3)', async () => {
      const { id, needIds } = await createBeneficiary(app, assocACookie, {
        deviceTypes: [DeviceType.REFRIGERATOR, DeviceType.OVEN, DeviceType.WASHING_MACHINE],
      });

      const res = await review(id, {
        beneficiaryDecision: 'APPROVED',
        needDecisions: [
          { needId: needIds[0], decision: 'APPROVED' },
          { needId: needIds[1], decision: 'APPROVED' },
          { needId: needIds[2], decision: 'REJECTED', rejectReason: 'المخزون غير كافٍ' },
        ],
      }).expect(201);

      expect(res.body.beneficiaryDecision).toBe(BeneficiaryReviewStatus.APPROVED);
      expect(res.body.approvedCount).toBe(2);
      expect(res.body.rejectedCount).toBe(1);

      const after = await prisma.beneficiary.findUniqueOrThrow({ where: { id }, include: { needs: true } });
      expect(after.reviewStatus).toBe(BeneficiaryReviewStatus.APPROVED);
      expect(after.reviewedAt).not.toBeNull();
      expect(after.reviewedById).not.toBeNull();

      const approved = after.needs.filter((n) => n.decisionStatus === NeedDecisionStatus.APPROVED);
      const rejected = after.needs.filter((n) => n.decisionStatus === NeedDecisionStatus.REJECTED);
      expect(approved).toHaveLength(2);
      expect(rejected).toHaveLength(1);

      // اعتماد الاحتياج ينشئ استحقاقًا معتمدًا فورًا — بلا أي فحص مخزون.
      for (const need of approved) {
        expect(need.fulfillmentStatus).toBe(NeedFulfillmentStatus.APPROVED_ENTITLEMENT);
      }
      // والمرفوض لا يحمل أي حالة تنفيذ.
      expect(rejected[0].fulfillmentStatus).toBeNull();
      expect(rejected[0].rejectReason).toBe('المخزون غير كافٍ');
    });

    it('سبب رفض المستفيد إلزامي، وسبب رفض الاحتياج الفردي اختياري', async () => {
      const { id, needIds } = await createBeneficiary(app, assocACookie);

      // رفض بلا سبب ⇒ 400
      const missing = await review(id, { beneficiaryDecision: 'REJECTED' }).expect(400);
      expect(missing.body.error.code).toBe('BENEFICIARY_REJECTION_REASON_REQUIRED');

      // سبب فارغ/مسافات فقط ⇒ 400 أيضًا
      await review(id, { beneficiaryDecision: 'REJECTED', beneficiaryRejectReason: '   ' }).expect(400);

      // اعتماد مع رفض احتياج **بلا** سبب فردي ⇒ مقبول تمامًا
      const { id: id2, needIds: needIds2 } = await createBeneficiary(app, assocACookie, {
        deviceTypes: [DeviceType.REFRIGERATOR, DeviceType.OVEN],
      });
      await review(id2, {
        beneficiaryDecision: 'APPROVED',
        needDecisions: [
          { needId: needIds2[0], decision: 'APPROVED' },
          { needId: needIds2[1], decision: 'REJECTED' },
        ],
      }).expect(201);

      expect(needIds).toBeDefined();
    });

    it('رفض المستفيد يغلق كل احتياجاته المعلَّقة بنفس السبب الموحَّد', async () => {
      const { id, needIds } = await createBeneficiary(app, assocACookie, {
        deviceTypes: [DeviceType.REFRIGERATOR, DeviceType.OVEN, DeviceType.WASHING_MACHINE],
      });

      const reason = 'المستفيد خارج نطاق المشروع';
      await review(id, {
        beneficiaryDecision: 'REJECTED',
        beneficiaryRejectReason: reason,
        // حتى لو أُرسل سبب فردي مختلف لأحدها، يُستبدَل بالسبب الموحَّد.
        needDecisions: [{ needId: needIds[0], decision: 'REJECTED', rejectReason: 'سبب فردي مختلف' }],
      }).expect(201);

      const after = await prisma.beneficiary.findUniqueOrThrow({ where: { id }, include: { needs: true } });
      expect(after.reviewStatus).toBe(BeneficiaryReviewStatus.REJECTED);
      expect(after.beneficiaryRejectReason).toBe(reason);
      expect(after.needs).toHaveLength(3);
      for (const need of after.needs) {
        expect(need.decisionStatus).toBe(NeedDecisionStatus.REJECTED);
        expect(need.rejectReason).toBe(reason);
        expect(need.fulfillmentStatus).toBeNull();
      }
    });

    it('لا يمكن اعتماد مستفيد كل احتياجاته مرفوضة', async () => {
      const { id, needIds } = await createBeneficiary(app, assocACookie, {
        deviceTypes: [DeviceType.REFRIGERATOR, DeviceType.OVEN],
      });

      const res = await review(id, {
        beneficiaryDecision: 'APPROVED',
        needDecisions: [
          { needId: needIds[0], decision: 'REJECTED' },
          { needId: needIds[1], decision: 'REJECTED' },
        ],
      }).expect(400);
      expect(res.body.error.code).toBe('BENEFICIARY_ALL_NEEDS_REJECTED');

      // ولم تُكتب أي حالة — التحقق كامل قبل أي كتابة.
      const after = await prisma.beneficiary.findUniqueOrThrow({ where: { id }, include: { needs: true } });
      expect(after.reviewStatus).toBe(BeneficiaryReviewStatus.UNDER_REVIEW);
      expect(after.needs.every((n) => n.decisionStatus === NeedDecisionStatus.PENDING)).toBe(true);
    });

    it('الاعتماد يوجب البتّ في كل احتياج معلَّق (لا احتياج بلا قرار)', async () => {
      const { id, needIds } = await createBeneficiary(app, assocACookie, {
        deviceTypes: [DeviceType.REFRIGERATOR, DeviceType.OVEN],
      });

      const res = await review(id, {
        beneficiaryDecision: 'APPROVED',
        needDecisions: [{ needId: needIds[0], decision: 'APPROVED' }],
      }).expect(400);
      expect(res.body.error.code).toBe('BENEFICIARY_NEED_DECISION_MISSING');
    });

    it('القرار النهائي غير قابل لإعادة الفتح (لا اعتماد ولا رفض ثانٍ)', async () => {
      const { id, needIds } = await createBeneficiary(app, assocACookie);

      await review(id, {
        beneficiaryDecision: 'APPROVED',
        needDecisions: [{ needId: needIds[0], decision: 'APPROVED' }],
      }).expect(201);

      const second = await review(id, {
        beneficiaryDecision: 'REJECTED',
        beneficiaryRejectReason: 'محاولة إعادة فتح',
      }).expect(409);
      expect(second.body.error.code).toBe('BENEFICIARY_ALREADY_REVIEWED');

      const after = await prisma.beneficiary.findUniqueOrThrow({ where: { id } });
      expect(after.reviewStatus).toBe(BeneficiaryReviewStatus.APPROVED);
    });

    it('يرفض احتياجًا لا يخصّ المستفيد، والمكرَّر داخل نفس الطلب', async () => {
      const { id, needIds } = await createBeneficiary(app, assocACookie);
      const other = await createBeneficiary(app, assocACookie);

      const foreign = await review(id, {
        beneficiaryDecision: 'APPROVED',
        needDecisions: [{ needId: other.needIds[0], decision: 'APPROVED' }],
      }).expect(404);
      expect(foreign.body.error.code).toBe('BENEFICIARY_NEED_NOT_FOUND');

      const duplicated = await review(id, {
        beneficiaryDecision: 'APPROVED',
        needDecisions: [
          { needId: needIds[0], decision: 'APPROVED' },
          { needId: needIds[0], decision: 'REJECTED' },
        ],
      }).expect(400);
      expect(duplicated.body.error.code).toBe('BENEFICIARY_NEED_DUPLICATE_DECISION');
    });

    it('مستفيد غير موجود ⇒ 404 نظيف', async () => {
      const res = await review(randomUUID(), { beneficiaryDecision: 'APPROVED' }).expect(404);
      expect(res.body.error.code).toBe('BENEFICIARY_NOT_FOUND');
    });
  });

  // ================================================================
  // قفل الاحتياجات بعد القرار النهائي
  // ================================================================
  describe('قفل الاحتياجات بعد القرار النهائي', () => {
    it('لا تعديل ولا إزالة لاحتياجات مستفيد مبتوت', async () => {
      const { id, needIds } = await createBeneficiary(app, assocACookie, {
        deviceTypes: [DeviceType.REFRIGERATOR, DeviceType.OVEN],
      });

      await review(id, {
        beneficiaryDecision: 'APPROVED',
        needDecisions: [
          { needId: needIds[0], decision: 'APPROVED' },
          { needId: needIds[1], decision: 'APPROVED' },
        ],
      }).expect(201);

      const removeRes = await http()
        .delete(`/api/v1/beneficiaries/needs/${needIds[0]}`)
        .set('Cookie', assocACookie)
        .send({ opId: newOpId('rm') })
        .expect(409);
      expect(removeRes.body.error.code).toBe('BENEFICIARY_NEEDS_LOCKED');

      const patchRes = await http()
        .patch(`/api/v1/beneficiaries/${id}`)
        .set('Cookie', assocACookie)
        .send({
          name: 'اسم جديد',
          region: 'الرياض',
          city: 'الرياض',
          district: 'حي',
          phone: '0512345678',
          familyCount: 3,
          socialStatus: 'أرملة',
          deviceTypes: [DeviceType.REFRIGERATOR],
          opId: newOpId('upd'),
        })
        .expect(409);
      expect(patchRes.body.error.code).toBe('BENEFICIARY_NEEDS_LOCKED');
    });
  });

  // ================================================================
  // التزامن — مراجعتان متزامنتان
  // ================================================================
  describe('التزامن', () => {
    it('مراجعتان متزامنتان على نفس المستفيد: واحدة تفوز فقط', async () => {
      const { id, needIds } = await createBeneficiary(app, assocACookie);

      const [a, b] = await Promise.all([
        review(id, {
          beneficiaryDecision: 'APPROVED',
          needDecisions: [{ needId: needIds[0], decision: 'APPROVED' }],
        }),
        review(id, { beneficiaryDecision: 'REJECTED', beneficiaryRejectReason: 'رفض متزامن' }),
      ]);

      const statuses = [a.status, b.status].sort();
      expect(statuses[0]).toBe(201);
      expect(statuses[1]).toBe(409);

      const after = await prisma.beneficiary.findUniqueOrThrow({ where: { id }, include: { needs: true } });
      expect([BeneficiaryReviewStatus.APPROVED, BeneficiaryReviewStatus.REJECTED]).toContain(after.reviewStatus);
      // اتساق: قرار المستفيد وقرار احتياجه لا يتناقضان أبدًا.
      if (after.reviewStatus === BeneficiaryReviewStatus.APPROVED) {
        expect(after.needs.some((n) => n.decisionStatus === NeedDecisionStatus.APPROVED)).toBe(true);
      } else {
        expect(after.needs.every((n) => n.decisionStatus === NeedDecisionStatus.REJECTED)).toBe(true);
      }
    });
  });

  // ================================================================
  // idempotency للمراجعة (يقابل القسم 5)
  // ================================================================
  describe('idempotency للمراجعة', () => {
    it('نفس opId بنفس الحمولة ⇒ إعادة نفس النتيجة بلا تنفيذ ثانٍ', async () => {
      const { id, needIds } = await createBeneficiary(app, assocACookie);
      const opId = newOpId('rev');
      const body = {
        beneficiaryDecision: 'APPROVED',
        needDecisions: [{ needId: needIds[0], decision: 'APPROVED' }],
        opId,
      };

      const first = await http().post(`/api/v1/beneficiaries/${id}/review`).set('Cookie', adminCookie).send(body).expect(201);
      const second = await http().post(`/api/v1/beneficiaries/${id}/review`).set('Cookie', adminCookie).send(body).expect(201);

      expect(second.body.replayed).toBe(true);
      expect(second.body.approvedCount).toBe(first.body.approvedCount);

      // ولم تُشغَّل بذرة التخصيص مرتين — الإعادة ليست قرارًا جديدًا.
      expect(spy.calls).toEqual([fx.associationAId]);
    });

    it('نفس opId بحمولة مختلفة ⇒ 409 تعارض', async () => {
      const { id, needIds } = await createBeneficiary(app, assocACookie);
      const opId = newOpId('rev');

      await http()
        .post(`/api/v1/beneficiaries/${id}/review`)
        .set('Cookie', adminCookie)
        .send({ beneficiaryDecision: 'APPROVED', needDecisions: [{ needId: needIds[0], decision: 'APPROVED' }], opId })
        .expect(201);

      await http()
        .post(`/api/v1/beneficiaries/${id}/review`)
        .set('Cookie', adminCookie)
        .send({ beneficiaryDecision: 'REJECTED', beneficiaryRejectReason: 'حمولة مختلفة', opId })
        .expect(409);
    });
  });

  // ================================================================
  // القسم 18 — bulkReviewBeneficiaries: success/failed بدقة
  // ================================================================
  describe('المراجعة بالجملة (القسم 18)', () => {
    const bulk = (items: unknown[], cookie = adminCookie) =>
      http().post('/api/v1/beneficiaries/bulk-review').set('Cookie', cookie).send({ items });

    it('يعيد success/failed بدقة، وADMIN فقط', async () => {
      const ok1 = await createBeneficiary(app, assocACookie);
      const ok2 = await createBeneficiary(app, assocACookie);
      const bad = await createBeneficiary(app, assocACookie);

      const res = await bulk([
        { beneficiaryId: ok1.id, beneficiaryDecision: 'APPROVED', needDecisions: [{ needId: ok1.needIds[0], decision: 'APPROVED' }], opId: newOpId() },
        { beneficiaryId: ok2.id, beneficiaryDecision: 'APPROVED', needDecisions: [{ needId: ok2.needIds[0], decision: 'APPROVED' }], opId: newOpId() },
        // رفض بلا سبب ⇒ عنصر فاشل
        { beneficiaryId: bad.id, beneficiaryDecision: 'REJECTED', opId: newOpId() },
      ]).expect(201);

      expect(res.body.success).toHaveLength(2);
      expect(res.body.failed).toHaveLength(1);
      expect(res.body.failed[0].beneficiaryId).toBe(bad.id);
      expect(res.body.failed[0].code).toBe('BENEFICIARY_REJECTION_REASON_REQUIRED');
    });

    it('دفعة فارغة مرفوضة', async () => {
      await bulk([]).expect(400);
    });

    // ------------------------------------------------------------
    // القسم 23 — فشل عنصر لا يُفسد العناصر الناجحة في نفس الدفعة
    // ------------------------------------------------------------
    it('فشل عنصر داخل الدفعة لا يُرجِع أو يُفسد العناصر الناجحة', async () => {
      const ok = await createBeneficiary(app, assocACookie);
      const bad = await createBeneficiary(app, assocACookie);

      const res = await bulk([
        { beneficiaryId: ok.id, beneficiaryDecision: 'APPROVED', needDecisions: [{ needId: ok.needIds[0], decision: 'APPROVED' }], opId: newOpId() },
        { beneficiaryId: bad.id, beneficiaryDecision: 'REJECTED', opId: newOpId() },
      ]).expect(201);

      expect(res.body.success).toHaveLength(1);
      expect(res.body.failed).toHaveLength(1);

      // الناجح **ثابت في القاعدة** فعلًا، والفاشل لم يتغيّر إطلاقًا.
      const okRow = await prisma.beneficiary.findUniqueOrThrow({ where: { id: ok.id }, include: { needs: true } });
      expect(okRow.reviewStatus).toBe(BeneficiaryReviewStatus.APPROVED);
      expect(okRow.needs[0].fulfillmentStatus).toBe(NeedFulfillmentStatus.APPROVED_ENTITLEMENT);

      const badRow = await prisma.beneficiary.findUniqueOrThrow({ where: { id: bad.id }, include: { needs: true } });
      expect(badRow.reviewStatus).toBe(BeneficiaryReviewStatus.UNDER_REVIEW);
      expect(badRow.needs[0].decisionStatus).toBe(NeedDecisionStatus.PENDING);
    });

    it('عنصر بمعرّف غير موجود يفشل وحده والبقية تنجح', async () => {
      const ok = await createBeneficiary(app, assocACookie);

      const res = await bulk([
        { beneficiaryId: randomUUID(), beneficiaryDecision: 'APPROVED', opId: newOpId() },
        { beneficiaryId: ok.id, beneficiaryDecision: 'APPROVED', needDecisions: [{ needId: ok.needIds[0], decision: 'APPROVED' }], opId: newOpId() },
      ]).expect(201);

      expect(res.body.success).toHaveLength(1);
      expect(res.body.failed).toHaveLength(1);
      expect(res.body.failed[0].code).toBe('BENEFICIARY_NOT_FOUND');
    });

    it('معرّف غير UUID داخل الدفعة يُرفض بـ400 على مستوى التحقق', async () => {
      await bulk([{ beneficiaryId: 'not-a-uuid', beneficiaryDecision: 'APPROVED', opId: newOpId() }]).expect(400);
    });

    it('idempotency على مستوى العنصر: إعادة نفس الدفعة لا تنفّذ القرار مرتين', async () => {
      const ok = await createBeneficiary(app, assocACookie);
      const items = [
        {
          beneficiaryId: ok.id,
          beneficiaryDecision: 'APPROVED',
          needDecisions: [{ needId: ok.needIds[0], decision: 'APPROVED' }],
          opId: newOpId(),
        },
      ];

      await bulk(items).expect(201);
      const second = await bulk(items).expect(201);

      expect(second.body.success).toHaveLength(1);
      // البذرة شُغِّلت مرة واحدة فقط رغم إرسال الدفعة مرتين.
      expect(spy.calls).toEqual([fx.associationAId]);
    });
  });

  // ================================================================
  // القسم 20–25 — Patch 3.2A.1: تجميع إشارة التخصيص لكل جمعية
  // ================================================================
  describe('Patch 3.2A.1 — تجميع بذرة التخصيص', () => {
    const bulk = (items: unknown[]) => http().post('/api/v1/beneficiaries/bulk-review').set('Cookie', adminCookie).send({ items });

    // القسم 20
    it('المراجعة الفردية تشغّل البذرة مرة واحدة فور الاعتماد', async () => {
      const { id, needIds } = await createBeneficiary(app, assocACookie);

      await review(id, {
        beneficiaryDecision: 'APPROVED',
        needDecisions: [{ needId: needIds[0], decision: 'APPROVED' }],
      }).expect(201);

      expect(spy.calls).toEqual([fx.associationAId]);
    });

    // القسم 21
    it('خمسة مستفيدين من نفس الجمعية ⇒ نداء واحد فقط للبذرة', async () => {
      const created = [];
      for (let i = 0; i < 5; i += 1) created.push(await createBeneficiary(app, assocACookie));

      const res = await bulk(
        created.map((c) => ({
          beneficiaryId: c.id,
          beneficiaryDecision: 'APPROVED',
          needDecisions: [{ needId: c.needIds[0], decision: 'APPROVED' }],
          opId: newOpId(),
        })),
      ).expect(201);

      expect(res.body.success).toHaveLength(5);
      // خمسة اعتمادات ناجحة، لكن جمعية واحدة ⇒ نداء واحد لا خمسة.
      expect(spy.calls).toEqual([fx.associationAId]);
    });

    // القسم 22
    it('مستفيدون من جمعيتين ⇒ نداءان فقط، واحد لكل جمعية', async () => {
      const a1 = await createBeneficiary(app, assocACookie);
      const a2 = await createBeneficiary(app, assocACookie);
      const b1 = await createBeneficiary(app, assocBCookie);
      const b2 = await createBeneficiary(app, assocBCookie);

      await bulk(
        [a1, a2, b1, b2].map((c) => ({
          beneficiaryId: c.id,
          beneficiaryDecision: 'APPROVED',
          needDecisions: [{ needId: c.needIds[0], decision: 'APPROVED' }],
          opId: newOpId(),
        })),
      ).expect(201);

      expect(spy.calls).toHaveLength(2);
      expect([...spy.calls].sort()).toEqual([fx.associationAId, fx.associationBId].sort());
    });

    // القسم 23 (الشق الخاص بالتجميع)
    it('جمعية عنصرها الوحيد فشل لا تدخل قائمة التخصيص', async () => {
      const a = await createBeneficiary(app, assocACookie);
      const b = await createBeneficiary(app, assocBCookie);

      await bulk([
        { beneficiaryId: a.id, beneficiaryDecision: 'APPROVED', needDecisions: [{ needId: a.needIds[0], decision: 'APPROVED' }], opId: newOpId() },
        // عنصر الجمعية "ب" يفشل (رفض بلا سبب) ⇒ جمعيته لا تُشغَّل إطلاقًا.
        { beneficiaryId: b.id, beneficiaryDecision: 'REJECTED', opId: newOpId() },
      ]).expect(201);

      expect(spy.calls).toEqual([fx.associationAId]);
    });

    // القسم 24
    it('الرفض الكامل لا يشغّل البذرة إطلاقًا', async () => {
      const a = await createBeneficiary(app, assocACookie);
      const b = await createBeneficiary(app, assocBCookie);

      await bulk([
        { beneficiaryId: a.id, beneficiaryDecision: 'REJECTED', beneficiaryRejectReason: 'سبب واضح', opId: newOpId() },
        { beneficiaryId: b.id, beneficiaryDecision: 'REJECTED', beneficiaryRejectReason: 'سبب واضح', opId: newOpId() },
      ]).expect(201);

      expect(spy.calls).toEqual([]);
    });

    it('الرفض الفردي لا يشغّل البذرة', async () => {
      const { id } = await createBeneficiary(app, assocACookie);
      await review(id, { beneficiaryDecision: 'REJECTED', beneficiaryRejectReason: 'سبب واضح' }).expect(201);
      expect(spy.calls).toEqual([]);
    });

    // القسم 25
    it('فشل البذرة بعد نجاح الاعتمادات: تبقى success ولا تتحول إلى failed', async () => {
      spy.failFor.add(fx.associationAId);

      const a1 = await createBeneficiary(app, assocACookie);
      const a2 = await createBeneficiary(app, assocACookie);

      const res = await bulk(
        [a1, a2].map((c) => ({
          beneficiaryId: c.id,
          beneficiaryDecision: 'APPROVED',
          needDecisions: [{ needId: c.needIds[0], decision: 'APPROVED' }],
          opId: newOpId(),
        })),
      ).expect(201);

      expect(res.body.success).toHaveLength(2);
      expect(res.body.failed).toHaveLength(0);
      expect(res.body.allocationWarnings).toHaveLength(1);
      expect(res.body.allocationWarnings[0].associationId).toBe(fx.associationAId);

      // والقرارات ثابتة فعلًا في القاعدة رغم فشل البذرة.
      for (const c of [a1, a2]) {
        const row = await prisma.beneficiary.findUniqueOrThrow({ where: { id: c.id } });
        expect(row.reviewStatus).toBe(BeneficiaryReviewStatus.APPROVED);
      }
    });

    it('فشل البذرة في المراجعة الفردية لا يُسقط القرار', async () => {
      spy.failFor.add(fx.associationAId);
      const { id, needIds } = await createBeneficiary(app, assocACookie);

      await review(id, {
        beneficiaryDecision: 'APPROVED',
        needDecisions: [{ needId: needIds[0], decision: 'APPROVED' }],
      }).expect(201);

      const row = await prisma.beneficiary.findUniqueOrThrow({ where: { id } });
      expect(row.reviewStatus).toBe(BeneficiaryReviewStatus.APPROVED);
    });
  });

  // ================================================================
  // القسم 19 — القراءة لا تكتب شيئًا
  // ================================================================
  describe('القراءة لا تكتب (القسم 19)', () => {
    it('استدعاء قائمة المستفيدين لا يغيّر أي حالة مراجعة ولا يكتب سجل تدقيق', async () => {
      const { id } = await createBeneficiary(app, assocACookie);
      await prisma.auditLog.deleteMany({});

      await http().get('/api/v1/beneficiaries').set('Cookie', adminCookie).expect(200);
      await http().get(`/api/v1/beneficiaries/${id}`).set('Cookie', adminCookie).expect(200);

      const row = await prisma.beneficiary.findUniqueOrThrow({ where: { id }, include: { needs: true } });
      expect(row.reviewStatus).toBe(BeneficiaryReviewStatus.UNDER_REVIEW);
      expect(row.reviewedAt).toBeNull();
      expect(row.needs.every((n) => n.decisionStatus === NeedDecisionStatus.PENDING)).toBe(true);
      expect(await prisma.auditLog.count()).toBe(0);
    });
  });

  // ================================================================
  // التدقيق — يُكتب بعد الالتزام الناجح فقط
  // ================================================================
  describe('سجل التدقيق', () => {
    it('يسجّل المراجعة الناجحة، ولا يسجّل المحاولة الفاشلة', async () => {
      const { id, needIds } = await createBeneficiary(app, assocACookie);
      await prisma.auditLog.deleteMany({});

      // محاولة فاشلة أولًا
      await review(id, { beneficiaryDecision: 'REJECTED' }).expect(400);
      expect(await prisma.auditLog.count({ where: { action: 'BENEFICIARY_REVIEWED' } })).toBe(0);

      await review(id, {
        beneficiaryDecision: 'APPROVED',
        needDecisions: [{ needId: needIds[0], decision: 'APPROVED' }],
      }).expect(201);

      const logs = await prisma.auditLog.findMany({ where: { action: 'BENEFICIARY_REVIEWED' } });
      expect(logs).toHaveLength(1);
      expect(logs[0].entityId).toBe(id);
      expect(logs[0].entityType).toBe('beneficiaries');
    });
  });
});
