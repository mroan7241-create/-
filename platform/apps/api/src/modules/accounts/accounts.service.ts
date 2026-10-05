import { Injectable } from '@nestjs/common';
import { AccountRole, AccountStatus, AuthCredentialType, Prisma, prisma } from '@alzad/db';
import { isAdminPermission, normalizeAdminPermissions } from '@alzad/shared';
import { ApiError, authForbidden } from '../../common/api-error';
import { generateAccessCode, generateStrongTempPassword, resetTokenHash } from '../../common/crypto.util';
import { authConfig } from '../../config/auth.config';
import { enqueueEmail } from '../auth/email/email.service';
import { hashSecret } from '../../common/password.util';
import { PublicCodeService } from '../../common/public-code.service';
import { requiredEmail, requiredText } from '../../common/validation/text.util';
import { AuditService } from '../audit/audit.service';
import type { AuthContext } from '../auth/auth.types';
import type { CreateAbanmiAccountDto } from './dto/create-abanmi-account.dto';
import type { CreateAdminAccountDto, UpdateAdminAccountDto } from './dto/admin-account.dto';

@Injectable()
export class AccountsService {
  constructor(private readonly publicCode: PublicCodeService, private readonly audit: AuditService) {}

  private async assertOwner(ctx: AuthContext, tx: Pick<Prisma.TransactionClient, 'account'> = prisma) {
    if (ctx.role !== AccountRole.ADMIN) throw authForbidden();
    const owner = await tx.account.findUnique({ where: { id: ctx.accountId }, select: { publicCode: true, role: true, status: true, archivedAt: true, adminFullAccess: true } });
    if (!owner || owner.publicCode !== 'ADM-000001' || owner.role !== AccountRole.ADMIN || owner.status !== AccountStatus.ACTIVE || owner.archivedAt || !owner.adminFullAccess) throw authForbidden();
  }

  private permissions(input: readonly string[]) {
    if (!Array.isArray(input) || input.some((value) => !isAdminPermission(value)) || new Set(input).size !== input.length) {
      throw new ApiError('ADMIN_PERMISSIONS_INVALID', 'قائمة الصلاحيات غير صالحة', 400);
    }
    return normalizeAdminPermissions(input);
  }

  private async staff(tx: Prisma.TransactionClient, id: string) {
    const account = await tx.account.findFirst({ where: { id, role: AccountRole.ADMIN, archivedAt: null } });
    if (!account) throw new ApiError('ADMIN_ACCOUNT_NOT_FOUND', 'الحساب الإداري غير موجود', 404);
    if (account.publicCode === 'ADM-000001' || account.adminFullAccess) throw new ApiError('ADMIN_OWNER_PROTECTED', 'لا يمكن تعديل حساب المالك من إدارة الموظفين', 403);
    return account;
  }

  async listAdmins(ctx: AuthContext) {
    await this.assertOwner(ctx);
    const accounts = await prisma.account.findMany({
      where: { role: AccountRole.ADMIN, archivedAt: null },
      select: { id: true, publicCode: true, name: true, email: true, status: true, lastLoginAt: true, createdAt: true, mustChangePassword: true, adminFullAccess: true, adminPermissions: true },
      orderBy: { createdAt: 'asc' },
    });
    return accounts.map((account) => ({ ...account, adminPermissions: normalizeAdminPermissions(account.adminPermissions) }));
  }

  async createAdmin(ctx: AuthContext, dto: CreateAdminAccountDto) {
    await this.assertOwner(ctx);
    const name = requiredText(dto.name, 'اسم الموظف', 120);
    const email = requiredEmail(dto.email);
    const adminPermissions = this.permissions(dto.adminPermissions);
    const temporaryPassword = generateStrongTempPassword();
    const secretHash = await hashSecret(temporaryPassword);
    try {
      const account = await prisma.$transaction(async (tx) => {
        await this.assertOwner(ctx, tx);
        const duplicate = await tx.authCredential.findUnique({ where: { type_identifier: { type: AuthCredentialType.EMAIL_PASSWORD, identifier: email } } });
        if (duplicate) throw new ApiError('ACCOUNT_EMAIL_IN_USE', 'البريد الإلكتروني مستخدم في حساب آخر', 409);
        const publicCode = await this.publicCode.nextPublicCode(tx, 'ADM');
        const created = await tx.account.create({ data: { publicCode, name, email, role: AccountRole.ADMIN, status: AccountStatus.ACTIVE, mustChangePassword: true, adminFullAccess: false, adminPermissions } });
        await tx.authCredential.create({ data: { accountId: created.id, type: AuthCredentialType.EMAIL_PASSWORD, identifier: email, secretHash } });
        await tx.auditLog.create({ data: { actorAccountId: ctx.accountId, actorRole: ctx.role, action: 'ADMIN_ACCOUNT_CREATED', entityType: 'accounts', entityId: created.id, metadata: { name, adminPermissions } } });
        return created;
      });
      return { ok: true as const, accountId: account.id, temporaryPassword };
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') throw new ApiError('ACCOUNT_EMAIL_IN_USE', 'البريد الإلكتروني مستخدم في حساب آخر', 409);
      throw error;
    }
  }

  async updateAdmin(ctx: AuthContext, id: string, dto: UpdateAdminAccountDto) {
    await this.assertOwner(ctx);
    const data: Prisma.AccountUpdateInput = {};
    if (dto.name !== undefined) data.name = requiredText(dto.name, 'اسم الموظف', 120);
    if (dto.adminPermissions !== undefined) data.adminPermissions = this.permissions(dto.adminPermissions);
    await prisma.$transaction(async (tx) => {
      await this.assertOwner(ctx, tx);
      const previous = await this.staff(tx, id);
      await tx.account.update({ where: { id }, data });
      await tx.auditLog.create({ data: { actorAccountId: ctx.accountId, actorRole: ctx.role, action: 'ADMIN_ACCOUNT_UPDATED', entityType: 'accounts', entityId: id, metadata: { name: dto.name ?? previous.name, previousPermissions: previous.adminPermissions, adminPermissions: dto.adminPermissions === undefined ? previous.adminPermissions : this.permissions(dto.adminPermissions) } } });
    });
    return { ok: true as const };
  }

  async setAdminStatus(ctx: AuthContext, id: string, status: 'ACTIVE' | 'SUSPENDED') {
    await this.assertOwner(ctx);
    if (status !== 'ACTIVE' && status !== 'SUSPENDED') throw new ApiError('ADMIN_STATUS_INVALID', 'حالة الحساب غير صالحة', 400);
    await prisma.$transaction(async (tx) => {
      await this.assertOwner(ctx, tx);
      await this.staff(tx, id);
      await tx.account.update({ where: { id }, data: { status } });
      if (status === 'SUSPENDED') await tx.authSession.updateMany({ where: { accountId: id, revokedAt: null }, data: { revokedAt: new Date() } });
      await tx.auditLog.create({ data: { actorAccountId: ctx.accountId, actorRole: ctx.role, action: status === 'ACTIVE' ? 'ADMIN_ACCOUNT_ACTIVATED' : 'ADMIN_ACCOUNT_SUSPENDED', entityType: 'accounts', entityId: id } });
    });
    return { ok: true as const };
  }

  async resetAdminPassword(ctx: AuthContext, id: string) {
    await this.assertOwner(ctx);
    const temporaryPassword = generateStrongTempPassword();
    const secretHash = await hashSecret(temporaryPassword);
    await prisma.$transaction(async (tx) => {
      await this.assertOwner(ctx, tx);
      await this.staff(tx, id);
      const credential = await tx.authCredential.findFirst({ where: { accountId: id, type: AuthCredentialType.EMAIL_PASSWORD } });
      if (!credential) throw new ApiError('ADMIN_CREDENTIAL_NOT_FOUND', 'بيانات دخول الموظف غير موجودة', 409);
      await tx.authCredential.update({ where: { id: credential.id }, data: { previousSecretHash: credential.secretHash, secretHash } });
      await tx.account.update({ where: { id }, data: { mustChangePassword: true } });
      const now = new Date();
      await tx.authSession.updateMany({ where: { accountId: id, revokedAt: null }, data: { revokedAt: now } });
      await tx.passwordResetToken.updateMany({ where: { accountId: id, consumedAt: null }, data: { consumedAt: now } });
      await tx.auditLog.create({ data: { actorAccountId: ctx.accountId, actorRole: ctx.role, action: 'ADMIN_ACCOUNT_PASSWORD_RESET', entityType: 'accounts', entityId: id } });
    });
    return { ok: true as const, temporaryPassword };
  }

  listAbanmi() {
    return prisma.account.findMany({
      where: { role: AccountRole.ABANMI, archivedAt: null },
      select: { id: true, publicCode: true, name: true, email: true, status: true, lastLoginAt: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  async createAbanmi(ctx: AuthContext, dto: CreateAbanmiAccountDto) {
    if (ctx.role !== AccountRole.ADMIN) throw authForbidden();
    const email = requiredEmail(dto.email);
    const name = dto.invite ? email : requiredText(dto.name, 'اسم المستخدم', 120);
    const temporaryPassword = generateStrongTempPassword();
    const secretHash = await hashSecret(temporaryPassword);
    const account = await prisma.$transaction(async (tx) => {
      if (dto.invite) await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`abanmi-invitation:${email}`}, 0))`;
      const duplicate = await tx.authCredential.findUnique({
        where: { type_identifier: { type: AuthCredentialType.EMAIL_PASSWORD, identifier: email } },
        ...(dto.invite ? { include: { account: true } } : {}),
      });
      if (duplicate) {
        const current = 'account' in duplicate ? duplicate.account as { id: string; role: AccountRole; status: AccountStatus; archivedAt: Date | null; name: string; mustChangePassword: boolean } : null;
        const invited = current && current.role === AccountRole.ABANMI && current.status === AccountStatus.ACTIVE && !current.archivedAt && current.mustChangePassword && current.name === email && await tx.auditLog.findFirst({ where: { entityId: current.id, action: 'ABANMI_ACCOUNT_INVITED' } });
        if (!dto.invite || !invited || !current) throw new ApiError('ACCOUNT_EMAIL_IN_USE', 'البريد الإلكتروني مستخدم في حساب آخر', 409);
        await tx.$queryRaw`SELECT id FROM accounts WHERE id=${current.id}::uuid FOR UPDATE`;
        const locked = await tx.account.findUniqueOrThrow({ where: { id: current.id } });
        if (locked.role !== AccountRole.ABANMI || locked.status !== AccountStatus.ACTIVE || locked.archivedAt || !locked.mustChangePassword || locked.name !== email) throw new ApiError('ACCOUNT_EMAIL_IN_USE', 'الحساب مستخدم بالفعل ولا يحتاج دعوة جديدة', 409);
        const credential = await tx.authCredential.findUniqueOrThrow({ where: { id: duplicate.id } });
        await this.queueAbanmiInvitation(tx, ctx, current.id, email, credential.secretHash);
        return locked;
      }
      const publicCode = await this.publicCode.nextPublicCode(tx, 'ABN');
      const created = await tx.account.create({
        data: { publicCode, name, email, role: AccountRole.ABANMI, status: AccountStatus.ACTIVE, mustChangePassword: true },
      });
      await tx.authCredential.create({
        data: { accountId: created.id, type: AuthCredentialType.EMAIL_PASSWORD, identifier: email, secretHash },
      });
      if (dto.invite) await this.queueAbanmiInvitation(tx, ctx, created.id, email, secretHash);
      return created;
    });
    if (dto.invite) return { ok: true as const, accountId: account.id, emailQueued: true as const };
    await this.audit.log({ id: ctx.accountId, role: ctx.role, associationId: ctx.associationId }, 'ABANMI_ACCOUNT_CREATED', 'accounts', account.id);
    return { ok: true as const, accountId: account.id, temporaryPassword };
  }

  private async queueAbanmiInvitation(tx: Prisma.TransactionClient, ctx: AuthContext, accountId: string, email: string, credentialHash: string) {
    const code = generateAccessCode('INV', 32);
    const predecessors = await tx.passwordResetToken.findMany({ where: { accountId, consumedAt: null, expiresAt: { gt: new Date() } }, select: { id: true } });
    const token = await tx.passwordResetToken.create({ data: { accountId, emailNormalized: email, tokenHash: resetTokenHash(code), expiresAt: new Date(Date.now() + authConfig.passwordResetTtlSeconds * 1000) } });
    await enqueueEmail(tx, 'PASSWORD_RESET', { to: email, name: 'مستخدم أبانمي', code, invitation: true }, { type: 'reset', tokenId: token.id, accountId, credentialHash, predecessorIds: predecessors.map(({ id }) => id) });
    await tx.auditLog.create({ data: { actorAccountId: ctx.accountId, actorRole: ctx.role, action: 'ABANMI_ACCOUNT_INVITED', entityType: 'accounts', entityId: accountId } });
  }
}
