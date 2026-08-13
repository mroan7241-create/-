import { Injectable, Logger } from '@nestjs/common';
import { prisma, AccountRole, Prisma } from '@alzad/db';
import { normalizePagination, toPaginatedResult, type PaginatedResult, type PaginationParams } from '../../common/pagination.util';
import type { AuthContext } from '../auth/auth.types';

export interface AuditActor {
  id: string;
  role: AccountRole;
  associationId?: string | null;
}

/**
 * NORM-009 — قائمة الإجراءات المرئية لدور DELEGATE حصرًا (نفس القائمة
 * المغلَقة في `DELEGATE_VISIBLE_AUDIT_ACTIONS_` القديمة): تسجيل الدخول،
 * الإسناد، فشل/تأكيد التسليم، تفعيل/تعطيل حسابه، إعادة توليد رمزه —
 * لا كلمات مرور، لا رموز، لا مواقع، لا أي حدث إداري حسّاس آخر.
 */
const DELEGATE_VISIBLE_ACTIONS = [
  'LOGIN_SUCCESS',
  'DELIVERY_ASSIGNED',
  'DELIVERY_CONFIRMED',
  'DELIVERY_FAILED',
  'DELIVERY_RETRIED',
  'DELEGATE_ACTIVATED',
  'DELEGATE_DEACTIVATED',
  'DELEGATE_CODE_REGENERATED',
];

/**
 * AuditService مركزي — audit_logs append-only (لا update/delete
 * endpoint إطلاقًا، لا مسار في هذه الخدمة يعدّل سجلًا موجودًا). فشل
 * تسجيل التدقيق بعد نجاح عملية حساسة فعليًا لا يُسقط تلك العملية أبدًا
 * (نفس مبدأ عزل audit_() في النظام القديم) — يُلتقَط هنا داخليًا ويُسجَّل
 * تحذيرًا فقط، فالمستدعي لا يحتاج try/catch حول كل نداء.
 */
@Injectable()
export class AuditService {
  private readonly logger = new Logger('AuditService');

  async log(
    actor: AuditActor | null,
    action: string,
    entityType: string,
    entityId: string | null,
    metadata?: Record<string, unknown>,
  ): Promise<void> {
    try {
      await prisma.auditLog.create({
        data: {
          actorAccountId: actor?.id ?? null,
          actorRole: actor?.role ?? null,
          associationId: actor?.associationId ?? null,
          action,
          entityType,
          entityId,
          metadata: metadata ? (metadata as object) : undefined,
        },
      });
    } catch (error) {
      this.logger.warn(`فشل تسجيل حركة تدقيق (${action}/${entityType}) بعد نجاح العملية الأساسية فعليًا: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  // ================================================================
  // listAuditLog — NORM-008/NORM-009 (قراءة، مُرقَّمة، معزولة بالدور)
  // ================================================================
  async listAuditLog(
    ctx: AuthContext,
    params: PaginationParams & { associationId?: string; entityType?: string; entityId?: string },
  ): Promise<PaginatedResult<unknown>> {
    const { page, pageSize, skip, take } = normalizePagination(params);
    const where: Prisma.AuditLogWhereInput = {};

    if (ctx.role === AccountRole.DELEGATE) {
      // NORM-009: مندوب يرى فقط سجلّه الشخصي، ومقصورًا على قائمة إجراءات مغلَقة (لا كلمات مرور، لا رموز، لا مواقع).
      where.actorAccountId = ctx.accountId;
      where.action = { in: DELEGATE_VISIBLE_ACTIONS };
    } else if (ctx.role === AccountRole.ASSOCIATION) {
      where.associationId = ctx.associationId ?? undefined;
    } else if (params.associationId) {
      where.associationId = params.associationId;
    }

    if (params.entityType) where.entityType = params.entityType;
    if (params.entityId) where.entityId = params.entityId;

    const [items, total] = await prisma.$transaction([
      prisma.auditLog.findMany({
        where,
        select: {
          id: true, action: true, entityType: true, entityId: true, metadata: true, createdAt: true,
          actorAccount: { select: { name: true, role: true, publicCode: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take,
      }),
      prisma.auditLog.count({ where }),
    ]);

    return toPaginatedResult(items, total, page, pageSize);
  }
}
