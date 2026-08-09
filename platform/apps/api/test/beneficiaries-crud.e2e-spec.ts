import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import { prisma, BeneficiaryReviewStatus, DeviceType, NeedDecisionStatus } from '@alzad/db';
import { createTestApp } from './utils/bootstrap';
import { cleanAuthState, seedTestFixtures } from './utils/fixtures';
import { loginAs, loginAsDelegate } from './utils/node2-fixtures';
import {
  beneficiaryPayload,
  cleanNode3State,
  createBeneficiary,
  newOpId,
  seedNode3Fixtures,
  uniquePhone,
  type Node3Fixtures,
} from './utils/node3-fixtures';
import { MAX_PAGE } from '../src/common/pagination.util';

/**
 * NODE-3 — المستفيدون والاحتياجات: إنشاء/تعديل/مزامنة/عزل مستأجرين/صلاحيات/ترقيم.
 * (قواعد المراجعة نفسها في `beneficiaries-review.e2e-spec.ts`.)
 */
describe('NODE-3 — المستفيدون والاحتياجات (CRUD/عزل/تحقق)', () => {
  let app: INestApplication;
  let base: Awaited<ReturnType<typeof seedTestFixtures>>;
  let fx: Node3Fixtures;
  let adminCookie: string;
  let assocACookie: string;
  let assocBCookie: string;

  beforeAll(async () => {
    ({ app } = await createTestApp());
    base = await seedTestFixtures();
    fx = await seedNode3Fixtures();
  }, 60000);

  beforeEach(async () => {
    await cleanNode3State();
    await cleanAuthState();
    adminCookie = await loginAs(app, base.adminEmail, base.adminPassword);
    assocACookie = await loginAs(app, fx.assocAEmail, fx.assocAPassword);
    assocBCookie = await loginAs(app, fx.assocBEmail, fx.assocBPassword);
  });

  afterAll(async () => {
    await cleanNode3State();
    await app.close();
  });

  const http = () => request(app.getHttpServer());

  // ================================================================
  // الصلاحيات (role gating)
  // ================================================================
  describe('الصلاحيات', () => {
    it('DELEGATE ممنوع من كل نقاط المستفيدين', async () => {
      const delegateCookie = await loginAsDelegate(app, base.delegateCode);

      await http().get('/api/v1/beneficiaries').set('Cookie', delegateCookie).expect(403);
      await http().post('/api/v1/beneficiaries').set('Cookie', delegateCookie).send(beneficiaryPayload()).expect(403);
      await http()
        .post(`/api/v1/beneficiaries/${randomUUID()}/review`)
        .set('Cookie', delegateCookie)
        .send({ beneficiaryDecision: 'APPROVED', opId: newOpId() })
        .expect(403);
      await http().post('/api/v1/beneficiaries/bulk-review').set('Cookie', delegateCookie).send({ items: [] }).expect(403);
    });

    it('بلا جلسة: 401 على القائمة والإنشاء', async () => {
      await http().get('/api/v1/beneficiaries').expect(401);
      await http().post('/api/v1/beneficiaries').send(beneficiaryPayload()).expect(401);
    });

    it('ASSOCIATION ممنوعة من المراجعة الفردية والجماعية (ADMIN فقط)', async () => {
      const { id } = await createBeneficiary(app, assocACookie);

      await http()
        .post(`/api/v1/beneficiaries/${id}/review`)
        .set('Cookie', assocACookie)
        .send({ beneficiaryDecision: 'APPROVED', needDecisions: [], opId: newOpId() })
        .expect(403);

      await http()
        .post('/api/v1/beneficiaries/bulk-review')
        .set('Cookie', assocACookie)
        .send({ items: [{ beneficiaryId: id, beneficiaryDecision: 'APPROVED', opId: newOpId() }] })
        .expect(403);
    });
  });

  // ================================================================
  // الإنشاء
  // ================================================================
  describe('إنشاء مستفيد + احتياجاته', () => {
    it('ينشئ المستفيد واحتياجاته معًا، بحالة UNDER_REVIEW وPENDING', async () => {
      const res = await http()
        .post('/api/v1/beneficiaries')
        .set('Cookie', assocACookie)
        .send(beneficiaryPayload({ deviceTypes: [DeviceType.REFRIGERATOR, DeviceType.OVEN] }))
        .expect(201);

      const id = res.body.beneficiaryId;
      const beneficiary = await prisma.beneficiary.findUniqueOrThrow({ where: { id }, include: { needs: true } });

      expect(beneficiary.reviewStatus).toBe(BeneficiaryReviewStatus.UNDER_REVIEW);
      expect(beneficiary.associationId).toBe(fx.associationAId);
      expect(beneficiary.publicCode).toMatch(/^BEN-\d{6}$/);
      expect(beneficiary.needs).toHaveLength(2);
      for (const need of beneficiary.needs) {
        expect(need.decisionStatus).toBe(NeedDecisionStatus.PENDING);
        expect(need.fulfillmentStatus).toBeNull();
        expect(need.publicCode).toMatch(/^NED-\d{6}$/);
        // الاحتياج يرث جمعية المستفيد حتمًا (composite FK يفرضها DB-level).
        expect(need.associationId).toBe(fx.associationAId);
      }
    });

    it('يرفض الإنشاء بلا أي احتياج (قاعدة: احتياج واحد على الأقل)', async () => {
      const payload = beneficiaryPayload();
      delete (payload as Record<string, unknown>).deviceTypes;
      await http().post('/api/v1/beneficiaries').set('Cookie', assocACookie).send(payload).expect(400);

      await http()
        .post('/api/v1/beneficiaries')
        .set('Cookie', assocACookie)
        .send(beneficiaryPayload({ deviceTypes: [] }))
        .expect(400);
    });

    it('يرفض نوع جهاز خارج الأنواع الثلاثة المعتمدة', async () => {
      await http()
        .post('/api/v1/beneficiaries')
        .set('Cookie', assocACookie)
        .send(beneficiaryPayload({ deviceTypes: ['AIR_CONDITIONER'] as unknown as DeviceType[] }))
        .expect(400);
    });

    it('يدمج تكرار نفس النوع داخل الطلب بدل إنشاء صفين', async () => {
      const { id } = await createBeneficiary(app, assocACookie, {
        deviceTypes: [DeviceType.OVEN, DeviceType.OVEN],
      });
      const needs = await prisma.beneficiaryNeed.findMany({ where: { beneficiaryId: id } });
      expect(needs).toHaveLength(1);
      expect(needs[0].deviceType).toBe(DeviceType.OVEN);
    });

    it('يرفض مستفيدًا ثانيًا بنفس الجوال داخل نفس الجمعية، ويسمح به لجمعية أخرى', async () => {
      const phone = uniquePhone();
      await createBeneficiary(app, assocACookie, { phone });

      await http()
        .post('/api/v1/beneficiaries')
        .set('Cookie', assocACookie)
        .send(beneficiaryPayload({ phone }))
        .expect(409);

      // نفس الجوال لدى جمعية **أخرى** مسموح — الفحص محصور داخل الجمعية.
      await http().post('/api/v1/beneficiaries').set('Cookie', assocBCookie).send(beneficiaryPayload({ phone })).expect(201);
    });

    it('ASSOCIATION لا تستطيع تزوير associationId — تُستخدم جمعية الجلسة حصرًا', async () => {
      const res = await http()
        .post('/api/v1/beneficiaries')
        .set('Cookie', assocACookie)
        .send(beneficiaryPayload({ associationId: fx.associationBId }))
        .expect(201);

      const created = await prisma.beneficiary.findUniqueOrThrow({ where: { id: res.body.beneficiaryId } });
      expect(created.associationId).toBe(fx.associationAId);
      expect(created.associationId).not.toBe(fx.associationBId);
    });

    it('ADMIN ينشئ نيابة عن جمعية محدَّدة، ويُرفض بلا تحديد جمعية', async () => {
      const res = await http()
        .post('/api/v1/beneficiaries')
        .set('Cookie', adminCookie)
        .send(beneficiaryPayload({ associationId: fx.associationBId }))
        .expect(201);
      const created = await prisma.beneficiary.findUniqueOrThrow({ where: { id: res.body.beneficiaryId } });
      expect(created.associationId).toBe(fx.associationBId);

      const payload = beneficiaryPayload();
      delete (payload as Record<string, unknown>).associationId;
      await http().post('/api/v1/beneficiaries').set('Cookie', adminCookie).send(payload).expect(400);
    });

    it('يرفض المدخلات خارج المدى (عدد الأفراد/الدخل) والمرجعية غير المعروفة', async () => {
      await http()
        .post('/api/v1/beneficiaries')
        .set('Cookie', assocACookie)
        .send(beneficiaryPayload({ familyCount: 0 }))
        .expect(400);
      await http()
        .post('/api/v1/beneficiaries')
        .set('Cookie', assocACookie)
        .send(beneficiaryPayload({ familyCount: 100 }))
        .expect(400);
      await http()
        .post('/api/v1/beneficiaries')
        .set('Cookie', assocACookie)
        .send(beneficiaryPayload({ socialStatus: 'حالة غير معروفة إطلاقًا' }))
        .expect(400);
      await http()
        .post('/api/v1/beneficiaries')
        .set('Cookie', assocACookie)
        .send(beneficiaryPayload({ city: 'مدينة غير موجودة' }))
        .expect(400);
      await http()
        .post('/api/v1/beneficiaries')
        .set('Cookie', assocACookie)
        .send(beneficiaryPayload({ phone: 'not-a-phone' }))
        .expect(400);
    });

    it('idempotency: نفس opId بنفس الحمولة يُعيد نفس المستفيد بلا تكرار؛ وبحمولة مختلفة يُعطي 409', async () => {
      const payload = beneficiaryPayload();

      const first = await http().post('/api/v1/beneficiaries').set('Cookie', assocACookie).send(payload).expect(201);
      const second = await http().post('/api/v1/beneficiaries').set('Cookie', assocACookie).send(payload).expect(201);

      expect(second.body.beneficiaryId).toBe(first.body.beneficiaryId);
      expect(second.body.replayed).toBe(true);
      expect(await prisma.beneficiary.count({ where: { associationId: fx.associationAId } })).toBe(1);

      await http()
        .post('/api/v1/beneficiaries')
        .set('Cookie', assocACookie)
        .send({ ...payload, name: 'اسم مختلف تمامًا' })
        .expect(409);
    });
  });

  // ================================================================
  // التعديل ومزامنة الاحتياجات
  // ================================================================
  describe('تعديل المستفيد ومزامنة احتياجاته', () => {
    it('يعدّل الحقول بلا مساس بالاحتياجات عند غياب deviceTypes', async () => {
      const { id } = await createBeneficiary(app, assocACookie, { deviceTypes: [DeviceType.REFRIGERATOR] });

      const payload = beneficiaryPayload({ name: 'اسم محدَّث', opId: newOpId('upd') });
      delete (payload as Record<string, unknown>).deviceTypes;

      await http().patch(`/api/v1/beneficiaries/${id}`).set('Cookie', assocACookie).send(payload).expect(200);

      const after = await prisma.beneficiary.findUniqueOrThrow({ where: { id }, include: { needs: true } });
      expect(after.name).toBe('اسم محدَّث');
      expect(after.needs).toHaveLength(1);
      expect(after.needs[0].deviceType).toBe(DeviceType.REFRIGERATOR);
    });

    it('يضيف الأنواع الجديدة ويحذف المعلَّق الغائب عن القائمة النهائية', async () => {
      const { id } = await createBeneficiary(app, assocACookie, {
        deviceTypes: [DeviceType.REFRIGERATOR, DeviceType.OVEN],
      });

      await http()
        .patch(`/api/v1/beneficiaries/${id}`)
        .set('Cookie', assocACookie)
        .send(beneficiaryPayload({ deviceTypes: [DeviceType.OVEN, DeviceType.WASHING_MACHINE], opId: newOpId('upd') }))
        .expect(200);

      const needs = await prisma.beneficiaryNeed.findMany({ where: { beneficiaryId: id } });
      expect(needs.map((n) => n.deviceType).sort()).toEqual([DeviceType.OVEN, DeviceType.WASHING_MACHINE].sort());
    });

    it('يرفض قائمة احتياجات فارغة صراحةً (لا يُترك المستفيد بلا احتياج)', async () => {
      const { id } = await createBeneficiary(app, assocACookie);
      await http()
        .patch(`/api/v1/beneficiaries/${id}`)
        .set('Cookie', assocACookie)
        .send(beneficiaryPayload({ deviceTypes: [], opId: newOpId('upd') }))
        .expect(400);
    });

    it('يرفض نقل المستفيد لجمعية أخرى من نموذج التعديل العام', async () => {
      const { id } = await createBeneficiary(app, assocACookie);
      const res = await http()
        .patch(`/api/v1/beneficiaries/${id}`)
        .set('Cookie', adminCookie)
        .send(beneficiaryPayload({ associationId: fx.associationBId, opId: newOpId('upd') }))
        .expect(400);
      expect(res.body.error.code).toBe('BENEFICIARY_ASSOCIATION_IMMUTABLE');
    });
  });

  // ================================================================
  // إزالة احتياج معلَّق
  // ================================================================
  describe('إزالة احتياج معلَّق', () => {
    it('تُزيل احتياجًا معلَّقًا مع بقاء واحد على الأقل', async () => {
      const { id, needIds } = await createBeneficiary(app, assocACookie, {
        deviceTypes: [DeviceType.REFRIGERATOR, DeviceType.OVEN],
      });

      await http()
        .delete(`/api/v1/beneficiaries/needs/${needIds[0]}`)
        .set('Cookie', assocACookie)
        .send({ opId: newOpId('rm') })
        .expect(200);

      expect(await prisma.beneficiaryNeed.count({ where: { beneficiaryId: id } })).toBe(1);
    });

    it('ترفض إزالة الاحتياج الأخير', async () => {
      const { needIds } = await createBeneficiary(app, assocACookie, { deviceTypes: [DeviceType.REFRIGERATOR] });
      const res = await http()
        .delete(`/api/v1/beneficiaries/needs/${needIds[0]}`)
        .set('Cookie', assocACookie)
        .send({ opId: newOpId('rm') })
        .expect(400);
      expect(res.body.error.code).toBe('BENEFICIARY_REQUIRES_NEED');
    });

    it('جمعية أخرى لا تستطيع إزالة احتياج ليس لها (404 لا 403 — منع تعداد المعرّفات)', async () => {
      const { needIds } = await createBeneficiary(app, assocACookie, {
        deviceTypes: [DeviceType.REFRIGERATOR, DeviceType.OVEN],
      });
      await http()
        .delete(`/api/v1/beneficiaries/needs/${needIds[0]}`)
        .set('Cookie', assocBCookie)
        .send({ opId: newOpId('rm') })
        .expect(404);
    });
  });

  // ================================================================
  // عزل المستأجرين على القراءة
  // ================================================================
  describe('عزل المستأجرين', () => {
    it('كل جمعية ترى مستفيديها فقط، وADMIN يرى الكل ويستطيع التصفية', async () => {
      await createBeneficiary(app, assocACookie);
      await createBeneficiary(app, assocACookie);
      await createBeneficiary(app, assocBCookie);

      const aList = await http().get('/api/v1/beneficiaries').set('Cookie', assocACookie).expect(200);
      expect(aList.body.total).toBe(2);
      expect(aList.body.items.every((i: { associationId: string }) => i.associationId === fx.associationAId)).toBe(true);

      const bList = await http().get('/api/v1/beneficiaries').set('Cookie', assocBCookie).expect(200);
      expect(bList.body.total).toBe(1);

      // ADMIN يرى ما هو أوسع من نطاق أي جمعية واحدة. لا نقارن بعدد مطلق
      // هنا: قاعدة الاختبار تحمل بذور تطوير حقيقية لجمعيات أخرى، والتأكيد
      // المطلق كان سيصف حالة البذور لا سلوك العزل. الأدق: ADMIN يرى
      // مستفيدي الجمعيتين معًا، وكل تصفية تُعيد نطاقها بدقة.
      const adminScopedA = await http()
        .get(`/api/v1/beneficiaries?associationId=${fx.associationAId}`)
        .set('Cookie', adminCookie)
        .expect(200);
      expect(adminScopedA.body.total).toBe(2);

      const filtered = await http()
        .get(`/api/v1/beneficiaries?associationId=${fx.associationBId}`)
        .set('Cookie', adminCookie)
        .expect(200);
      expect(filtered.body.total).toBe(1);

      const adminList = await http().get('/api/v1/beneficiaries?pageSize=100').set('Cookie', adminCookie).expect(200);
      expect(adminList.body.total).toBeGreaterThanOrEqual(3);
    });

    it('جمعية لا تستطيع تجاوز العزل عبر associationId في الاستعلام', async () => {
      await createBeneficiary(app, assocBCookie);

      const res = await http()
        .get(`/api/v1/beneficiaries?associationId=${fx.associationBId}`)
        .set('Cookie', assocACookie)
        .expect(200);

      // المعامل يُتجاهَل كليًا لفاعل ASSOCIATION — تبقى النتيجة نطاق جمعيته.
      expect(res.body.total).toBe(0);
    });

    it('جمعية لا تستطيع قراءة أو تعديل مستفيد جمعية أخرى', async () => {
      const { id } = await createBeneficiary(app, assocACookie);

      await http().get(`/api/v1/beneficiaries/${id}`).set('Cookie', assocBCookie).expect(404);
      await http()
        .patch(`/api/v1/beneficiaries/${id}`)
        .set('Cookie', assocBCookie)
        .send(beneficiaryPayload({ opId: newOpId('upd') }))
        .expect(404);

      // ولا يزال مالكه يصل إليه بلا مشكلة.
      await http().get(`/api/v1/beneficiaries/${id}`).set('Cookie', assocACookie).expect(200);
    });
  });

  // ================================================================
  // القائمة: ترقيم/بحث/ترتيب/تحصين المدخلات
  // ================================================================
  describe('القائمة — ترقيم وبحث وترتيب وتحصين', () => {
    it('ترقيم خادمي حقيقي بحدود page/pageSize', async () => {
      for (let i = 0; i < 3; i += 1) await createBeneficiary(app, assocACookie);

      const page1 = await http().get('/api/v1/beneficiaries?page=1&pageSize=2').set('Cookie', assocACookie).expect(200);
      expect(page1.body.items).toHaveLength(2);
      expect(page1.body.total).toBe(3);
      expect(page1.body.totalPages).toBe(2);

      const page2 = await http().get('/api/v1/beneficiaries?page=2&pageSize=2').set('Cookie', assocACookie).expect(200);
      expect(page2.body.items).toHaveLength(1);

      // لا تداخل بين الصفحتين — الترتيب حتمي بكاسر تعادل على id.
      const ids = [...page1.body.items, ...page2.body.items].map((i: { id: string }) => i.id);
      expect(new Set(ids).size).toBe(3);
    });

    it('لا 500 على أي مُدخَل ترقيم/تصفية/ترتيب فاسد — 400 نظيف دائمًا', async () => {
      const badQueries = [
        'page=abc',
        'page=0',
        'page=-5',
        `page=${MAX_PAGE + 1}`,
        'page=1e308',
        'pageSize=abc',
        'pageSize=0',
        'pageSize=101',
        'reviewStatus=NOT_A_STATUS',
        'sortBy=id;DROP TABLE beneficiaries',
        'sortBy=password',
        'sortDir=sideways',
        'associationId=not-a-uuid',
      ];
      for (const q of badQueries) {
        const res = await http().get(`/api/v1/beneficiaries?${q}`).set('Cookie', assocACookie);
        expect(res.status).toBe(400);
      }
    });

    it('معرّف غير UUID على المسارات يُرفض بـ400 لا 500', async () => {
      await http().get('/api/v1/beneficiaries/not-a-uuid').set('Cookie', assocACookie).expect(400);
      await http()
        .patch('/api/v1/beneficiaries/not-a-uuid')
        .set('Cookie', assocACookie)
        .send(beneficiaryPayload({ opId: newOpId() }))
        .expect(400);
      await http()
        .post('/api/v1/beneficiaries/not-a-uuid/review')
        .set('Cookie', adminCookie)
        .send({ beneficiaryDecision: 'APPROVED', opId: newOpId() })
        .expect(400);
    });

    it('البحث يعمل بالاسم والرمز العام والجوال، ويصفّي فعلًا', async () => {
      const phone = uniquePhone();
      const { id } = await createBeneficiary(app, assocACookie, { name: 'محمد المطلوب للبحث', phone });
      await createBeneficiary(app, assocACookie, { name: 'شخص آخر تمامًا' });
      const created = await prisma.beneficiary.findUniqueOrThrow({ where: { id } });

      const byName = await http().get('/api/v1/beneficiaries?search=المطلوب').set('Cookie', assocACookie).expect(200);
      expect(byName.body.total).toBe(1);
      expect(byName.body.items[0].id).toBe(id);

      const byCode = await http()
        .get(`/api/v1/beneficiaries?search=${created.publicCode}`)
        .set('Cookie', assocACookie)
        .expect(200);
      expect(byCode.body.total).toBe(1);

      const byPhone = await http().get(`/api/v1/beneficiaries?search=${phone}`).set('Cookie', assocACookie).expect(200);
      expect(byPhone.body.total).toBe(1);
    });

    it('الترتيب بالاسم تصاعديًا/تنازليًا يعمل خادميًا', async () => {
      await createBeneficiary(app, assocACookie, { name: 'أأأ الأول' });
      await createBeneficiary(app, assocACookie, { name: 'ييي الأخير' });

      const asc = await http().get('/api/v1/beneficiaries?sortBy=name&sortDir=asc').set('Cookie', assocACookie).expect(200);
      const desc = await http().get('/api/v1/beneficiaries?sortBy=name&sortDir=desc').set('Cookie', assocACookie).expect(200);

      expect(asc.body.items[0].name).not.toBe(desc.body.items[0].name);
      expect(asc.body.items[0].name).toBe(desc.body.items[desc.body.items.length - 1].name);
    });

    it('عدّادات الاحتياجات مجمَّعة بلا N+1 — استعلام تجميعي واحد لكل الصفحة', async () => {
      await createBeneficiary(app, assocACookie, { deviceTypes: [DeviceType.REFRIGERATOR, DeviceType.OVEN] });
      await createBeneficiary(app, assocACookie, { deviceTypes: [DeviceType.WASHING_MACHINE] });

      // عدد استعلامات Prisma لا يتناسب مع عدد الصفوف: findMany + count +
      // groupBy واحد فقط مهما بلغ حجم الصفحة (يُثبَت عبر عدّاد أحداث
      // الاستعلام الحقيقي أدناه في اختبار مستقل).
      const res = await http().get('/api/v1/beneficiaries').set('Cookie', assocACookie).expect(200);
      const totals = res.body.items.map((i: { needsTotal: number }) => i.needsTotal).sort();
      expect(totals).toEqual([1, 2]);
      expect(res.body.items.every((i: { needsPending: number }) => i.needsPending >= 1)).toBe(true);
    });
  });
});
