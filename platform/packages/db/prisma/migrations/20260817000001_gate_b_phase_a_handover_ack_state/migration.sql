-- GATE-B Phase A: dual custody acknowledgement — handover recorded by Association,
-- physical custody not transferred until the Delegate separately confirms receipt.
-- See ALZAD Gate A §27 (Decision A) and audit/final/14-PHASE-A-IMPLEMENTATION-BLUEPRINT.md §3
ALTER TYPE "DeliveryStatus" ADD VALUE 'PENDING_DELEGATE_ACKNOWLEDGEMENT';
