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
