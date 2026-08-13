import { Injectable } from '@nestjs/common';
import { prisma, AccountRole } from '@alzad/db';
import { ApiError, authForbidden } from '../../common/api-error';
import { AuditService } from '../audit/audit.service';
import type { AuthContext } from '../auth/auth.types';
import type { SaveActivityDto } from './dto/activity.dto';

/**
 * ActivitiesService — NODE-7 (يوازي getActivitiesBundle/saveActivity القديمتين).
 *
 * نطاق موثَّق: تتبُّع المرحلة/النشاط الرئيسي/الفرعي + النسبة/الحالة/
 * الملاحظات مُنقَل بالكامل. **إرفاق أدلة الأنشطة (ActivityEvidence مع
 * ملف مرفوع) مؤجَّل صراحةً** — البنية موجودة في المخطط لكن لا رفع ملفات
 * لها بعد؛ راجع PRODUCT_PARITY_MASTER.md §5 لسبب هذا التأجيل الصريح (لا
 * إسقاط صامت — قرار نطاق موثَّق).
 */
@Injectable()
export class ActivitiesService {
  constructor(private readonly audit: AuditService) {}

  async listActivities() {
    return prisma.activity.findMany({
      orderBy: [{ phaseOrder: 'asc' }, { mainActivityOrder: 'asc' }, { createdAt: 'asc' }],
      include: { evidence: { select: { id: true, approvalStatus: true, notes: true, uploadedAt: true } } },
    });
  }

  async saveActivity(ctx: AuthContext, input: SaveActivityDto) {
    if (ctx.role !== AccountRole.ADMIN) throw authForbidden();

    const data = {
      phaseOrder: input.phaseOrder,
      phaseName: input.phaseName,
      mainActivityOrder: input.mainActivityOrder,
      mainActivityName: input.mainActivityName,
      subActivityName: input.subActivityName ?? null,
      responsible: input.responsible ?? null,
      startDate: input.startDate ? new Date(input.startDate) : null,
      endDate: input.endDate ? new Date(input.endDate) : null,
      completionPercent: input.completionPercent ?? 0,
      status: input.status,
      notes: input.notes ?? null,
      evidenceUrl: input.evidenceUrl ?? null,
    };

    let activityId: string;
    if (input.id) {
      const existing = await prisma.activity.findUnique({ where: { id: input.id } });
      if (!existing) throw new ApiError('ACTIVITY_NOT_FOUND', 'النشاط غير موجود', 404);
      await prisma.activity.update({ where: { id: input.id }, data });
      activityId = input.id;
    } else {
      const created = await prisma.activity.create({ data });
      activityId = created.id;
    }

    await this.audit.log({ id: ctx.accountId, role: ctx.role, associationId: ctx.associationId }, input.id ? 'ACTIVITY_UPDATED' : 'ACTIVITY_CREATED', 'activities', activityId);
    return { ok: true as const, activityId };
  }
}
