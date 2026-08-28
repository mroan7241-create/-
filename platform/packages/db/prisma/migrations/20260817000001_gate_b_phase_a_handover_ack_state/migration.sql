-- Assignment records the intended handover; custody moves only after the delegate confirms receipt.
ALTER TYPE "DeliveryStatus" ADD VALUE 'PENDING_DELEGATE_ACKNOWLEDGEMENT';
