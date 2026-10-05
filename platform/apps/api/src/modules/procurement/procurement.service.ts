import { Injectable } from '@nestjs/common';
import { prisma, AccountRole, DamageCaseStatus, DeviceType, PurchaseOrderStatus, ShipmentStatus, Prisma, ReconciliationIssueStatus } from '@alzad/db';
import { ApiError } from '../../common/api-error';
import { IdempotencyService } from '../../common/idempotency.service';
import { lockParticipationForOperationalWrite } from '../../common/participation-write-lock.util';
import { PublicCodeService } from '../../common/public-code.service';
import { requiredText } from '../../common/validation/text.util';
import type { AuthContext } from '../auth/auth.types';
import type { CreatePurchaseOrderDto, CreateShipmentDto } from './procurement.dto';
import { shipmentReceiptVerified } from './shipment-receipt.util';
import { debitCentralStock, releaseCentralStock } from '../central-stock/central-stock.service';

@Injectable()
export class ProcurementService {
  constructor(private readonly idem: IdempotencyService, private readonly codes: PublicCodeService) {}

  listOrders(ctx: AuthContext) { return prisma.purchaseOrder.findMany({ where: ctx.role === AccountRole.ADMIN ? {} : { associationId: ctx.associationId ?? '__none__' }, include: { items: true, shipments: { include: { items: true } } }, orderBy: { createdAt: 'desc' } }); }

  createOrder(ctx: AuthContext, dto: CreatePurchaseOrderDto) {
    if (!dto.items?.length) throw new ApiError('PO_ITEMS_REQUIRED', 'بنود أمر الشراء مطلوبة', 400);
    for (const item of dto.items) if (!Object.values(DeviceType).includes(item.deviceType) || !Number.isInteger(item.approvedQty) || item.approvedQty < 1) throw new ApiError('PO_ITEM_INVALID', 'بند أمر الشراء غير صالح', 400);
    return prisma.$transaction(async (tx) => {
      const claim = await this.idem.claim<{ id: string }>(tx, ctx.accountId, 'purchase-order-create', dto.opId, dto); if (!claim.claimed) return claim.existingResponse!;
      await lockParticipationForOperationalWrite(tx, dto.associationId);
      const po = await tx.purchaseOrder.create({ data: { publicCode: await this.codes.nextPublicCode(tx, 'PO'), orderNumber: requiredText(dto.orderNumber, 'رقم أمر الشراء', 120), associationId: dto.associationId, supplierName: requiredText(dto.supplierName, 'المورد', 200), orderedAt: dto.orderedAt ? new Date(dto.orderedAt) : null, expectedDeliveryAt: dto.expectedDeliveryAt ? new Date(dto.expectedDeliveryAt) : null, createdById: ctx.accountId, items: { create: dto.items.map((i) => ({ deviceType: i.deviceType, spec: i.spec?.trim() || null, approvedQty: i.approvedQty })) } } });
      await audit(tx, ctx, 'PURCHASE_ORDER_CREATED', 'purchase_orders', po.id, dto.associationId); const response = { id: po.id }; await this.idem.complete(tx, ctx.accountId, 'purchase-order-create', dto.opId, response); return response;
    });
  }

  transitionOrder(ctx: AuthContext, id: string, status: PurchaseOrderStatus, opId: string) { return prisma.$transaction(async (tx) => {
    const claim = await this.idem.claim<{ ok: true }>(tx, ctx.accountId, 'purchase-order-transition', opId, { id, status }); if (!claim.claimed) return claim.existingResponse!;
    const scope = await tx.purchaseOrder.findUnique({ where: { id }, select: { associationId: true } });
    if (!scope) throw new ApiError('PO_TRANSITION_INVALID', 'انتقال أمر الشراء غير مسموح', 409);
    await lockParticipationForOperationalWrite(tx, scope.associationId);
    const po = await tx.purchaseOrder.findUnique({ where: { id } }); if (!po || po.status !== PurchaseOrderStatus.DRAFT || (status !== PurchaseOrderStatus.APPROVED && status !== PurchaseOrderStatus.CANCELLED)) throw new ApiError('PO_TRANSITION_INVALID', 'انتقال أمر الشراء غير مسموح', 409);
    await tx.purchaseOrder.update({ where: { id }, data: { status, approvedAt: status === PurchaseOrderStatus.APPROVED ? new Date() : null, approvedById: status === PurchaseOrderStatus.APPROVED ? ctx.accountId : null } }); await audit(tx, ctx, 'PURCHASE_ORDER_TRANSITIONED', 'purchase_orders', id, po.associationId, { status }); const response = { ok: true as const }; await this.idem.complete(tx, ctx.accountId, 'purchase-order-transition', opId, response); return response;
  }); }

  createShipment(ctx: AuthContext, dto: CreateShipmentDto) { if (!dto.items?.length) throw new ApiError('SHIPMENT_ITEMS_REQUIRED', 'بنود الشحنة مطلوبة', 400); return prisma.$transaction(async (tx) => {
    const claim = await this.idem.claim<{ id: string }>(tx, ctx.accountId, 'shipment-create', dto.opId, dto); if (!claim.claimed) return claim.existingResponse!;
    const scope = await tx.purchaseOrder.findUnique({ where: { id: dto.purchaseOrderId }, select: { associationId: true } });
    if (!scope) throw new ApiError('SHIPMENT_PO_INVALID', 'أمر الشراء غير معتمد للشحن', 409);
    await lockParticipationForOperationalWrite(tx, scope.associationId);
    await tx.$queryRaw`SELECT id FROM purchase_orders WHERE id=${dto.purchaseOrderId}::uuid FOR UPDATE`;
    const po = await tx.purchaseOrder.findUnique({ where: { id: dto.purchaseOrderId }, include: { items: { include: { shipmentItems: { include: { shipment: { select: { status: true } } } } } } } }); if (!po || (po.status !== PurchaseOrderStatus.APPROVED && po.status !== PurchaseOrderStatus.PARTIALLY_DELIVERED)) throw new ApiError('SHIPMENT_PO_INVALID', 'أمر الشراء غير معتمد للشحن', 409);
    const quantities = new Map<DeviceType, number>();
    const seen = new Set<string>();
    for (const input of dto.items) {
      if (seen.has(input.purchaseOrderItemId)) throw new ApiError('SHIPMENT_ITEM_DUPLICATE', 'لا يمكن تكرار بند أمر الشراء في الشحنة', 400);
      seen.add(input.purchaseOrderItemId);
      const line = po.items.find((i) => i.id === input.purchaseOrderItemId);
      const already = line?.shipmentItems.reduce((sum, item) => sum + (item.shipment.status === ShipmentStatus.CANCELLED ? 0 : item.shippedQty), 0) ?? 0;
      if (!line || !Number.isInteger(input.shippedQty) || input.shippedQty < 1 || already + input.shippedQty > line.approvedQty) throw new ApiError('SHIPMENT_QUANTITY_INVALID', 'كمية الشحن تتجاوز الكمية المعتمدة', 409);
      quantities.set(line.deviceType, (quantities.get(line.deviceType) ?? 0) + input.shippedQty);
    }
    const shipment = await tx.shipment.create({ data: { publicCode: await this.codes.nextPublicCode(tx, 'SHP'), purchaseOrderId: po.id, associationId: po.associationId, route: dto.route, scheduledAt: dto.scheduledAt ? new Date(dto.scheduledAt) : null, location: dto.location?.trim() || null, receiverInstructions: dto.receiverInstructions?.trim() || null, items: { create: dto.items.map((i) => ({ purchaseOrderItemId: i.purchaseOrderItemId, shippedQty: i.shippedQty })) } } });
    // Every newly created shipment, including one from an older PO, consumes
    // actual central stock. Historical shipments are never backfilled/debited.
    await debitCentralStock(tx, shipment.id, quantities);
    await tx.purchaseOrder.update({ where: { id: po.id }, data: { status: PurchaseOrderStatus.PARTIALLY_DELIVERED } }); await audit(tx, ctx, 'SHIPMENT_CREATED', 'shipments', shipment.id, po.associationId); const response = { id: shipment.id }; await this.idem.complete(tx, ctx.accountId, 'shipment-create', dto.opId, response); return response;
  }); }

  transitionShipment(ctx: AuthContext, id: string, status: ShipmentStatus, opId: string) { return prisma.$transaction(async (tx) => {
    const claim = await this.idem.claim<{ ok: true }>(tx, ctx.accountId, 'shipment-transition', opId, { id, status }); if (!claim.claimed) return claim.existingResponse!;
    const scope = await tx.shipment.findUnique({ where: { id }, select: { associationId: true } });
    if (!scope || (ctx.role === AccountRole.ASSOCIATION && scope.associationId !== ctx.associationId)) throw new ApiError('SHIPMENT_NOT_FOUND', 'الشحنة غير موجودة', 404);
    await lockParticipationForOperationalWrite(tx, scope.associationId);
    await tx.$queryRaw`SELECT id FROM shipments WHERE id=${id}::uuid FOR UPDATE`;
    const sh = await tx.shipment.findUnique({ where: { id }, include: {
      items: { include: { purchaseOrderItem: { select: { deviceType: true } } } },
      receiptBatches: { select: { status: true, confirmedAt: true, quantityPhotoFileId: true, signatureFileId: true, items: { select: { deviceType: true, sentQty: true, goodQty: true, damagedQty: true, missingQty: true, damageCases: { select: { status: true } } } } } },
      reconciliationIssues: { select: { status: true } },
    } }); if (!sh) throw new ApiError('SHIPMENT_NOT_FOUND', 'الشحنة غير موجودة', 404);
    if (ctx.role === AccountRole.ASSOCIATION && sh.associationId !== ctx.associationId) throw new ApiError('SHIPMENT_NOT_FOUND', 'الشحنة غير موجودة', 404);
    const associationAllowed = (sh.status === ShipmentStatus.DISPATCHED && (status === ShipmentStatus.PARTIALLY_RECEIVED || status === ShipmentStatus.RECEIVED || status === ShipmentStatus.RECONCILIATION_REQUIRED)) || (sh.status === ShipmentStatus.PARTIALLY_RECEIVED && (status === ShipmentStatus.RECEIVED || status === ShipmentStatus.RECONCILIATION_REQUIRED));
    if (ctx.role === AccountRole.ASSOCIATION && !associationAllowed) throw new ApiError('SHIPMENT_TRANSITION_FORBIDDEN', 'لا تملك الجمعية صلاحية هذا الانتقال', 403);
    const allowed: Partial<Record<ShipmentStatus, ShipmentStatus[]>> = { PLANNED: [ShipmentStatus.DISPATCHED, ShipmentStatus.CANCELLED], DISPATCHED: [ShipmentStatus.PARTIALLY_RECEIVED, ShipmentStatus.RECEIVED, ShipmentStatus.RECONCILIATION_REQUIRED], PARTIALLY_RECEIVED: [ShipmentStatus.RECEIVED, ShipmentStatus.RECONCILIATION_REQUIRED], RECEIVED: [ShipmentStatus.CLOSED, ShipmentStatus.RECONCILIATION_REQUIRED], RECONCILIATION_REQUIRED: [ShipmentStatus.CLOSED] }; if (!allowed[sh.status]?.includes(status)) throw new ApiError('SHIPMENT_TRANSITION_INVALID', 'انتقال حالة الشحنة غير مسموح', 409);
    if ((status === ShipmentStatus.PARTIALLY_RECEIVED || status === ShipmentStatus.RECEIVED || status === ShipmentStatus.RECONCILIATION_REQUIRED || status === ShipmentStatus.CLOSED)
      && !shipmentReceiptVerified(status, sh.items.map((item) => ({ deviceType: item.purchaseOrderItem.deviceType, shippedQty: item.shippedQty })), sh.receiptBatches)) {
      throw new ApiError('SHIPMENT_RECEIPT_REQUIRED', 'لا يمكن تغيير حالة الشحنة قبل توثيق استلامها بمحضر مرتبط وإثباتات صحيحة', 409);
    }
    if (status === ShipmentStatus.CLOSED && sh.reconciliationIssues.some((issue) => issue.status !== ReconciliationIssueStatus.SETTLED && issue.status !== ReconciliationIssueStatus.CLOSED)) {
      throw new ApiError('SHIPMENT_RECONCILIATION_OPEN', 'لا يمكن إغلاق الشحنة قبل تسوية فروقات الاستلام', 409);
    }
    if (status === ShipmentStatus.CLOSED && sh.receiptBatches.some((batch) => batch.items.some((item) => item.damageCases.some((damage) => damage.status !== DamageCaseStatus.CLOSED)))) {
      throw new ApiError('SHIPMENT_DAMAGE_OPEN', 'لا يمكن إغلاق الشحنة قبل اعتماد حالات التلف وإغلاقها', 409);
    }
    if (status === ShipmentStatus.CANCELLED) await releaseCentralStock(tx, id);
    await tx.shipment.update({ where: { id }, data: { status } }); await audit(tx, ctx, 'SHIPMENT_TRANSITIONED', 'shipments', id, sh.associationId, { status }); const response = { ok: true as const }; await this.idem.complete(tx, ctx.accountId, 'shipment-transition', opId, response); return response;
  }); }

  decideIssue(ctx: AuthContext, id: string, status: ReconciliationIssueStatus, resolution: string, opId: string) { return prisma.$transaction(async (tx) => {
    const claim = await this.idem.claim<{ ok: true }>(tx, ctx.accountId, 'reconciliation-issue-decision', opId, { id, status, resolution }); if (!claim.claimed) return claim.existingResponse!;
    const scope = await tx.shipmentReconciliationIssue.findUnique({ where: { id }, select: { associationId: true } });
    if (!scope) throw new ApiError('RECONCILIATION_ISSUE_INVALID', 'فجوة التسوية غير موجودة أو مغلقة', 409);
    await lockParticipationForOperationalWrite(tx, scope.associationId);
    const issue = await tx.shipmentReconciliationIssue.findUnique({ where: { id } }); if (!issue || issue.status === ReconciliationIssueStatus.CLOSED) throw new ApiError('RECONCILIATION_ISSUE_INVALID', 'فجوة التسوية غير موجودة أو مغلقة', 409); if (status === ReconciliationIssueStatus.CLOSED && issue.status !== ReconciliationIssueStatus.SETTLED) throw new ApiError('RECONCILIATION_SETTLEMENT_REQUIRED', 'يجب تسوية الفجوة قبل إغلاقها', 409);
    await tx.shipmentReconciliationIssue.update({ where: { id }, data: { status, resolution: requiredText(resolution, 'قرار التسوية', 2000), decidedById: ctx.accountId, decidedAt: new Date() } }); await audit(tx, ctx, 'RECONCILIATION_ISSUE_DECIDED', 'shipment_reconciliation_issues', id, issue.associationId, { status }); const response = { ok: true as const }; await this.idem.complete(tx, ctx.accountId, 'reconciliation-issue-decision', opId, response); return response;
  }); }
}

async function audit(tx: Prisma.TransactionClient, ctx: AuthContext, action: string, entityType: string, entityId: string, associationId: string, metadata?: Prisma.InputJsonObject) { await tx.auditLog.create({ data: { actorAccountId: ctx.accountId, actorRole: ctx.role, associationId, action, entityType, entityId, metadata } }); }
