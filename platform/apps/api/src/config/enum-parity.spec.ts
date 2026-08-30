import { DeviceStatus as DbDeviceStatus, DeliveryStatus as DbDeliveryStatus, OutboxEventStatus as DbOutboxEventStatus, OutboxEventType as DbOutboxEventType } from '@alzad/db';
import { DeviceStatus as SharedDeviceStatus, DeliveryStatus as SharedDeliveryStatus, OutboxEventStatus as SharedOutboxEventStatus, OutboxEventType as SharedOutboxEventType } from '@alzad/shared';
describe('live enum parity', () => {
  it('keeps Prisma and shared runtime values byte-for-byte equal', () => {
    expect(Object.values(SharedDeviceStatus)).toEqual(Object.values(DbDeviceStatus));
    expect(Object.values(SharedDeliveryStatus)).toEqual(Object.values(DbDeliveryStatus));
    expect(Object.values(DbDeviceStatus)).toContain('WITH_BENEFICIARY_PENDING_APPROVAL');
    expect(Object.values(SharedOutboxEventType)).toEqual(Object.values(DbOutboxEventType));
    expect(Object.values(SharedOutboxEventStatus)).toEqual(Object.values(DbOutboxEventStatus));
    expect(Object.values(DbDeliveryStatus)).toContain('DELIVERY_CLOSED');
  });
});
