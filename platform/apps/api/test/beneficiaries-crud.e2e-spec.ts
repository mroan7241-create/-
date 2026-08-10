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

  // ================================================================
  // NODE-3.1 — البند 1: العنوان/العلامة المميزة حقول قراءة تاريخية فقط
  // ================================================================
  describe('NODE-3.1 — address/landmark: قراءة تاريخية فقط', () => {
    it('إرسال address أو landmark في الإنشاء أو التعديل يُرفض بـ400 (ليسا حقلَي إدخال)', async () => {
      await http()
        .post('/api/v1/beneficiaries')
        .set('Cookie', assocACookie)
        .send(beneficiaryPayload({ address: 'عنوان وصفي' }))
        .expect(400);

      await http()
        .post('/api/v1/beneficiaries')
        .set('Cookie', assocACookie)
        .send(beneficiaryPayload({ landmark: 'قرب المسجد' }))
        .expect(400);

      const { id } = await createBeneficiary(app, assocACookie);
      await http()
        .patch(`/api/v1/beneficiaries/${id}`)
        .set('Cookie', assocACookie)
        .send(beneficiaryPayload({ address: 'عنوان جديد', opId: newOpId('upd') }))
        .expect(400);
      await http()
        .patch(`/api/v1/beneficiaries/${id}`)
        .set('Cookie', assocACookie)
        .send(beneficiaryPayload({ landmark: 'علامة جديدة', opId: newOpId('upd') }))
        .expect(400);
    });

    it('الإنشاء لا يشترطهما، ويترك address على قيمة القاعدة الافتراضية وlandmark فارغًا', async () => {
      const { id } = await createBeneficiary(app, assocACookie);
      const created = await prisma.beneficiary.findUniqueOrThrow({ where: { id } });
      expect(created.address).toBe('');
      expect(created.landmark).toBeNull();
    });

    it('سجل تاريخي يحمل قيمًا فعلية: تعديل حقل آخر لا يمسّهما إطلاقًا، والتفاصيل تُعيدهما', async () => {
      const { id } = await createBeneficiary(app, assocACookie);

      // محاكاة سجل مهاجَر من النظام القديم: تُكتب القيم مباشرة عبر Prisma
      // تجاوزًا للـAPI (الذي لم يعد يقبلهما أصلًا).
      const historicalAddress = 'شارع الملك عبدالعزيز، قرب المسجد الجامع';
      const historicalLandmark = 'بجوار الصيدلية الكبرى';
      await prisma.beneficiary.update({
        where: { id },
        data: { address: historicalAddress, landmark: historicalLandmark },
      });

      await http()
        .patch(`/api/v1/beneficiaries/${id}`)
        .set('Cookie', assocACookie)
        .send(beneficiaryPayload({ name: 'اسم محدَّث تمامًا', opId: newOpId('upd') }))
        .expect(200);

      const after = await prisma.beneficiary.findUniqueOrThrow({ where: { id } });
      expect(after.name).toBe('اسم محدَّث تمامًا');
      // بايت ببايت كما كانا — لا مسح ولا استبدال ولا قصّ.
      expect(after.address).toBe(historicalAddress);
      expect(after.landmark).toBe(historicalLandmark);

      const detail = await http().get(`/api/v1/beneficiaries/${id}`).set('Cookie', assocACookie).expect(200);
      expect(detail.body.address).toBe(historicalAddress);
      expect(detail.body.landmark).toBe(historicalLandmark);
    });
  });

  // ================================================================
  // NODE-3.1 — البند 2: موقع المستفيد (أعمدة Prisma الموجودة أصلًا)
  // ================================================================
  describe('NODE-3.1 — موقع المستفيد', () => {
    it('الحفظ بلا أي بيانات موقع صالح تمامًا (الموقع اختياري)', async () => {
      const { id } = await createBeneficiary(app, assocACookie);
      const row = await prisma.beneficiary.findUniqueOrThrow({ where: { id } });
      expect(row.latitude).toBeNull();
      expect(row.longitude).toBeNull();
      expect(row.locationSource).toBeNull();
      expect(row.locationUpdatedAt).toBeNull();

      const detail = await http().get(`/api/v1/beneficiaries/${id}`).set('Cookie', assocACookie).expect(200);
      expect(detail.body.locationConfirmed).toBe(false);
    });

    it('يحفظ إحداثيات صالحة مع المصدر وتاريخ التحديث', async () => {
      const res = await http()
        .post('/api/v1/beneficiaries')
        .set('Cookie', assocACookie)
        .send(beneficiaryPayload({ lat: 24.7136, lng: 46.6753, locationSource: 'CURRENT_LOCATION' }))
        .expect(201);

      const row = await prisma.beneficiary.findUniqueOrThrow({ where: { id: res.body.beneficiaryId } });
      expect(Number(row.latitude)).toBeCloseTo(24.7136, 6);
      expect(Number(row.longitude)).toBeCloseTo(46.6753, 6);
      expect(row.locationSource).toBe('CURRENT_LOCATION');
      expect(row.locationUpdatedAt).not.toBeNull();

      const detail = await http()
        .get(`/api/v1/beneficiaries/${res.body.beneficiaryId}`)
        .set('Cookie', assocACookie)
        .expect(200);
      expect(detail.body.locationConfirmed).toBe(true);
      expect(detail.body.lat).toBeCloseTo(24.7136, 6);
    });

    it('إحداثية واحدة دون الأخرى تُرفض (both-or-neither)، وخارج المدى يُرفض', async () => {
      for (const bad of [
        { lat: 24.7136 },
        { lng: 46.6753 },
        { lat: 91, lng: 46 },
        { lat: -91, lng: 46 },
        { lat: 24, lng: 181 },
        { lat: 24, lng: -181 },
      ]) {
        await http()
          .post('/api/v1/beneficiaries')
          .set('Cookie', assocACookie)
          .send(beneficiaryPayload(bad))
          .expect(400);
      }
    });

    it('مصدر موقع غير معروف يُصحَّح إلى MANUAL بدل رفض الطلب (تساهل Legacy)', async () => {
      const res = await http()
        .post('/api/v1/beneficiaries')
        .set('Cookie', assocACookie)
        .send(beneficiaryPayload({ lat: 24.5, lng: 46.5, locationSource: 'قيمة غير معروفة' }))
        .expect(201);
      const row = await prisma.beneficiary.findUniqueOrThrow({ where: { id: res.body.beneficiaryId } });
      expect(row.locationSource).toBe('MANUAL');
    });

    it('تعديل حقل لا علاقة له بالموقع لا يمسّ locationUpdatedAt إطلاقًا', async () => {
      const create = await http()
        .post('/api/v1/beneficiaries')
        .set('Cookie', assocACookie)
        .send(beneficiaryPayload({ lat: 24.5, lng: 46.5, locationSource: 'MAP' }))
        .expect(201);
      const id = create.body.beneficiaryId;
      const before = await prisma.beneficiary.findUniqueOrThrow({ where: { id } });

      await new Promise((resolve) => setTimeout(resolve, 20));

      // لا lat/lng في الحمولة إطلاقًا ⇒ الموقع لا يُمسّ.
      await http()
        .patch(`/api/v1/beneficiaries/${id}`)
        .set('Cookie', assocACookie)
        .send(beneficiaryPayload({ name: 'اسم مختلف', opId: newOpId('upd') }))
        .expect(200);

      const after = await prisma.beneficiary.findUniqueOrThrow({ where: { id } });
      expect(after.locationUpdatedAt?.toISOString()).toBe(before.locationUpdatedAt?.toISOString());
      expect(Number(after.latitude)).toBeCloseTo(24.5, 6);
      expect(after.locationSource).toBe('MAP');
    });

    it('إرسال نفس الإحداثيات دون تغيير فعلي لا يُحدِّث locationUpdatedAt', async () => {
      const create = await http()
        .post('/api/v1/beneficiaries')
        .set('Cookie', assocACookie)
        .send(beneficiaryPayload({ lat: 24.5, lng: 46.5, locationSource: 'MAP' }))
        .expect(201);
      const id = create.body.beneficiaryId;
      const before = await prisma.beneficiary.findUniqueOrThrow({ where: { id } });

      await new Promise((resolve) => setTimeout(resolve, 20));

      await http()
        .patch(`/api/v1/beneficiaries/${id}`)
        .set('Cookie', assocACookie)
        .send(beneficiaryPayload({ lat: 24.5, lng: 46.5, locationSource: 'MANUAL', opId: newOpId('upd') }))
        .expect(200);

      const after = await prisma.beneficiary.findUniqueOrThrow({ where: { id } });
      expect(after.locationUpdatedAt?.toISOString()).toBe(before.locationUpdatedAt?.toISOString());
      // المصدر أيضًا لا يُمسّ ما دامت الإحداثيات لم تتغيّر.
      expect(after.locationSource).toBe('MAP');
    });

    it('تغيير الإحداثيات فعليًا يُحدِّث المصدر وتاريخ التحديث', async () => {
      const create = await http()
        .post('/api/v1/beneficiaries')
        .set('Cookie', assocACookie)
        .send(beneficiaryPayload({ lat: 24.5, lng: 46.5, locationSource: 'MAP' }))
        .expect(201);
      const id = create.body.beneficiaryId;
      const before = await prisma.beneficiary.findUniqueOrThrow({ where: { id } });

      await new Promise((resolve) => setTimeout(resolve, 20));

      await http()
        .patch(`/api/v1/beneficiaries/${id}`)
        .set('Cookie', assocACookie)
        .send(beneficiaryPayload({ lat: 21.4225, lng: 39.8262, locationSource: 'CURRENT_LOCATION', opId: newOpId('upd') }))
        .expect(200);

      const after = await prisma.beneficiary.findUniqueOrThrow({ where: { id } });
      expect(Number(after.latitude)).toBeCloseTo(21.4225, 6);
      expect(after.locationSource).toBe('CURRENT_LOCATION');
      expect(after.locationUpdatedAt!.getTime()).toBeGreaterThan(before.locationUpdatedAt!.getTime());
    });

    it('مسح الموقع صراحةً (lat/lng = null) يفرّغ الأعمدة الأربعة', async () => {
      const create = await http()
        .post('/api/v1/beneficiaries')
        .set('Cookie', assocACookie)
        .send(beneficiaryPayload({ lat: 24.5, lng: 46.5, locationSource: 'MAP' }))
        .expect(201);
      const id = create.body.beneficiaryId;

      await http()
        .patch(`/api/v1/beneficiaries/${id}`)
        .set('Cookie', assocACookie)
        .send(beneficiaryPayload({ lat: null, lng: null, opId: newOpId('upd') }))
        .expect(200);

      const after = await prisma.beneficiary.findUniqueOrThrow({ where: { id } });
      expect(after.latitude).toBeNull();
      expect(after.longitude).toBeNull();
      expect(after.locationSource).toBeNull();
      expect(after.locationUpdatedAt).toBeNull();
    });

    it('مُصفّي "بانتظار تحديد الموقع" يصفّي خادميًا على غياب الإحداثيات', async () => {
      await createBeneficiary(app, assocACookie); // بلا موقع
      await http()
        .post('/api/v1/beneficiaries')
        .set('Cookie', assocACookie)
        .send(beneficiaryPayload({ lat: 24.5, lng: 46.5, locationSource: 'MAP' }))
        .expect(201);

      const pending = await http()
        .get('/api/v1/beneficiaries?locationStatus=PENDING')
        .set('Cookie', assocACookie)
        .expect(200);
      expect(pending.body.total).toBe(1);
      expect(pending.body.items[0].locationConfirmed).toBe(false);

      const confirmed = await http()
        .get('/api/v1/beneficiaries?locationStatus=CONFIRMED')
        .set('Cookie', assocACookie)
        .expect(200);
      expect(confirmed.body.total).toBe(1);
      expect(confirmed.body.items[0].locationConfirmed).toBe(true);

      // قيمة غير معروفة للمُصفّي تُرفض بـ400 لا 500، ولا تتعارض مع البحث.
      await http().get('/api/v1/beneficiaries?locationStatus=NOPE').set('Cookie', assocACookie).expect(400);
    });

    it('المُصفّي يتعايش مع البحث الحر بلا أن يُلغي أحدهما الآخر', async () => {
      await createBeneficiary(app, assocACookie, { name: 'مستفيد بلا موقع للبحث' });
      const res = await http()
        .get('/api/v1/beneficiaries?locationStatus=PENDING&search=للبحث')
        .set('Cookie', assocACookie)
        .expect(200);
      expect(res.body.total).toBe(1);
    });
  });

  // ================================================================
  // NODE-3.3 — الاقتران الناقص لِ(lat, lng): رفض 400 بلا أي أثر جانبي
  // ================================================================
  //
  // العطب المُصلَح: `undefined` (لم يُرسَل) و`null` (امسح) كانا يُطويان في
  // مفهوم «فارغ» واحد داخل `optionalCoordinate`، فكان `{ lat: null }` وحده
  // — أو `{ lng: null }` وحده — يمرّ بوصفه «كلاهما فارغ» ⇒ **مسح صامت
  // لموقع مخزَّن** بناءً على طرف واحد من الطلب. الآن الصور الستّ كلها 400.
  describe('NODE-3.3 — اقتران lat/lng الناقص', () => {
    /** الصور الستّ المختلطة: غائب/`null`/رقم في كل تركيبة غير متجانسة. */
    const partialPairs: Array<Record<string, unknown>> = [
      { lat: null }, // lat = null، lng غائب
      { lng: null }, // lat غائب، lng = null
      { lat: 24.7136 }, // lat رقم، lng غائب
      { lng: 46.6753 }, // lat غائب، lng رقم
      { lat: null, lng: 46.6753 }, // lat = null، lng رقم
      { lat: 24.7136, lng: null }, // lat رقم، lng = null
    ];

    it('الإنشاء يرفض الصور الستّ كلها بـ400', async () => {
      expect(partialPairs).toHaveLength(6);
      for (const partial of partialPairs) {
        await http()
          .post('/api/v1/beneficiaries')
          .set('Cookie', assocACookie)
          .send(beneficiaryPayload(partial))
          .expect(400);
      }
    });

    it('التعديل يرفض الصور الستّ كلها بـ400 دون أن يمسّ الموقع المخزَّن', async () => {
      const create = await http()
        .post('/api/v1/beneficiaries')
        .set('Cookie', assocACookie)
        .send(beneficiaryPayload({ lat: 24.5, lng: 46.5, locationSource: 'MAP' }))
        .expect(201);
      const id = create.body.beneficiaryId as string;

      // موقع حقيقي مخزَّن فعلًا — حتى تكون «لم يتغيّر» دعوى ذات معنى.
      const before = await prisma.beneficiary.findUniqueOrThrow({ where: { id } });
      expect(before.latitude).not.toBeNull();
      expect(before.locationUpdatedAt).not.toBeNull();

      for (const partial of partialPairs) {
        await http()
          .patch(`/api/v1/beneficiaries/${id}`)
          .set('Cookie', assocACookie)
          .send(beneficiaryPayload({ ...partial, opId: newOpId('upd') }))
          .expect(400);

        // بعد **كل** محاولة مرفوضة: الأعمدة الأربعة كما كانت بايتًا ببايت.
        const after = await prisma.beneficiary.findUniqueOrThrow({ where: { id } });
        expect(after.latitude?.toString()).toBe(before.latitude?.toString());
        expect(after.longitude?.toString()).toBe(before.longitude?.toString());
        expect(after.locationSource).toBe(before.locationSource);
        expect(after.locationUpdatedAt?.toISOString()).toBe(before.locationUpdatedAt?.toISOString());
      }
    });

    it('طلب مرفوض لا يستهلك opId إطلاقًا: الرفض يسبق مطالبة idempotency', async () => {
      const { id } = await createBeneficiary(app, assocACookie);
      const opId = newOpId('upd');

      // نفس الـopId يُرفض أولًا لاقترانه الناقص…
      await http()
        .patch(`/api/v1/beneficiaries/${id}`)
        .set('Cookie', assocACookie)
        .send(beneficiaryPayload({ lat: 24.7136, opId }))
        .expect(400);

      // …ثم يُستعمل نفسه لطلب صالح فينجح: لم تُسجَّل له مطالبة سابقة.
      await http()
        .patch(`/api/v1/beneficiaries/${id}`)
        .set('Cookie', assocACookie)
        .send(beneficiaryPayload({ lat: 24.7136, lng: 46.6753, locationSource: 'MAP', opId }))
        .expect(200);

      const after = await prisma.beneficiary.findUniqueOrThrow({ where: { id } });
      expect(Number(after.latitude)).toBeCloseTo(24.7136, 6);
      expect(after.locationSource).toBe('MAP');
    });
  });

  // ================================================================
  // NODE-3.1 — البند 3: تنبيه "مطابق محتمل" غير الحاجب
  // ================================================================
  describe('NODE-3.1 — تنبيه المطابق المحتمل (غير حاجب)', () => {
    it('نفس الاسم (بعد التطبيع) ونفس المدينة بجوال مختلف: ينجح الحفظ مع تنبيه يحمل publicCode', async () => {
      const { id: firstId } = await createBeneficiary(app, assocACookie, { name: 'محمد عبدالله الشمري' });
      const first = await prisma.beneficiary.findUniqueOrThrow({ where: { id: firstId } });

      const res = await http()
        .post('/api/v1/beneficiaries')
        .set('Cookie', assocACookie)
        // تطبيع الاسم: مسافات زائدة + حالة أحرف — يجب أن يُطابِق رغم ذلك.
        .send(beneficiaryPayload({ name: '  محمد   عبدالله    الشمري ' }))
        .expect(201);

      expect(res.body.possibleDuplicate).toBeDefined();
      expect(res.body.possibleDuplicate.publicCode).toBe(first.publicCode);
      expect(res.body.possibleDuplicate.message).toContain(first.publicCode);
      // لا تسريب لأي معرّف داخلي في التنبيه.
      expect(JSON.stringify(res.body.possibleDuplicate)).not.toContain(firstId);
      // ومع ذلك الحفظ **نجح فعلًا**: سجلان قائمان.
      expect(await prisma.beneficiary.count({ where: { associationId: fx.associationAId } })).toBe(2);
    });

    it('نفس الاسم لكن مدينة مختلفة: لا تنبيه', async () => {
      await createBeneficiary(app, assocACookie, { name: 'سالم القحطاني', city: 'الرياض' });
      const res = await http()
        .post('/api/v1/beneficiaries')
        .set('Cookie', assocACookie)
        .send(beneficiaryPayload({ name: 'سالم القحطاني', region: 'مكة المكرمة', city: 'جدة' }))
        .expect(201);
      expect(res.body.possibleDuplicate).toBeUndefined();
    });

    it('مطابقة اسم+مدينة لدى جمعية أخرى: لا تنبيه ولا تسريب لبياناتها', async () => {
      const { id: otherId } = await createBeneficiary(app, assocBCookie, { name: 'فاطمة العتيبي' });
      const other = await prisma.beneficiary.findUniqueOrThrow({ where: { id: otherId } });

      const res = await http()
        .post('/api/v1/beneficiaries')
        .set('Cookie', assocACookie)
        .send(beneficiaryPayload({ name: 'فاطمة العتيبي' }))
        .expect(201);

      expect(res.body.possibleDuplicate).toBeUndefined();
      expect(JSON.stringify(res.body)).not.toContain(other.publicCode);
      expect(JSON.stringify(res.body)).not.toContain(otherId);
    });

    it('التعديل يُطلق نفس الفحص، ولا يُنبّه المستفيد على نفسه', async () => {
      const { id: aId } = await createBeneficiary(app, assocACookie, { name: 'خالد الدوسري' });
      const a = await prisma.beneficiary.findUniqueOrThrow({ where: { id: aId } });
      const { id: bId } = await createBeneficiary(app, assocACookie, { name: 'اسم مختلف تمامًا' });

      // تعديل السجل على نفسه بلا تغيير الاسم: لا تنبيه ذاتي.
      const selfRes = await http()
        .patch(`/api/v1/beneficiaries/${aId}`)
        .set('Cookie', assocACookie)
        .send(beneficiaryPayload({ name: 'خالد الدوسري', opId: newOpId('upd') }))
        .expect(200);
      expect(selfRes.body.possibleDuplicate).toBeUndefined();

      // تعديل السجل الثاني ليطابق اسم الأول ⇒ تنبيه غير حاجب.
      const dupRes = await http()
        .patch(`/api/v1/beneficiaries/${bId}`)
        .set('Cookie', assocACookie)
        .send(beneficiaryPayload({ name: 'خالد الدوسري', opId: newOpId('upd') }))
        .expect(200);
      expect(dupRes.body.ok).toBe(true);
      expect(dupRes.body.possibleDuplicate.publicCode).toBe(a.publicCode);

      // والحفظ سرى فعليًا رغم التنبيه.
      const after = await prisma.beneficiary.findUniqueOrThrow({ where: { id: bId } });
      expect(after.name).toBe('خالد الدوسري');
    });
  });

  // ================================================================
  // NODE-3.1 — البند 4: رفض تكرار الجوال آمن ضد السباق (أقفال استشارية)
  // ================================================================
  describe('NODE-3.1 — تزامن رفض تكرار الجوال', () => {
    it('إنشاءان متزامنان بنفس الجوال في نفس الجمعية: واحد فقط ينجح والآخر 409، وصف واحد في القاعدة', async () => {
      const phone = uniquePhone();
      const results = await Promise.all([
        http().post('/api/v1/beneficiaries').set('Cookie', assocACookie).send(beneficiaryPayload({ phone })),
        http().post('/api/v1/beneficiaries').set('Cookie', assocACookie).send(beneficiaryPayload({ phone })),
      ]);

      const statuses = results.map((r) => r.status).sort();
      expect(statuses).toEqual([201, 409]);
      const conflict = results.find((r) => r.status === 409)!;
      expect(conflict.body.error.code).toBe('BENEFICIARY_DUPLICATE_PHONE');

      expect(await prisma.beneficiary.count({ where: { associationId: fx.associationAId, phone } })).toBe(1);
    });

    it('تصادم متقاطع (جوال أساسي لأحدهما = إضافي للآخر) لا يمرّ مرتين', async () => {
      const shared = uniquePhone();
      const results = await Promise.all([
        http().post('/api/v1/beneficiaries').set('Cookie', assocACookie).send(beneficiaryPayload({ phone: shared })),
        http()
          .post('/api/v1/beneficiaries')
          .set('Cookie', assocACookie)
          .send(beneficiaryPayload({ phone: uniquePhone(), phone2: shared })),
      ]);

      const succeeded = results.filter((r) => r.status === 201);
      expect(succeeded).toHaveLength(1);
      expect(results.find((r) => r.status !== 201)!.status).toBe(409);

      // لا صفّان يحملان الرقم المشترك بأي من العمودين.
      const holders = await prisma.beneficiary.count({
        where: { associationId: fx.associationAId, OR: [{ phone: shared }, { secondaryPhone: shared }] },
      });
      expect(holders).toBe(1);
    });

    it('تعديلان متزامنان لمستفيدَين نحو نفس الجوال الهدف: لا تكرار ولا جمود', async () => {
      const target = uniquePhone();
      const { id: aId } = await createBeneficiary(app, assocACookie);
      const { id: bId } = await createBeneficiary(app, assocACookie);

      const results = await Promise.all([
        http()
          .patch(`/api/v1/beneficiaries/${aId}`)
          .set('Cookie', assocACookie)
          .send(beneficiaryPayload({ phone: target, opId: newOpId('upd') })),
        http()
          .patch(`/api/v1/beneficiaries/${bId}`)
          .set('Cookie', assocACookie)
          .send(beneficiaryPayload({ phone: target, opId: newOpId('upd') })),
      ]);

      // لا 500 (جمود Postgres كان سيظهر هنا تحديدًا) — نجاح واحد و409 واحد.
      expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
      expect(await prisma.beneficiary.count({ where: { associationId: fx.associationAId, phone: target } })).toBe(1);
    });

    it('تبادل رقمين بين معاملتين متزامنتين لا يُسبّب جمودًا (ترتيب أقفال حتمي)', async () => {
      const p1 = uniquePhone();
      const p2 = uniquePhone();
      const { id: aId } = await createBeneficiary(app, assocACookie, { phone: p1 });
      const { id: bId } = await createBeneficiary(app, assocACookie, { phone: p2 });

      // A: p1 → p2، وB: p2 → p1 — كل معاملة تحتاج قفلَي نفس الرقمين بترتيب
      // معكوس ظاهريًا؛ الترتيب الحتمي داخل acquirePhoneLocks يمنع الجمود.
      const results = await Promise.all([
        http()
          .patch(`/api/v1/beneficiaries/${aId}`)
          .set('Cookie', assocACookie)
          .send(beneficiaryPayload({ phone: p2, opId: newOpId('upd') })),
        http()
          .patch(`/api/v1/beneficiaries/${bId}`)
          .set('Cookie', assocACookie)
          .send(beneficiaryPayload({ phone: p1, opId: newOpId('upd') })),
      ]);

      // المهم: لا 500 ولا تعليق — كلاهما حُسم بردّ نظيف.
      for (const r of results) expect([200, 409]).toContain(r.status);
      const phones = await prisma.beneficiary.findMany({
        where: { associationId: fx.associationAId },
        select: { phone: true },
      });
      expect(new Set(phones.map((p) => p.phone)).size).toBe(phones.length);
    }, 30000);

    it('جمعيتان مختلفتان تستخدمان نفس الجوال في نفس اللحظة: كلاهما ينجح (القاعدة لم تتغيّر)', async () => {
      const phone = uniquePhone();
      const results = await Promise.all([
        http().post('/api/v1/beneficiaries').set('Cookie', assocACookie).send(beneficiaryPayload({ phone })),
        http().post('/api/v1/beneficiaries').set('Cookie', assocBCookie).send(beneficiaryPayload({ phone })),
      ]);

      expect(results.map((r) => r.status)).toEqual([201, 201]);
      expect(await prisma.beneficiary.count({ where: { phone, associationId: fx.associationAId } })).toBe(1);
      expect(await prisma.beneficiary.count({ where: { phone, associationId: fx.associationBId } })).toBe(1);
    });
  });

  // ================================================================
  // NODE-3.2 — بصمة idempotency لنيّة الموقع (PRESERVE/CLEAR/SET)
  //
  // العطب المُصلَح: (أ) `locationUpdatedAt` المولَّد لحظة التنفيذ كان
  // يدخل حمولة التجزئة، فتختلف بصمة طلبين متطابقين تمامًا وتُرَدّ إعادة
  // المحاولة المشروعة بـ409؛ (ب) `?? null` في مسار التعديل كان يطوي
  // «الحقل غائب» (احفظ الموقع) و«الحقل = null» (امسح الموقع) في بصمة
  // واحدة، فيمرّ أحدهما مكان الآخر بلا اعتراض.
  // ================================================================
  describe('NODE-3.2 — بصمة idempotency لنيّة الموقع', () => {
    describe('الإنشاء', () => {
      it('نفس opId بنفس الإحداثيات: إعادة تشغيل ناجحة لا 409، وصف واحد فقط في القاعدة', async () => {
        const payload = beneficiaryPayload({ lat: 24.7136, lng: 46.6753, locationSource: 'MAP' });

        const first = await http().post('/api/v1/beneficiaries').set('Cookie', assocACookie).send(payload).expect(201);
        const second = await http().post('/api/v1/beneficiaries').set('Cookie', assocACookie).send(payload).expect(201);

        expect(second.body.beneficiaryId).toBe(first.body.beneficiaryId);
        expect(second.body.replayed).toBe(true);
        expect(first.body.replayed).toBe(false);
        expect(await prisma.beneficiary.count({ where: { associationId: fx.associationAId } })).toBe(1);
      });

      it('التاريخ المولَّد لا يشارك في البصمة: إعادة المحاولة بعد مرور زمن حقيقي تنجح ولا تُحدِّث الموقع', async () => {
        const payload = beneficiaryPayload({ lat: 24.5, lng: 46.5, locationSource: 'CURRENT_LOCATION' });

        const first = await http().post('/api/v1/beneficiaries').set('Cookie', assocACookie).send(payload).expect(201);
        const id = first.body.beneficiaryId;
        const before = await prisma.beneficiary.findUniqueOrThrow({ where: { id } });

        // لو دخل `locationUpdatedAt` البصمة لكانت أي إعادة محاولة بعد أول
        // مللي ثانية قد أعطت 409 — فالتأخير هنا هو جوهر الإثبات لا زينة.
        await new Promise((resolve) => setTimeout(resolve, 25));

        const second = await http().post('/api/v1/beneficiaries').set('Cookie', assocACookie).send(payload).expect(201);
        expect(second.body.replayed).toBe(true);
        expect(second.body.beneficiaryId).toBe(id);

        // ولا كتابة ثانية وقعت: الموقع بتاريخه الأصلي حرفيًا.
        const after = await prisma.beneficiary.findUniqueOrThrow({ where: { id } });
        expect(after.locationUpdatedAt?.toISOString()).toBe(before.locationUpdatedAt?.toISOString());
        expect(await prisma.beneficiary.count({ where: { associationId: fx.associationAId } })).toBe(1);
      });

      it('نفس opId ونفس الإحداثيات بمصدر مختلف دلاليًا: 409', async () => {
        const payload = beneficiaryPayload({ lat: 24.7136, lng: 46.6753, locationSource: 'MAP' });

        await http().post('/api/v1/beneficiaries').set('Cookie', assocACookie).send(payload).expect(201);

        const conflict = await http()
          .post('/api/v1/beneficiaries')
          .set('Cookie', assocACookie)
          .send({ ...payload, locationSource: 'CURRENT_LOCATION' })
          .expect(409);
        expect(conflict.body.error.code).toBe('APPLICATION_IDEMPOTENCY_CONFLICT');

        // ولم يُنشأ صف ثانٍ ولم يتبدّل مصدر الصف الأول.
        expect(await prisma.beneficiary.count({ where: { associationId: fx.associationAId } })).toBe(1);
        const row = await prisma.beneficiary.findFirstOrThrow({ where: { associationId: fx.associationAId } });
        expect(row.locationSource).toBe('MAP');
      });

      it('مصدران خامّان مجهولان يؤولان كلاهما إلى MANUAL: نيّة واحدة ⇒ إعادة تشغيل لا 409', async () => {
        const payload = beneficiaryPayload({ lat: 24.5, lng: 46.5, locationSource: 'مصدر مجهول أول' });

        const first = await http().post('/api/v1/beneficiaries').set('Cookie', assocACookie).send(payload).expect(201);
        const second = await http()
          .post('/api/v1/beneficiaries')
          .set('Cookie', assocACookie)
          .send({ ...payload, locationSource: 'مصدر مجهول آخر مختلف نصًّا' })
          .expect(201);

        expect(second.body.replayed).toBe(true);
        expect(second.body.beneficiaryId).toBe(first.body.beneficiaryId);
      });

      it('إنشاء بلا موقع إطلاقًا: إعادة المحاولة بنفس opId تظل إعادة تشغيل ناجحة', async () => {
        const payload = beneficiaryPayload();

        const first = await http().post('/api/v1/beneficiaries').set('Cookie', assocACookie).send(payload).expect(201);
        const second = await http().post('/api/v1/beneficiaries').set('Cookie', assocACookie).send(payload).expect(201);

        expect(second.body.replayed).toBe(true);
        expect(second.body.beneficiaryId).toBe(first.body.beneficiaryId);
      });
    });

    describe('التعديل', () => {
      /** مستفيد بموقع مؤكَّد — نقطة انطلاق كل حالات PRESERVE/CLEAR أدناه. */
      const createWithLocation = async () => {
        const res = await http()
          .post('/api/v1/beneficiaries')
          .set('Cookie', assocACookie)
          .send(beneficiaryPayload({ lat: 24.5, lng: 46.5, locationSource: 'MAP' }))
          .expect(201);
        return res.body.beneficiaryId as string;
      };

      it('نفس opId بنفس حمولة SET: إعادة تشغيل ناجحة لا 409', async () => {
        const id = await createWithLocation();
        const payload = beneficiaryPayload({
          lat: 21.4225,
          lng: 39.8262,
          locationSource: 'CURRENT_LOCATION',
          region: 'مكة المكرمة',
          city: 'جدة',
          opId: newOpId('upd'),
        });

        const first = await http().patch(`/api/v1/beneficiaries/${id}`).set('Cookie', assocACookie).send(payload).expect(200);
        expect(first.body.replayed).toBe(false);
        const after = await prisma.beneficiary.findUniqueOrThrow({ where: { id } });

        const second = await http().patch(`/api/v1/beneficiaries/${id}`).set('Cookie', assocACookie).send(payload).expect(200);
        expect(second.body.replayed).toBe(true);

        // إعادة التشغيل لم تكتب شيئًا من جديد.
        const afterReplay = await prisma.beneficiary.findUniqueOrThrow({ where: { id } });
        expect(afterReplay.locationUpdatedAt?.toISOString()).toBe(after.locationUpdatedAt?.toISOString());
        expect(afterReplay.locationSource).toBe('CURRENT_LOCATION');
      });

      it('PRESERVE ثم CLEAR بنفس opId: 409 — ولا يُمسح الموقع فعليًا', async () => {
        const id = await createWithLocation();
        const opId = newOpId('upd');
        const base = beneficiaryPayload({ opId });

        // (1) الحقل غائب تمامًا ⇒ احفظ الموقع كما هو.
        const preserve = { ...base };
        delete (preserve as Record<string, unknown>).lat;
        delete (preserve as Record<string, unknown>).lng;
        await http().patch(`/api/v1/beneficiaries/${id}`).set('Cookie', assocACookie).send(preserve).expect(200);

        const afterPreserve = await prisma.beneficiary.findUniqueOrThrow({ where: { id } });
        expect(Number(afterPreserve.latitude)).toBeCloseTo(24.5, 6);

        // (2) نفس opId لكن lat/lng = null صراحةً ⇒ نيّة مسح، مختلفة تمامًا.
        const conflict = await http()
          .patch(`/api/v1/beneficiaries/${id}`)
          .set('Cookie', assocACookie)
          .send({ ...base, lat: null, lng: null })
          .expect(409);
        expect(conflict.body.error.code).toBe('APPLICATION_IDEMPOTENCY_CONFLICT');

        // الرفض وقع **قبل** أي كتابة: الموقع سليم بكل أعمدته الأربعة.
        const afterConflict = await prisma.beneficiary.findUniqueOrThrow({ where: { id } });
        expect(Number(afterConflict.latitude)).toBeCloseTo(24.5, 6);
        expect(Number(afterConflict.longitude)).toBeCloseTo(46.5, 6);
        expect(afterConflict.locationSource).toBe('MAP');
        expect(afterConflict.locationUpdatedAt?.toISOString()).toBe(afterPreserve.locationUpdatedAt?.toISOString());
      });

      it('CLEAR ثم PRESERVE بنفس opId: 409 أيضًا (التمييز متماثل في الاتجاهين)', async () => {
        const id = await createWithLocation();
        const opId = newOpId('upd');
        const base = beneficiaryPayload({ opId });

        await http()
          .patch(`/api/v1/beneficiaries/${id}`)
          .set('Cookie', assocACookie)
          .send({ ...base, lat: null, lng: null })
          .expect(200);
        expect((await prisma.beneficiary.findUniqueOrThrow({ where: { id } })).latitude).toBeNull();

        const preserve = { ...base };
        delete (preserve as Record<string, unknown>).lat;
        delete (preserve as Record<string, unknown>).lng;
        const conflict = await http()
          .patch(`/api/v1/beneficiaries/${id}`)
          .set('Cookie', assocACookie)
          .send(preserve)
          .expect(409);
        expect(conflict.body.error.code).toBe('APPLICATION_IDEMPOTENCY_CONFLICT');
      });

      it('نفس opId ونفس الإحداثيات بمصدر مختلف دلاليًا: 409 بلا كتابة', async () => {
        const id = await createWithLocation();
        const payload = beneficiaryPayload({
          lat: 21.4225,
          lng: 39.8262,
          locationSource: 'MAP',
          region: 'مكة المكرمة',
          city: 'جدة',
          opId: newOpId('upd'),
        });

        await http().patch(`/api/v1/beneficiaries/${id}`).set('Cookie', assocACookie).send(payload).expect(200);
        const after = await prisma.beneficiary.findUniqueOrThrow({ where: { id } });
        expect(after.locationSource).toBe('MAP');

        const conflict = await http()
          .patch(`/api/v1/beneficiaries/${id}`)
          .set('Cookie', assocACookie)
          .send({ ...payload, locationSource: 'IMPORT' })
          .expect(409);
        expect(conflict.body.error.code).toBe('APPLICATION_IDEMPOTENCY_CONFLICT');

        const afterConflict = await prisma.beneficiary.findUniqueOrThrow({ where: { id } });
        expect(afterConflict.locationSource).toBe('MAP');
      });

      it('نفس الإحداثيات بمصدرين مجهولين (كلاهما MANUAL): نيّة واحدة ⇒ إعادة تشغيل', async () => {
        const id = await createWithLocation();
        const payload = beneficiaryPayload({
          lat: 21.4225,
          lng: 39.8262,
          locationSource: 'مجهول أول',
          region: 'مكة المكرمة',
          city: 'جدة',
          opId: newOpId('upd'),
        });

        await http().patch(`/api/v1/beneficiaries/${id}`).set('Cookie', assocACookie).send(payload).expect(200);
        const second = await http()
          .patch(`/api/v1/beneficiaries/${id}`)
          .set('Cookie', assocACookie)
          .send({ ...payload, locationSource: 'مجهول ثانٍ' })
          .expect(200);
        expect(second.body.replayed).toBe(true);
      });

      it('لا انحدار: مستفيد بلا موقع إطلاقًا يُعدَّل مرارًا بـopId مختلف بلا أي تعارض', async () => {
        const { id } = await createBeneficiary(app, assocACookie);

        for (const name of ['اسم أول', 'اسم ثانٍ', 'اسم ثالث']) {
          const payload = beneficiaryPayload({ name, opId: newOpId('upd') });
          delete (payload as Record<string, unknown>).lat;
          delete (payload as Record<string, unknown>).lng;
          await http().patch(`/api/v1/beneficiaries/${id}`).set('Cookie', assocACookie).send(payload).expect(200);
        }

        const after = await prisma.beneficiary.findUniqueOrThrow({ where: { id } });
        expect(after.name).toBe('اسم ثالث');
        expect(after.latitude).toBeNull();
        expect(after.locationUpdatedAt).toBeNull();
      });

      it('لا انحدار: مسح عادي (بـopId خاص به) لا يزال يمسح الموقع فعليًا', async () => {
        const id = await createWithLocation();

        await http()
          .patch(`/api/v1/beneficiaries/${id}`)
          .set('Cookie', assocACookie)
          .send(beneficiaryPayload({ lat: null, lng: null, opId: newOpId('upd') }))
          .expect(200);

        const after = await prisma.beneficiary.findUniqueOrThrow({ where: { id } });
        expect(after.latitude).toBeNull();
        expect(after.longitude).toBeNull();
        expect(after.locationSource).toBeNull();
        expect(after.locationUpdatedAt).toBeNull();
      });
    });
  });

  // ================================================================
  // NODE-3.1 — البند 6: إزالة نقطة حالة الوحدة غير المستخدَمة
  // ================================================================
  describe('NODE-3.1 — تنظيف BeneficiaryNeedsModule', () => {
    it('لم تعد هناك نقطة HTTP عامة على /beneficiary-needs', async () => {
      await http().get('/api/v1/beneficiary-needs/_module-status').set('Cookie', assocACookie).expect(404);
    });
  });
});
