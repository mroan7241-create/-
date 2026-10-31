ALTER TABLE "beneficiaries" ADD COLUMN "submitted_device_types" "DeviceType"[] NOT NULL DEFAULT ARRAY[]::"DeviceType"[];
UPDATE "beneficiaries" b SET "submitted_device_types" = COALESCE((SELECT array_agg(n.device_type ORDER BY n.device_type) FROM beneficiary_needs n WHERE n.beneficiary_id=b.id), ARRAY[]::"DeviceType"[]);
CREATE INDEX "beneficiaries_association_id_archived_at_need_priority_id_idx" ON "beneficiaries"("association_id", "archived_at", "need_priority", "id");
CREATE TABLE "beneficiary_information_requests" (
 "id" UUID NOT NULL DEFAULT uuidv7(), "beneficiary_id" UUID NOT NULL, "association_id" UUID NOT NULL, "batch_id" UUID NOT NULL,
 "status" TEXT NOT NULL DEFAULT 'OPEN', "items" JSONB NOT NULL, "message" TEXT, "email_event_id" UUID, "due_at" TIMESTAMP(3), "source_snapshot" JSONB NOT NULL, "source_updated_at" TIMESTAMP(3) NOT NULL,
 "response" JSONB, "response_note" TEXT, "requested_by_id" UUID NOT NULL, "resolved_by_id" UUID,
 "submitted_at" TIMESTAMP(3), "resolved_at" TIMESTAMP(3), "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updated_at" TIMESTAMP(3) NOT NULL,
 CONSTRAINT "beneficiary_information_requests_pkey" PRIMARY KEY ("id"),
 CONSTRAINT "beneficiary_information_requests_status_check" CHECK (status IN ('OPEN','SUBMITTED','CLOSED','CANCELLED')),
 CONSTRAINT "beneficiary_information_requests_beneficiary_fkey" FOREIGN KEY ("beneficiary_id", "association_id") REFERENCES "beneficiaries"("id", "association_id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "beneficiary_information_requests_association_id_status_created_at_idx" ON "beneficiary_information_requests"("association_id", "status", "created_at");
CREATE INDEX "beneficiary_information_requests_beneficiary_id_created_at_idx" ON "beneficiary_information_requests"("beneficiary_id", "created_at");
CREATE UNIQUE INDEX "beneficiary_information_requests_one_active" ON "beneficiary_information_requests"("beneficiary_id") WHERE status IN ('OPEN','SUBMITTED');
ALTER TABLE "beneficiary_information_requests" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "beneficiary_information_requests" FROM anon, authenticated;
