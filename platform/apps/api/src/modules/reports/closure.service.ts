import { Injectable } from '@nestjs/common';
import { prisma, AccountRole, OrganizationClosureStatus, ParticipationStatus, Prisma, ProjectClosureStatus } from '@alzad/db';
import { ApiError } from '../../common/api-error';
import { IdempotencyService } from '../../common/idempotency.service';
import type { AuthContext } from '../auth/auth.types';
import { ClosureReadinessService } from './closure-readiness.service';

@Injectable()
export class ClosureService {
  constructor(private readonly readiness: ClosureReadinessService, private readonly idem: IdempotencyService) {}

  getProjectReport() { return prisma.projectClosureReport.findUnique({ where: { projectKey: 'electrical-appliances' } }); }

  async snapshot(participationId: string, db: Prisma.TransactionClient = prisma) {
    const participation = await db.projectParticipation.findUnique({ where: { id: participationId } });
    if (!participation?.associationId) throw new ApiError('PARTICIPATION_NOT_OPERATIONAL', 'المشاركة غير تشغيلية', 409);
    const associationId = participation.associationId;
    const [beneficiaries, needs, devices, receipts, missions, attempts, movements, damage, reconciliation, escalations] = await Promise.all([
      db.beneficiary.groupBy({ by: ['listType'], where: { associationId, archivedAt: null }, _count: { _all: true } }),
      db.beneficiaryNeed.groupBy({ by: ['decisionStatus', 'fulfillmentStatus'], where: { associationId }, _count: { _all: true } }),
      db.deviceUnit.groupBy({ by: ['status'], where: { associationId }, _count: { _all: true } }),
      db.receiptItem.aggregate({ where: { receiptBatch: { associationId } }, _sum: { sentQty: true, goodQty: true, damagedQty: true, missingQty: true } }),
      db.deliveryMission.groupBy({ by: ['status'], where: { associationId }, _count: { _all: true } }),
      db.deliveryAttempt.groupBy({ by: ['status'], where: { mission: { associationId } }, _count: { _all: true } }),
      db.deviceMovement.count({ where: { associationId } }),
      db.damageCase.groupBy({ by: ['status'], where: { associationId }, _count: { _all: true } }),
      db.shipmentReconciliationIssue.groupBy({ by: ['status'], where: { associationId }, _count: { _all: true } }),
      db.escalationCase.groupBy({ by: ['status'], where: { associationId }, _count: { _all: true } }),
    ]);
    return { associationId, generatedAt: new Date(), beneficiaries, needs, devices, receipts, missions, attempts, movements, damage, reconciliation, escalations };
  }

  async generate(ctx: AuthContext, participationId: string, opId: string) {
    return prisma.$transaction(async (tx) => {
      const participation = await this.findParticipation(tx, ctx, participationId);
      const claim = await this.idem.claim<{ id: string }>(tx, ctx.accountId, 'organization-closure-generate', opId, { participationId });
      if (!claim.claimed) return claim.existingResponse!;
      await this.lockParticipation(tx, participationId);
      const current = await tx.organizationClosureReport.findUnique({ where: { participationId } });
      if (current && !this.isEditable(current.status)) throw new ApiError('CLOSURE_REPORT_LOCKED', 'التقرير مقفل في حالته الحالية', 409);
      await this.assertReady(tx, participation.id);
      const snapshot = await this.snapshot(participationId, tx);
      const report = await tx.organizationClosureReport.upsert({
        where: { participationId },
        create: { participationId, status: OrganizationClosureStatus.GENERATED, snapshotJson: snapshot, generatedAt: new Date(), generatedById: ctx.accountId },
        update: { status: OrganizationClosureStatus.GENERATED, snapshotJson: snapshot, generatedAt: new Date(), generatedById: ctx.accountId },
      });
      await tx.projectParticipation.update({ where: { id: participationId }, data: { status: ParticipationStatus.READY_TO_CLOSE } });
      await audit(tx, ctx, 'ORGANIZATION_CLOSURE_GENERATED', 'organization_closure_reports', report.id, { snapshot });
      const response = { id: report.id };
      await this.idem.complete(tx, ctx.accountId, 'organization-closure-generate', opId, response);
      return response;
    });
  }

  async updateQualitative(ctx: AuthContext, id: string, fields: { challenges?: string; lessonsLearned?: string; recommendations?: string; finalNotes?: string }) {
    return prisma.$transaction(async (tx) => {
      const report = await this.lockReport(tx, ctx, id);
      if (ctx.role !== AccountRole.ASSOCIATION || !this.isEditable(report.status)) throw new ApiError('CLOSURE_REPORT_LOCKED', 'التقرير مقفل في حالته الحالية', 409);
      return tx.organizationClosureReport.update({ where: { id }, data: fields });
    });
  }

  async transitionOrganization(ctx: AuthContext, id: string, to: OrganizationClosureStatus, opId: string) {
    return prisma.$transaction(async (tx) => {
      await this.findReport(tx, ctx, id);
      const claim = await this.idem.claim<{ ok: true }>(tx, ctx.accountId, 'organization-closure-transition', opId, { id, to });
      if (!claim.claimed) return claim.existingResponse!;
      const current = await this.lockReport(tx, ctx, id);
      const associationTransition = (current.status === OrganizationClosureStatus.GENERATED || current.status === OrganizationClosureStatus.REOPENED) && to === OrganizationClosureStatus.SUBMITTED;
      const adminTransition = (current.status === OrganizationClosureStatus.SUBMITTED && to === OrganizationClosureStatus.UNDER_REVIEW) ||
        (current.status === OrganizationClosureStatus.UNDER_REVIEW && to === OrganizationClosureStatus.APPROVED) ||
        (current.status === OrganizationClosureStatus.APPROVED && to === OrganizationClosureStatus.CLOSED);
      if ((ctx.role === AccountRole.ASSOCIATION && !associationTransition) || (ctx.role === AccountRole.ADMIN && !adminTransition)) {
        throw new ApiError('CLOSURE_TRANSITION_INVALID', 'انتقال تقرير الإغلاق غير مسموح', 409);
      }
      if ([OrganizationClosureStatus.SUBMITTED, OrganizationClosureStatus.APPROVED, OrganizationClosureStatus.CLOSED].some((status) => status === to)) {
        await this.assertReady(tx, current.participationId);
      }
      // Reopening permits operational changes. Resubmission must capture their
      // current totals under the same lock as the readiness decision.
      const snapshot = current.status === OrganizationClosureStatus.REOPENED && to === OrganizationClosureStatus.SUBMITTED
        ? await this.snapshot(current.participationId, tx) : undefined;
      const now = new Date();
      await tx.organizationClosureReport.update({
        where: { id },
        data: {
          status: to,
          ...(snapshot ? { snapshotJson: snapshot, generatedAt: now, generatedById: ctx.accountId } : {}),
          ...(to === OrganizationClosureStatus.SUBMITTED ? { submittedAt: now, submittedById: ctx.accountId } : {}),
          ...(to === OrganizationClosureStatus.UNDER_REVIEW || to === OrganizationClosureStatus.APPROVED ? { reviewedAt: now, reviewedById: ctx.accountId } : {}),
          ...(to === OrganizationClosureStatus.CLOSED ? { closedAt: now, closedById: ctx.accountId } : {}),
        },
      });
      await tx.projectParticipation.update({
        where: { id: current.participationId },
        data: {
          status: to === OrganizationClosureStatus.SUBMITTED ? ParticipationStatus.CLOSURE_SUBMITTED : to === OrganizationClosureStatus.CLOSED ? ParticipationStatus.CLOSED : current.participation.status,
          closedAt: to === OrganizationClosureStatus.CLOSED ? now : null,
        },
      });
      await audit(tx, ctx, 'ORGANIZATION_CLOSURE_TRANSITIONED', 'organization_closure_reports', id, { to });
      const response = { ok: true as const };
      await this.idem.complete(tx, ctx.accountId, 'organization-closure-transition', opId, response);
      return response;
    });
  }

  async reopen(ctx: AuthContext, id: string, reason: string) {
    if (ctx.role !== AccountRole.ADMIN || !reason.trim()) throw new ApiError('CLOSURE_REOPEN_FORBIDDEN', 'إعادة الفتح تتطلب صلاحية الإدارة وسببًا', 403);
    return prisma.$transaction(async (tx) => {
      const report = await this.lockReport(tx, ctx, id);
      if (report.status !== OrganizationClosureStatus.CLOSED) throw new ApiError('CLOSURE_REOPEN_INVALID', 'التقرير غير مغلق', 409);
      await tx.organizationClosureReport.update({ where: { id }, data: { status: OrganizationClosureStatus.REOPENED, reopenedAt: new Date(), reopenedById: ctx.accountId, reopenReason: reason } });
      await tx.projectParticipation.update({ where: { id: report.participationId }, data: { status: ParticipationStatus.EXECUTING, closedAt: null } });
      await audit(tx, ctx, 'ORGANIZATION_CLOSURE_REOPENED', 'organization_closure_reports', id, { reason, previousSnapshot: report.snapshotJson ?? null });
      return { ok: true };
    });
  }

  private isEditable(status: OrganizationClosureStatus) {
    return status === OrganizationClosureStatus.DRAFT || status === OrganizationClosureStatus.GENERATED || status === OrganizationClosureStatus.REOPENED;
  }

  private async assertReady(tx: Prisma.TransactionClient, participationId: string) {
    const ready = await this.readiness.check(participationId, tx);
    if (!ready.ready) throw new ApiError('CLOSURE_NOT_READY', 'لا يمكن إنشاء أو إرسال أو اعتماد أو إغلاق التقرير مع وجود موانع', 409);
  }

  private async findParticipation(tx: Prisma.TransactionClient, ctx: AuthContext, id: string) {
    const participation = await tx.projectParticipation.findUnique({ where: { id } });
    if (!participation || (ctx.role === AccountRole.ASSOCIATION && participation.associationId !== ctx.associationId)) throw new ApiError('PARTICIPATION_NOT_FOUND', 'المشاركة غير موجودة', 404);
    return participation;
  }

  private async lockParticipation(tx: Prisma.TransactionClient, id: string) {
    await tx.$queryRaw`SELECT id FROM project_participations WHERE id=${id}::uuid FOR UPDATE`;
  }

  private async findReport(tx: Prisma.TransactionClient, ctx: AuthContext, id: string) {
    const report = await tx.organizationClosureReport.findUnique({ where: { id }, include: { participation: true } });
    if (!report || (ctx.role === AccountRole.ASSOCIATION && report.participation.associationId !== ctx.associationId)) throw new ApiError('CLOSURE_REPORT_NOT_FOUND', 'تقرير الإغلاق غير موجود', 404);
    return report;
  }

  private async lockReport(tx: Prisma.TransactionClient, ctx: AuthContext, id: string) {
    const existing = await this.findReport(tx, ctx, id);
    await this.lockParticipation(tx, existing.participationId);
    return this.findReport(tx, ctx, id);
  }

  async generateProject(ctx: AuthContext) {
    return prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM project_closure_reports WHERE project_key='electrical-appliances' FOR UPDATE`;
      // Existing participations remain stable while totals are collected. This
      // does not block admission of a future participation or change intake.
      await tx.$queryRaw`SELECT id FROM project_participations ORDER BY id FOR SHARE`;
      const open = await tx.projectParticipation.count({ where: { status: { not: ParticipationStatus.CLOSED } } });
      if (open) throw new ApiError('PROJECT_CLOSURE_ORGANIZATIONS_OPEN', 'لا يمكن إنشاء التقرير الختامي قبل إغلاق كل المشاركات', 409);
      const reports = await tx.organizationClosureReport.findMany({ where: { status: OrganizationClosureStatus.CLOSED }, select: { id: true, snapshotJson: true } });
      const snapshot = { organizationReports: reports, generatedAt: new Date() };
      return tx.projectClosureReport.upsert({
        where: { projectKey: 'electrical-appliances' },
        create: { projectKey: 'electrical-appliances', snapshotJson: snapshot, lastActorId: ctx.accountId },
        update: { snapshotJson: snapshot, lastActorId: ctx.accountId },
      });
    });
  }

  async transitionProject(ctx: AuthContext, to: ProjectClosureStatus, donorFeedbackNotes?: string) {
    return prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM project_closure_reports WHERE project_key='electrical-appliances' FOR UPDATE`;
      const report = await tx.projectClosureReport.findUnique({ where: { projectKey: 'electrical-appliances' } });
      if (!report) throw new ApiError('PROJECT_CLOSURE_NOT_FOUND', 'التقرير الختامي غير موجود', 404);
      const next: Partial<Record<ProjectClosureStatus, ProjectClosureStatus[]>> = {
        GENERATED: [ProjectClosureStatus.UNDER_INTERNAL_REVIEW],
        UNDER_INTERNAL_REVIEW: [ProjectClosureStatus.APPROVED_INTERNAL],
        APPROVED_INTERNAL: [ProjectClosureStatus.SUBMITTED_TO_DONOR],
        SUBMITTED_TO_DONOR: [ProjectClosureStatus.DONOR_FEEDBACK, ProjectClosureStatus.DONOR_APPROVED],
        DONOR_FEEDBACK: [ProjectClosureStatus.RESUBMITTED],
        RESUBMITTED: [ProjectClosureStatus.DONOR_FEEDBACK, ProjectClosureStatus.DONOR_APPROVED],
        DONOR_APPROVED: [ProjectClosureStatus.PROJECT_CLOSED],
      };
      if (!next[report.status]?.includes(to)) throw new ApiError('PROJECT_CLOSURE_TRANSITION_INVALID', 'لا يمكن تجاوز حالات اعتماد التقرير الختامي', 409);
      if (to === ProjectClosureStatus.DONOR_FEEDBACK && !donorFeedbackNotes?.trim()) throw new ApiError('DONOR_FEEDBACK_REQUIRED', 'ملاحظات الداعم مطلوبة', 400);
      await tx.projectClosureReport.update({ where: { id: report.id }, data: { status: to, lastActorId: ctx.accountId, donorFeedbackNotes: donorFeedbackNotes?.trim() || report.donorFeedbackNotes } });
      await audit(tx, ctx, 'PROJECT_CLOSURE_TRANSITIONED', 'project_closure_reports', report.id, { to, donorFeedbackNotes: donorFeedbackNotes ?? null });
      return { ok: true };
    });
  }
}

async function audit(tx: Prisma.TransactionClient, ctx: AuthContext, action: string, entityType: string, entityId: string, metadata?: Prisma.InputJsonObject) {
  await tx.auditLog.create({ data: { actorAccountId: ctx.accountId, actorRole: ctx.role, associationId: ctx.associationId ?? null, action, entityType, entityId, metadata } });
}
