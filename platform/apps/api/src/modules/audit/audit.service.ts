import { Injectable, Logger } from '@nestjs/common';
import { prisma, AccountRole } from '@alzad/db';

export interface AuditActor {
  id: string;
  role: AccountRole;
  associationId?: string | null;
}

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
}
