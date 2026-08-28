-- GATE-B Phase A: delivery approval / dual custody acknowledgement state model
-- See platform/docs/audit/final/14-PHASE-A-IMPLEMENTATION-BLUEPRINT.md §3
ALTER TYPE "DeviceStatus" ADD VALUE 'WITH_BENEFICIARY_PENDING_APPROVAL';
ALTER TYPE "DeliveryStatus" ADD VALUE 'PENDING_DELIVERY_APPROVAL';
ALTER TYPE "DeliveryStatus" ADD VALUE 'DEFERRED';
ALTER TYPE "DeliveryStatus" ADD VALUE 'PENDING_RETURN_APPROVAL';
