import * as argon2 from 'argon2';
import { prisma, AccountRole, AccountStatus, AssociationStatus, AuthCredentialType } from '@alzad/db';

export async function hashSecret(secret: string): Promise<string> {
  return argon2.hash(secret, { type: argon2.argon2id });
}

/** ينظّف كل الجداول التي تنتجها اختبارات NODE-1 — لا يمسّ الحسابات/الجمعيات الثابتة نفسها. */
export async function cleanAuthState(): Promise<void> {
  await prisma.authRateLimit.deleteMany({});
  await prisma.passwordResetToken.deleteMany({});
  await prisma.authSession.deleteMany({});
  await prisma.auditLog.deleteMany({});
}

/**
 * يعيد ضبط كلمة مرور حساب مباشرة عبر Prisma (بلا المرور بسياسة منع إعادة
 * استخدام كلمة المرور) — تُستخدم في beforeEach للاختبارات التي تُغيّر
 * كلمة مرور حساب مشترك (مثل assocEmail)، لضمان أن كل اختبار يبدأ من حالة
 * معروفة بصرف النظر عمّا فعله اختبار سابق.
 */
export async function resetAccountPassword(email: string, password: string): Promise<void> {
  const secretHash = await hashSecret(password);
  await prisma.authCredential.update({
    where: { type_identifier: { type: AuthCredentialType.EMAIL_PASSWORD, identifier: email } },
    data: { secretHash, previousSecretHash: null },
  });
  await prisma.account.updateMany({ where: { email }, data: { mustChangePassword: false } });
}

interface TestFixtures {
  activeAssociationId: string;
  disabledAssociationId: string;
  adminEmail: string;
  adminPassword: string;
  assocEmail: string;
  assocPassword: string;
  assocAccountId: string;
  suspendedAssocEmail: string;
  suspendedAssocPassword: string;
  mustChangeAssocEmail: string;
  mustChangeAssocPassword: string;
  mustChangeAssocEmail2: string;
  mustChangeAssocPassword2: string;
  disabledAssocOrgEmail: string;
  disabledAssocOrgPassword: string;
  delegateCode: string;
  delegateEmail: string;
  delegateAccountId: string;
  suspendedDelegateCode: string;
  disabledAssocOrgDelegateCode: string;
}

/**
 * يبني بيانات ثابتة نظيفة لكل الاختبارات (حسابات ADMIN/ASSOCIATION/DELEGATE
 * بحالات متعددة: نشط/معطَّل/جمعية معطَّلة/يتطلب تغيير كلمة مرور). يُستدعى
 * مرة واحدة في beforeAll لكل ملف اختبار — الجداول idempotent عبر upsert.
 */
export async function seedTestFixtures(): Promise<TestFixtures> {
  const activeAssociation = await prisma.association.upsert({
    where: { publicCode: 'E2E-ASC-ACTIVE' },
    update: { status: AssociationStatus.ACTIVE },
    create: {
      publicCode: 'E2E-ASC-ACTIVE',
      name: 'جمعية اختبار نشطة',
      category: 'جمعية خيرية',
      region: 'الرياض',
      city: 'الرياض',
      phones: ['0500000001'],
      status: AssociationStatus.ACTIVE,
    },
  });

  const disabledAssociation = await prisma.association.upsert({
    where: { publicCode: 'E2E-ASC-DISABLED' },
    update: { status: AssociationStatus.INACTIVE },
    create: {
      publicCode: 'E2E-ASC-DISABLED',
      name: 'جمعية اختبار معطّلة',
      category: 'جمعية خيرية',
      region: 'الرياض',
      city: 'الرياض',
      phones: ['0500000002'],
      status: AssociationStatus.INACTIVE,
    },
  });

  const adminEmail = 'e2e-admin@example.org';
  const adminPassword = 'E2eAdminPass123';
  await upsertUserAccount('E2E-ADM-0001', adminEmail, adminPassword, AccountRole.ADMIN, null, AccountStatus.ACTIVE, false);

  const assocEmail = 'e2e-assoc@example.org';
  const assocPassword = 'E2eAssocPass123';
  const assocAccount = await upsertUserAccount(
    'E2E-USR-0001',
    assocEmail,
    assocPassword,
    AccountRole.ASSOCIATION,
    activeAssociation.id,
    AccountStatus.ACTIVE,
    false,
  );

  // كل حساب ASSOCIATION أدناه ينتمي لجمعية منفصلة عن activeAssociation —
  // resetAssociationPassword يبحث بـ`findFirst({associationId, role:
  // ASSOCIATION})` بلا ترتيب صريح؛ جمعية واحدة بأكثر من حساب ASSOCIATION
  // تجعل تلك النتيجة غير محدَّدة، وهو افتراض متعمَّد يطابق نموذج القديم
  // (حساب دخول واحد لكل جمعية) — لذا لا نُكرِّر association واحدة هنا.
  const suspendedOwnerAssociation = await prisma.association.upsert({
    where: { publicCode: 'E2E-ASC-SUSPUSER' },
    update: { status: AssociationStatus.ACTIVE },
    create: {
      publicCode: 'E2E-ASC-SUSPUSER',
      name: 'جمعية اختبار (حساب موقوف)',
      category: 'جمعية خيرية',
      region: 'الرياض',
      city: 'الرياض',
      phones: ['0500000003'],
      status: AssociationStatus.ACTIVE,
    },
  });

  const suspendedAssocEmail = 'e2e-assoc-suspended@example.org';
  const suspendedAssocPassword = 'E2eSuspendedPass123';
  await upsertUserAccount(
    'E2E-USR-0002',
    suspendedAssocEmail,
    suspendedAssocPassword,
    AccountRole.ASSOCIATION,
    suspendedOwnerAssociation.id,
    AccountStatus.SUSPENDED,
    false,
  );

  const mustChangeOwnerAssociation = await prisma.association.upsert({
    where: { publicCode: 'E2E-ASC-MUSTCHANGE' },
    update: { status: AssociationStatus.ACTIVE },
    create: {
      publicCode: 'E2E-ASC-MUSTCHANGE',
      name: 'جمعية اختبار (يجب تغيير كلمة المرور)',
      category: 'جمعية خيرية',
      region: 'الرياض',
      city: 'الرياض',
      phones: ['0500000004'],
      status: AssociationStatus.ACTIVE,
    },
  });

  const mustChangeAssocEmail = 'e2e-assoc-mustchange@example.org';
  const mustChangeAssocPassword = 'E2eMustChangePass123';
  await upsertUserAccount(
    'E2E-USR-0003',
    mustChangeAssocEmail,
    mustChangeAssocPassword,
    AccountRole.ASSOCIATION,
    mustChangeOwnerAssociation.id,
    AccountStatus.ACTIVE,
    true,
  );

  const mustChangeOwnerAssociation2 = await prisma.association.upsert({
    where: { publicCode: 'E2E-ASC-MUSTCHANGE2' },
    update: { status: AssociationStatus.ACTIVE },
    create: {
      publicCode: 'E2E-ASC-MUSTCHANGE2',
      name: 'جمعية اختبار (يجب تغيير كلمة المرور 2)',
      category: 'جمعية خيرية',
      region: 'الرياض',
      city: 'الرياض',
      phones: ['0500000005'],
      status: AssociationStatus.ACTIVE,
    },
  });

  // حساب mustChangePassword منفصل مخصَّص لاختبار "تغيير كلمة المرور" — يبقى الأول أعلاه دون تحوّر لبقية الاختبارات.
  const mustChangeAssocEmail2 = 'e2e-assoc-mustchange2@example.org';
  const mustChangeAssocPassword2 = 'E2eMustChangePass456';
  await upsertUserAccount(
    'E2E-USR-0005',
    mustChangeAssocEmail2,
    mustChangeAssocPassword2,
    AccountRole.ASSOCIATION,
    mustChangeOwnerAssociation2.id,
    AccountStatus.ACTIVE,
    true,
  );

  const disabledAssocOrgEmail = 'e2e-assoc-disabledorg@example.org';
  const disabledAssocOrgPassword = 'E2eDisabledOrgPass123';
  await upsertUserAccount(
    'E2E-USR-0004',
    disabledAssocOrgEmail,
    disabledAssocOrgPassword,
    AccountRole.ASSOCIATION,
    disabledAssociation.id,
    AccountStatus.ACTIVE,
    false,
  );

  const delegateCode = 'MND-E2E001';
  const delegateAccount = await upsertDelegateAccount('E2E-MND-0001', delegateCode, activeAssociation.id, AccountStatus.ACTIVE);

  const suspendedDelegateCode = 'MND-E2E002';
  await upsertDelegateAccount('E2E-MND-0002', suspendedDelegateCode, activeAssociation.id, AccountStatus.SUSPENDED);

  const disabledAssocOrgDelegateCode = 'MND-E2E003';
  await upsertDelegateAccount('E2E-MND-0003', disabledAssocOrgDelegateCode, disabledAssociation.id, AccountStatus.ACTIVE);

  return {
    activeAssociationId: activeAssociation.id,
    disabledAssociationId: disabledAssociation.id,
    adminEmail,
    adminPassword,
    assocEmail,
    assocPassword,
    assocAccountId: assocAccount.id,
    suspendedAssocEmail,
    suspendedAssocPassword,
    mustChangeAssocEmail,
    mustChangeAssocPassword,
    mustChangeAssocEmail2,
    mustChangeAssocPassword2,
    disabledAssocOrgEmail,
    disabledAssocOrgPassword,
    delegateCode,
    delegateEmail: `e2e-mnd-0001@example.org`,
    delegateAccountId: delegateAccount.id,
    suspendedDelegateCode,
    disabledAssocOrgDelegateCode,
  };
}

async function upsertUserAccount(
  publicCode: string,
  email: string,
  password: string,
  role: AccountRole,
  associationId: string | null,
  status: AccountStatus,
  mustChangePassword: boolean,
) {
  const secretHash = await hashSecret(password);
  const account = await prisma.account.upsert({
    where: { publicCode },
    update: { status, mustChangePassword, associationId: associationId ?? undefined },
    create: {
      publicCode,
      name: `حساب اختبار ${publicCode}`,
      email,
      role,
      associationId: associationId ?? undefined,
      status,
      mustChangePassword,
    },
  });

  await prisma.authCredential.upsert({
    where: { type_identifier: { type: AuthCredentialType.EMAIL_PASSWORD, identifier: email } },
    update: { secretHash, accountId: account.id },
    create: { accountId: account.id, type: AuthCredentialType.EMAIL_PASSWORD, identifier: email, secretHash },
  });

  return account;
}

async function upsertDelegateAccount(publicCode: string, code: string, associationId: string, status: AccountStatus) {
  const secretHash = await hashSecret(code);
  const account = await prisma.account.upsert({
    where: { publicCode },
    update: { status, associationId },
    create: {
      publicCode,
      name: `مندوب اختبار ${publicCode}`,
      email: `${publicCode.toLowerCase()}@example.org`,
      role: AccountRole.DELEGATE,
      associationId,
      status,
    },
  });

  await prisma.authCredential.upsert({
    where: { type_identifier: { type: AuthCredentialType.DELEGATE_ACCESS_CODE, identifier: publicCode } },
    update: { secretHash, accountId: account.id },
    create: { accountId: account.id, type: AuthCredentialType.DELEGATE_ACCESS_CODE, identifier: publicCode, secretHash },
  });

  return account;
}
