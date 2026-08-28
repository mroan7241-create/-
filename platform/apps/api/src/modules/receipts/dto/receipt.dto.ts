import { IsIn, IsOptional, IsString, IsUUID } from 'class-validator';
import { ReceiptBatchStatus } from '@alzad/db';
import { PaginationQueryDto } from '../../../common/validation/pagination-query.dto';

/**
 * `POST /receipts` — ADMIN فقط؛ إنشاء محضر + بنوده كعملية ذرّية واحدة،
 * الحالة الابتدائية دومًا مسودة. NODE-4.2: أصبح الـendpoint
 * multipart-capable (إثبات شراء إداري اختياري عبر حقل `adminProofFile`)
 * مع بقاء التوافق الخلفي الكامل لطلبات JSON العادية (multer لا يتدخل
 * إطلاقًا في طلبات غير multipart). لذلك `items` يصل إما مصفوفة حقيقية
 * (JSON) أو نصًا JSON (multipart) — التحقق الفعلي في `parseCreateItems`
 * (خارج DTO عمدًا، نفس نمط `items`/`damagePhotoLinks` في
 * `ConfirmReceiptBatchDto` أدناه)؛ `@IsOptional()` هنا فقط لتفادي حذف
 * الحقل عبر `whitelist: true` قبل وصوله لِ`parseCreateItems`.
 */
export class CreateReceiptBatchDto {
  @IsUUID()
  associationId!: string;

  @IsString()
  supplierName!: string;

  @IsString()
  sentDate!: string;

  @IsOptional()
  @IsString()
  notes?: string;

  /** NODE-4.2 — رقم مستند مرجعي اختياري (لا نظام مشتريات/RFQ/PO). */
  @IsOptional()
  @IsString()
  documentNumber?: string;

  @IsOptional()
  items?: unknown;

  @IsString()
  opId!: string;
}

/** `GET /receipts` — نطاق ADMIN مقابل ASSOCIATION يُحسم داخل الخدمة من AuthContext حصرًا، لا من associationId المُرسَل. */
export class ListReceiptBatchesQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsUUID()
  associationId?: string;

  @IsOptional()
  @IsIn(Object.values(ReceiptBatchStatus))
  status?: ReceiptBatchStatus;
}

/**
 * `POST /receipts/:id/confirm` — multipart/form-data (ASSOCIATION فقط).
 * `items`/`damagePhotoLinks` تصل كنصوص JSON (نفس نمط `answers` في
 * NODE-2's SubmitApplicationDto) — التحويل الفعلي يحدث داخل الخدمة، حتى
 * تبقى رسائل الخطأ خاصة بالتحقق الحقيقي (StateRules/Validation) لا شكل
 * الحقل الخام.
 */
export class ConfirmReceiptBatchDto {
  @IsString()
  receiverTitle!: string;

  /** JSON-encoded: [{itemId, receivedQty, damagedQty, missingQty, differenceReason?, differenceNotes?}] — بند غائب = استلام كامل. */
  @IsOptional()
  @IsString()
  items?: string;

  /** JSON-encoded: [[itemId, itemId, ...], ...] — بترتيب يطابق ملفات damagePhotos المرفوعة بنفس الترتيب. */
  @IsOptional()
  @IsString()
  damagePhotoLinks?: string;

  @IsString()
  opId!: string;
}

export class SendReceiptBatchDto {
  @IsString()
  opId!: string;
}

/** `GET /receipts/:id/evidence/:evidenceType` — معامل الاستعلام damagePhotoId، إن وُجد، UUID فقط. */
export class ReceiptEvidenceQueryDto {
  @IsOptional()
  @IsUUID()
  damagePhotoId?: string;
}
