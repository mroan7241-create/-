import { Injectable } from '@nestjs/common';
import { prisma, AccountRole, OrganizationClosureStatus, ParticipationStatus, Prisma, ProjectClosureStatus } from '@alzad/db';
import { ApiError } from '../../common/api-error';
import { IdempotencyService } from '../../common/idempotency.service';
import type { AuthContext } from '../auth/auth.types';
import { ClosureReadinessService } from './closure-readiness.service';

@Injectable()
export class ClosureService {
  constructor(private readonly readiness: ClosureReadinessService, private readonly idem: IdempotencyService) {}

  async snapshot(participationId: string) {
    const participation = await prisma.projectParticipation.findUnique({ where: { id: participationId } });
    if (!participation?.associationId) throw new ApiError('PARTICIPATION_NOT_OPERATIONAL', 'المشاركة غير تشغيلية', 409);
    const associationId = participation.associationId;
    const [beneficiaries, needs, devices, receipts, missions, attempts, movements, damage, reconciliation, escalations] = await Promise.all([
      prisma.beneficiary.groupBy({ by: ['listType'], where: { associationId, archivedAt: null }, _count: { _all: true } }),
      prisma.beneficiaryNeed.groupBy({ by: ['decisionStatus', 'fulfillmentStatus'], where: { associationId }, _count: { _all: true } }),
      prisma.deviceUnit.groupBy({ by: ['status'], where: { associationId }, _count: { _all: true } }),
      prisma.receiptItem.aggregate({ where: { receiptBatch: { associationId } }, _sum: { sentQty: true, goodQty: true, damagedQty: true, missingQty: true } }),
      prisma.deliveryMission.groupBy({ by: ['status'], where: { associationId }, _count: { _all: true } }),
      prisma.deliveryAttempt.groupBy({ by: ['status'], where: { mission: { associationId } }, _count: { _all: true } }),
      prisma.deviceMovement.count({ where: { associationId } }),
      prisma.damageCase.groupBy({ by: ['status'], where: { associationId }, _count: { _all: true } }),
      prisma.shipmentReconciliationIssue.groupBy({ by: ['status'], where: { associationId }, _count: { _all: true } }),
      prisma.escalationCase.groupBy({ by: ['status'], where: { associationId }, _count: { _all: true } }),
    ]);
    return { associationId, generatedAt: new Date(), beneficiaries, needs, devices, receipts, missions, attempts, movements, damage, reconciliation, escalations };
  }

  async generate(ctx: AuthContext, participationId: string, opId: string) {
    const ready = await this.readiness.check(participationId); if (!ready.ready) throw new ApiError('CLOSURE_NOT_READY', 'لا يمكن إنشاء تقرير الإغلاق مع وجود موانع', 409); const snapshot = await this.snapshot(participationId);
    return prisma.$transaction(async (tx) => { const claim = await this.idem.claim<{ id: string }>(tx, ctx.accountId, 'organization-closure-generate', opId, { participationId }); if (!claim.claimed) return claim.existingResponse!; const report = await tx.organizationClosureReport.upsert({ where: { participationId }, create: { participationId, status: OrganizationClosureStatus.GENERATED, snapshotJson: snapshot, generatedAt: new Date(), generatedById: ctx.accountId }, update: { status: OrganizationClosureStatus.GENERATED, snapshotJson: snapshot, generatedAt: new Date(), generatedById: ctx.accountId } }); await tx.projectParticipation.update({ where: { id: participationId }, data: { status: ParticipationStatus.READY_TO_CLOSE } }); await audit(tx, ctx, 'ORGANIZATION_CLOSURE_GENERATED', 'organization_closure_reports', report.id, { snapshot }); const response = { id: report.id }; await this.idem.complete(tx, ctx.accountId, 'organization-closure-generate', opId, response); return response; });
  }

  async updateQualitative(ctx: AuthContext, id: string, fields: { challenges?: string; lessonsLearned?: string; recommendations?: string; finalNotes?: string }) {
    const report = await prisma.organizationClosureReport.findUnique({ where: { id }, include: { participation: true } }); if (!report || (ctx.role === AccountRole.ASSOCIATION && report.participation.associationId !== ctx.associationId)) throw new ApiError('CLOSURE_REPORT_NOT_FOUND', 'تقرير الإغلاق غير موجود', 404);
    if (report.status !== OrganizationClosureStatus.DRAFT && report.status !== OrganizationClosureStatus.GENERATED && report.status !== OrganizationClosureStatus.REOPENED) throw new ApiError('CLOSURE_REPORT_LOCKED', 'التقرير مقفل في حالته الحالية', 409); return prisma.organizationClosureReport.update({ where: { id }, data: fields });
  }

  async transitionOrganization(ctx: AuthContext, id: string, to: OrganizationClosureStatus, opId: string) {
    const current = await prisma.organizationClosureReport.findUnique({ where: { id }, include: { participation: true } }); if (!current || (ctx.role === AccountRole.ASSOCIATION && current.participation.associationId !== ctx.associationId)) throw new ApiError('CLOSURE_REPORT_NOT_FOUND', 'تقرير الإغلاق غير موجود', 404);
    const allowed: Partial<Record<OrganizationClosureStatus, OrganizationClosureStatus[]>> = { GENERATED: [OrganizationClosureStatus.SUBMITTED], SUBMITTED: [OrganizationClosureStatus.UNDER_REVIEW], UNDER_REVIEW: [OrganizationClosureStatus.APPROVED], APPROVED: [OrganizationClosureStatus.CLOSED] }; if (!allowed[current.status]?.includes(to)) throw new ApiError('CLOSURE_TRANSITION_INVALID', 'انتقال تقرير الإغلاق غير مسموح', 409);
    if (to === OrganizationClosureStatus.SUBMITTED) { const ready = await this.readiness.check(current.participationId); if (!ready.ready) throw new ApiError('CLOSURE_NOT_READY', 'لا يمكن إرسال التقرير مع وجود موانع', 409); }
    return prisma.$transaction(async (tx) => { const claim = await this.idem.claim<{ ok: true }>(tx, ctx.accountId, 'organization-closure-transition', opId, { id, to }); if (!claim.claimed) return claim.existingResponse!; const now = new Date(); await tx.organizationClosureReport.update({ where: { id }, data: { status: to, ...(to === OrganizationClosureStatus.SUBMITTED ? { submittedAt: now, submittedById: ctx.accountId } : {}), ...(to === OrganizationClosureStatus.UNDER_REVIEW || to === OrganizationClosureStatus.APPROVED ? { reviewedAt: now, reviewedById: ctx.accountId } : {}), ...(to === OrganizationClosureStatus.CLOSED ? { closedAt: now, closedById: ctx.accountId } : {}) } }); await tx.projectParticipation.update({ where: { id: current.participationId }, data: { status: to === OrganizationClosureStatus.SUBMITTED ? ParticipationStatus.CLOSURE_SUBMITTED : to === OrganizationClosureStatus.CLOSED ? ParticipationStatus.CLOSED : current.participation.status, closedAt: to === OrganizationClosureStatus.CLOSED ? now : null } }); await audit(tx, ctx, 'ORGANIZATION_CLOSURE_TRANSITIONED', 'organization_closure_reports', id, { to }); const response = { ok: true as const }; await this.idem.complete(tx, ctx.accountId, 'organization-closure-transition', opId, response); return response; });
  }

  async reopen(ctx: AuthContext, id: string, reason: string) { if (ctx.role !== AccountRole.ADMIN || !reason.trim()) throw new ApiError('CLOSURE_REOPEN_FORBIDDEN', 'إعادة الفتح تتطلب صلاحية الإدارة وسببًا', 403); return prisma.$transaction(async (tx) => { const report = await tx.organizationClosureReport.findUnique({ where: { id } }); if (!report || report.status !== OrganizationClosureStatus.CLOSED) throw new ApiError('CLOSURE_REOPEN_INVALID', 'التقرير غير مغلق', 409); await tx.organizationClosureReport.update({ where: { id }, data: { status: OrganizationClosureStatus.REOPENED, reopenedAt: new Date(), reopenedById: ctx.accountId, reopenReason: reason } }); await tx.projectParticipation.update({ where: { id: report.participationId }, data: { status: ParticipationStatus.EXECUTING, closedAt: null } }); await audit(tx, ctx, 'ORGANIZATION_CLOSURE_REOPENED', 'organization_closure_reports', id, { reason, previousSnapshot: report.snapshotJson ?? null }); return { ok: true }; }); }

  async generateProject(ctx: AuthContext) { const open = await prisma.projectParticipation.count({ where: { status: { not: ParticipationStatus.CLOSED } } }); if (open) throw new ApiError('PROJECT_CLOSURE_ORGANIZATIONS_OPEN', 'لا يمكن إنشاء التقرير الختامي قبل إغلاق كل المشاركات', 409); const reports = await prisma.organizationClosureReport.findMany({ where: { status: OrganizationClosureStatus.CLOSED }, select: { id: true, snapshotJson: true } }); const snapshot = { organizationReports: reports, generatedAt: new Date() }; return prisma.projectClosureReport.upsert({ where: { projectKey: 'electrical-appliances' }, create: { projectKey: 'electrical-appliances', snapshotJson: snapshot, lastActorId: ctx.accountId }, update: { snapshotJson: snapshot, lastActorId: ctx.accountId } }); }

  async transitionProject(ctx: AuthContext, to: ProjectClosureStatus, donorFeedbackNotes?: string) { const report = await prisma.projectClosureReport.findUnique({ where: { projectKey: 'electrical-appliances' } }); if (!report) throw new ApiError('PROJECT_CLOSURE_NOT_FOUND', 'التقرير الختامي غير موجود', 404); const next: Partial<Record<ProjectClosureStatus, ProjectClosureStatus[]>> = { GENERATED: [ProjectClosureStatus.UNDER_INTERNAL_REVIEW], UNDER_INTERNAL_REVIEW: [ProjectClosureStatus.APPROVED_INTERNAL], APPROVED_INTERNAL: [ProjectClosureStatus.SUBMITTED_TO_DONOR], SUBMITTED_TO_DONOR: [ProjectClosureStatus.DONOR_FEEDBACK, ProjectClosureStatus.DONOR_APPROVED], DONOR_FEEDBACK: [ProjectClosureStatus.RESUBMITTED], RESUBMITTED: [ProjectClosureStatus.DONOR_FEEDBACK, ProjectClosureStatus.DONOR_APPROVED], DONOR_APPROVED: [ProjectClosureStatus.PROJECT_CLOSED] }; if (!next[report.status]?.includes(to)) throw new ApiError('PROJECT_CLOSURE_TRANSITION_INVALID', 'لا يمكن تجاوز حالات اعتماد التقرير الختامي', 409); if (to === ProjectClosureStatus.DONOR_FEEDBACK && !donorFeedbackNotes?.trim()) throw new ApiError('DONOR_FEEDBACK_REQUIRED', 'ملاحظات الداعم مطلوبة', 400); return prisma.$transaction(async (tx) => { await tx.projectClosureReport.update({ where: { id: report.id }, data: { status: to, lastActorId: ctx.accountId, donorFeedbackNotes: donorFeedbackNotes?.trim() || report.donorFeedbackNotes } }); await audit(tx, ctx, 'PROJECT_CLOSURE_TRANSITIONED', 'project_closure_reports', report.id, { to, donorFeedbackNotes: donorFeedbackNotes ?? null }); return { ok: true }; }); }
}

async function audit(tx: Prisma.TransactionClient, ctx: AuthContext, action: string, entityType: string, entityId: string, metadata?: Prisma.InputJsonObject) { await tx.auditLog.create({ data: { actorAccountId: ctx.accountId, actorRole: ctx.role, associationId: ctx.associationId ?? null, action, entityType, entityId, metadata } }); }
