-- PASS B locked scope completion. Additive only; no previously applied migration is altered.

CREATE TYPE "EligibilityStatus" AS ENUM ('PENDING', 'PASSED', 'FAILED', 'NEEDS_INFO');
CREATE TYPE "AssociationSelectionList" AS ENUM ('NONE', 'MAIN', 'RESERVE');
CREATE TYPE "ParticipationStatus" AS ENUM ('APPROVED_AWAITING_SETUP', 'ACTIVE', 'EXECUTING', 'READY_TO_CLOSE', 'CLOSURE_SUBMITTED', 'CLOSED', 'SUSPENDED', 'WITHDRAWN');
CREATE TYPE "ActivationBasis" AS ENUM ('AGREEMENT_COMPLETED', 'LEGACY_MIGRATION', 'ADMIN_REOPEN');
CREATE TYPE "AgreementStatus" AS ENUM ('DRAFT', 'SENT', 'SIGNED_BY_ORG', 'SIGNED', 'CANCELLED', 'SUPERSEDED');
CREATE TYPE "CoordinatorChangeStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');
CREATE TYPE "BeneficiaryListType" AS ENUM ('MAIN', 'RESERVE', 'REJECTED');
CREATE TYPE "DeliveryApprovalStage" AS ENUM ('ASSOCIATION', 'ZAAD');
CREATE TYPE "DeliveryApprovalDecision" AS ENUM ('APPROVED', 'RETURNED_FOR_FIX', 'REJECTED');
CREATE TYPE "ReturnCondition" AS ENUM ('GOOD', 'DAMAGED');
CREATE TYPE "EscalationStatus" AS ENUM ('OPEN', 'NEEDS_INFO', 'APPROVED', 'REJECTED', 'RESOLVED');
CREATE TYPE "EscalationSeverity" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');
CREATE TYPE "PurchaseOrderStatus" AS ENUM ('DRAFT', 'APPROVED', 'PARTIALLY_DELIVERED', 'FULFILLED', 'CANCELLED');
CREATE TYPE "ShipmentRoute" AS ENUM ('SUPPLIER_TO_ORGANIZATION', 'ORGANIZATION_PICKUP_FROM_SUPPLIER', 'ORGANIZATION_PICKUP_FROM_ZAAD');
CREATE TYPE "ShipmentStatus" AS ENUM ('PLANNED', 'DISPATCHED', 'PARTIALLY_RECEIVED', 'RECEIVED', 'RECONCILIATION_REQUIRED', 'CLOSED', 'CANCELLED');
CREATE TYPE "DamageCaseStatus" AS ENUM ('OPEN', 'UNDER_REVIEW', 'AWAITING_RETURN', 'RETURNED', 'AWAITING_REPLACEMENT', 'REPLACED', 'SETTLED', 'CLOSED');
CREATE TYPE "ReconciliationIssueType" AS ENUM ('MISSING', 'OVERAGE', 'QUANTITY_MISMATCH', 'OTHER');
CREATE TYPE "ReconciliationIssueStatus" AS ENUM ('OPEN', 'UNDER_REVIEW', 'SETTLED', 'CLOSED');
CREATE TYPE "NotificationSeverity" AS ENUM ('INFO', 'WARNING', 'CRITICAL');
CREATE TYPE "OrganizationClosureStatus" AS ENUM ('DRAFT', 'GENERATED', 'SUBMITTED', 'UNDER_REVIEW', 'APPROVED', 'CLOSED', 'REOPENED');
CREATE TYPE "ProjectClosureStatus" AS ENUM ('GENERATED', 'UNDER_INTERNAL_REVIEW', 'APPROVED_INTERNAL', 'SUBMITTED_TO_DONOR', 'DONOR_FEEDBACK', 'RESUBMITTED', 'DONOR_APPROVED', 'PROJECT_CLOSED');

ALTER TYPE "FileCategory" ADD VALUE 'APPLICATION_INITIAL_BENEFICIARIES';
ALTER TYPE "FileCategory" ADD VALUE 'PARTICIPATION_AGREEMENT';
ALTER TYPE "FileCategory" ADD VALUE 'ESCALATION_EVIDENCE';
ALTER TYPE "FileCategory" ADD VALUE 'PURCHASE_ORDER_DOCUMENT';
ALTER TYPE "FileCategory" ADD VALUE 'RETURN_EVIDENCE';
ALTER TYPE "OutboxEventType" ADD VALUE 'DELIVERY_SUBMITTED';
ALTER TYPE "OutboxEventType" ADD VALUE 'DELIVERY_ASSOCIATION_APPROVED';
ALTER TYPE "OutboxEventType" ADD VALUE 'RETURN_REQUESTED';
ALTER TYPE "OutboxEventType" ADD VALUE 'ESCALATION_OPENED';
ALTER TYPE "OutboxEventType" ADD VALUE 'SLA_ALERT_DUE';

ALTER TABLE "association_applications"
  ADD COLUMN "address" TEXT,
  ADD COLUMN "service_scope" TEXT,
  ADD COLUMN "coordinator_phone" TEXT,
  ADD COLUMN "coordinator_email" TEXT,
  ADD COLUMN "coordinator_title" TEXT,
  ADD COLUMN "beneficiary_database_updated_at" TIMESTAMP(3),
  ADD COLUMN "approx_beneficiary_count" INTEGER,
  ADD COLUMN "approx_need_count" INTEGER,
  ADD COLUMN "initial_beneficiary_file_id" UUID,
  ADD COLUMN "eligibility_status" "EligibilityStatus" NOT NULL DEFAULT 'PENDING',
  ADD COLUMN "eligibility_reviewed_at" TIMESTAMP(3),
  ADD COLUMN "eligibility_reviewed_by" UUID,
  ADD COLUMN "eligibility_notes" TEXT,
  ADD COLUMN "evaluation_breakdown" JSONB,
  ADD COLUMN "evaluation_score" DECIMAL(5,2),
  ADD COLUMN "evaluation_rank" INTEGER,
  ADD COLUMN "evaluated_at" TIMESTAMP(3),
  ADD COLUMN "evaluated_by" UUID,
  ADD COLUMN "geographic_need_score" DECIMAL(5,2),
  ADD COLUMN "selection_list" "AssociationSelectionList" NOT NULL DEFAULT 'NONE',
  ADD COLUMN "selection_reason" TEXT,
  ADD COLUMN "selection_approved_at" TIMESTAMP(3),
  ADD COLUMN "selection_approved_by" UUID,
  ADD COLUMN "supporter_approved_at" TIMESTAMP(3),
  ADD COLUMN "supporter_approval_reference" TEXT;

ALTER TABLE "beneficiaries"
  ADD COLUMN "list_type" "BeneficiaryListType",
  ADD COLUMN "list_rank" INTEGER,
  ADD COLUMN "list_reason" TEXT,
  ADD COLUMN "list_approved_at" TIMESTAMP(3),
  ADD COLUMN "list_approved_by" UUID;

ALTER TABLE "receipt_batches" ADD COLUMN "shipment_id" UUID;
ALTER TABLE "delivery_missions" ADD COLUMN "return_condition" "ReturnCondition";

CREATE TABLE "project_participations" (
  "id" UUID NOT NULL DEFAULT uuidv7(), "association_id" UUID, "application_id" UUID,
  "status" "ParticipationStatus" NOT NULL, "activation_basis" "ActivationBasis" NOT NULL,
  "coordinator_name" TEXT, "coordinator_phone" TEXT, "coordinator_email" TEXT, "coordinator_title" TEXT,
  "setup_completed_at" TIMESTAMP(3), "setup_completed_by" UUID, "activated_at" TIMESTAMP(3), "closed_at" TIMESTAMP(3),
  "activation_anomaly" BOOLEAN NOT NULL DEFAULT false, "activation_anomaly_reason" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "project_participations_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "project_participations_association_id_key" ON "project_participations"("association_id");
CREATE UNIQUE INDEX "project_participations_application_id_key" ON "project_participations"("application_id");
CREATE INDEX "project_participations_status_idx" ON "project_participations"("status");

CREATE TABLE "participation_agreements" (
  "id" UUID NOT NULL DEFAULT uuidv7(), "participation_id" UUID NOT NULL, "version" INTEGER NOT NULL,
  "template_version" TEXT NOT NULL, "status" "AgreementStatus" NOT NULL DEFAULT 'DRAFT', "file_id" UUID, "reference" TEXT,
  "sent_at" TIMESTAMP(3), "signed_by_org_at" TIMESTAMP(3), "signed_by_zaad_at" TIMESTAMP(3),
  "org_signer_name" TEXT, "zaad_signer_name" TEXT, "created_by" UUID NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "participation_agreements_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "participation_agreements_participation_id_version_key" ON "participation_agreements"("participation_id", "version");
CREATE INDEX "participation_agreements_participation_id_status_idx" ON "participation_agreements"("participation_id", "status");

CREATE TABLE "coordinator_change_requests" (
  "id" UUID NOT NULL DEFAULT uuidv7(), "participation_id" UUID NOT NULL,
  "proposed_name" TEXT NOT NULL, "proposed_phone" TEXT NOT NULL, "proposed_email" TEXT, "proposed_title" TEXT,
  "reason" TEXT NOT NULL, "status" "CoordinatorChangeStatus" NOT NULL DEFAULT 'PENDING',
  "requested_by" UUID NOT NULL, "decided_by" UUID, "decided_at" TIMESTAMP(3), "decision_notes" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "coordinator_change_requests_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "coordinator_change_requests_participation_id_status_idx" ON "coordinator_change_requests"("participation_id", "status");

CREATE TABLE "delivery_approvals" (
  "id" UUID NOT NULL DEFAULT uuidv7(), "mission_id" UUID NOT NULL, "stage" "DeliveryApprovalStage" NOT NULL,
  "decision" "DeliveryApprovalDecision" NOT NULL, "actor_id" UUID NOT NULL, "reason" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "delivery_approvals_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "delivery_approvals_mission_id_created_at_idx" ON "delivery_approvals"("mission_id", "created_at");

CREATE TABLE "escalation_cases" (
  "id" UUID NOT NULL DEFAULT uuidv7(), "association_id" UUID NOT NULL, "beneficiary_id" UUID,
  "delivery_mission_id" UUID, "receipt_batch_id" UUID, "evidence_file_id" UUID,
  "category" TEXT NOT NULL, "severity" "EscalationSeverity" NOT NULL, "description" TEXT NOT NULL,
  "requested_action" TEXT NOT NULL, "status" "EscalationStatus" NOT NULL DEFAULT 'OPEN', "resolution" TEXT,
  "created_by" UUID NOT NULL, "decided_by" UUID, "decided_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "escalation_cases_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "escalation_cases_association_id_status_severity_idx" ON "escalation_cases"("association_id", "status", "severity");

CREATE TABLE "beneficiary_replacements" (
  "id" UUID NOT NULL DEFAULT uuidv7(), "association_id" UUID NOT NULL, "old_beneficiary_id" UUID NOT NULL,
  "new_beneficiary_id" UUID NOT NULL, "escalation_case_id" UUID, "reason" TEXT NOT NULL,
  "authorized_by" UUID NOT NULL, "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "beneficiary_replacements_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "beneficiary_replacements_escalation_case_id_key" ON "beneficiary_replacements"("escalation_case_id");
CREATE INDEX "beneficiary_replacements_association_id_created_at_idx" ON "beneficiary_replacements"("association_id", "created_at");

CREATE TABLE "purchase_orders" (
  "id" UUID NOT NULL DEFAULT uuidv7(), "public_code" TEXT NOT NULL, "order_number" TEXT NOT NULL,
  "association_id" UUID NOT NULL, "supplier_name" TEXT NOT NULL, "status" "PurchaseOrderStatus" NOT NULL DEFAULT 'DRAFT',
  "ordered_at" TIMESTAMP(3), "expected_delivery_at" TIMESTAMP(3), "document_file_id" UUID,
  "created_by" UUID NOT NULL, "approved_by" UUID, "approved_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "purchase_orders_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "purchase_orders_public_code_key" ON "purchase_orders"("public_code");
CREATE UNIQUE INDEX "purchase_orders_order_number_key" ON "purchase_orders"("order_number");
CREATE INDEX "purchase_orders_association_id_status_idx" ON "purchase_orders"("association_id", "status");

CREATE TABLE "purchase_order_items" (
  "id" UUID NOT NULL DEFAULT uuidv7(), "purchase_order_id" UUID NOT NULL, "device_type" "DeviceType" NOT NULL,
  "spec" TEXT, "approved_qty" INTEGER NOT NULL,
  CONSTRAINT "purchase_order_items_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "purchase_order_items_approved_qty_check" CHECK ("approved_qty" > 0)
);
CREATE INDEX "purchase_order_items_purchase_order_id_idx" ON "purchase_order_items"("purchase_order_id");

CREATE TABLE "shipments" (
  "id" UUID NOT NULL DEFAULT uuidv7(), "public_code" TEXT NOT NULL, "purchase_order_id" UUID NOT NULL,
  "association_id" UUID NOT NULL, "route" "ShipmentRoute" NOT NULL, "status" "ShipmentStatus" NOT NULL DEFAULT 'PLANNED',
  "scheduled_at" TIMESTAMP(3), "location" TEXT, "receiver_instructions" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "shipments_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "shipments_public_code_key" ON "shipments"("public_code");
CREATE INDEX "shipments_association_id_status_idx" ON "shipments"("association_id", "status");

CREATE TABLE "shipment_items" (
  "id" UUID NOT NULL DEFAULT uuidv7(), "shipment_id" UUID NOT NULL, "purchase_order_item_id" UUID NOT NULL,
  "shipped_qty" INTEGER NOT NULL,
  CONSTRAINT "shipment_items_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "shipment_items_shipped_qty_check" CHECK ("shipped_qty" > 0)
);
CREATE UNIQUE INDEX "shipment_items_shipment_id_purchase_order_item_id_key" ON "shipment_items"("shipment_id", "purchase_order_item_id");

CREATE TABLE "damage_cases" (
  "id" UUID NOT NULL DEFAULT uuidv7(), "receipt_item_id" UUID, "device_id" UUID, "association_id" UUID NOT NULL,
  "quantity" INTEGER NOT NULL DEFAULT 1, "description" TEXT NOT NULL, "status" "DamageCaseStatus" NOT NULL DEFAULT 'OPEN',
  "return_required" BOOLEAN NOT NULL DEFAULT false, "returned_at" TIMESTAMP(3),
  "replacement_expected" BOOLEAN NOT NULL DEFAULT false, "replacement_received_at" TIMESTAMP(3),
  "resolution" TEXT, "closed_at" TIMESTAMP(3), "closed_by" UUID,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "damage_cases_pkey" PRIMARY KEY ("id"), CONSTRAINT "damage_cases_quantity_check" CHECK ("quantity" > 0)
);
CREATE INDEX "damage_cases_association_id_status_idx" ON "damage_cases"("association_id", "status");

CREATE TABLE "shipment_reconciliation_issues" (
  "id" UUID NOT NULL DEFAULT uuidv7(), "shipment_id" UUID NOT NULL, "receipt_item_id" UUID,
  "association_id" UUID NOT NULL, "type" "ReconciliationIssueType" NOT NULL,
  "expected_qty" INTEGER NOT NULL, "actual_qty" INTEGER NOT NULL, "status" "ReconciliationIssueStatus" NOT NULL DEFAULT 'OPEN',
  "reason" TEXT, "resolution" TEXT, "decided_by" UUID, "decided_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "shipment_reconciliation_issues_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "shipment_reconciliation_issues_association_id_status_idx" ON "shipment_reconciliation_issues"("association_id", "status");

CREATE TABLE "notifications" (
  "id" UUID NOT NULL DEFAULT uuidv7(), "account_id" UUID, "association_id" UUID, "audience_role" "AccountRole",
  "type" TEXT NOT NULL, "title" TEXT NOT NULL, "body" TEXT NOT NULL, "severity" "NotificationSeverity" NOT NULL DEFAULT 'INFO',
  "entity_type" TEXT NOT NULL, "entity_id" TEXT, "dedupe_key" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "read_at" TIMESTAMP(3),
  CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "notifications_dedupe_key_key" ON "notifications"("dedupe_key");
CREATE INDEX "notifications_account_id_read_at_created_at_idx" ON "notifications"("account_id", "read_at", "created_at");
CREATE INDEX "notifications_association_id_audience_role_read_at_idx" ON "notifications"("association_id", "audience_role", "read_at");

CREATE TABLE "organization_closure_reports" (
  "id" UUID NOT NULL DEFAULT uuidv7(), "participation_id" UUID NOT NULL,
  "status" "OrganizationClosureStatus" NOT NULL DEFAULT 'DRAFT', "snapshot_json" JSONB,
  "challenges" TEXT, "lessons_learned" TEXT, "recommendations" TEXT, "final_notes" TEXT,
  "generated_at" TIMESTAMP(3), "generated_by" UUID, "submitted_at" TIMESTAMP(3), "submitted_by" UUID,
  "reviewed_at" TIMESTAMP(3), "reviewed_by" UUID, "closed_at" TIMESTAMP(3), "closed_by" UUID,
  "reopened_at" TIMESTAMP(3), "reopened_by" UUID, "reopen_reason" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "organization_closure_reports_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "organization_closure_reports_participation_id_key" ON "organization_closure_reports"("participation_id");

CREATE TABLE "project_closure_reports" (
  "id" UUID NOT NULL DEFAULT uuidv7(), "project_key" TEXT NOT NULL,
  "status" "ProjectClosureStatus" NOT NULL DEFAULT 'GENERATED', "snapshot_json" JSONB NOT NULL,
  "executive_summary" TEXT, "project_analysis" TEXT, "consolidated_lessons" TEXT,
  "recommendations" TEXT, "management_commentary" TEXT, "donor_feedback_notes" TEXT, "last_actor_id" UUID,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "project_closure_reports_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "project_closure_reports_project_key_key" ON "project_closure_reports"("project_key");

ALTER TABLE "association_applications" ADD CONSTRAINT "association_applications_initial_beneficiary_file_id_fkey" FOREIGN KEY ("initial_beneficiary_file_id") REFERENCES "files"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "association_applications" ADD CONSTRAINT "association_applications_eligibility_reviewed_by_fkey" FOREIGN KEY ("eligibility_reviewed_by") REFERENCES "accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "association_applications" ADD CONSTRAINT "association_applications_evaluated_by_fkey" FOREIGN KEY ("evaluated_by") REFERENCES "accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "association_applications" ADD CONSTRAINT "association_applications_selection_approved_by_fkey" FOREIGN KEY ("selection_approved_by") REFERENCES "accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE UNIQUE INDEX "association_applications_initial_beneficiary_file_id_key" ON "association_applications"("initial_beneficiary_file_id");
ALTER TABLE "beneficiaries" ADD CONSTRAINT "beneficiaries_list_approved_by_fkey" FOREIGN KEY ("list_approved_by") REFERENCES "accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "project_participations" ADD CONSTRAINT "project_participations_association_id_fkey" FOREIGN KEY ("association_id") REFERENCES "associations"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "project_participations" ADD CONSTRAINT "project_participations_application_id_fkey" FOREIGN KEY ("application_id") REFERENCES "association_applications"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "project_participations" ADD CONSTRAINT "project_participations_setup_completed_by_fkey" FOREIGN KEY ("setup_completed_by") REFERENCES "accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "participation_agreements" ADD CONSTRAINT "participation_agreements_participation_id_fkey" FOREIGN KEY ("participation_id") REFERENCES "project_participations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "participation_agreements" ADD CONSTRAINT "participation_agreements_file_id_fkey" FOREIGN KEY ("file_id") REFERENCES "files"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "participation_agreements" ADD CONSTRAINT "participation_agreements_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "coordinator_change_requests" ADD CONSTRAINT "coordinator_change_requests_participation_id_fkey" FOREIGN KEY ("participation_id") REFERENCES "project_participations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "coordinator_change_requests" ADD CONSTRAINT "coordinator_change_requests_requested_by_fkey" FOREIGN KEY ("requested_by") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "coordinator_change_requests" ADD CONSTRAINT "coordinator_change_requests_decided_by_fkey" FOREIGN KEY ("decided_by") REFERENCES "accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "delivery_approvals" ADD CONSTRAINT "delivery_approvals_mission_id_fkey" FOREIGN KEY ("mission_id") REFERENCES "delivery_missions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "delivery_approvals" ADD CONSTRAINT "delivery_approvals_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "escalation_cases" ADD CONSTRAINT "escalation_cases_association_id_fkey" FOREIGN KEY ("association_id") REFERENCES "associations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "escalation_cases" ADD CONSTRAINT "escalation_cases_beneficiary_id_fkey" FOREIGN KEY ("beneficiary_id") REFERENCES "beneficiaries"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "escalation_cases" ADD CONSTRAINT "escalation_cases_delivery_mission_id_fkey" FOREIGN KEY ("delivery_mission_id") REFERENCES "delivery_missions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "escalation_cases" ADD CONSTRAINT "escalation_cases_receipt_batch_id_fkey" FOREIGN KEY ("receipt_batch_id") REFERENCES "receipt_batches"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "escalation_cases" ADD CONSTRAINT "escalation_cases_evidence_file_id_fkey" FOREIGN KEY ("evidence_file_id") REFERENCES "files"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "escalation_cases" ADD CONSTRAINT "escalation_cases_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "escalation_cases" ADD CONSTRAINT "escalation_cases_decided_by_fkey" FOREIGN KEY ("decided_by") REFERENCES "accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "beneficiary_replacements" ADD CONSTRAINT "beneficiary_replacements_association_id_fkey" FOREIGN KEY ("association_id") REFERENCES "associations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "beneficiary_replacements" ADD CONSTRAINT "beneficiary_replacements_old_beneficiary_id_fkey" FOREIGN KEY ("old_beneficiary_id") REFERENCES "beneficiaries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "beneficiary_replacements" ADD CONSTRAINT "beneficiary_replacements_new_beneficiary_id_fkey" FOREIGN KEY ("new_beneficiary_id") REFERENCES "beneficiaries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "beneficiary_replacements" ADD CONSTRAINT "beneficiary_replacements_escalation_case_id_fkey" FOREIGN KEY ("escalation_case_id") REFERENCES "escalation_cases"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "beneficiary_replacements" ADD CONSTRAINT "beneficiary_replacements_authorized_by_fkey" FOREIGN KEY ("authorized_by") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_association_id_fkey" FOREIGN KEY ("association_id") REFERENCES "associations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_document_file_id_fkey" FOREIGN KEY ("document_file_id") REFERENCES "files"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_approved_by_fkey" FOREIGN KEY ("approved_by") REFERENCES "accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "purchase_order_items" ADD CONSTRAINT "purchase_order_items_purchase_order_id_fkey" FOREIGN KEY ("purchase_order_id") REFERENCES "purchase_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "shipments" ADD CONSTRAINT "shipments_purchase_order_id_fkey" FOREIGN KEY ("purchase_order_id") REFERENCES "purchase_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "shipments" ADD CONSTRAINT "shipments_association_id_fkey" FOREIGN KEY ("association_id") REFERENCES "associations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "shipment_items" ADD CONSTRAINT "shipment_items_shipment_id_fkey" FOREIGN KEY ("shipment_id") REFERENCES "shipments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "shipment_items" ADD CONSTRAINT "shipment_items_purchase_order_item_id_fkey" FOREIGN KEY ("purchase_order_item_id") REFERENCES "purchase_order_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "receipt_batches" ADD CONSTRAINT "receipt_batches_shipment_id_fkey" FOREIGN KEY ("shipment_id") REFERENCES "shipments"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "damage_cases" ADD CONSTRAINT "damage_cases_receipt_item_id_fkey" FOREIGN KEY ("receipt_item_id") REFERENCES "receipt_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "damage_cases" ADD CONSTRAINT "damage_cases_device_id_fkey" FOREIGN KEY ("device_id") REFERENCES "device_units"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "damage_cases" ADD CONSTRAINT "damage_cases_association_id_fkey" FOREIGN KEY ("association_id") REFERENCES "associations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "damage_cases" ADD CONSTRAINT "damage_cases_closed_by_fkey" FOREIGN KEY ("closed_by") REFERENCES "accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "shipment_reconciliation_issues" ADD CONSTRAINT "shipment_reconciliation_issues_shipment_id_fkey" FOREIGN KEY ("shipment_id") REFERENCES "shipments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "shipment_reconciliation_issues" ADD CONSTRAINT "shipment_reconciliation_issues_receipt_item_id_fkey" FOREIGN KEY ("receipt_item_id") REFERENCES "receipt_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "shipment_reconciliation_issues" ADD CONSTRAINT "shipment_reconciliation_issues_association_id_fkey" FOREIGN KEY ("association_id") REFERENCES "associations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "shipment_reconciliation_issues" ADD CONSTRAINT "shipment_reconciliation_issues_decided_by_fkey" FOREIGN KEY ("decided_by") REFERENCES "accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_association_id_fkey" FOREIGN KEY ("association_id") REFERENCES "associations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "organization_closure_reports" ADD CONSTRAINT "organization_closure_reports_participation_id_fkey" FOREIGN KEY ("participation_id") REFERENCES "project_participations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "organization_closure_reports" ADD CONSTRAINT "organization_closure_reports_generated_by_fkey" FOREIGN KEY ("generated_by") REFERENCES "accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "organization_closure_reports" ADD CONSTRAINT "organization_closure_reports_submitted_by_fkey" FOREIGN KEY ("submitted_by") REFERENCES "accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "organization_closure_reports" ADD CONSTRAINT "organization_closure_reports_reviewed_by_fkey" FOREIGN KEY ("reviewed_by") REFERENCES "accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "organization_closure_reports" ADD CONSTRAINT "organization_closure_reports_closed_by_fkey" FOREIGN KEY ("closed_by") REFERENCES "accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "organization_closure_reports" ADD CONSTRAINT "organization_closure_reports_reopened_by_fkey" FOREIGN KEY ("reopened_by") REFERENCES "accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "project_closure_reports" ADD CONSTRAINT "project_closure_reports_last_actor_id_fkey" FOREIGN KEY ("last_actor_id") REFERENCES "accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Legacy backfill follows Association status and does not update Account status.
INSERT INTO "project_participations" (
  "id", "association_id", "status", "activation_basis", "activated_at", "activation_anomaly", "activation_anomaly_reason", "created_at", "updated_at"
)
SELECT uuidv7(), a."id",
  CASE WHEN a."status" = 'ACTIVE' THEN 'ACTIVE'::"ParticipationStatus" ELSE 'SUSPENDED'::"ParticipationStatus" END,
  'LEGACY_MIGRATION'::"ActivationBasis", CASE WHEN a."status" = 'ACTIVE' THEN a."created_at" ELSE NULL END,
  NOT EXISTS (
    SELECT 1 FROM "accounts" ac
    WHERE ac."association_id" = a."id" AND ac."role" = 'ASSOCIATION' AND ac."archived_at" IS NULL
      AND ((a."status" = 'ACTIVE' AND ac."status" = 'ACTIVE') OR (a."status" = 'INACTIVE' AND ac."status" = 'SUSPENDED'))
  ),
  CASE WHEN NOT EXISTS (
    SELECT 1 FROM "accounts" ac
    WHERE ac."association_id" = a."id" AND ac."role" = 'ASSOCIATION' AND ac."archived_at" IS NULL
      AND ((a."status" = 'ACTIVE' AND ac."status" = 'ACTIVE') OR (a."status" = 'INACTIVE' AND ac."status" = 'SUSPENDED'))
  ) THEN 'Association/Account status mismatch preserved for review' ELSE NULL END,
  CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "associations" a
ON CONFLICT ("association_id") DO NOTHING;

-- Explicit project calendar policy: Sunday-Thursday; Friday/Saturday weekend. Holidays remain configurable only.
INSERT INTO "system_settings" ("key", "value", "updated_at") VALUES
  ('calendar.workingDays', '[0,1,2,3,4]'::jsonb, CURRENT_TIMESTAMP),
  ('calendar.holidays', '[]'::jsonb, CURRENT_TIMESTAMP),
  ('evidence.requireRecipientSignature', 'true'::jsonb, CURRENT_TIMESTAMP),
  ('selection.weightsVersion', '"2026-approved-30-20-20-15-10-5"'::jsonb, CURRENT_TIMESTAMP)
ON CONFLICT ("key") DO NOTHING;

-- New operational tables inherit the production boundary: no direct Data API grants, RLS enabled with no public policies.
ALTER TABLE "project_participations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "participation_agreements" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "coordinator_change_requests" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "delivery_approvals" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "escalation_cases" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "beneficiary_replacements" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "purchase_orders" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "purchase_order_items" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "shipments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "shipment_items" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "damage_cases" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "shipment_reconciliation_issues" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "notifications" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "organization_closure_reports" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "project_closure_reports" ENABLE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON TABLE "project_participations", "participation_agreements", "coordinator_change_requests", "delivery_approvals", "escalation_cases", "beneficiary_replacements", "purchase_orders", "purchase_order_items", "shipments", "shipment_items", "damage_cases", "shipment_reconciliation_issues", "notifications", "organization_closure_reports", "project_closure_reports" FROM anon, authenticated;
