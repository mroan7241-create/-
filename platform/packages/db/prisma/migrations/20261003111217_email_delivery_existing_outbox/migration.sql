-- Add the approved durable mail event to the existing outbox; no data rewrite.
ALTER TYPE "OutboxEventType" ADD VALUE 'EMAIL_DELIVERY';
