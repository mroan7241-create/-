import { Injectable } from '@nestjs/common';
import { AccountRole, DeviceType, Prisma, prisma } from '@alzad/db';
import { ApiError } from '../../common/api-error';
import { IdempotencyService } from '../../common/idempotency.service';
import type { AuthContext } from '../auth/auth.types';

type StockRow = { device_type: DeviceType };
const MAX_QTY = 2_147_483_647;

export function requireQuantity(value: number, label: string, allowZero = false): number {
  if (!Number.isSafeInteger(value) || value < (allowZero ? 0 : 1) || value > MAX_QTY) {
    throw new ApiError('CENTRAL_STOCK_QUANTITY_INVALID', `${label} يجب أن تكون كمية صحيحة ${allowZero ? 'غير سالبة' : 'موجبة'}`, 400);
  }
  return value;
}

export function requireDeviceType(value: DeviceType): DeviceType {
  if (!Object.values(DeviceType).includes(value)) {
    throw new ApiError('CENTRAL_STOCK_DEVICE_TYPE_INVALID', 'نوع الجهاز غير صالح', 400);
  }
  return value;
}

/** Atomic UPDATE locks the per-type balance row and rejects over-distribution. */
export async function debitCentralStock(
  tx: Prisma.TransactionClient,
  shipmentId: string,
  quantities: Map<DeviceType, number>,
): Promise<void> {
  for (const [deviceType, quantity] of [...quantities].sort(([a], [b]) => a.localeCompare(b))) {
    requireDeviceType(deviceType);
    requireQuantity(quantity, 'كمية الشحنة');
    const updated = await tx.$queryRaw<StockRow[]>`
      UPDATE central_stock_balances
      SET distributed_qty = distributed_qty + ${quantity}, updated_at = now()
      WHERE device_type = ${deviceType}::"DeviceType"
        AND distributed_qty <= received_qty - ${quantity}
      RETURNING device_type
    `;
    if (!updated.length) {
      throw new ApiError('CENTRAL_STOCK_INSUFFICIENT', `الكمية المستلمة في مخزون الزاد لا تكفي للشحنة (${deviceType})`, 409);
    }
    await tx.centralStockDispatch.create({ data: { shipmentId, deviceType, quantity } });
  }
}

/** Only a PLANNED shipment can be cancelled; release exactly its own active debits. */
export async function releaseCentralStock(tx: Prisma.TransactionClient, shipmentId: string): Promise<void> {
  const dispatches = await tx.centralStockDispatch.findMany({ where: { shipmentId, releasedAt: null }, orderBy: { deviceType: 'asc' } });
  for (const dispatch of dispatches) {
    await tx.centralStockBalance.update({
      where: { deviceType: dispatch.deviceType },
      data: { distributedQty: { decrement: dispatch.quantity } },
    });
    await tx.centralStockDispatch.update({ where: { id: dispatch.id }, data: { releasedAt: new Date() } });
  }
}

@Injectable()
export class CentralStockService {
  constructor(private readonly idempotency: IdempotencyService) {}

  async summary() {
    const [balances, receipts, dispatches] = await Promise.all([
      prisma.centralStockBalance.findMany({ orderBy: { deviceType: 'asc' } }),
      prisma.centralStockReceipt.findMany({ orderBy: { createdAt: 'desc' }, take: 20 }),
      prisma.centralStockDispatch.findMany({
        where: { releasedAt: null },
        include: { shipment: { select: { publicCode: true, association: { select: { name: true } } } } },
        orderBy: { createdAt: 'desc' }, take: 30,
      }),
    ]);
    return {
      balances: Object.values(DeviceType).map((deviceType) => {
        const row = balances.find((item) => item.deviceType === deviceType);
        return { deviceType, contractedQty: row?.contractedQty ?? 0, receivedQty: row?.receivedQty ?? 0,
          distributedQty: row?.distributedQty ?? 0, availableQty: (row?.receivedQty ?? 0) - (row?.distributedQty ?? 0) };
      }),
      receipts,
      dispatches,
    };
  }

  setContracted(ctx: AuthContext, deviceType: DeviceType, contractedQty: number, opId: string) {
    requireDeviceType(deviceType);
    requireQuantity(contractedQty, 'الكمية المتعاقد عليها', true);
    return prisma.$transaction(async (tx) => {
      const claim = await this.idempotency.claim<{ ok: true }>(tx, ctx.accountId, 'central-stock-contract', opId, { deviceType, contractedQty });
      if (!claim.claimed) return claim.existingResponse!;
      const rows = await tx.$queryRaw<StockRow[]>`
        INSERT INTO central_stock_balances (device_type, contracted_qty, received_qty, distributed_qty, updated_at)
        VALUES (${deviceType}::"DeviceType", ${contractedQty}, 0, 0, now())
        ON CONFLICT (device_type) DO UPDATE
        SET contracted_qty = EXCLUDED.contracted_qty, updated_at = now()
        WHERE central_stock_balances.received_qty <= EXCLUDED.contracted_qty
        RETURNING device_type
      `;
      if (!rows.length) throw new ApiError('CENTRAL_STOCK_CONTRACT_BELOW_RECEIVED', 'لا يمكن جعل المتعاقد عليه أقل من المستلم فعليًا', 409);
      await tx.auditLog.create({ data: { actorAccountId: ctx.accountId, actorRole: AccountRole.ADMIN,
        action: 'CENTRAL_STOCK_CONTRACT_SET', entityType: 'central_stock_balances', entityId: deviceType,
        metadata: { contractedQty } } });
      const response = { ok: true as const };
      await this.idempotency.complete(tx, ctx.accountId, 'central-stock-contract', opId, response);
      return response;
    });
  }

  recordReceipt(ctx: AuthContext, deviceType: DeviceType, quantity: number, reference: string, opId: string) {
    requireDeviceType(deviceType);
    requireQuantity(quantity, 'الكمية المستلمة');
    const cleanReference = reference?.trim();
    if (!cleanReference || cleanReference.length > 200) throw new ApiError('CENTRAL_STOCK_REFERENCE_REQUIRED', 'مرجع الاستلام مطلوب', 400);
    return prisma.$transaction(async (tx) => {
      const claim = await this.idempotency.claim<{ id: string }>(tx, ctx.accountId, 'central-stock-receipt', opId,
        { deviceType, quantity, reference: cleanReference });
      if (!claim.claimed) return claim.existingResponse!;
      const rows = await tx.$queryRaw<StockRow[]>`
        UPDATE central_stock_balances
        SET received_qty = received_qty + ${quantity}, updated_at = now()
        WHERE device_type = ${deviceType}::"DeviceType"
          AND received_qty <= contracted_qty - ${quantity}
        RETURNING device_type
      `;
      if (!rows.length) throw new ApiError('CENTRAL_STOCK_RECEIPT_EXCEEDS_CONTRACT', 'المستلم يتجاوز الكمية المتعاقد عليها؛ راجع الكمية الكلية أولًا', 409);
      const receipt = await tx.centralStockReceipt.create({ data: { deviceType, quantity, reference: cleanReference, recordedById: ctx.accountId } });
      await tx.auditLog.create({ data: { actorAccountId: ctx.accountId, actorRole: AccountRole.ADMIN,
        action: 'CENTRAL_STOCK_RECEIVED', entityType: 'central_stock_receipts', entityId: receipt.id,
        metadata: { deviceType, quantity, reference: cleanReference } } });
      const response = { id: receipt.id };
      await this.idempotency.complete(tx, ctx.accountId, 'central-stock-receipt', opId, response);
      return response;
    });
  }
}
