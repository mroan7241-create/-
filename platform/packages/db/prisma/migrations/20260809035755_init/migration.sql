-- CreateEnum
CREATE TYPE "AccountRole" AS ENUM ('ADMIN', 'ASSOCIATION', 'DELEGATE');

-- CreateEnum
CREATE TYPE "AccountStatus" AS ENUM ('ACTIVE', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "AuthCredentialType" AS ENUM ('EMAIL_PASSWORD', 'DELEGATE_ACCESS_CODE');

-- CreateEnum
CREATE TYPE "AssociationStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "ApplicationStatus" AS ENUM ('UNDER_REVIEW', 'ACCEPTED', 'REJECTED');

-- CreateEnum
CREATE TYPE "BeneficiaryReviewStatus" AS ENUM ('UNDER_REVIEW', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "LegacyBeneficiaryStatus" AS ENUM ('NEW', 'UNDER_REVIEW', 'APPROVED', 'AWAITING_DEVICES', 'DELIVERY_IN_PROGRESS', 'DELIVERED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "NeedDecisionStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "NeedFulfillmentStatus" AS ENUM ('APPROVED_ENTITLEMENT', 'AWAITING_DEVICE', 'DEVICE_READY', 'AWAITING_DELEGATE_ASSIGNMENT', 'ASSIGNED_TO_DELEGATE_PENDING', 'OUT_WITH_DELEGATE', 'DEFERRED', 'AWAITING_RETURN_CONFIRMATION', 'RETURNED_TO_ASSOCIATION_WAREHOUSE', 'DELIVERED');

-- CreateEnum
CREATE TYPE "NeedDeviceType" AS ENUM ('REFRIGERATOR', 'OVEN', 'WASHING_MACHINE');

-- CreateEnum
CREATE TYPE "DeviceStatus" AS ENUM ('WAREHOUSE', 'ALLOCATED', 'WITH_DELEGATE', 'DELIVERED', 'DAMAGED');

-- CreateEnum
CREATE TYPE "DeliveryStatus" AS ENUM ('NOT_STARTED', 'PREPARING', 'OUT_WITH_DELEGATE', 'DELIVERED', 'DELIVERY_FAILED');

-- CreateEnum
CREATE TYPE "DeliveryFailureReason" AS ENUM ('COULD_NOT_REACH', 'NO_ANSWER', 'POSTPONEMENT_REQUESTED', 'INCORRECT_ADDRESS', 'NOT_FOUND', 'RECEIPT_REFUSED');

-- CreateEnum
CREATE TYPE "ReceiptBatchStatus" AS ENUM ('DRAFT', 'AWAITING_ASSOCIATION_CONFIRMATION', 'RECEIVED_COMPLETE', 'RECEIVED_WITH_DISCREPANCIES');

-- CreateEnum
CREATE TYPE "LocationSource" AS ENUM ('MAP', 'CURRENT_LOCATION', 'IMPORT', 'MANUAL');

-- CreateEnum
CREATE TYPE "ReferenceValueType" AS ENUM ('REGION', 'CITY', 'ASSOCIATION_CATEGORY', 'SOCIAL_STATUS', 'DEVICE_TYPE');

-- CreateEnum
CREATE TYPE "FileCategory" AS ENUM ('ASSOCIATION_LICENSE', 'RECEIPT_QUANTITY_PHOTO', 'RECEIPT_SIGNATURE_PHOTO', 'RECEIPT_DAMAGE_PHOTO', 'DELIVERY_PROOF_PHOTO', 'DELIVERY_RECIPIENT_SIGNATURE', 'ACTIVITY_EVIDENCE');

-- CreateEnum
CREATE TYPE "DeviceAllocationStatus" AS ENUM ('ACTIVE', 'RELEASED');

-- CreateEnum
CREATE TYPE "IdempotencyKeyStatus" AS ENUM ('IN_PROGRESS', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "OutboxEventType" AS ENUM ('BENEFICIARY_APPROVED', 'RECEIPT_CONFIRMED', 'STOCK_INCREASED');

-- CreateEnum
CREATE TYPE "OutboxEventStatus" AS ENUM ('PENDING', 'PROCESSED', 'FAILED');

-- CreateEnum
CREATE TYPE "DeviceMovementLocationType" AS ENUM ('WAREHOUSE', 'DELEGATE', 'BENEFICIARY', 'DAMAGED_HOLDING');

-- CreateTable
CREATE TABLE "accounts" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "public_code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT,
    "role" "AccountRole" NOT NULL,
    "association_id" UUID,
    "status" "AccountStatus" NOT NULL DEFAULT 'ACTIVE',
    "must_change_password" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "archived_at" TIMESTAMP(3),

    CONSTRAINT "accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "auth_credentials" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "account_id" UUID NOT NULL,
    "type" "AuthCredentialType" NOT NULL,
    "identifier" TEXT NOT NULL,
    "secret_hash" TEXT NOT NULL,
    "previous_secret_hash" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "auth_credentials_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "auth_sessions" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "account_id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "revoked_at" TIMESTAMP(3),
    "last_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ip_address" TEXT,
    "user_agent" TEXT,

    CONSTRAINT "auth_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "associations" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "public_code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "region" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "phones" TEXT[],
    "email" TEXT,
    "status" "AssociationStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "archived_at" TIMESTAMP(3),

    CONSTRAINT "associations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "association_applications" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "public_code" TEXT NOT NULL,
    "client_request_id" TEXT,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "region" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "email" TEXT,
    "contact_name" TEXT NOT NULL,
    "notes" TEXT,
    "license_number" TEXT,
    "license_expiry_date" DATE,
    "license_file_id" UUID,
    "pledge_accepted" BOOLEAN NOT NULL DEFAULT false,
    "pledge_accepted_at" TIMESTAMP(3),
    "status" "ApplicationStatus" NOT NULL DEFAULT 'UNDER_REVIEW',
    "reject_reason" TEXT,
    "resulting_association_id" UUID,
    "submitted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewed_at" TIMESTAMP(3),
    "reviewed_by" UUID,

    CONSTRAINT "association_applications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "application_answers" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "application_id" UUID NOT NULL,
    "question_key" TEXT NOT NULL,
    "answer" BOOLEAN NOT NULL,

    CONSTRAINT "application_answers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reference_values" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "type" "ReferenceValueType" NOT NULL,
    "value" TEXT NOT NULL,
    "parent_id" UUID,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "reference_values_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "beneficiaries" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "public_code" TEXT NOT NULL,
    "association_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "region" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "district" TEXT,
    "phone" TEXT NOT NULL,
    "secondary_phone" TEXT,
    "family_count" INTEGER NOT NULL,
    "social_security" BOOLEAN NOT NULL DEFAULT false,
    "marital_status" TEXT NOT NULL,
    "income" DECIMAL(12,2),
    "latitude" DECIMAL(9,6),
    "longitude" DECIMAL(9,6),
    "location_source" "LocationSource",
    "location_updated_at" TIMESTAMP(3),
    "review_status" "BeneficiaryReviewStatus" NOT NULL DEFAULT 'UNDER_REVIEW',
    "beneficiary_reject_reason" TEXT,
    "reviewed_by" UUID,
    "reviewed_at" TIMESTAMP(3),
    "legacy_status" "LegacyBeneficiaryStatus",
    "legacy_needs_text" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "archived_at" TIMESTAMP(3),

    CONSTRAINT "beneficiaries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "beneficiary_needs" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "public_code" TEXT NOT NULL,
    "beneficiary_id" UUID NOT NULL,
    "association_id" UUID NOT NULL,
    "device_type" "NeedDeviceType" NOT NULL,
    "decision_status" "NeedDecisionStatus" NOT NULL DEFAULT 'PENDING',
    "reject_reason" TEXT,
    "reviewed_by" UUID,
    "reviewed_at" TIMESTAMP(3),
    "fulfillment_status" "NeedFulfillmentStatus",
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "beneficiary_needs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "files" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "storage_provider" TEXT NOT NULL,
    "bucket" TEXT NOT NULL,
    "object_key" TEXT NOT NULL,
    "original_name" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "size_bytes" BIGINT NOT NULL,
    "sha256" TEXT,
    "category" "FileCategory" NOT NULL,
    "uploaded_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "files_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "receipt_batches" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "public_code" TEXT NOT NULL,
    "association_id" UUID NOT NULL,
    "supplier_name" TEXT NOT NULL,
    "sent_at" TIMESTAMP(3),
    "created_by" UUID NOT NULL,
    "status" "ReceiptBatchStatus" NOT NULL DEFAULT 'DRAFT',
    "notes" TEXT,
    "receiver_name" TEXT,
    "receiver_title" TEXT,
    "quantity_photo_file_id" UUID,
    "signature_file_id" UUID,
    "confirmed_at" TIMESTAMP(3),
    "confirmed_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "receipt_batches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "receipt_items" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "public_code" TEXT NOT NULL,
    "receipt_batch_id" UUID NOT NULL,
    "device_type" TEXT NOT NULL,
    "spec" TEXT,
    "sent_qty" INTEGER NOT NULL,
    "good_qty" INTEGER NOT NULL DEFAULT 0,
    "damaged_qty" INTEGER NOT NULL DEFAULT 0,
    "missing_qty" INTEGER NOT NULL DEFAULT 0,
    "difference_reason" TEXT,
    "difference_notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "receipt_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "receipt_damage_photos" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "public_code" TEXT NOT NULL,
    "receipt_item_id" UUID NOT NULL,
    "file_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "receipt_damage_photos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "device_units" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "public_code" TEXT NOT NULL,
    "association_id" UUID NOT NULL,
    "device_type" TEXT NOT NULL,
    "spec" TEXT,
    "receipt_item_id" UUID,
    "status" "DeviceStatus" NOT NULL DEFAULT 'WAREHOUSE',
    "current_location_type" "DeviceMovementLocationType" NOT NULL,
    "current_location_ref" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "delivered_at" TIMESTAMP(3),
    "beneficiary_need_id" UUID,

    CONSTRAINT "device_units_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "device_allocations" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "device_id" UUID NOT NULL,
    "beneficiary_need_id" UUID NOT NULL,
    "beneficiary_id" UUID NOT NULL,
    "association_id" UUID NOT NULL,
    "status" "DeviceAllocationStatus" NOT NULL DEFAULT 'ACTIVE',
    "allocated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "released_at" TIMESTAMP(3),
    "release_reason" TEXT,
    "created_by" UUID,
    "source" TEXT,

    CONSTRAINT "device_allocations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "device_movements" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "device_id" UUID NOT NULL,
    "association_id" UUID NOT NULL,
    "from_location_type" "DeviceMovementLocationType",
    "from_location_ref" UUID,
    "to_location_type" "DeviceMovementLocationType" NOT NULL,
    "to_location_ref" UUID,
    "reason" TEXT NOT NULL,
    "reference_type" TEXT,
    "reference_id" UUID,
    "performed_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "device_movements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "delivery_missions" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "public_code" TEXT NOT NULL,
    "beneficiary_id" UUID NOT NULL,
    "association_id" UUID NOT NULL,
    "delegate_account_id" UUID,
    "status" "DeliveryStatus" NOT NULL DEFAULT 'NOT_STARTED',
    "assigned_at" TIMESTAMP(3),
    "scheduled_for" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "delivery_missions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "delivery_attempts" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "public_code" TEXT NOT NULL,
    "mission_id" UUID NOT NULL,
    "beneficiary_id" UUID NOT NULL,
    "delegate_account_id" UUID NOT NULL,
    "status" "DeliveryStatus" NOT NULL,
    "failure_reason" "DeliveryFailureReason",
    "notes" TEXT,
    "proof_file_id" UUID,
    "recipient_signature_file_id" UUID,
    "attempted_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "delivery_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "activities" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "phase_order" INTEGER NOT NULL,
    "phase_name" TEXT NOT NULL,
    "main_activity_order" INTEGER NOT NULL,
    "main_activity_name" TEXT NOT NULL,
    "sub_activity_name" TEXT,
    "responsible" TEXT,
    "start_date" DATE,
    "end_date" DATE,
    "completion_percent" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "activities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "activity_evidence" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "activity_id" UUID NOT NULL,
    "file_id" UUID,
    "approval_status" TEXT NOT NULL,
    "notes" TEXT,
    "uploaded_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "activity_evidence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "actor_account_id" UUID,
    "actor_role" "AccountRole",
    "association_id" UUID,
    "action" TEXT NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" TEXT,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "idempotency_keys" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "account_id" UUID NOT NULL,
    "scope" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "request_hash" TEXT NOT NULL,
    "status" "IdempotencyKeyStatus" NOT NULL DEFAULT 'IN_PROGRESS',
    "response_json" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3),

    CONSTRAINT "idempotency_keys_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "system_settings" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "system_settings_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "outbox_events" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "type" "OutboxEventType" NOT NULL,
    "status" "OutboxEventStatus" NOT NULL DEFAULT 'PENDING',
    "payload" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processed_at" TIMESTAMP(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "last_error" TEXT,

    CONSTRAINT "outbox_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "accounts_public_code_key" ON "accounts"("public_code");

-- CreateIndex
CREATE INDEX "accounts_email_status_idx" ON "accounts"("email", "status");

-- CreateIndex
CREATE INDEX "auth_credentials_account_id_idx" ON "auth_credentials"("account_id");

-- CreateIndex
CREATE UNIQUE INDEX "auth_credentials_type_identifier_key" ON "auth_credentials"("type", "identifier");

-- CreateIndex
CREATE UNIQUE INDEX "auth_sessions_token_hash_key" ON "auth_sessions"("token_hash");

-- CreateIndex
CREATE INDEX "auth_sessions_account_id_idx" ON "auth_sessions"("account_id");

-- CreateIndex
CREATE UNIQUE INDEX "associations_public_code_key" ON "associations"("public_code");

-- CreateIndex
CREATE INDEX "associations_status_idx" ON "associations"("status");

-- CreateIndex
CREATE UNIQUE INDEX "association_applications_public_code_key" ON "association_applications"("public_code");

-- CreateIndex
CREATE UNIQUE INDEX "association_applications_client_request_id_key" ON "association_applications"("client_request_id");

-- CreateIndex
CREATE INDEX "association_applications_status_idx" ON "association_applications"("status");

-- CreateIndex
CREATE UNIQUE INDEX "application_answers_application_id_question_key_key" ON "application_answers"("application_id", "question_key");

-- CreateIndex
CREATE UNIQUE INDEX "reference_values_type_value_parent_id_key" ON "reference_values"("type", "value", "parent_id");

-- CreateIndex
CREATE UNIQUE INDEX "beneficiaries_public_code_key" ON "beneficiaries"("public_code");

-- CreateIndex
CREATE INDEX "beneficiaries_association_id_review_status_idx" ON "beneficiaries"("association_id", "review_status");

-- CreateIndex
CREATE INDEX "beneficiaries_phone_idx" ON "beneficiaries"("phone");

-- CreateIndex
CREATE UNIQUE INDEX "beneficiary_needs_public_code_key" ON "beneficiary_needs"("public_code");

-- CreateIndex
CREATE INDEX "beneficiary_needs_beneficiary_id_idx" ON "beneficiary_needs"("beneficiary_id");

-- CreateIndex
CREATE INDEX "beneficiary_needs_association_id_decision_status_fulfillmen_idx" ON "beneficiary_needs"("association_id", "decision_status", "fulfillment_status");

-- CreateIndex
CREATE UNIQUE INDEX "beneficiary_needs_beneficiary_id_device_type_key" ON "beneficiary_needs"("beneficiary_id", "device_type");

-- CreateIndex
CREATE INDEX "files_category_idx" ON "files"("category");

-- CreateIndex
CREATE UNIQUE INDEX "files_bucket_object_key_key" ON "files"("bucket", "object_key");

-- CreateIndex
CREATE UNIQUE INDEX "receipt_batches_public_code_key" ON "receipt_batches"("public_code");

-- CreateIndex
CREATE INDEX "receipt_batches_association_id_status_idx" ON "receipt_batches"("association_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "receipt_items_public_code_key" ON "receipt_items"("public_code");

-- CreateIndex
CREATE INDEX "receipt_items_receipt_batch_id_idx" ON "receipt_items"("receipt_batch_id");

-- CreateIndex
CREATE UNIQUE INDEX "receipt_damage_photos_public_code_key" ON "receipt_damage_photos"("public_code");

-- CreateIndex
CREATE INDEX "receipt_damage_photos_receipt_item_id_idx" ON "receipt_damage_photos"("receipt_item_id");

-- CreateIndex
CREATE UNIQUE INDEX "device_units_public_code_key" ON "device_units"("public_code");

-- CreateIndex
CREATE INDEX "device_units_association_id_device_type_status_idx" ON "device_units"("association_id", "device_type", "status");

-- CreateIndex
CREATE INDEX "device_allocations_association_id_status_idx" ON "device_allocations"("association_id", "status");

-- CreateIndex
CREATE INDEX "device_movements_device_id_created_at_idx" ON "device_movements"("device_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "delivery_missions_public_code_key" ON "delivery_missions"("public_code");

-- CreateIndex
CREATE INDEX "delivery_missions_delegate_account_id_status_idx" ON "delivery_missions"("delegate_account_id", "status");

-- CreateIndex
CREATE INDEX "delivery_missions_association_id_status_idx" ON "delivery_missions"("association_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "delivery_attempts_public_code_key" ON "delivery_attempts"("public_code");

-- CreateIndex
CREATE INDEX "delivery_attempts_mission_id_idx" ON "delivery_attempts"("mission_id");

-- CreateIndex
CREATE INDEX "activity_evidence_activity_id_idx" ON "activity_evidence"("activity_id");

-- CreateIndex
CREATE INDEX "audit_logs_entity_type_entity_id_created_at_idx" ON "audit_logs"("entity_type", "entity_id", "created_at");

-- CreateIndex
CREATE INDEX "audit_logs_actor_account_id_created_at_idx" ON "audit_logs"("actor_account_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "idempotency_keys_account_id_scope_key_key" ON "idempotency_keys"("account_id", "scope", "key");

-- CreateIndex
CREATE INDEX "outbox_events_status_created_at_idx" ON "outbox_events"("status", "created_at");

-- AddForeignKey
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_association_id_fkey" FOREIGN KEY ("association_id") REFERENCES "associations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "auth_credentials" ADD CONSTRAINT "auth_credentials_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "auth_sessions" ADD CONSTRAINT "auth_sessions_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "association_applications" ADD CONSTRAINT "association_applications_license_file_id_fkey" FOREIGN KEY ("license_file_id") REFERENCES "files"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "association_applications" ADD CONSTRAINT "association_applications_resulting_association_id_fkey" FOREIGN KEY ("resulting_association_id") REFERENCES "associations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "association_applications" ADD CONSTRAINT "association_applications_reviewed_by_fkey" FOREIGN KEY ("reviewed_by") REFERENCES "accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "application_answers" ADD CONSTRAINT "application_answers_application_id_fkey" FOREIGN KEY ("application_id") REFERENCES "association_applications"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reference_values" ADD CONSTRAINT "reference_values_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "reference_values"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "beneficiaries" ADD CONSTRAINT "beneficiaries_association_id_fkey" FOREIGN KEY ("association_id") REFERENCES "associations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "beneficiaries" ADD CONSTRAINT "beneficiaries_reviewed_by_fkey" FOREIGN KEY ("reviewed_by") REFERENCES "accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "beneficiary_needs" ADD CONSTRAINT "beneficiary_needs_beneficiary_id_fkey" FOREIGN KEY ("beneficiary_id") REFERENCES "beneficiaries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "beneficiary_needs" ADD CONSTRAINT "beneficiary_needs_association_id_fkey" FOREIGN KEY ("association_id") REFERENCES "associations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "beneficiary_needs" ADD CONSTRAINT "beneficiary_needs_reviewed_by_fkey" FOREIGN KEY ("reviewed_by") REFERENCES "accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "files" ADD CONSTRAINT "files_uploaded_by_fkey" FOREIGN KEY ("uploaded_by") REFERENCES "accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receipt_batches" ADD CONSTRAINT "receipt_batches_association_id_fkey" FOREIGN KEY ("association_id") REFERENCES "associations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receipt_batches" ADD CONSTRAINT "receipt_batches_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receipt_batches" ADD CONSTRAINT "receipt_batches_confirmed_by_fkey" FOREIGN KEY ("confirmed_by") REFERENCES "accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receipt_batches" ADD CONSTRAINT "receipt_batches_quantity_photo_file_id_fkey" FOREIGN KEY ("quantity_photo_file_id") REFERENCES "files"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receipt_batches" ADD CONSTRAINT "receipt_batches_signature_file_id_fkey" FOREIGN KEY ("signature_file_id") REFERENCES "files"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receipt_items" ADD CONSTRAINT "receipt_items_receipt_batch_id_fkey" FOREIGN KEY ("receipt_batch_id") REFERENCES "receipt_batches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receipt_damage_photos" ADD CONSTRAINT "receipt_damage_photos_receipt_item_id_fkey" FOREIGN KEY ("receipt_item_id") REFERENCES "receipt_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receipt_damage_photos" ADD CONSTRAINT "receipt_damage_photos_file_id_fkey" FOREIGN KEY ("file_id") REFERENCES "files"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "device_units" ADD CONSTRAINT "device_units_association_id_fkey" FOREIGN KEY ("association_id") REFERENCES "associations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "device_units" ADD CONSTRAINT "device_units_receipt_item_id_fkey" FOREIGN KEY ("receipt_item_id") REFERENCES "receipt_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "device_units" ADD CONSTRAINT "device_units_beneficiary_need_id_fkey" FOREIGN KEY ("beneficiary_need_id") REFERENCES "beneficiary_needs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "device_allocations" ADD CONSTRAINT "device_allocations_device_id_fkey" FOREIGN KEY ("device_id") REFERENCES "device_units"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "device_allocations" ADD CONSTRAINT "device_allocations_beneficiary_need_id_fkey" FOREIGN KEY ("beneficiary_need_id") REFERENCES "beneficiary_needs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "device_allocations" ADD CONSTRAINT "device_allocations_beneficiary_id_fkey" FOREIGN KEY ("beneficiary_id") REFERENCES "beneficiaries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "device_allocations" ADD CONSTRAINT "device_allocations_association_id_fkey" FOREIGN KEY ("association_id") REFERENCES "associations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "device_allocations" ADD CONSTRAINT "device_allocations_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "device_movements" ADD CONSTRAINT "device_movements_device_id_fkey" FOREIGN KEY ("device_id") REFERENCES "device_units"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "device_movements" ADD CONSTRAINT "device_movements_association_id_fkey" FOREIGN KEY ("association_id") REFERENCES "associations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "device_movements" ADD CONSTRAINT "device_movements_performed_by_fkey" FOREIGN KEY ("performed_by") REFERENCES "accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_missions" ADD CONSTRAINT "delivery_missions_beneficiary_id_fkey" FOREIGN KEY ("beneficiary_id") REFERENCES "beneficiaries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_missions" ADD CONSTRAINT "delivery_missions_association_id_fkey" FOREIGN KEY ("association_id") REFERENCES "associations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_missions" ADD CONSTRAINT "delivery_missions_delegate_account_id_fkey" FOREIGN KEY ("delegate_account_id") REFERENCES "accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_attempts" ADD CONSTRAINT "delivery_attempts_mission_id_fkey" FOREIGN KEY ("mission_id") REFERENCES "delivery_missions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_attempts" ADD CONSTRAINT "delivery_attempts_beneficiary_id_fkey" FOREIGN KEY ("beneficiary_id") REFERENCES "beneficiaries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_attempts" ADD CONSTRAINT "delivery_attempts_delegate_account_id_fkey" FOREIGN KEY ("delegate_account_id") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_attempts" ADD CONSTRAINT "delivery_attempts_proof_file_id_fkey" FOREIGN KEY ("proof_file_id") REFERENCES "files"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_attempts" ADD CONSTRAINT "delivery_attempts_recipient_signature_file_id_fkey" FOREIGN KEY ("recipient_signature_file_id") REFERENCES "files"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activity_evidence" ADD CONSTRAINT "activity_evidence_activity_id_fkey" FOREIGN KEY ("activity_id") REFERENCES "activities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activity_evidence" ADD CONSTRAINT "activity_evidence_file_id_fkey" FOREIGN KEY ("file_id") REFERENCES "files"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actor_account_id_fkey" FOREIGN KEY ("actor_account_id") REFERENCES "accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_association_id_fkey" FOREIGN KEY ("association_id") REFERENCES "associations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "idempotency_keys" ADD CONSTRAINT "idempotency_keys_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ============================================================
-- قيود بنيوية إضافية لا يدعمها Prisma schema مباشرة (partial unique
-- indexes بشرط WHERE) — أُضيفت يدويًا بعد توليد الـmigration الأساسية
-- من `prisma migrate diff`. توثيق القرار في schema.prisma (تعليق فوق
-- device_allocations) وplatform/docs/DATA_MODEL.md.
-- ============================================================

-- جهاز واحد لا يملك أكثر من تخصيص ACTIVE واحد في وقت واحد.
CREATE UNIQUE INDEX "ux_device_allocations_active_device"
  ON "device_allocations" ("device_id")
  WHERE "status" = 'ACTIVE';

-- احتياج واحد لا يملك أكثر من جهاز ACTIVE مخصَّص له في وقت واحد.
CREATE UNIQUE INDEX "ux_device_allocations_active_need"
  ON "device_allocations" ("beneficiary_need_id")
  WHERE "status" = 'ACTIVE';

-- ============================================================
-- CHECK constraints — بنود محضر الاستلام (receipt_items)
-- ============================================================
ALTER TABLE "receipt_items"
  ADD CONSTRAINT "ck_receipt_items_sent_qty_positive" CHECK ("sent_qty" > 0);

ALTER TABLE "receipt_items"
  ADD CONSTRAINT "ck_receipt_items_good_qty_non_negative" CHECK ("good_qty" >= 0);

ALTER TABLE "receipt_items"
  ADD CONSTRAINT "ck_receipt_items_damaged_qty_non_negative" CHECK ("damaged_qty" >= 0);

ALTER TABLE "receipt_items"
  ADD CONSTRAINT "ck_receipt_items_missing_qty_non_negative" CHECK ("missing_qty" >= 0);

-- التحقق النهائي (good + damaged + missing = sent) يُفرض عبر Database
-- CHECK constraint هنا أيضًا كخط دفاع أخير على مستوى البيانات، بالإضافة
-- إلى فرضه داخل transaction عند التأكيد في apps/api (راجع
-- platform/docs/ARCHITECTURE.md، قسم "Database Transactions") — القيمة
-- الافتراضية للأعمدة الثلاثة صفر قبل التأكيد، لذا هذا القيد لا يمنع
-- إنشاء بند بانتظار التأكيد (0 + 0 + 0 != sent_qty)، فهو مطبَّق فقط بعد
-- أن تكتب عملية التأكيد الكميات الثلاث فعليًا ضمن نفس الـtransaction.
ALTER TABLE "receipt_items"
  ADD CONSTRAINT "ck_receipt_items_quantities_reconcile"
  CHECK (
    ("good_qty" = 0 AND "damaged_qty" = 0 AND "missing_qty" = 0)
    OR ("good_qty" + "damaged_qty" + "missing_qty" = "sent_qty")
  );
