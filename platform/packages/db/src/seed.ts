/**
 * بيانات Development/Test اصطناعية فقط — لا توجد أي بيانات شخصية حقيقية
 * هنا. تُشغَّل عبر `npm run db:seed` من جذر platform/ (أو `prisma db
 * seed` داخل packages/db). آمنة لإعادة التشغيل (upsert بكل مكان).
 */
import { PrismaClient, AccountRole, AccountStatus, AssociationStatus, AuthCredentialType, BeneficiaryReviewStatus, NeedDecisionStatus, DeviceType } from '../generated/client';
import * as argon2 from 'argon2';
import { computeCredentialLookupHash, normalizeDelegateCode, AUTH_CREDENTIAL_LOOKUP_HMAC_KEY_DEV_DEFAULT } from '@alzad/shared';
import { seedReferenceData } from './reference-data.seed';
import { assertSeedNotTargetingProduction } from './production-seed.guard';

const prisma = new PrismaClient();

// نفس المتغير ونفس الافتراضي المستخدَمين في apps/api/src/config/auth.config.ts
// (packages/shared/src/auth-secrets.ts هو المصدر الوحيد لكليهما) — لا
// helper منفصل هنا، فقط استدعاء لنفس الدالة المشتركة (computeCredentialLookupHash).
const credentialLookupHmacKey = process.env.AUTH_CREDENTIAL_LOOKUP_HMAC_KEY ?? AUTH_CREDENTIAL_LOOKUP_HMAC_KEY_DEV_DEFAULT;

async function hashSecret(secret: string): Promise<string> {
  return argon2.hash(secret, { type: argon2.argon2id });
}

/** نفس صيغة رمز دخول المندوب القديمة (MND-XXXXXX) — يُطبع في السجل مرة واحدة فقط للتطوير المحلي، ولا يُخزَّن نصًا صريحًا. */
function generateDelegateCode(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let out = '';
  for (let i = 0; i < 6; i++) out += alphabet[Math.floor(Math.random() * alphabet.length)];
  return `MND-${out}`;
}

async function main() {
  assertSeedNotTargetingProduction();
  const admin = await prisma.account.upsert({
    where: { publicCode: 'ADM-000001' },
    update: {},
    create: {
      publicCode: 'ADM-000001',
      name: 'مدير النظام (تجريبي)',
      email: 'admin@example.org',
      role: AccountRole.ADMIN,
      status: AccountStatus.ACTIVE,
      credentials: {
        create: {
          type: AuthCredentialType.EMAIL_PASSWORD,
          identifier: 'admin@example.org',
          secretHash: await hashSecret('DevAdminPass123'),
        },
      },
    },
  });

  const associationsSeed = [
    { code: 'ASC-000001', name: 'جمعية الاختبار الأولى', accountCode: 'USR-000002', delegateAccountCode: 'MND-000003' },
    { code: 'ASC-000002', name: 'جمعية الاختبار الثانية', accountCode: 'USR-000004', delegateAccountCode: 'MND-000005' },
  ];

  for (const seedAssoc of associationsSeed) {
    const association = await prisma.association.upsert({
      where: { publicCode: seedAssoc.code },
      update: {},
      create: {
        publicCode: seedAssoc.code,
        name: seedAssoc.name,
        category: 'جمعية خيرية',
        region: 'الرياض',
        city: 'الرياض',
        phones: ['0500000001'],
        email: `${seedAssoc.code.toLowerCase()}@example.org`,
        status: AssociationStatus.ACTIVE,
      },
    });

    await prisma.account.upsert({
      where: { publicCode: seedAssoc.accountCode },
      update: {},
      create: {
        publicCode: seedAssoc.accountCode,
        name: seedAssoc.name,
        email: `${seedAssoc.code.toLowerCase()}-account@example.org`,
        role: AccountRole.ASSOCIATION,
        associationId: association.id,
        status: AccountStatus.ACTIVE,
        credentials: {
          create: {
            type: AuthCredentialType.EMAIL_PASSWORD,
            identifier: `${seedAssoc.code.toLowerCase()}-account@example.org`,
            secretHash: await hashSecret('DevAssocPass123'),
          },
        },
      },
    });

    const existingDelegate = await prisma.account.findUnique({ where: { publicCode: seedAssoc.delegateAccountCode } });
    if (!existingDelegate) {
      const delegateAccessCode = generateDelegateCode();
      const normalizedCode = normalizeDelegateCode(delegateAccessCode);
      await prisma.account.create({
        data: {
          publicCode: seedAssoc.delegateAccountCode,
          name: `مندوب ${seedAssoc.name}`,
          role: AccountRole.DELEGATE,
          associationId: association.id,
          status: AccountStatus.ACTIVE,
          credentials: {
            create: {
              type: AuthCredentialType.DELEGATE_ACCESS_CODE,
              // identifier = lookup hash (HMAC-SHA256) للرمز المطبَّع — نفس الدالة المشتركة
              // المستخدَمة في مسار تسجيل الدخول الفعلي (apps/api)، وليس implementation منفصل.
              // الرمز الفعلي لا يُخزَّن خامًا أبدًا؛ فقط كـsecretHash (Argon2id).
              identifier: computeCredentialLookupHash(normalizedCode, credentialLookupHmacKey),
              secretHash: await hashSecret(normalizedCode),
            },
          },
        },
      });
      // eslint-disable-next-line no-console
      console.log(`رمز دخول مندوب تجريبي (${seedAssoc.name}): ${delegateAccessCode}`);
    }

    const beneficiary = await prisma.beneficiary.upsert({
      where: { publicCode: `BEN-${seedAssoc.code.slice(-6)}` },
      update: {},
      create: {
        publicCode: `BEN-${seedAssoc.code.slice(-6)}`,
        associationId: association.id,
        name: `مستفيد تجريبي (${seedAssoc.name})`,
        region: 'الرياض',
        city: 'الرياض',
        district: 'حي الاختبار',
        phone: '0500000099',
        familyCount: 3,
        socialSecurity: true,
        maritalStatus: 'أرملة',
        reviewStatus: BeneficiaryReviewStatus.UNDER_REVIEW,
      },
    });

    await prisma.beneficiaryNeed.upsert({
      where: { beneficiaryId_deviceType: { beneficiaryId: beneficiary.id, deviceType: DeviceType.REFRIGERATOR } },
      update: {},
      create: {
        publicCode: `NED-${seedAssoc.code.slice(-6)}`,
        beneficiaryId: beneficiary.id,
        associationId: association.id,
        deviceType: DeviceType.REFRIGERATOR,
        decisionStatus: NeedDecisionStatus.PENDING,
      },
    });
  }

  const referenceResult = await seedReferenceData(prisma);
  console.log(`بذر البيانات المرجعية: ${referenceResult.inserted} سجلًا جديدًا (idempotent — لا تكرار).`);

  await reconcilePublicCodeCounters();
  console.log('اكتمل بذر بيانات التطوير — Admin:', admin.publicCode);
}

/**
 * الجداول التي تحمل publicCode بصيغة `PREFIX-000000` ويولّدها
 * PublicCodeService من نفس عدّاد public_code_counters.
 */
const PUBLIC_CODE_SOURCES: { prefix: string; table: string }[] = [
  { prefix: 'ADM', table: 'accounts' },
  { prefix: 'USR', table: 'accounts' },
  { prefix: 'MND', table: 'accounts' },
  { prefix: 'ASC', table: 'associations' },
  { prefix: 'BEN', table: 'beneficiaries' },
  { prefix: 'NED', table: 'beneficiary_needs' },
  { prefix: 'APP', table: 'association_applications' },
];

/**
 * يُقدّم عدّاد public_code_counters ليتجاوز أكبر رقم بذَره هذا الملف يدويًا.
 *
 * الخلل المُصحَّح (كان قائمًا قبل NODE-2.1 ومستقلًا عنها): البذر يكتب
 * رموزًا ثابتة مثل `ASC-000001`/`ASC-000002` مباشرةً **دون** أن يحجزها في
 * public_code_counters، بينما `PublicCodeService.nextPublicCode` يبدأ من 1
 * دائمًا. فأول جمعية تُنشأ عبر الـAPI على قاعدة بيانات جديدة تحصل على
 * `ASC-000001` المحجوز أصلًا فتفشل بـ`Unique constraint failed on
 * public_code` (خطأ 500 خام). كان الخلل يختفي في التشغيل الثاني لأن
 * العدّاد يكون قد تجاوز الرموز المبذورة، فبدا كأنه تقطّع عشوائي.
 *
 * التصحيح هنا لا في PublicCodeService عمدًا: المولّد الذرّي سليم، والخطأ
 * أن البذر يفتعل رموزًا بلا حجز. `greatest(...)` تجعل العملية idempotent
 * ولا تُنقص عدّادًا تقدَّم فعلًا. الشرط النصّي يقتصر على `PREFIX-` متبوعًا
 * بستّ خانات رقمية حصرًا حتى لا تدخل رموز المناديب العشوائية
 * (`MND-SEXKR5`) في الحساب.
 */
async function reconcilePublicCodeCounters(): Promise<void> {
  for (const { prefix, table } of PUBLIC_CODE_SOURCES) {
    await prisma.$executeRawUnsafe(
      `INSERT INTO public_code_counters (prefix, next_value, updated_at)
       SELECT $1, coalesce(max((substring(public_code from '[0-9]{6}$'))::int), 0), now()
         FROM ${table}
        WHERE public_code ~ ('^' || $1 || '-[0-9]{6}$')
       ON CONFLICT (prefix) DO UPDATE
         SET next_value = greatest(public_code_counters.next_value, excluded.next_value),
             updated_at = now()`,
      prefix,
    );
  }
}

main()
  .catch((error) => {
    console.error('فشل بذر بيانات التطوير:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
