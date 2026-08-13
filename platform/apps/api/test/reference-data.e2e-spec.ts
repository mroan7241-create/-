import request from 'supertest';
import { INestApplication } from '@nestjs/common';
import { createTestApp } from './utils/bootstrap';
import { prisma, seedReferenceData } from '@alzad/db';
import {
  LEGACY_REGIONS_CITIES,
  LEGACY_DEVICE_TYPES,
  LEGACY_SOCIAL_STATUSES,
  LEGACY_ASSOCIATION_CATEGORIES,
  LEGACY_ASSOCIATION_SECTORS,
  LEGACY_DIFFERENCE_REASONS,
  LEGACY_RECEIVER_TITLES,
} from '@alzad/shared';
import { cleanAuthState, seedTestFixtures } from './utils/fixtures';
import { loginAs } from './utils/node2-fixtures';
import { newOpId } from './utils/node3-fixtures';

describe('Reference data — GET /reference-values (NODE-1)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    ({ app } = await createTestApp());
    // تأكد من أن الجدول مبذور (idempotent) قبل هذه المجموعة تحديدًا.
    await seedReferenceData(prisma);
  });

  afterAll(async () => {
    await app.close();
  });

  const http = () => request(app.getHttpServer());

  // 24) reference endpoint is public — no session required
  it('GET /reference-values عام تمامًا — يعمل بلا أي كوكي جلسة', async () => {
    const res = await http().get('/api/v1/reference-values');
    expect(res.status).toBe(200);
    expect(res.body.ready).toBe(true);
    expect(res.body.source).toBe('db');
  });

  // 27) response contains all legacy groups
  it('الاستجابة تحوي كل مجموعات البيانات المرجعية القديمة', async () => {
    const res = await http().get('/api/v1/reference-values');
    const body = res.body;
    for (const key of [
      'regions',
      'citiesByRegion',
      'deviceTypes',
      'socialStatuses',
      'associationCategories',
      'associationSectors',
      'deviceSpecsByType',
      'suppliers',
      'differenceReasons',
      'receiverTitles',
      'applicationQuestions',
      'pledgeText',
    ]) {
      expect(body).toHaveProperty(key);
    }
  });

  it('regions/deviceTypes/socialStatuses/associationCategories/associationSectors/differenceReasons/receiverTitles تحوي كل قيم Legacy (superset — قاعدة بيانات التطوير المشتركة قد تحوي صفوفًا إضافية من اختبارات أخرى)', async () => {
    const res = await http().get('/api/v1/reference-values');
    const containsAll = (actual: string[], expected: string[]) => expected.every((v) => actual.includes(v));
    expect(containsAll(res.body.regions, Object.keys(LEGACY_REGIONS_CITIES))).toBe(true);
    expect(containsAll(res.body.deviceTypes, LEGACY_DEVICE_TYPES)).toBe(true);
    expect(containsAll(res.body.socialStatuses, LEGACY_SOCIAL_STATUSES)).toBe(true);
    expect(containsAll(res.body.associationCategories, LEGACY_ASSOCIATION_CATEGORIES)).toBe(true);
    expect(containsAll(res.body.associationSectors, LEGACY_ASSOCIATION_SECTORS)).toBe(true);
    expect(containsAll(res.body.differenceReasons, LEGACY_DIFFERENCE_REASONS)).toBe(true);
    expect(containsAll(res.body.receiverTitles, LEGACY_RECEIVER_TITLES)).toBe(true);
  });

  // 26) root/child reference integrity still passes
  it('كل مدينة في citiesByRegion تنتمي لمنطقة موجودة فعليًا في regions (سلامة الأب/الابن)', async () => {
    const res = await http().get('/api/v1/reference-values');
    const regions: string[] = res.body.regions;
    for (const region of Object.keys(res.body.citiesByRegion)) {
      expect(regions).toContain(region);
    }
    for (const [region, cities] of Object.entries(LEGACY_REGIONS_CITIES)) {
      expect(new Set(res.body.citiesByRegion[region])).toEqual(new Set(cities as string[]));
    }
  });

  it('deviceSpecsByType يحوي فقط أنواع الأجهزة التشغيلية الثلاثة (ثلاجة/فرن/غسالة) — لا يتّسع لكامل كتالوج deviceTypes التاريخي', async () => {
    const res = await http().get('/api/v1/reference-values');
    const specKeys = Object.keys(res.body.deviceSpecsByType);
    for (const key of specKeys) {
      expect(['ثلاجة', 'فرن', 'غسالة']).toContain(key);
    }
  });

  // 25) duplicate reference seed not created — running the seed again inserts 0 new rows
  it('إعادة تشغيل seedReferenceData لا تُنشئ أي تكرار (idempotent)', async () => {
    const before = await prisma.referenceValue.count();
    const result = await seedReferenceData(prisma);
    const after = await prisma.referenceValue.count();
    expect(result.inserted).toBe(0);
    expect(after).toBe(before);
  });

  it('applicationQuestions وpledgeText يُعادان دائمًا حتى مع بيانات مرجعية موجودة', async () => {
    const res = await http().get('/api/v1/reference-values');
    expect(Array.isArray(res.body.applicationQuestions)).toBe(true);
    expect(res.body.applicationQuestions.length).toBeGreaterThan(0);
    expect(typeof res.body.pledgeText).toBe('string');
    expect(res.body.pledgeText.length).toBeGreaterThan(0);
  });
});

/** REF-008 — POST /reference-values (تكامل حقيقي). كل قيمة اختبار تحمل بادئة REF-E2E- فريدة تُنظَّف بها حصرًا. */
describe('REF-008 — إضافة قيمة مرجعية (تكامل حقيقي)', () => {
  let app: INestApplication;
  let base: Awaited<ReturnType<typeof seedTestFixtures>>;
  let adminCookie: string;
  let assocCookie: string;

  beforeAll(async () => {
    ({ app } = await createTestApp());
    await seedReferenceData(prisma);
    base = await seedTestFixtures();
  }, 60000);

  beforeEach(async () => {
    await prisma.referenceValue.deleteMany({ where: { value: { startsWith: 'REF-E2E-' } } });
    await cleanAuthState();
    adminCookie = await loginAs(app, base.adminEmail, base.adminPassword);
    assocCookie = await loginAs(app, base.assocEmail, base.assocPassword);
  });

  afterAll(async () => {
    await prisma.referenceValue.deleteMany({ where: { value: { startsWith: 'REF-E2E-' } } });
    await app.close();
  });

  const http = () => request(app.getHttpServer());

  it('ADMIN يضيف قيمة جذر (لا أب) ← تظهر فورًا في GET /reference-values', async () => {
    const res = await http().post('/api/v1/reference-values').set('Cookie', adminCookie).send({ type: 'SUPPLIER', value: 'REF-E2E-مورد', opId: newOpId('ref') });
    expect(res.status).toBe(201);
    expect(res.body.value).toBe('REF-E2E-مورد');

    const list = await http().get('/api/v1/reference-values');
    expect(list.body.suppliers).toContain('REF-E2E-مورد');
  });

  it('ADMIN يضيف مدينة تابعة لمنطقة موجودة ← تظهر تحت تلك المنطقة في citiesByRegion', async () => {
    const res = await http()
      .post('/api/v1/reference-values')
      .set('Cookie', adminCookie)
      .send({ type: 'CITY', value: 'REF-E2E-مدينة', parentValue: 'الرياض', opId: newOpId('ref') });
    expect(res.status).toBe(201);

    const list = await http().get('/api/v1/reference-values');
    expect(list.body.citiesByRegion['الرياض']).toContain('REF-E2E-مدينة');
  });

  it('CITY بلا parentValue يُرفَض 400، وSUPPLIER مع parentValue يُرفَض 400 (النوع لا يقبل أبًا)', async () => {
    const noParent = await http().post('/api/v1/reference-values').set('Cookie', adminCookie).send({ type: 'CITY', value: 'REF-E2E-بلا-أب', opId: newOpId('ref') });
    expect(noParent.status).toBe(400);

    const badParent = await http()
      .post('/api/v1/reference-values')
      .set('Cookie', adminCookie)
      .send({ type: 'SUPPLIER', value: 'REF-E2E-مورد2', parentValue: 'شيء', opId: newOpId('ref') });
    expect(badParent.status).toBe(400);
  });

  it('أب غير موجود يُرفَض 400', async () => {
    const res = await http()
      .post('/api/v1/reference-values')
      .set('Cookie', adminCookie)
      .send({ type: 'CITY', value: 'REF-E2E-مدينة2', parentValue: 'REF-E2E-منطقة-غير-موجودة', opId: newOpId('ref') });
    expect(res.status).toBe(400);
  });

  it('قيمة مكرَّرة لنفس (type, parent) تُرفَض 409', async () => {
    const opId = newOpId('ref');
    const first = await http().post('/api/v1/reference-values').set('Cookie', adminCookie).send({ type: 'SUPPLIER', value: 'REF-E2E-مكرر', opId });
    expect(first.status).toBe(201);

    const dup = await http().post('/api/v1/reference-values').set('Cookie', adminCookie).send({ type: 'SUPPLIER', value: 'REF-E2E-مكرر', opId: newOpId('ref') });
    expect(dup.status).toBe(409);
  });

  it('ASSOCIATION ممنوع من الإضافة (ADMIN فقط)', async () => {
    const res = await http().post('/api/v1/reference-values').set('Cookie', assocCookie).send({ type: 'SUPPLIER', value: 'REF-E2E-ممنوع', opId: newOpId('ref') });
    expect(res.status).toBe(403);
  });
});
