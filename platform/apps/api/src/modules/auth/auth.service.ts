import { Inject, Injectable } from '@nestjs/common';
import { setTimeout as delay } from 'node:timers/promises';
import { timingSafeEqual } from 'node:crypto';
import { prisma, AccountRole, AccountStatus, AssociationStatus, AuthCredentialType } from '@alzad/db';
import { authConfig } from '../../config/auth.config';
import {
  delegateCredentialLookupHash,
  generateAccessCode,
  generateSessionToken,
  generateStrongTempPassword,
  normalizeDelegateCode,
  resetTokenHash,
  sha256Hex,
} from '../../common/crypto.util';
import { hashSecret, verifySecret } from '../../common/password.util';
import { assertPasswordPolicy } from '../../common/password-policy';
import { RateLimitService } from '../../common/rate-limit.service';
import { ApiError, authAssociationDisabled, authForbidden, authInvalidCredentials } from '../../common/api-error';
import { AuditService } from '../audit/audit.service';
import { EmailService } from './email/email.service';
import type { AuthContext } from './auth.types';

const DELEGATE_CODE_RE = /^MND-[A-Z0-9]{6,12}$/;
const PASSWORD_RESET_GENERIC_MESSAGE = 'إذا كان البريد الإلكتروني مسجلًا في النظام فستصلك تعليمات استعادة كلمة المرور خلال دقائق.';
const PASSWORD_RESET_INVALID_MESSAGE = 'رمز الاستعادة غير صحيح أو منتهي الصلاحية أو استُخدم بالفعل. اطلب رمزًا جديدًا';

export interface LoginResult {
  rawToken: string;
  expiresAt: Date;
  /** سقف مطلق ثابت للجلسة (12h) — الـcontroller يستخدمه لعمر الكوكي، لا expiresAt المنزلق. */
  absoluteExpiresAt: Date;
  account: { id: string; publicCode: string; name: string; role: AccountRole; associationId: string | null; mustChangePassword: boolean };
}

export interface RequestMeta {
  ipAddress?: string;
  userAgent?: string;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly rateLimit: RateLimitService,
    private readonly audit: AuditService,
    @Inject(EmailService) private readonly emailService: EmailService,
  ) {}

  // ================================================================
  // LOGIN — ADMIN / ASSOCIATION
  // ================================================================
  async loginUser(emailRaw: string, password: string, meta: RequestMeta): Promise<LoginResult> {
    const email = String(emailRaw || '').trim().toLowerCase();
    if (!isEmailShape(email) || !password) throw authInvalidCredentials();

    await this.rateLimit.consume('login:user', email, authConfig.rateLimitUserLogin);

    const credential = await prisma.authCredential.findUnique({
      where: { type_identifier: { type: AuthCredentialType.EMAIL_PASSWORD, identifier: email } },
      include: { account: { include: { association: true } } },
    });

    const account = credential?.account;
    const roleOk = account && (
      account.role === AccountRole.ADMIN ||
      account.role === AccountRole.ASSOCIATION ||
      account.role === AccountRole.ABANMI
    );
    const passwordOk = credential && (await verifySecret(credential.secretHash, password));

    if (!credential || !account || account.status !== AccountStatus.ACTIVE || !roleOk || !passwordOk) {
      await delay(350);
      throw authInvalidCredentials();
    }

    if (account.role === AccountRole.ASSOCIATION) {
      if (!account.associationId || !account.association || account.association.status !== AssociationStatus.ACTIVE) {
        throw authAssociationDisabled();
      }
    }

    const session = await this.createSession(account.id, meta);
    await prisma.account.update({ where: { id: account.id }, data: { lastLoginAt: new Date() } });
    await this.audit.log({ id: account.id, role: account.role, associationId: account.associationId }, 'LOGIN_SUCCESS', 'accounts', account.id);

    return {
      rawToken: session.rawToken,
      expiresAt: session.expiresAt,
      absoluteExpiresAt: session.absoluteExpiresAt,
      account: {
        id: account.id,
        publicCode: account.publicCode,
        name: account.name,
        role: account.role,
        associationId: account.associationId,
        mustChangePassword: account.mustChangePassword,
      },
    };
  }

  // ================================================================
  // LOGIN — DELEGATE (رمز دخول، بلا بريد/كلمة مرور)
  // ================================================================
  async loginDelegate(codeRaw: string, meta: RequestMeta): Promise<LoginResult> {
    const code = normalizeDelegateCode(codeRaw);
    if (!DELEGATE_CODE_RE.test(code)) throw authInvalidCredentials();

    await this.rateLimit.consume('login:delegate', code, authConfig.rateLimitDelegateLogin);

    // بحث O(1) عبر lookup hash (HMAC-SHA256 بمفتاح مخصَّص) بدل فحص خطي
    // على كل بيانات اعتماد المناديب — راجع common/crypto.util.ts
    // وpackages/shared/src/credential-lookup.ts. لا فهرسة على الرمز
    // الخام نفسه أبدًا (لا يُخزَّن أصلًا).
    const lookupHash = delegateCredentialLookupHash(code);
    const credential = await prisma.authCredential.findUnique({
      where: { type_identifier: { type: AuthCredentialType.DELEGATE_ACCESS_CODE, identifier: lookupHash } },
      include: { account: { include: { association: true } } },
    });

    const account = credential?.account;
    const roleOk = account && account.role === AccountRole.DELEGATE && account.status === AccountStatus.ACTIVE;
    // التحقق بـArgon2id يبقى إلزاميًا حتى بعد نجاح lookup — دفاع متعمَّق
    // (defense-in-depth)، لا اعتماد على lookup hash وحده كإثبات هوية.
    const passwordOk = credential && (await verifySecret(credential.secretHash, code));

    if (!credential || !account || !roleOk || !passwordOk) {
      await delay(350);
      throw authInvalidCredentials();
    }

    if (!account.associationId || !account.association || account.association.status !== AssociationStatus.ACTIVE) {
      throw authAssociationDisabled();
    }

    const session = await this.createSession(account.id, meta);
    await prisma.account.update({ where: { id: account.id }, data: { lastLoginAt: new Date() } });
    await this.audit.log({ id: account.id, role: account.role, associationId: account.associationId }, 'LOGIN_SUCCESS', 'accounts', account.id);

    return {
      rawToken: session.rawToken,
      expiresAt: session.expiresAt,
      absoluteExpiresAt: session.absoluteExpiresAt,
      account: {
        id: account.id,
        publicCode: account.publicCode,
        name: account.name,
        role: account.role,
        associationId: account.associationId,
        mustChangePassword: account.mustChangePassword,
      },
    };
  }

  private async createSession(accountId: string, meta: RequestMeta): Promise<{ rawToken: string; expiresAt: Date; absoluteExpiresAt: Date }> {
    const rawToken = generateSessionToken();
    const now = new Date();
    const expiresAt = new Date(now.getTime() + authConfig.sessionIdleSeconds * 1000);
    const absoluteExpiresAt = new Date(now.getTime() + authConfig.sessionAbsoluteSeconds * 1000);
    await prisma.authSession.create({
      data: {
        accountId,
        tokenHash: sha256Hex(rawToken),
        expiresAt,
        absoluteExpiresAt,
        lastSeenAt: now,
        ipAddress: meta.ipAddress ?? null,
        userAgent: meta.userAgent ?? null,
      },
    });
    return { rawToken, expiresAt, absoluteExpiresAt };
  }

  // ================================================================
  // LOGOUT
  // ================================================================
  async logout(ctx: AuthContext): Promise<void> {
    await prisma.authSession.update({ where: { id: ctx.sessionId }, data: { revokedAt: new Date() } });
    await this.audit.log({ id: ctx.accountId, role: ctx.role, associationId: ctx.associationId }, 'LOGOUT', 'auth_sessions', ctx.sessionId);
  }

  // ================================================================
  // GET /auth/me
  // ================================================================
  async getMe(ctx: AuthContext) {
    const account = await prisma.account.findUniqueOrThrow({ where: { id: ctx.accountId } });
    return {
      id: account.id,
      publicCode: account.publicCode,
      name: account.name,
      role: account.role,
      associationId: account.associationId,
      mustChangePassword: account.mustChangePassword,
    };
  }

  // ================================================================
  // CHANGE PASSWORD (يعمل حتى إذا mustChangePassword = true)
  // ================================================================
  async changePassword(ctx: AuthContext, currentPassword: string, newPassword: string): Promise<void> {
    const credential = await prisma.authCredential.findFirst({
      where: { accountId: ctx.accountId, type: AuthCredentialType.EMAIL_PASSWORD },
    });
    if (!credential || !(await verifySecret(credential.secretHash, String(currentPassword || '')))) {
      throw new ApiError('AUTH_VALIDATION_FAILED', 'كلمة المرور الحالية غير صحيحة', 400);
    }
    const finalPassword = await assertPasswordPolicy(newPassword, credential.secretHash, credential.previousSecretHash);
    const newHash = await hashSecret(finalPassword);

    await prisma.$transaction(async (tx) => {
      await tx.authCredential.update({
        where: { id: credential.id },
        data: { previousSecretHash: credential.secretHash, secretHash: newHash },
      });
      await tx.account.update({ where: { id: ctx.accountId }, data: { mustChangePassword: false } });
      // تغيير كلمة المرور يُبطل كل الجلسات — بما فيها الجلسة الحالية (نفس أثر revokeSessions_/actorEpoch_ القديم).
      await tx.authSession.updateMany({ where: { accountId: ctx.accountId, revokedAt: null }, data: { revokedAt: new Date() } });
    });

    await this.audit.log({ id: ctx.accountId, role: ctx.role, associationId: ctx.associationId }, 'PASSWORD_CHANGED', 'accounts', ctx.accountId);
  }

  // ================================================================
  // REQUEST PASSWORD RESET — رد موحَّد دائمًا، بلا كشف حالة الحساب
  // ================================================================
  async requestPasswordReset(emailRaw: string): Promise<{ ok: true; message: string }> {
    const generic = { ok: true as const, message: PASSWORD_RESET_GENERIC_MESSAGE };
    const email = String(emailRaw || '').trim().toLowerCase();
    if (!isEmailShape(email)) return generic;

    await this.rateLimit.consume('password-reset-request', email, authConfig.rateLimitPasswordResetRequest);

    const credential = await prisma.authCredential.findUnique({
      where: { type_identifier: { type: AuthCredentialType.EMAIL_PASSWORD, identifier: email } },
      include: { account: { include: { association: true } } },
    });
    const account = credential?.account;
    let eligible =
      !!account &&
      account.status === AccountStatus.ACTIVE &&
      (account.role === AccountRole.ADMIN || account.role === AccountRole.ASSOCIATION || account.role === AccountRole.ABANMI);
    if (eligible && account!.role === AccountRole.ASSOCIATION) {
      eligible = !!account!.association && account!.association.status === AssociationStatus.ACTIVE;
    }

    if (!eligible || !account) {
      await delay(350);
      return generic;
    }

    const code = generateAccessCode('RST', 8);
    try {
      await this.emailService.sendPasswordResetCode({ to: email, name: account.name, code });
    } catch {
      // فشل الإرسال لا يُفصح عنه، والرمز لا يُخزَّن أصلًا — لا فائدة من رمز لن يصل صاحبه.
      return generic;
    }

    await prisma.$transaction(async (tx) => {
      // طلب جديد يُبطل أي رمز سابق نشط لنفس الحساب — لا أكثر من رمز صالح واحد في وقت واحد.
      await tx.passwordResetToken.updateMany({
        where: { accountId: account.id, consumedAt: null },
        data: { consumedAt: new Date() },
      });
      await tx.passwordResetToken.create({
        data: {
          accountId: account.id,
          emailNormalized: email,
          tokenHash: resetTokenHash(code),
          expiresAt: new Date(Date.now() + authConfig.passwordResetTtlSeconds * 1000),
        },
      });
    });

    await this.audit.log({ id: account.id, role: account.role, associationId: account.associationId }, 'PASSWORD_RESET_REQUESTED', 'accounts', account.id);
    return generic;
  }

  // ================================================================
  // CONFIRM PASSWORD RESET
  // ================================================================
  async confirmPasswordReset(emailRaw: string, codeRaw: string, newPassword: string): Promise<{ ok: true }> {
    const email = String(emailRaw || '').trim().toLowerCase();
    const code = String(codeRaw || '').trim().toUpperCase();
    await this.rateLimit.consume('password-reset-verify', email, authConfig.rateLimitPasswordResetVerify);

    // ملاحظة مهمة: أي throw داخل $transaction يُرجع كل الكتابة فيها (rollback) — بما فيها
    // تحديث attempt_count/consumed_at الذي يُفترض أن يبقى حتى لو فشلت المحاولة الحالية. لذلك
    // نُعيد نتيجة (outcome) من الداخل بدل رمي الاستثناء، ونرمي الخطأ بعد التزام (commit) المعاملة.
    type ConfirmOutcome = { ok: true; account: NonNullable<Awaited<ReturnType<typeof prisma.account.findUnique>>> } | { ok: false };

    const outcome: ConfirmOutcome = await prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<
        { id: string; account_id: string; token_hash: string; attempt_count: number; expires_at: Date; consumed_at: Date | null }[]
      >`SELECT id, account_id, token_hash, attempt_count, expires_at, consumed_at
        FROM password_reset_tokens
        WHERE email_normalized = ${email} AND consumed_at IS NULL
        ORDER BY created_at DESC LIMIT 1 FOR UPDATE`;
      const token = rows[0];
      if (!token || token.expires_at <= new Date() || token.attempt_count >= authConfig.passwordResetMaxAttempts) {
        return { ok: false };
      }

      const providedHash = resetTokenHash(code);
      const isMatch = timingSafeEqualHex(providedHash, token.token_hash);
      if (!isMatch) {
        const nextAttempts = token.attempt_count + 1;
        const exhausted = nextAttempts >= authConfig.passwordResetMaxAttempts;
        await tx.passwordResetToken.update({
          where: { id: token.id },
          data: { attemptCount: nextAttempts, consumedAt: exhausted ? new Date() : undefined },
        });
        return { ok: false };
      }

      const account = await tx.account.findUnique({ where: { id: token.account_id } });
      const credential = account
        ? await tx.authCredential.findFirst({ where: { accountId: account.id, type: AuthCredentialType.EMAIL_PASSWORD } })
        : null;
      if (!account || account.status !== AccountStatus.ACTIVE || !credential) {
        await tx.passwordResetToken.update({ where: { id: token.id }, data: { consumedAt: new Date() } });
        return { ok: false };
      }

      const finalPassword = await assertPasswordPolicy(newPassword, credential.secretHash, credential.previousSecretHash);
      const newHash = await hashSecret(finalPassword);

      await tx.authCredential.update({
        where: { id: credential.id },
        data: { previousSecretHash: credential.secretHash, secretHash: newHash },
      });
      await tx.account.update({ where: { id: account.id }, data: { mustChangePassword: false } });
      await tx.authSession.updateMany({ where: { accountId: account.id, revokedAt: null }, data: { revokedAt: new Date() } });
      await tx.passwordResetToken.update({ where: { id: token.id }, data: { consumedAt: new Date() } });

      return { ok: true, account };
    });

    if (!outcome.ok) {
      throw new ApiError('AUTH_VALIDATION_FAILED', PASSWORD_RESET_INVALID_MESSAGE, 400);
    }
    const accountForAlert = outcome.account;

    // التدقيق يُسجَّل بعد التزام (commit) المعاملة فعليًا — لا قبله من
    // داخل $transaction — حتى لا يُسجَّل PASSWORD_RESET_COMPLETED إن
    // فشلت المعاملة لأي سبب بعد نجاح المنطق الداخلي (تناسق ترتيب
    // الأحداث، وليس لأن AuditService يستخدم tx نفسها أصلًا).
    await this.audit.log(
      { id: accountForAlert.id, role: accountForAlert.role, associationId: accountForAlert.associationId },
      'PASSWORD_RESET_COMPLETED',
      'accounts',
      accountForAlert.id,
    );

    try {
      await this.emailService.sendSecurityAlert({
        to: email,
        name: accountForAlert.name,
        subject: 'تنبيه أمني: تغيّرت كلمة مرور حسابك',
        body: `تم تغيير كلمة مرور حسابك للتو. إن لم يكن هذا أنت فتواصل فورًا مع إدارة المشروع.`,
      });
    } catch {
      /* إشعار تحسيني بعد نجاح العملية الفعلية — لا يُفشل الاستجابة */
    }

    return { ok: true };
  }

  // ================================================================
  // ADMIN RESET ASSOCIATION PASSWORD
  // ================================================================
  async resetAssociationPassword(ctx: AuthContext, associationId: string): Promise<{ ok: true; temporaryPassword: string }> {
    if (ctx.role !== AccountRole.ADMIN) throw authForbidden();
    const association = await prisma.association.findUnique({ where: { id: associationId } });
    if (!association) throw new ApiError('AUTH_VALIDATION_FAILED', 'الجمعية غير موجودة', 404);

    await this.rateLimit.consume('reset-association-password', associationId, authConfig.rateLimitAssociationPasswordReset);

    const temporaryPassword = await prisma.$transaction(async (tx) => {
      const account = await tx.account.findFirst({ where: { associationId, role: AccountRole.ASSOCIATION } });
      if (!account) throw new ApiError('AUTH_VALIDATION_FAILED', 'تعذر العثور على حساب دخول لهذه الجمعية', 400);
      const credential = await tx.authCredential.findFirst({ where: { accountId: account.id, type: AuthCredentialType.EMAIL_PASSWORD } });
      if (!credential) throw new ApiError('AUTH_VALIDATION_FAILED', 'تعذر العثور على بيانات اعتماد حساب الجمعية', 400);

      const newPassword = generateStrongTempPassword();
      const newHash = await hashSecret(newPassword);
      await tx.authCredential.update({
        where: { id: credential.id },
        data: { previousSecretHash: credential.secretHash, secretHash: newHash },
      });
      await tx.account.update({ where: { id: account.id }, data: { mustChangePassword: true } });
      // يُبطل جلسة حساب الجمعية نفسه فقط — لا يمسّ جلسات مناديبها (نفس تعليق resetAssociationPassword القديمة).
      await tx.authSession.updateMany({ where: { accountId: account.id, revokedAt: null }, data: { revokedAt: new Date() } });
      return newPassword;
    });

    await this.audit.log(
      { id: ctx.accountId, role: ctx.role, associationId: ctx.associationId },
      'ASSOCIATION_PASSWORD_RESET',
      'associations',
      associationId,
      { associationName: association.name },
    );

    return { ok: true, temporaryPassword };
  }
}

function isEmailShape(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) && value.length <= 180;
}

function timingSafeEqualHex(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'hex');
  const bufB = Buffer.from(b, 'hex');
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}
