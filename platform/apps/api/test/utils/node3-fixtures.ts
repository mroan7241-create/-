import request from 'supertest';
import type { INestApplication } from '@nestjs/common';
import {
  prisma,
  AccountRole,
  AccountStatus,
  AssociationStatus,
  AuthCredentialType,
  DeviceType,
} from '@alzad/db';
import * as argon2 from 'argon2';
import { uniqueSuffix } from './node2-fixtures';

/**
 * أدوات اختبار NODE-3 فقط — ملف مستقل عمدًا، بنفس مبدأ `node2-fixtures.ts`:
 * اختبارات NODE-1/NODE-2 تبقى كما اعتُمدت بلا أي تعديل على ملفاتها.
 */
export const NODE3_MARKER = 'NODE3E2E';

/**
 * جمعية ثانية مستقلة — أساس كل اختبارات عزل المستأجرين (tenant isolation)
 * واختبارات تجميع إشارة التخصيص لأكثر من جمعية.
 */
export interface Node3Fixtures {
  associationAId: string;
  associationBId: string;
  assocAEmail: string;
  assocAPassword: string;
  assocBEmail: string;
  assocBPassword: string;
}

export async function seedNode3Fixtures(): Promise<Node3Fixtures> {
  const associationA = await upsertAssociation('E2E3-ASC-A', `جمعية ${NODE3_MARKER} أ`, '0511000001');
  const associationB = await upsertAssociation('E2E3-ASC-B', `جمعية ${NODE3_MARKER} ب`, '0511000002');

  const assocAEmail = 'e2e3-assoc-a@example.org';
  const assocAPassword = 'E2e3AssocAPass123';
  await upsertAssociationAccount('E2E3-USR-A', assocAEmail, assocAPassword, associationA.id);

  const assocBEmail = 'e2e3-assoc-b@example.org';
  const assocBPassword = 'E2e3AssocBPass123';
  await upsertAssociationAccount('E2E3-USR-B', assocBEmail, assocBPassword, associationB.id);

  return {
    associationAId: associationA.id,
    associationBId: associationB.id,
    assocAEmail,
    assocAPassword,
    assocBEmail,
    assocBPassword,
  };
}

async function upsertAssociation(publicCode: string, name: string, phone: string) {
  return prisma.association.upsert({
    where: { publicCode },
    update: { status: AssociationStatus.ACTIVE },
    create: {
      publicCode,
      name,
      category: 'جمعية خيرية',
      region: 'الرياض',
      city: 'الرياض',
      phones: [phone],
      status: AssociationStatus.ACTIVE,
    },
  });
}

async function upsertAssociationAccount(publicCode: string, email: string, password: string, associationId: string) {
  const secretHash = await argon2.hash(password, { type: argon2.argon2id });
  const account = await prisma.account.upsert({
    where: { publicCode },
    update: { status: AccountStatus.ACTIVE, associationId, mustChangePassword: false },
    create: {
      publicCode,
      name: `حساب ${NODE3_MARKER} ${publicCode}`,
      email,
      role: AccountRole.ASSOCIATION,
      associationId,
      status: AccountStatus.ACTIVE,
      mustChangePassword: false,
    },
  });
  await prisma.authCredential.upsert({
    where: { type_identifier: { type: AuthCredentialType.EMAIL_PASSWORD, identifier: email } },
    update: { secretHash, accountId: account.id },
    create: { accountId: account.id, type: AuthCredentialType.EMAIL_PASSWORD, identifier: email, secretHash },
  });
  return account;
}

/**
 * ينظّف كل ما تُنشئه اختبارات NODE-3 — المستفيدون واحتياجاتهم ومفاتيح
 * الـidempotency وسجلات التدقيق. لا يمسّ الجمعيات/الحسابات الثابتة أعلاه
 * (تُعاد صناعتها عبر upsert) ولا أي بذرة seed.
 */
export async function cleanNode3State(): Promise<void> {
  // مقصور على جمعيتَي NODE-3 وحدهما — لا يمسّ بذور seed إطلاقًا (نفس مبدأ
  // `cleanNode2State`). حذف كل المستفيدين/الاحتياجات بلا تحديد نطاق كان
  // يصطدم فعليًا بـ`device_allocations_beneficiary_need_id_..._fkey` لأن
  // بذرة التطوير تُنشئ تخصيصات تشير إلى احتياجات مبذورة.
  const associations = await prisma.association.findMany({
    where: { publicCode: { in: ['E2E3-ASC-A', 'E2E3-ASC-B'] } },
    select: { id: true },
  });
  const associationIds = associations.map((a) => a.id);
  if (associationIds.length > 0) {
    await prisma.beneficiaryNeed.deleteMany({ where: { associationId: { in: associationIds } } });
    await prisma.beneficiary.deleteMany({ where: { associationId: { in: associationIds } } });
  }
  await prisma.idempotencyKey.deleteMany({});
  await prisma.auditLog.deleteMany({});
}

let phoneCounter = 0;
/** رقم جوال سعودي صالح وفريد لكل استدعاء — يمنع اصطدام قاعدة "تكرار الجوال داخل الجمعية". */
export function uniquePhone(): string {
  phoneCounter += 1;
  return `05${String(10_000_000 + phoneCounter).slice(0, 8)}`;
}

export function newOpId(prefix = 'op'): string {
  return `${prefix}-${uniqueSuffix()}`;
}

export interface BeneficiaryPayloadOverrides {
  name?: string;
  phone?: string;
  deviceTypes?: DeviceType[];
  associationId?: string;
  opId?: string;
  [key: string]: unknown;
}

/** حمولة إنشاء مستفيد صالحة بالكامل — region/city/socialStatus من البذور المرجعية الحقيقية. */
export function beneficiaryPayload(overrides: BeneficiaryPayloadOverrides = {}) {
  return {
    name: `مستفيد ${NODE3_MARKER} ${uniqueSuffix()}`,
    region: 'الرياض',
    city: 'الرياض',
    district: 'حي النرجس',
    // NODE-3.1: `address`/`landmark` لم يعودا حقلَي إدخال إطلاقًا — إرسالهما
    // يُرفض بـ400 عبر `forbidNonWhitelisted` العام، فحُذفا من الحمولة القياسية.
    phone: uniquePhone(),
    familyCount: 5,
    socialSecurity: true,
    socialStatus: 'أرملة',
    income: 2000,
    deviceTypes: [DeviceType.REFRIGERATOR],
    opId: newOpId('create'),
    ...overrides,
  };
}

/** ينشئ مستفيدًا عبر الـAPI الحقيقي ويعيد معرّفه ومعرّفات احتياجاته. */
export async function createBeneficiary(
  app: INestApplication,
  cookie: string,
  overrides: BeneficiaryPayloadOverrides = {},
): Promise<{ id: string; needIds: string[]; deviceTypes: string[] }> {
  const payload = beneficiaryPayload(overrides);
  const res = await request(app.getHttpServer())
    .post('/api/v1/beneficiaries')
    .set('Cookie', cookie)
    .send(payload);
  if (res.status !== 201) {
    throw new Error(`createBeneficiary failed: ${res.status} ${JSON.stringify(res.body)}`);
  }
  const id = res.body.beneficiaryId as string;
  const needs = await prisma.beneficiaryNeed.findMany({ where: { beneficiaryId: id }, orderBy: { createdAt: 'asc' } });
  return { id, needIds: needs.map((n) => n.id), deviceTypes: needs.map((n) => n.deviceType) };
}
