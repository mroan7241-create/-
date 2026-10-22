import { Body, Controller, Injectable, Post } from '@nestjs/common';
import { ArrayMaxSize, ArrayMinSize, ArrayUnique, IsArray, IsUUID } from 'class-validator';
import { AccountRole, prisma, type Prisma } from '@alzad/db';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import type { AuthContext } from '../auth/auth.types';
import { lockAdminApplicationScope } from '../auth/admin-route-permissions';
import { ApiError } from '../../common/api-error';
import { decryptEmailDelivery, enqueueEmail, type EmailDeliveryPayload } from '../auth/email/email.service';
import { NONSELECTION_BODY, NONSELECTION_CAMPAIGN, NONSELECTION_SUBJECT, nonselectionExclusion, nonselectionMarker } from './nonselection-notice.policy';

export class NonselectionNoticeDto {
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(10) @ArrayUnique() @IsUUID('all', { each: true }) applicationIds!: string[];
}

@Injectable()
export class NonselectionNoticeService {
  async queue(ctx: AuthContext, ids: string[]) {
    if (ctx.role !== AccountRole.ADMIN || !ids.length || ids.length > 10 || new Set(ids).size !== ids.length) throw new ApiError('NONSELECTION_SCOPE_INVALID', 'نطاق الإشعار غير صالح', 400);
    return prisma.$transaction(async tx => {
      const fresh = await lockAdminApplicationScope(tx, ctx);
      if (!fresh.adminFullAccess) throw new ApiError('NONSELECTION_FULL_ADMIN_REQUIRED', 'يتطلب الإشعار صلاحية الإدارة الكاملة', 403);
      // Preserve ownership of older queued/uncertain rejection deliveries too.
      const previous = await tx.outboxEvent.findMany({ where: { type: 'EMAIL_DELIVERY', status: { in: ['PENDING', 'PROCESSING', 'FAILED'] }, payload: { path: ['kind'], equals: 'NOTICE' } }, select: { id: true, payload: true } });
      const owned = new Set<string>();
      for (const event of previous) {
        let delivery;
        try { delivery = decryptEmailDelivery(event.id, event.payload as unknown as EmailDeliveryPayload); }
        catch { throw new ApiError('NONSELECTION_DELIVERY_AUDIT_REQUIRED', 'يلزم فحص سجل بريد سابق قبل الإرسال', 409); }
        if (delivery.context.type === 'rejection' || delivery.context.type === 'nonselection') owned.add(delivery.context.applicationId);
      }
      const results: Array<{ id: string; code?: string; status: string; reason?: string; eventId?: string }> = [];
      for (const id of [...ids].sort()) {
        await tx.$queryRaw`SELECT id FROM association_applications WHERE id=${id}::uuid FOR UPDATE`;
        const app = await tx.associationApplication.findUnique({ where: { id } });
        if (!app) { results.push({ id, status: 'SKIPPED', reason: 'NOT_FOUND' }); continue; }
        const key = nonselectionMarker(id);
        const existing = await tx.systemSetting.findUnique({ where: { key } });
        if (existing || owned.has(id)) { results.push({ id, code: app.publicCode, status: 'ALREADY_OWNED' }); continue; }
        const excluded = await nonselectionExclusion(tx, app);
        if (excluded) { results.push({ id, code: app.publicCode, status: 'SKIPPED', reason: excluded }); continue; }
        const queued = await enqueueEmail(tx, 'NOTICE', { to: app.email!.trim().toLowerCase(), name: app.name, subject: NONSELECTION_SUBJECT, body: NONSELECTION_BODY }, { type: 'nonselection', applicationId: id, campaign: NONSELECTION_CAMPAIGN, markerKey: key });
        await tx.systemSetting.create({ data: { key, value: { status: 'QUEUED', eventId: queued.eventId, campaign: NONSELECTION_CAMPAIGN } } });
        await tx.auditLog.create({ data: { actorAccountId: ctx.accountId, actorRole: ctx.role, action: 'NONSELECTION_NOTICE_QUEUED', entityType: 'association_applications', entityId: id, metadata: { campaign: NONSELECTION_CAMPAIGN, eventId: queued.eventId } as Prisma.InputJsonValue } });
        results.push({ id, code: app.publicCode, status: 'QUEUED', eventId: queued.eventId });
      }
      return { ok: true, results };
    }, { maxWait: 5_000, timeout: 30_000 });
  }
}

@Controller('association-applications')
export class NonselectionNoticeController {
  constructor(private readonly notices: NonselectionNoticeService) {}
  @Post('nonselection-notices') @Roles(AccountRole.ADMIN)
  queue(@CurrentUser() ctx: AuthContext, @Body() dto: NonselectionNoticeDto) { return this.notices.queue(ctx, dto.applicationIds); }
}
