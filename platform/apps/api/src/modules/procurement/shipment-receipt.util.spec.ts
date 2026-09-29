import { ReceiptBatchStatus, ShipmentStatus } from '@alzad/db';
import { shipmentReceiptVerified } from './shipment-receipt.util';

const shipment = [{ deviceType: 'REFRIGERATOR', shippedQty: 3 }];
const receipt = (sentQty: number, goodQty = sentQty, overrides: Record<string, unknown> = {}) => ({
  status: ReceiptBatchStatus.RECEIVED_COMPLETE,
  confirmedAt: new Date(), quantityPhotoFileId: 'quantity', signatureFileId: 'signature',
  items: [{ deviceType: 'REFRIGERATOR', sentQty, goodQty, damagedQty: 0, missingQty: sentQty - goodQty }],
  ...overrides,
});

describe('shipment receipt evidence gate', () => {
  it('rejects receipt and closure without a linked confirmed batch', () => {
    expect(shipmentReceiptVerified(ShipmentStatus.RECEIVED, shipment, [])).toBe(false);
    expect(shipmentReceiptVerified(ShipmentStatus.CLOSED, shipment, [receipt(3, 3, { status: ReceiptBatchStatus.DRAFT })])).toBe(false);
  });
  it('rejects a confirmed batch without both evidence files', () => {
    expect(shipmentReceiptVerified(ShipmentStatus.RECEIVED, shipment, [receipt(3, 3, { signatureFileId: null })])).toBe(false);
  });
  it('permits partial reception, then full reception and closure after a second evidenced batch', () => {
    expect(shipmentReceiptVerified(ShipmentStatus.PARTIALLY_RECEIVED, shipment, [receipt(2)])).toBe(true);
    expect(shipmentReceiptVerified(ShipmentStatus.RECEIVED, shipment, [receipt(2)])).toBe(false);
    expect(shipmentReceiptVerified(ShipmentStatus.RECEIVED, shipment, [receipt(2), receipt(1)])).toBe(true);
    expect(shipmentReceiptVerified(ShipmentStatus.CLOSED, shipment, [receipt(2), receipt(1)])).toBe(true);
  });
  it('rejects overcounted or mismatched device types', () => {
    expect(shipmentReceiptVerified(ShipmentStatus.RECEIVED, shipment, [receipt(4)])).toBe(false);
    expect(shipmentReceiptVerified(ShipmentStatus.RECEIVED, shipment, [receipt(3, 3, { items: [{ deviceType: 'OVEN', sentQty: 3, goodQty: 3, damagedQty: 0, missingQty: 0 }] })])).toBe(false);
  });
});
