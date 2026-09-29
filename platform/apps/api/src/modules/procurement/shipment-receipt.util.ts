import { ReceiptBatchStatus, ShipmentStatus } from '@alzad/db';

type ShipmentLine = { deviceType: string; shippedQty: number };
type ReceiptLine = { deviceType: string | null; sentQty: number; goodQty: number; damagedQty: number; missingQty: number };
type LinkedReceipt = {
  status: ReceiptBatchStatus;
  confirmedAt: Date | null;
  quantityPhotoFileId: string | null;
  signatureFileId: string | null;
  items: ReceiptLine[];
};

/** Only a confirmed, evidenced, linked receipt can advance shipment receipt state. */
export function shipmentReceiptVerified(
  target: ShipmentStatus,
  shipped: ShipmentLine[],
  batches: LinkedReceipt[],
): boolean {
  const expected = new Map<string, number>();
  for (const line of shipped) expected.set(line.deviceType, (expected.get(line.deviceType) ?? 0) + line.shippedQty);

  const accounted = new Map<string, { good: number; damaged: number; missing: number; sent: number }>();
  let hasConfirmed = false;
  let hasDiscrepancy = false;
  for (const batch of batches) {
    if (batch.status !== ReceiptBatchStatus.RECEIVED_COMPLETE && batch.status !== ReceiptBatchStatus.RECEIVED_WITH_DISCREPANCIES) continue;
    if (!batch.confirmedAt || !batch.quantityPhotoFileId || !batch.signatureFileId) return false;
    hasConfirmed = true;
    if (batch.status === ReceiptBatchStatus.RECEIVED_WITH_DISCREPANCIES) hasDiscrepancy = true;
    for (const item of batch.items) {
      if (!item.deviceType || !expected.has(item.deviceType)) return false;
      const total = accounted.get(item.deviceType) ?? { good: 0, damaged: 0, missing: 0, sent: 0 };
      total.good += item.goodQty;
      total.damaged += item.damagedQty;
      total.missing += item.missingQty;
      total.sent += item.sentQty;
      accounted.set(item.deviceType, total);
    }
  }
  if (!hasConfirmed) return false;
  const totals = [...expected].map(([type, quantity]) => ({ quantity, actual: accounted.get(type) ?? { good: 0, damaged: 0, missing: 0, sent: 0 } }));
  if (totals.some(({ quantity, actual }) => actual.sent > quantity || actual.good + actual.damaged + actual.missing !== actual.sent)) return false;
  const fullyAccounted = totals.every(({ quantity, actual }) => actual.sent === quantity);
  const fullyReceivedGood = totals.every(({ quantity, actual }) => actual.good === quantity && actual.damaged === 0 && actual.missing === 0);
  if (target === ShipmentStatus.RECEIVED) return fullyAccounted && fullyReceivedGood && !hasDiscrepancy;
  if (target === ShipmentStatus.RECONCILIATION_REQUIRED) return hasDiscrepancy;
  if (target === ShipmentStatus.PARTIALLY_RECEIVED) return totals.some(({ actual }) => actual.good + actual.damaged > 0) && !fullyReceivedGood;
  if (target === ShipmentStatus.CLOSED) return fullyAccounted;
  return true;
}
