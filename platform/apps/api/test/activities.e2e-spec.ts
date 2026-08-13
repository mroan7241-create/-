import request from 'supertest';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import { prisma } from '@alzad/db';
import { AppModule } from '../src/app.module';
import { HttpExceptionFilter } from '../src/common/http-exception.filter';
import { EmailService } from '../src/modules/auth/email/email.service';
import { FakeEmailService } from '../src/modules/auth/email/fake-email.service';
import { cleanAuthState, seedTestFixtures } from './utils/fixtures';
import { loginAs } from './utils/node2-fixtures';

jest.setTimeout(60000);

/**
 * NODE-7 — متابعة الأنشطة + سجل العمليات (تكامل حقيقي).
 * الأنشطة كيان عالمي غير مرتبط بجمعية (يوازي getActivitiesBundle/
 * saveActivity القديمتين) — العزل هنا بادئة اسم فريدة (ACT-E2E-) بدل
 * associationId، وتُنظَّف بها حصرًا حتى لا تمسّ بيانات اختبارات أخرى.
 */
describe('NODE-7 — الأنشطة وسجل العمليات (تكامل حقيقي)', () => {
  let app: INestApplication;
  let base: Awaited<ReturnType<typeof seedTestFixtures>>;
  let adminCookie: string;
  let assocCookie: string;
  let delegateCookie: string;

  beforeAll(async () => {
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
  }, 60000);

  beforeEach(async () => {
    await prisma.activity.deleteMany({ where: { mainActivityName: { startsWith: 'ACT-E2E-' } } });
    await cleanAuthState();
    adminCookie = await loginAs(app, base.adminEmail, base.adminPassword);
    assocCookie = await loginAs(app, base.assocEmail, base.assocPassword);
    const delegateLoginRes = await request(app.getHttpServer()).post('/api/v1/auth/login').send({ type: 'delegate', code: base.delegateCode });
    if (delegateLoginRes.status !== 200) throw new Error(`delegate login failed: ${delegateLoginRes.status} ${JSON.stringify(delegateLoginRes.body)}`);
    delegateCookie = delegateLoginRes.headers['set-cookie'][0].split(';')[0];
  });

  afterAll(async () => {
    await prisma.activity.deleteMany({ where: { mainActivityName: { startsWith: 'ACT-E2E-' } } });
    await app.close();
  });

  const http = () => request(app.getHttpServer());

  it('ADMIN ينشئ نشاطًا ← يظهر في القائمة لِADMIN وASSOCIATION ← سجل تدقيق يوثِّق الإنشاء', async () => {
    const createRes = await http()
      .post('/api/v1/activities')
      .set('Cookie', adminCookie)
      .send({ phaseOrder: 1, phaseName: 'مرحلة تجريبية', mainActivityOrder: 1, mainActivityName: 'ACT-E2E-إنشاء', status: 'NOT_STARTED' });
    expect(createRes.status).toBe(201);
    const activityId = createRes.body.activityId as string;
    expect(activityId).toBeTruthy();

    const adminList = await http().get('/api/v1/activities').set('Cookie', adminCookie);
    expect(adminList.status).toBe(200);
    expect(adminList.body.map((a: { id: string }) => a.id)).toContain(activityId);

    const assocList = await http().get('/api/v1/activities').set('Cookie', assocCookie);
    expect(assocList.status).toBe(200);
    expect(assocList.body.map((a: { id: string }) => a.id)).toContain(activityId);

    const auditRes = await http().get('/api/v1/audit').set('Cookie', adminCookie).query({ entityType: 'activities', entityId: activityId });
    expect(auditRes.status).toBe(200);
    expect(auditRes.body.items.some((e: { action: string }) => e.action === 'ACTIVITY_CREATED')).toBe(true);
  });

  it('ADMIN يعدِّل نشاطًا موجودًا عبر id ← تحديث فعلي لا تكرار ← سجل تدقيق يوثِّق التعديل', async () => {
    const createRes = await http()
      .post('/api/v1/activities')
      .set('Cookie', adminCookie)
      .send({ phaseOrder: 1, phaseName: 'مرحلة', mainActivityOrder: 1, mainActivityName: 'ACT-E2E-تعديل', status: 'NOT_STARTED' });
    const activityId = createRes.body.activityId as string;

    const updateRes = await http()
      .post('/api/v1/activities')
      .set('Cookie', adminCookie)
      .send({ id: activityId, phaseOrder: 1, phaseName: 'مرحلة', mainActivityOrder: 1, mainActivityName: 'ACT-E2E-تعديل', status: 'IN_PROGRESS', completionPercent: 40 });
    expect(updateRes.status).toBe(201);
    expect(updateRes.body.activityId).toBe(activityId);

    const row = await prisma.activity.findUniqueOrThrow({ where: { id: activityId } });
    expect(row.status).toBe('IN_PROGRESS');
    expect(Number(row.completionPercent)).toBe(40);

    const count = await prisma.activity.count({ where: { mainActivityName: 'ACT-E2E-تعديل' } });
    expect(count).toBe(1); // تعديل، لا إنشاء صف إضافي

    const auditRes = await http().get('/api/v1/audit').set('Cookie', adminCookie).query({ entityType: 'activities', entityId: activityId });
    expect(auditRes.body.items.map((e: { action: string }) => e.action)).toEqual(expect.arrayContaining(['ACTIVITY_CREATED', 'ACTIVITY_UPDATED']));
  });

  it('ASSOCIATION وDELEGATE ممنوعان من إنشاء/تعديل الأنشطة (ADMIN فقط)', async () => {
    const payload = { phaseOrder: 1, phaseName: 'مرحلة', mainActivityOrder: 1, mainActivityName: 'ACT-E2E-ممنوع', status: 'NOT_STARTED' };
    const assocRes = await http().post('/api/v1/activities').set('Cookie', assocCookie).send(payload);
    expect(assocRes.status).toBe(403);

    const delegateRes = await http().post('/api/v1/activities').set('Cookie', delegateCookie).send(payload);
    expect(delegateRes.status).toBe(403);
  });

  it('DELEGATE ممنوع من قراءة قائمة الأنشطة (خارج نطاقه)', async () => {
    const res = await http().get('/api/v1/activities').set('Cookie', delegateCookie);
    expect(res.status).toBe(403);
  });

  it('سجل التدقيق: DELEGATE يرى فقط إجراءاته المرئية المحدَّدة، لا ACTIVITY_CREATED', async () => {
    await http()
      .post('/api/v1/activities')
      .set('Cookie', adminCookie)
      .send({ phaseOrder: 1, phaseName: 'مرحلة', mainActivityOrder: 1, mainActivityName: 'ACT-E2E-نطاق-مندوب', status: 'NOT_STARTED' });

    const res = await http().get('/api/v1/audit').set('Cookie', delegateCookie);
    expect(res.status).toBe(200);
    expect(res.body.items.every((e: { action: string }) => e.action !== 'ACTIVITY_CREATED')).toBe(true);
  });
});
