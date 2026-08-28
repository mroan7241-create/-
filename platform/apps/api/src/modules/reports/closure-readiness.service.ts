import { Injectable } from '@nestjs/common';
import { prisma, DamageCaseStatus, DeliveryStatus, EscalationSeverity, EscalationStatus, NeedDecisionStatus, ParticipationStatus, ReconciliationIssueStatus } from '@alzad/db';
import { ApiError } from '../../common/api-error';
import { ReconciliationService } from './reconciliation.service';

@Injectable()
export class ClosureReadinessService {
  constructor(private readonly reconciliation: ReconciliationService) {}

  async check(participationId: string) {
    const participation = await prisma.projectParticipation.findUnique({ where: { id: participationId } });
    if (!participation?.associationId) throw new ApiError('PARTICIPATION_NOT_OPERATIONAL', 'المشاركة غير مرتبطة بجمعية تشغيلية', 409);
    const associationId = participation.associationId;
    const [unresolvedBeneficiaries, unresolvedNeeds, pendingApprovals, custody, pendingReturns, damage, issues, escalations, missingEvidence, reconciliation] = await Promise.all([
      prisma.beneficiary.count({ where: { associationId, archivedAt: null, reviewStatus: 'UNDER_REVIEW' } }),
      prisma.beneficiaryNeed.count({ where: { associationId, decisionStatus: NeedDecisionStatus.PENDING } }),
      prisma.deliveryMission.count({ where: { associationId, status: DeliveryStatus.PENDING_DELIVERY_APPROVAL } }),
      prisma.deliveryMission.count({ where: { associationId, status: { in: [DeliveryStatus.OUT_WITH_DELEGATE, DeliveryStatus.DELIVERY_FAILED, DeliveryStatus.DEFERRED] } } }),
      prisma.deliveryMission.count({ where: { associationId, status: DeliveryStatus.PENDING_RETURN_APPROVAL } }),
      prisma.damageCase.count({ where: { associationId, status: { not: DamageCaseStatus.CLOSED } } }),
      prisma.shipmentReconciliationIssue.count({ where: { associationId, status: { not: ReconciliationIssueStatus.CLOSED } } }),
      prisma.escalationCase.count({ where: { associationId, severity: { in: [EscalationSeverity.HIGH, EscalationSeverity.CRITICAL] }, status: { in: [EscalationStatus.OPEN, EscalationStatus.NEEDS_INFO, EscalationStatus.APPROVED] } } }),
      prisma.deliveryAttempt.count({ where: { mission: { associationId }, status: DeliveryStatus.PENDING_DELIVERY_APPROVAL, OR: [{ proofFileId: null }, { recipientSignatureFileId: null }] } }),
      this.reconciliation.reconcile(associationId),
    ]);
    const stateAllowed = participation.status === ParticipationStatus.EXECUTING || participation.status === ParticipationStatus.READY_TO_CLOSE || participation.status === ParticipationStatus.CLOSURE_SUBMITTED;
    const rows: Array<[string, number, string]> = [
      ['UNRESOLVED_BENEFICIARIES', unresolvedBeneficiaries, '/beneficiaries'], ['UNRESOLVED_NEEDS', unresolvedNeeds, '/beneficiaries'],
      ['PENDING_DELIVERY_APPROVALS', pendingApprovals, '/deliveries'], ['OPEN_DELEGATE_CUSTODY', custody, '/deliveries'],
      ['PENDING_RETURN_CONFIRMATION', pendingReturns, '/deliveries'], ['UNRESOLVED_DAMAGE', damage, '/procurement'],
      ['OPEN_SHIPMENT_RECONCILIATION', issues, '/procurement'], ['OPEN_CRITICAL_ESCALATIONS', escalations, '/escalations'],
      ['MISSING_MANDATORY_EVIDENCE', missingEvidence, '/deliveries'], ['RECONCILIATION_VARIANCE', reconciliation.violations.reduce((sum, violation) => sum + violation.count, 0), '/reports/reconciliation'],
      ['PARTICIPATION_STATE_INCONSISTENT', stateAllowed ? 0 : 1, '/participations'],
    ];
    const blockers = rows.filter(([, count]) => count > 0).map(([code, count, route]) => ({ code, count, severity: 'BLOCKING', route }));
    return { ready: blockers.length === 0, blockers, generatedAt: new Date() };
  }
}
