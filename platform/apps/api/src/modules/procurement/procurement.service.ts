import { Injectable } from '@nestjs/common';
import { prisma, AccountRole, DeviceType, PurchaseOrderStatus, ShipmentStatus, Prisma, ReconciliationIssueStatus } from '@alzad/db';
import { ApiError } from '../../common/api-error';
import { IdempotencyService } from '../../common/idempotency.service';
import { PublicCodeService } from '../../common/public-code.service';
import { requiredText } from '../../common/validation/text.util';
import type { AuthContext } from '../auth/auth.types';
import type { CreatePurchaseOrderDto, CreateShipmentDto } from './procurement.dto';

@Injectable()
export class ProcurementService {
  constructor(private readonly idem: IdempotencyService, private readonly codes: PublicCodeService) {}

  listOrders(ctx: AuthContext) { return prisma.purchaseOrder.findMany({ where: ctx.role === AccountRole.ADMIN ? {} : { associationId: ctx.associationId ?? '__none__' }, include: { items: true, shipments: { include: { items: true } } }, orderBy: { createdAt: 'desc' } }); }

  createOrder(ctx: AuthContext, dto: CreatePurchaseOrderDto) {
    if (!dto.items?.length) throw new ApiError('PO_ITEMS_REQUIRED', 'بنود أمر الشراء مطلوبة', 400);
    for (const item of dto.items) if (!Object.values(DeviceType).includes(item.deviceType) || !Number.isInteger(item.approvedQty) || item.approvedQty < 1) throw new ApiError('PO_ITEM_INVALID', 'بند أمر الشراء غير صالح', 400);
    return prisma.$transaction(async (tx) => {
      const claim = await this.idem.claim<{ id: string }>(tx, ctx.accountId, 'purchase-order-create', dto.opId, dto); if (!claim.claimed) return claim.existingResponse!;
      const po = await tx.purchaseOrder.create({ data: { publicCode: await this.codes.nextPublicCode(tx, 'PO'), orderNumber: requiredText(dto.orderNumber, 'رقم أمر الشراء', 120), associationId: dto.associationId, supplierName: requiredText(dto.supplierName, 'المورد', 200), orderedAt: dto.orderedAt ? new Date(dto.orderedAt) : null, expectedDeliveryAt: dto.expectedDeliveryAt ? new Date(dto.expectedDeliveryAt) : null, createdById: ctx.accountId, items: { create: dto.items.map((i) => ({ deviceType: i.deviceType, spec: i.spec?.trim() || null, approvedQty: i.approvedQty })) } } });
      await audit(tx, ctx, 'PURCHASE_ORDER_CREATED', 'purchase_orders', po.id, dto.associationId); const response = { id: po.id }; await this.idem.complete(tx, ctx.accountId, 'purchase-order-create', dto.opId, response); return response;
    });
  }

  transitionOrder(ctx: AuthContext, id: string, status: PurchaseOrderStatus, opId: string) { return prisma.$transaction(async (tx) => {
    const claim = await this.idem.claim<{ ok: true }>(tx, ctx.accountId, 'purchase-order-transition', opId, { id, status }); if (!claim.claimed) return claim.existingResponse!;
    const po = await tx.purchaseOrder.findUnique({ where: { id } }); if (!po || po.status !== PurchaseOrderStatus.DRAFT || (status !== PurchaseOrderStatus.APPROVED && status !== PurchaseOrderStatus.CANCELLED)) throw new ApiError('PO_TRANSITION_INVALID', 'انتقال أمر الشراء غير مسموح', 409);
    await tx.purchaseOrder.update({ where: { id }, data: { status, approvedAt: status === PurchaseOrderStatus.APPROVED ? new Date() : null, approvedById: status === PurchaseOrderStatus.APPROVED ? ctx.accountId : null } }); await audit(tx, ctx, 'PURCHASE_ORDER_TRANSITIONED', 'purchase_orders', id, po.associationId, { status }); const response = { ok: true as const }; await this.idem.complete(tx, ctx.accountId, 'purchase-order-transition', opId, response); return response;
  }); }

  createShipment(ctx: AuthContext, dto: CreateShipmentDto) { if (!dto.items?.length) throw new ApiError('SHIPMENT_ITEMS_REQUIRED', 'بنود الشحنة مطلوبة', 400); return prisma.$transaction(async (tx) => {
    const claim = await this.idem.claim<{ id: string }>(tx, ctx.accountId, 'shipment-create', dto.opId, dto); if (!claim.claimed) return claim.existingResponse!; await tx.$queryRaw`SELECT id FROM purchase_orders WHERE id=${dto.purchaseOrderId}::uuid FOR UPDATE`;
    const po = await tx.purchaseOrder.findUnique({ where: { id: dto.purchaseOrderId }, include: { items: { include: { shipmentItems: true } } } }); if (!po || (po.status !== PurchaseOrderStatus.APPROVED && po.status !== PurchaseOrderStatus.PARTIALLY_DELIVERED)) throw new ApiError('SHIPMENT_PO_INVALID', 'أمر الشراء غير معتمد للشحن', 409);
    for (const input of dto.items) { const line = po.items.find((i) => i.id === input.purchaseOrderItemId); const already = line?.shipmentItems.reduce((sum, item) => sum + item.shippedQty, 0) ?? 0; if (!line || !Number.isInteger(input.shippedQty) || input.shippedQty < 1 || already + input.shippedQty > line.approvedQty) throw new ApiError('SHIPMENT_QUANTITY_INVALID', 'كمية الشحن تتجاوز الكمية المعتمدة', 409); }
    const shipment = await tx.shipment.create({ data: { publicCode: await this.codes.nextPublicCode(tx, 'SHP'), purchaseOrderId: po.id, associationId: po.associationId, route: dto.route, scheduledAt: dto.scheduledAt ? new Date(dto.scheduledAt) : null, location: dto.location?.trim() || null, receiverInstructions: dto.receiverInstructions?.trim() || null, items: { create: dto.items.map((i) => ({ purchaseOrderItemId: i.purchaseOrderItemId, shippedQty: i.shippedQty })) } } }); await tx.purchaseOrder.update({ where: { id: po.id }, data: { status: PurchaseOrderStatus.PARTIALLY_DELIVERED } }); await audit(tx, ctx, 'SHIPMENT_CREATED', 'shipments', shipment.id, po.associationId); const response = { id: shipment.id }; await this.idem.complete(tx, ctx.accountId, 'shipment-create', dto.opId, response); return response;
  }); }

  transitionShipment(ctx: AuthContext, id: string, status: ShipmentStatus, opId: string) { return prisma.$transaction(async (tx) => {
    const claim = await this.idem.claim<{ ok: true }>(tx, ctx.accountId, 'shipment-transition', opId, { id, status }); if (!claim.claimed) return claim.existingResponse!; const sh = await tx.shipment.findUnique({ where: { id } }); if (!sh) throw new ApiError('SHIPMENT_NOT_FOUND', 'الشحنة غير موجودة', 404);
    if (ctx.role === AccountRole.ASSOCIATION && sh.associationId !== ctx.associationId) throw new ApiError('SHIPMENT_NOT_FOUND', 'الشحنة غير موجودة', 404);
    const associationAllowed = (sh.status === ShipmentStatus.DISPATCHED && (status === ShipmentStatus.PARTIALLY_RECEIVED || status === ShipmentStatus.RECEIVED || status === ShipmentStatus.RECONCILIATION_REQUIRED)) || (sh.status === ShipmentStatus.PARTIALLY_RECEIVED && (status === ShipmentStatus.RECEIVED || status === ShipmentStatus.RECONCILIATION_REQUIRED));
    if (ctx.role === AccountRole.ASSOCIATION && !associationAllowed) throw new ApiError('SHIPMENT_TRANSITION_FORBIDDEN', 'لا تملك الجمعية صلاحية هذا الانتقال', 403);
    const allowed: Partial<Record<ShipmentStatus, ShipmentStatus[]>> = { PLANNED: [ShipmentStatus.DISPATCHED, ShipmentStatus.CANCELLED], DISPATCHED: [ShipmentStatus.PARTIALLY_RECEIVED, ShipmentStatus.RECEIVED, ShipmentStatus.RECONCILIATION_REQUIRED], PARTIALLY_RECEIVED: [ShipmentStatus.RECEIVED, ShipmentStatus.RECONCILIATION_REQUIRED], RECEIVED: [ShipmentStatus.CLOSED, ShipmentStatus.RECONCILIATION_REQUIRED], RECONCILIATION_REQUIRED: [ShipmentStatus.CLOSED] }; if (!allowed[sh.status]?.includes(status)) throw new ApiError('SHIPMENT_TRANSITION_INVALID', 'انتقال حالة الشحنة غير مسموح', 409);
    await tx.shipment.update({ where: { id }, data: { status } }); await audit(tx, ctx, 'SHIPMENT_TRANSITIONED', 'shipments', id, sh.associationId, { status }); const response = { ok: true as const }; await this.idem.complete(tx, ctx.accountId, 'shipment-transition', opId, response); return response;
  }); }

  decideIssue(ctx: AuthContext, id: string, status: ReconciliationIssueStatus, resolution: string, opId: string) { return prisma.$transaction(async (tx) => {
    const claim = await this.idem.claim<{ ok: true }>(tx, ctx.accountId, 'reconciliation-issue-decision', opId, { id, status, resolution }); if (!claim.claimed) return claim.existingResponse!; const issue = await tx.shipmentReconciliationIssue.findUnique({ where: { id } }); if (!issue || issue.status === ReconciliationIssueStatus.CLOSED) throw new ApiError('RECONCILIATION_ISSUE_INVALID', 'فجوة التسوية غير موجودة أو مغلقة', 409); if (status === ReconciliationIssueStatus.CLOSED && issue.status !== ReconciliationIssueStatus.SETTLED) throw new ApiError('RECONCILIATION_SETTLEMENT_REQUIRED', 'يجب تسوية الفجوة قبل إغلاقها', 409);
    await tx.shipmentReconciliationIssue.update({ where: { id }, data: { status, resolution: requiredText(resolution, 'قرار التسوية', 2000), decidedById: ctx.accountId, decidedAt: new Date() } }); await audit(tx, ctx, 'RECONCILIATION_ISSUE_DECIDED', 'shipment_reconciliation_issues', id, issue.associationId, { status }); const response = { ok: true as const }; await this.idem.complete(tx, ctx.accountId, 'reconciliation-issue-decision', opId, response); return response;
  }); }
}

async function audit(tx: Prisma.TransactionClient, ctx: AuthContext, action: string, entityType: string, entityId: string, associationId: string, metadata?: Prisma.InputJsonObject) { await tx.auditLog.create({ data: { actorAccountId: ctx.accountId, actorRole: ctx.role, associationId, action, entityType, entityId, metadata } }); }
