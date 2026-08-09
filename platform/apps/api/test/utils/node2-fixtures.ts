import request from 'supertest';
import type { INestApplication } from '@nestjs/common';
import { prisma } from '@alzad/db';
import { LEGACY_APPLICATION_QUESTIONS } from '@alzad/shared';

/**
 * أدوات اختبار NODE-2 فقط — ملف مستقل عمدًا حتى لا نمسّ
 * `test/utils/fixtures.ts` الخاص بِNODE-1 (اختبارات NODE-1 يجب أن تبقى
 * كما اعتُمدت، بلا أي تعديل).
 */

/** كل جمعية/طلب تُنشئه اختبارات NODE-2 يحمل هذه العلامة في الاسم — تجعل التنظيف دقيقًا ولا يمسّ بذور seed. */
export const NODE2_MARKER = 'NODE2E2E';

// ————————————————————————————————————————————————
// صور اختبار صغيرة حقيقية (magic bytes صحيحة فعلًا)
// ————————————————————————————————————————————————
export const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

export const JPEG_1X1 = Buffer.from(
  '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==',
  'base64',
);

export const WEBP_1X1 = Buffer.from('UklGRhoAAABXRUJQVlA4TA0AAAAvAAAAEAcQERGIiP4HAA==', 'base64');

/** ليست صورة إطلاقًا — لا magic bytes معروفة. */
export const NOT_AN_IMAGE = Buffer.from('%PDF-1.7\n%not an image at all\n', 'utf8');

/** أكبر من 8 MiB بايت واحد — يبدأ بتوقيع PNG صحيح حتى يكون الرفض بسبب الحجم حصرًا. */
export function oversizedImage(): Buffer {
  const size = 8 * 1024 * 1024 + 1;
  const buffer = Buffer.alloc(size, 0x41);
  PNG_1X1.subarray(0, 8).copy(buffer, 0);
  return buffer;
}

// ————————————————————————————————————————————————
// بناء حمولة طلب انضمام صالحة
// ————————————————————————————————————————————————
export const ALL_YES_ANSWERS: Record<string, boolean> = Object.fromEntries(
  LEGACY_APPLICATION_QUESTIONS.map((q) => [q.key, true]),
);

let counter = 0;
export function uniqueSuffix(): string {
  counter += 1;
  return `${Date.now().toString(36)}${counter.toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
}

export function newClientRequestId(): string {
  return `crid-${uniqueSuffix()}`.slice(0, 64).padEnd(12, '0');
}

export interface ApplicationPayload {
  clientRequestId: string;
  name: string;
  category: string;
  sector: string;
  region: string;
  city: string;
  phone: string;
  email: string;
  contactName: string;
  notes?: string;
  licenseNumber: string;
  licenseExpiryDate: string;
  answers: Record<string, boolean>;
  pledgeAccepted: string;
  website?: string;
}

/** حمولة صالحة بالكامل مقابل البيانات المرجعية المبذورة فعلًا (الرياض/الرياض، جمعية خيرية، رعاية الأيتام). */
export function validApplicationPayload(overrides: Partial<ApplicationPayload> = {}): ApplicationPayload {
  const suffix = uniqueSuffix();
  const phoneTail = String(Math.floor(Math.random() * 100000000)).padStart(8, '0');
  return {
    clientRequestId: newClientRequestId(),
    name: `${NODE2_MARKER} جمعية ${suffix}`,
    category: 'جمعية خيرية',
    sector: 'رعاية الأيتام',
    region: 'الرياض',
    city: 'الرياض',
    phone: `05${phoneTail}`,
    email: `applicant-${suffix}@example.org`,
    contactName: 'مسؤول الاختبار',
    notes: 'ملاحظات اختبارية',
    licenseNumber: `LIC-${suffix}`,
    licenseExpiryDate: '2030-12-31',
    answers: ALL_YES_ANSWERS,
    pledgeAccepted: 'true',
    ...overrides,
  };
}

export interface SubmitOptions {
  file?: Buffer | null;
  filename?: string;
  contentType?: string;
}

/** يُرسل الطلب فعليًا كـmultipart/form-data عبر الـendpoint الحقيقي. */
export function submitApplication(app: INestApplication, payload: ApplicationPayload, options: SubmitOptions = {}) {
  const req = request(app.getHttpServer()).post('/api/v1/association-applications');
  for (const [key, value] of Object.entries(payload)) {
    if (value === undefined) continue;
    req.field(key, key === 'answers' ? JSON.stringify(value) : String(value));
  }
  const file = options.file === undefined ? PNG_1X1 : options.file;
  if (file) {
    req.attach('licenseFile', file, {
      filename: options.filename ?? 'license.png',
      contentType: options.contentType ?? 'image/png',
    });
  }
  return req;
}

// ————————————————————————————————————————————————
// جلسات
// ————————————————————————————————————————————————
export async function loginAs(app: INestApplication, email: string, password: string): Promise<string> {
  const res = await request(app.getHttpServer()).post('/api/v1/auth/login').send({ type: 'user', email, password });
  if (res.status !== 200) throw new Error(`login failed for ${email}: ${res.status} ${JSON.stringify(res.body)}`);
  const raw = res.headers['set-cookie'] as unknown as string[];
  return raw[0].split(';')[0];
}

export async function loginAsDelegate(app: INestApplication, code: string): Promise<string> {
  const res = await request(app.getHttpServer()).post('/api/v1/auth/login').send({ type: 'delegate', code });
  if (res.status !== 200) throw new Error(`delegate login failed: ${res.status} ${JSON.stringify(res.body)}`);
  const raw = res.headers['set-cookie'] as unknown as string[];
  return raw[0].split(';')[0];
}

// ————————————————————————————————————————————————
// تنظيف حالة NODE-2 بين الاختبارات
// ————————————————————————————————————————————————
/**
 * يحذف كل ما تُنشئه اختبارات NODE-2 (طلبات/إجابات/ملفات/idempotency)
 * والجمعيات+الحسابات الناتجة عنها (المميَّزة بـNODE2_MARKER في الاسم
 * فقط — لا يمسّ بذور seed ولا حسابات NODE-1 الثابتة).
 */
export async function cleanNode2State(): Promise<void> {
  await prisma.applicationAnswer.deleteMany({});
  await prisma.associationApplication.deleteMany({});
  await prisma.idempotencyKey.deleteMany({});
  await prisma.fileObject.deleteMany({});

  const associations = await prisma.association.findMany({
    where: { name: { contains: NODE2_MARKER } },
    select: { id: true },
  });
  const associationIds = associations.map((a) => a.id);
  if (associationIds.length > 0) {
    const accounts = await prisma.account.findMany({ where: { associationId: { in: associationIds } }, select: { id: true } });
    const accountIds = accounts.map((a) => a.id);
    if (accountIds.length > 0) {
      await prisma.authSession.deleteMany({ where: { accountId: { in: accountIds } } });
      await prisma.passwordResetToken.deleteMany({ where: { accountId: { in: accountIds } } });
      await prisma.auditLog.deleteMany({ where: { actorAccountId: { in: accountIds } } });
      await prisma.authCredential.deleteMany({ where: { accountId: { in: accountIds } } });
      await prisma.account.deleteMany({ where: { id: { in: accountIds } } });
    }
    await prisma.association.deleteMany({ where: { id: { in: associationIds } } });
  }
}
