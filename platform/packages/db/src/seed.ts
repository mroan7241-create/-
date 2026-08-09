/**
 * بيانات Development/Test اصطناعية فقط — لا توجد أي بيانات شخصية حقيقية
 * هنا. تُشغَّل عبر `npm run db:seed` من جذر platform/ (أو `prisma db
 * seed` داخل packages/db). آمنة لإعادة التشغيل (upsert بكل مكان).
 */
import { PrismaClient, AccountRole, AccountStatus, AssociationStatus, AuthCredentialType, BeneficiaryReviewStatus, NeedDecisionStatus, NeedDeviceType } from '../generated/client';
import { randomBytes, scryptSync } from 'node:crypto';

const prisma = new PrismaClient();

function hashSecret(secret: string): string {
  const salt = randomBytes(16).toString('hex');
  const derived = scryptSync(secret, salt, 64).toString('hex');
  return `scrypt:${salt}:${derived}`;
}

async function main() {
  const admin = await prisma.account.upsert({
    where: { publicCode: 'MND-000001' },
    update: {},
    create: {
      publicCode: 'MND-000001',
      name: 'مدير النظام (تجريبي)',
      email: 'admin@example.org',
      role: AccountRole.ADMIN,
      status: AccountStatus.ACTIVE,
      credentials: {
        create: {
          type: AuthCredentialType.EMAIL_PASSWORD,
          identifier: 'admin@example.org',
          secretHash: hashSecret('DevAdminPass123'),
        },
      },
    },
  });

  const associationsSeed = [
    { code: 'ASC-000001', name: 'جمعية الاختبار الأولى', accountCode: 'MND-000002', delegateCode: 'MND-000003' },
    { code: 'ASC-000002', name: 'جمعية الاختبار الثانية', accountCode: 'MND-000004', delegateCode: 'MND-000005' },
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
            secretHash: hashSecret('DevAssocPass123'),
          },
        },
      },
    });

    await prisma.account.upsert({
      where: { publicCode: seedAssoc.delegateCode },
      update: {},
      create: {
        publicCode: seedAssoc.delegateCode,
        name: `مندوب ${seedAssoc.name}`,
        role: AccountRole.DELEGATE,
        associationId: association.id,
        status: AccountStatus.ACTIVE,
        credentials: {
          create: {
            type: AuthCredentialType.DELEGATE_ACCESS_CODE,
            identifier: `${seedAssoc.code}-DLG`,
            secretHash: hashSecret('123456'),
          },
        },
      },
    });

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
      where: { beneficiaryId_deviceType: { beneficiaryId: beneficiary.id, deviceType: NeedDeviceType.REFRIGERATOR } },
      update: {},
      create: {
        publicCode: `NED-${seedAssoc.code.slice(-6)}`,
        beneficiaryId: beneficiary.id,
        associationId: association.id,
        deviceType: NeedDeviceType.REFRIGERATOR,
        decisionStatus: NeedDecisionStatus.PENDING,
      },
    });
  }

  console.log('اكتمل بذر بيانات التطوير — Admin:', admin.publicCode);
}

main()
  .catch((error) => {
    console.error('فشل بذر بيانات التطوير:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
