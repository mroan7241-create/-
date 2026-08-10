import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Min,
  ValidateNested,
} from 'class-validator';
import { DeviceType, ReceiptBatchStatus } from '@alzad/db';
import { PaginationQueryDto } from '../../../common/validation/pagination-query.dto';

const DEVICE_TYPE_VALUES = Object.values(DeviceType);

export class CreateReceiptItemDto {
  @IsIn(DEVICE_TYPE_VALUES)
  deviceType!: DeviceType;

  @IsString()
  spec!: string;

  @IsInt()
  @Min(1)
  sentQty!: number;
}

/** `POST /receipts` — ADMIN فقط؛ إنشاء محضر + بنوده كعملية ذرّية واحدة، الحالة الابتدائية دومًا مسودة. */
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

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CreateReceiptItemDto)
  items!: CreateReceiptItemDto[];

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
