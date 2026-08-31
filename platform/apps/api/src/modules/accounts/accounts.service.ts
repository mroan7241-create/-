import { Injectable } from '@nestjs/common';
import { AccountRole, AccountStatus, AuthCredentialType, prisma } from '@alzad/db';
import { ApiError } from '../../common/api-error';
import { generateStrongTempPassword } from '../../common/crypto.util';
import { hashSecret } from '../../common/password.util';
import { PublicCodeService } from '../../common/public-code.service';
import { requiredText } from '../../common/validation/text.util';
import { AuditService } from '../audit/audit.service';
import type { AuthContext } from '../auth/auth.types';
import type { CreateAbanmiAccountDto } from './dto/create-abanmi-account.dto';

@Injectable()
export class AccountsService {
  constructor(private readonly publicCode: PublicCodeService, private readonly audit: AuditService) {}

  listAbanmi() {
    return prisma.account.findMany({
      where: { role: AccountRole.ABANMI, archivedAt: null },
      select: { id: true, publicCode: true, name: true, email: true, status: true, lastLoginAt: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  async createAbanmi(ctx: AuthContext, dto: CreateAbanmiAccountDto) {
    const name = requiredText(dto.name, 'اسم المستخدم', 120);
    const email = dto.email.trim().toLowerCase();
    const temporaryPassword = generateStrongTempPassword();
    const secretHash = await hashSecret(temporaryPassword);
    const account = await prisma.$transaction(async (tx) => {
      const duplicate = await tx.authCredential.findUnique({
        where: { type_identifier: { type: AuthCredentialType.EMAIL_PASSWORD, identifier: email } },
      });
      if (duplicate) throw new ApiError('ACCOUNT_EMAIL_IN_USE', 'البريد الإلكتروني مستخدم في حساب آخر', 409);
      const publicCode = await this.publicCode.nextPublicCode(tx, 'ABN');
      const created = await tx.account.create({
        data: { publicCode, name, email, role: AccountRole.ABANMI, status: AccountStatus.ACTIVE, mustChangePassword: true },
      });
      await tx.authCredential.create({
        data: { accountId: created.id, type: AuthCredentialType.EMAIL_PASSWORD, identifier: email, secretHash },
      });
      return created;
    });
    await this.audit.log({ id: ctx.accountId, role: ctx.role, associationId: ctx.associationId }, 'ABANMI_ACCOUNT_CREATED', 'accounts', account.id);
    return { ok: true as const, accountId: account.id, temporaryPassword };
  }
}
