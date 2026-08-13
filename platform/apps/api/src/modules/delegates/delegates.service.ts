import { Injectable } from '@nestjs/common';
import { prisma, Prisma, AccountRole, AccountStatus, AuthCredentialType } from '@alzad/db';
import { ApiError, authForbidden } from '../../common/api-error';
import { PublicCodeService } from '../../common/public-code.service';
import { IdempotencyService } from '../../common/idempotency.service';
import { RateLimitService } from '../../common/rate-limit.service';
import { AuditService } from '../audit/audit.service';
import { hashSecret } from '../../common/password.util';
import { normalizeSaudiPhone } from '../../common/validation/phone.util';
import { requiredText } from '../../common/validation/text.util';
import { normalizePagination, toPaginatedResult, type PaginatedResult, type PaginationParams } from '../../common/pagination.util';
import { generateAccessCode, delegateCredentialLookupHash, normalizeDelegateCode } from '../../common/crypto.util';
import type { AuthContext } from '../auth/auth.types';
import type { SaveDelegateDto, UpdateDelegateDto } from './dto/delegate.dto';

/**
 * ============================================================
 * DelegatesService — NODE-6 (يوازي Delegates.gs: saveDelegate/
 * listDelegates_/setDelegateStatus/regenerateDelegateCode)
 * ============================================================
 *
 * عزل ASSOCIATION مطابق حرفيًا لِDEL-001..004 (audit/01-legacy-auth.md):
 * ASSOCIATION تُجبَر دائمًا على associationId من الجلسة (أبدًا من الطلب)،
 * ولا يمكنها لمس مندوب لا ينتمي لجمعيتها — ADMIN فقط بلا هذا القيد.
 *
 * الرمز الخام (MND-XXXXXX) لا يُخزَّن أبدًا — فقط hashSecret(code) في
 * auth_credentials.secret_hash + delegateCredentialLookupHash(code) في
 * identifier (بحث O(1) بلا فحص خطي، نفس نمط تسجيل دخول المندوب
 * الحقيقي أصلًا منذ NODE-1). يُعاد للمستدعي مرة واحدة فقط عند
 * الإنشاء/إعادة التوليد، تمامًا كسلوك DEL-002/DEL-003.
 */
@Injectable()
export class DelegatesService {
  constructor(
    private readonly publicCode: PublicCodeService,
    private readonly idempotency: IdempotencyService,
    private readonly rateLimit: RateLimitService,
    private readonly audit: AuditService,
  ) {}

  private actor(ctx: AuthContext) {
    return { id: ctx.accountId, role: ctx.role, associationId: ctx.associationId };
  }

  /** يحسم associationId الفعلي: ASSOCIATION تُجبَر على جلستها؛ ADMIN يجب أن يزوّد واحدًا صراحةً. */
  private resolveAssociationId(ctx: AuthContext, requested?: string): string {
    if (ctx.role === AccountRole.ASSOCIATION) {
      if (!ctx.associationId) throw authForbidden();
      return ctx.associationId;
    }
    if (!requested) throw new ApiError('DELEGATE_ASSOCIATION_REQUIRED', 'يجب تحديد الجمعية', 400);
    return requested;
  }

  private async assertOwnership(ctx: AuthContext, delegateAssociationId: string | null): Promise<void> {
    if (ctx.role === AccountRole.ADMIN) return;
    if (ctx.role === AccountRole.ASSOCIATION && ctx.associationId === delegateAssociationId) return;
    throw authForbidden();
  }

  // ================================================================
  // listDelegates — Delegates.gs::listDelegates_ (DEL-001)
  // ================================================================
  async listDelegates(
    ctx: AuthContext,
    params: PaginationParams & { search?: string; associationId?: string; status?: AccountStatus },
  ): Promise<PaginatedResult<unknown>> {
    const { page, pageSize, skip, take } = normalizePagination(params);

    const where: Prisma.AccountWhereInput = { role: AccountRole.DELEGATE, archivedAt: null };
    if (ctx.role === AccountRole.ASSOCIATION) {
      where.associationId = ctx.associationId; // DEL-001: لا يُسمَح لِASSOCIATION برؤية أي جمعية أخرى مهما طلبت
    } else if (params.associationId) {
      where.associationId = params.associationId;
    }
    if (params.status) where.status = params.status;
    if (params.search) {
      where.OR = [
        { name: { contains: params.search, mode: 'insensitive' } },
        { publicCode: { contains: params.search, mode: 'insensitive' } },
        { phone: { contains: params.search } },
      ];
    }

    const [items, total] = await prisma.$transaction([
      prisma.account.findMany({
        where,
        select: { id: true, publicCode: true, name: true, phone: true, status: true, associationId: true, lastLoginAt: true, createdAt: true },
        orderBy: { createdAt: 'desc' },
        skip,
        take,
      }),
      prisma.account.count({ where }),
    ]);

    return toPaginatedResult(items, total, page, pageSize);
  }

  // ================================================================
  // getDelegateDetail
  // ================================================================
  async getDelegateDetail(ctx: AuthContext, id: string) {
    const delegate = await prisma.account.findFirst({
      where: { id, role: AccountRole.DELEGATE, archivedAt: null },
      select: { id: true, publicCode: true, name: true, phone: true, status: true, associationId: true, lastLoginAt: true, createdAt: true },
    });
    if (!delegate) throw new ApiError('DELEGATE_NOT_FOUND', 'المندوب غير موجود', 404);
    await this.assertOwnership(ctx, delegate.associationId);
    return delegate;
  }

  // ================================================================
  // saveDelegate (إنشاء) — Delegates.gs::saveDelegate (DEL-002 create path)
  // ================================================================
  async createDelegate(ctx: AuthContext, input: SaveDelegateDto): Promise<{ ok: true; delegateId: string; accessCode: string | null; replayed: boolean }> {
    if (ctx.role !== AccountRole.ADMIN && ctx.role !== AccountRole.ASSOCIATION) throw authForbidden();
    const associationId = this.resolveAssociationId(ctx, input.associationId);
    const name = requiredText(input.name, 'اسم المندوب', 120);
    const phone = normalizeSaudiPhone(input.phone);

    const payload = { associationId, name, phone };

    const outcome = await prisma.$transaction(async (tx) => {
      const claim = await this.idempotency.claim<{ delegateId: string }>(tx, ctx.accountId, 'delegate-create', input.opId, payload);
      if (!claim.claimed) return { replayed: true as const, delegateId: claim.existingResponse!.delegateId, accessCode: null };

      const association = await tx.association.findUnique({ where: { id: associationId }, select: { id: true, status: true } });
      if (!association) throw new ApiError('ASSOCIATION_NOT_FOUND', 'الجمعية غير موجودة', 404);

      const publicCode = await this.publicCode.nextPublicCode(tx, 'MND');
      const account = await tx.account.create({
        data: { publicCode, name, phone, role: AccountRole.DELEGATE, associationId, status: AccountStatus.ACTIVE },
      });

      // DEL-002: يُعاد الرمز الخام مرة واحدة فقط في الاستجابة — لا يُخزَّن أبدًا سوى تجزئته.
      const code = generateAccessCode('MND', 6);
      const secretHash = await hashSecret(code);
      const lookupHash = delegateCredentialLookupHash(normalizeDelegateCode(code));
      await tx.authCredential.create({
        data: { accountId: account.id, type: AuthCredentialType.DELEGATE_ACCESS_CODE, identifier: lookupHash, secretHash },
      });

      const response = { delegateId: account.id };
      await this.idempotency.complete(tx, ctx.accountId, 'delegate-create', input.opId, response);
      return { replayed: false as const, delegateId: account.id, accessCode: code };
    });

    if (!outcome.replayed) {
      await this.audit.log(this.actor(ctx), 'DELEGATE_CREATED', 'accounts', outcome.delegateId, { associationId });
    }

    return { ok: true, delegateId: outcome.delegateId, accessCode: outcome.accessCode, replayed: outcome.replayed };
  }

  // ================================================================
  // saveDelegate (تعديل) — name/phone فقط، لا رمز، لا حالة (DEL-002 update path)
  // ================================================================
  async updateDelegate(ctx: AuthContext, id: string, input: UpdateDelegateDto) {
    const delegate = await prisma.account.findFirst({ where: { id, role: AccountRole.DELEGATE, archivedAt: null } });
    if (!delegate) throw new ApiError('DELEGATE_NOT_FOUND', 'المندوب غير موجود', 404);
    await this.assertOwnership(ctx, delegate.associationId);

    const data: Prisma.AccountUpdateInput = {};
    if (input.name !== undefined) data.name = requiredText(input.name, 'اسم المندوب', 120);
    if (input.phone !== undefined) data.phone = normalizeSaudiPhone(input.phone);
    if (Object.keys(data).length === 0) return { ok: true as const };

    await prisma.account.update({ where: { id }, data });
    await this.audit.log(this.actor(ctx), 'DELEGATE_UPDATED', 'accounts', id);
    return { ok: true as const };
  }

  // ================================================================
  // setDelegateStatus — Delegates.gs::setDelegateStatus (DEL-004)
  // ================================================================
  async setDelegateStatus(ctx: AuthContext, id: string, status: typeof AccountStatus.ACTIVE | typeof AccountStatus.SUSPENDED) {
    const outcome = await prisma.$transaction(async (tx) => {
      const delegate = await tx.account.findFirst({ where: { id, role: AccountRole.DELEGATE, archivedAt: null } });
      if (!delegate) throw new ApiError('DELEGATE_NOT_FOUND', 'المندوب غير موجود', 404);
      await this.assertOwnership(ctx, delegate.associationId);

      await tx.account.update({ where: { id }, data: { status } });
      // DEL-004: التعطيل يُبطل الجلسات فورًا — لا ينتظر انتهاء صلاحية التوكن الحالي.
      if (status === AccountStatus.SUSPENDED) {
        await tx.authSession.updateMany({ where: { accountId: id, revokedAt: null }, data: { revokedAt: new Date() } });
      }
      return { delegateId: id };
    });

    await this.audit.log(this.actor(ctx), status === AccountStatus.ACTIVE ? 'DELEGATE_ACTIVATED' : 'DELEGATE_DEACTIVATED', 'accounts', outcome.delegateId);
    return { ok: true as const };
  }

  // ================================================================
  // regenerateDelegateCode — Delegates.gs::regenerateDelegateCode (DEL-003)
  // ================================================================
  async regenerateDelegateCode(ctx: AuthContext, id: string): Promise<{ ok: true; accessCode: string }> {
    await this.rateLimit.consume('regen-delegate-code', id, { limit: 8, windowSeconds: 900 });

    const outcome = await prisma.$transaction(async (tx) => {
      const delegate = await tx.account.findFirst({ where: { id, role: AccountRole.DELEGATE, archivedAt: null } });
      if (!delegate) throw new ApiError('DELEGATE_NOT_FOUND', 'المندوب غير موجود', 404);
      await this.assertOwnership(ctx, delegate.associationId);

      const code = generateAccessCode('MND', 6);
      const secretHash = await hashSecret(code);
      const lookupHash = delegateCredentialLookupHash(normalizeDelegateCode(code));

      // الرمز القديم يُستبدَل بالكامل (hash+salt جديدان) — لا يبقى صالحًا مطلقًا بعد هذه اللحظة.
      await tx.authCredential.updateMany({
        where: { accountId: id, type: AuthCredentialType.DELEGATE_ACCESS_CODE },
        data: { identifier: lookupHash, secretHash },
      });
      // أي جلسة مندوب حالية بالرمز القديم تُبطَل فورًا.
      await tx.authSession.updateMany({ where: { accountId: id, revokedAt: null }, data: { revokedAt: new Date() } });

      return { code };
    });

    await this.audit.log(this.actor(ctx), 'DELEGATE_CODE_REGENERATED', 'accounts', id);
    return { ok: true, accessCode: outcome.code };
  }
}
