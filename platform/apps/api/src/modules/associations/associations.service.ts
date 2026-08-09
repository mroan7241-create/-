import { Injectable } from '@nestjs/common';
import { prisma, Prisma, AccountRole, AccountStatus, AssociationStatus, AuthCredentialType } from '@alzad/db';
import { ApiError, authForbidden } from '../../common/api-error';
import { PublicCodeService } from '../../common/public-code.service';
import { IdempotencyService } from '../../common/idempotency.service';
import { AuditService } from '../audit/audit.service';
import { hashSecret } from '../../common/password.util';
import { assertPasswordPolicy } from '../../common/password-policy';
import { requiredEmail, requiredText } from '../../common/validation/text.util';
import { normalizeSaudiPhone } from '../../common/validation/phone.util';
import { normalizePagination, toPaginatedResult, type PaginatedResult, type PaginationParams } from '../../common/pagination.util';
import type { AuthContext } from '../auth/auth.types';

export interface CreateAssociationInput {
  name: string;
  category?: string;
  region: string;
  city: string;
  phone: string;
  email: string;
  status?: 'ACTIVE' | 'INACTIVE';
  temporaryPassword: string;
  opId: string;
}

export interface UpdateAssociationInput {
  name?: string;
  category?: string;
  region?: string;
  city?: string;
  phone?: string;
  email?: string;
  status?: 'ACTIVE' | 'INACTIVE';
}

export interface SelfSettingsInput {
  phone: string;
  email: string;
}

@Injectable()
export class AssociationsService {
  constructor(
    private readonly publicCode: PublicCodeService,
    private readonly idempotency: IdempotencyService,
    private readonly audit: AuditService,
  ) {}

  async listAssociations(params: PaginationParams & { search?: string; status?: AssociationStatus }): Promise<PaginatedResult<unknown>> {
    const { page, pageSize, skip, take } = normalizePagination(params);
    const where: Prisma.AssociationWhereInput = {};
    if (params.status) where.status = params.status;
    if (params.search) {
      const q = params.search.trim();
      where.OR = [
        { name: { contains: q, mode: 'insensitive' } },
        { publicCode: { contains: q, mode: 'insensitive' } },
        { email: { contains: q, mode: 'insensitive' } },
        { region: { contains: q, mode: 'insensitive' } },
        { city: { contains: q, mode: 'insensitive' } },
      ];
    }

    const [rows, total] = await Promise.all([
      prisma.association.findMany({ where, orderBy: { name: 'asc' }, skip, take }),
      prisma.association.count({ where }),
    ]);

    const ids = rows.map((r) => r.id);
    const counts = await this.countsByAssociation(ids);

    return toPaginatedResult(
      rows.map((row) => ({ ...mapAssociation(row), ...counts[row.id] })),
      total,
      page,
      pageSize,
    );
  }

  async getAssociationDetail(id: string) {
    const association = await prisma.association.findUnique({ where: { id } });
    if (!association) throw new ApiError('ASSOCIATION_NOT_FOUND', 'الجمعية غير موجودة', 404);

    const account = await prisma.account.findFirst({
      where: { associationId: id, role: AccountRole.ASSOCIATION, archivedAt: null },
      select: { id: true, publicCode: true, email: true, status: true, mustChangePassword: true, lastLoginAt: true },
    });
    const counts = await this.countsByAssociation([id]);

    return { ...mapAssociation(association), ...counts[id], account: account ?? null };
  }

  // ================================================================
  // ADMIN — إنشاء مباشر (saveAssociation Legacy — بلا payload.id)
  // ================================================================
  async createAssociation(ctx: AuthContext, input: CreateAssociationInput) {
    const name = requiredText(input.name, 'اسم الجمعية', 150);
    const email = requiredEmail(input.email);
    const phone = normalizeSaudiPhone(input.phone);
    const category = input.category ? requiredText(input.category, 'التصنيف', 150) : undefined;
    const region = requiredText(input.region, 'المنطقة', 80);
    const city = requiredText(input.city, 'المدينة', 80);
    const status = input.status === 'INACTIVE' ? AssociationStatus.INACTIVE : AssociationStatus.ACTIVE;
    const finalPassword = await assertPasswordPolicy(input.temporaryPassword, '', null);
    const payload = { name, email, phone, category, region, city, status };

    const outcome = await prisma.$transaction(async (tx) => {
      const claim = await this.idempotency.claim<{ associationId: string; accountId: string }>(tx, ctx.accountId, 'association-create', input.opId, payload);
      if (!claim.claimed) return { replayed: true as const, response: claim.existingResponse! };

      const existingCredential = await tx.authCredential.findUnique({
        where: { type_identifier: { type: AuthCredentialType.EMAIL_PASSWORD, identifier: email } },
      });
      if (existingCredential) throw new ApiError('ASSOCIATION_EMAIL_IN_USE', 'البريد الإلكتروني مستخدم في حساب آخر', 409);

      const associationCode = await this.publicCode.nextPublicCode(tx, 'ASC');
      const association = await tx.association.create({
        data: { publicCode: associationCode, name, category: category ?? '', region, city, phones: [phone], email, status },
      });

      const userCode = await this.publicCode.nextPublicCode(tx, 'USR');
      const account = await tx.account.create({
        data: {
          publicCode: userCode,
          name,
          email,
          role: AccountRole.ASSOCIATION,
          associationId: association.id,
          status: AccountStatus.ACTIVE,
          mustChangePassword: true,
        },
      });

      const secretHash = await hashSecret(finalPassword);
      await tx.authCredential.create({ data: { accountId: account.id, type: AuthCredentialType.EMAIL_PASSWORD, identifier: email, secretHash } });

      const response = { associationId: association.id, accountId: account.id };
      await this.idempotency.complete(tx, ctx.accountId, 'association-create', input.opId, response);
      return { replayed: false as const, response, association };
    });

    if (!outcome.replayed) {
      await this.audit.log({ id: ctx.accountId, role: ctx.role, associationId: ctx.associationId }, 'ASSOCIATION_CREATED', 'associations', outcome.response.associationId);
    }

    return { ok: true as const, associationId: outcome.response.associationId };
  }

  // ================================================================
  // ADMIN — تعديل (saveAssociation Legacy — payload.id موجود)
  // ================================================================
  async updateAssociation(ctx: AuthContext, id: string, input: UpdateAssociationInput) {
    const before = await prisma.association.findUnique({ where: { id } });
    if (!before) throw new ApiError('ASSOCIATION_NOT_FOUND', 'الجمعية غير موجودة', 404);

    const data: Prisma.AssociationUpdateInput = {};
    if (input.name !== undefined) data.name = requiredText(input.name, 'اسم الجمعية', 150);
    if (input.category !== undefined) data.category = input.category ? requiredText(input.category, 'التصنيف', 150) : '';
    if (input.region !== undefined) data.region = requiredText(input.region, 'المنطقة', 80);
    if (input.city !== undefined) data.city = requiredText(input.city, 'المدينة', 80);
    if (input.phone !== undefined) {
      const phone = normalizeSaudiPhone(input.phone);
      data.phones = [phone];
    }
    if (input.email !== undefined) data.email = requiredEmail(input.email);

    const newStatus = input.status === 'INACTIVE' ? AssociationStatus.INACTIVE : input.status === 'ACTIVE' ? AssociationStatus.ACTIVE : undefined;
    if (newStatus) data.status = newStatus;

    // NODE-2: على خلاف saveAssociation القديمة (لا تُزامن البريد على حساب الدخول عند تعديل ADMIN — ثغرة توثَّق كذلك)،
    // نحن نتعمَّد عدم تغيير AuthCredential.identifier هنا إطلاقًا — البريد التشغيلي (contact email) منفصل عن بريد الدخول.
    await prisma.association.update({ where: { id }, data });

    const deactivating = newStatus === AssociationStatus.INACTIVE && before.status !== AssociationStatus.INACTIVE;
    if (deactivating) {
      await this.revokeAssociationSessions(id);
    }

    await this.audit.log(
      { id: ctx.accountId, role: ctx.role, associationId: ctx.associationId },
      'ASSOCIATION_UPDATED',
      'associations',
      id,
      newStatus ? { statusTransition: `${before.status}->${newStatus}` } : undefined,
    );

    return { ok: true as const };
  }

  /** ACTIVE→INACTIVE يُبطل جلسات كل حسابات الجمعية (ASSOCIATION + DELEGATE) — يطابق revokeAssociationSessions_ القديمة. */
  private async revokeAssociationSessions(associationId: string): Promise<void> {
    const accounts = await prisma.account.findMany({ where: { associationId }, select: { id: true } });
    if (accounts.length === 0) return;
    await prisma.authSession.updateMany({
      where: { accountId: { in: accounts.map((a) => a.id) }, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  // ================================================================
  // ASSOCIATION self-settings — phone/email فقط
  // ================================================================
  async updateSelfSettings(ctx: AuthContext, input: SelfSettingsInput) {
    if (ctx.role !== AccountRole.ASSOCIATION || !ctx.associationId) throw authForbidden();

    const phone = normalizeSaudiPhone(input.phone);
    const email = requiredEmail(input.email);

    const duplicate = await prisma.account.findFirst({
      where: { id: { not: ctx.accountId }, email },
    });
    if (duplicate) throw new ApiError('ASSOCIATION_EMAIL_IN_USE', 'البريد الإلكتروني مستخدم في حساب آخر', 409);

    // NODE-2: يطابق updateAssociationSettings القديمة — تحديث Association (بيانات تواصل) وAccount.email
    // (بريد العرض على الحساب، وليس AuthCredential.identifier/بريد تسجيل الدخول) معًا بنفس المعاملة.
    await prisma.$transaction([
      prisma.association.update({ where: { id: ctx.associationId }, data: { phones: [phone], email } }),
      prisma.account.update({ where: { id: ctx.accountId }, data: { email } }),
    ]);

    await this.audit.log({ id: ctx.accountId, role: ctx.role, associationId: ctx.associationId }, 'ASSOCIATION_SETTINGS_UPDATED', 'associations', ctx.associationId);

    return { ok: true as const };
  }

  private async countsByAssociation(ids: string[]): Promise<Record<string, { beneficiariesCount: number; devicesCount: number; delegatesCount: number }>> {
    const result: Record<string, { beneficiariesCount: number; devicesCount: number; delegatesCount: number }> = {};
    for (const id of ids) result[id] = { beneficiariesCount: 0, devicesCount: 0, delegatesCount: 0 };
    if (ids.length === 0) return result;

    const [beneficiaryCounts, deviceCounts, delegateCounts] = await Promise.all([
      prisma.beneficiary.groupBy({ by: ['associationId'], where: { associationId: { in: ids } }, _count: { _all: true } }),
      prisma.deviceUnit.groupBy({ by: ['associationId'], where: { associationId: { in: ids } }, _count: { _all: true } }),
      prisma.account.groupBy({ by: ['associationId'], where: { associationId: { in: ids }, role: AccountRole.DELEGATE }, _count: { _all: true } }),
    ]);
    for (const row of beneficiaryCounts) result[row.associationId].beneficiariesCount = row._count._all;
    for (const row of deviceCounts) result[row.associationId].devicesCount = row._count._all;
    for (const row of delegateCounts) {
      if (row.associationId) result[row.associationId].delegatesCount = row._count._all;
    }
    return result;
  }
}

function mapAssociation(row: {
  id: string;
  publicCode: string;
  name: string;
  category: string | null;
  region: string;
  city: string;
  phones: string[];
  email: string | null;
  status: string;
  createdAt: Date;
}) {
  return {
    id: row.id,
    publicCode: row.publicCode,
    name: row.name,
    category: row.category,
    region: row.region,
    city: row.city,
    phone: row.phones[0] ?? null,
    email: row.email,
    status: row.status,
    createdAt: row.createdAt,
  };
}
