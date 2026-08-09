import { IsIn, IsOptional, IsString } from 'class-validator';

/**
 * multipart/form-data — كل الحقول تصل كنصوص (حتى pledgeAccepted/answers)؛
 * التحويل الفعلي (boolean/JSON) يحدث داخل ApplicationsService، لا هنا،
 * حتى تبقى رسائل الخطأ خاصة بالتحقق الحقيقي (Validation.gs) لا بشكل الحقل.
 */
export class SubmitApplicationDto {
  @IsString()
  clientRequestId!: string;

  @IsString()
  name!: string;

  @IsOptional()
  @IsString()
  category?: string;

  @IsString()
  sector!: string;

  @IsString()
  region!: string;

  @IsString()
  city!: string;

  @IsString()
  phone!: string;

  @IsString()
  email!: string;

  @IsString()
  contactName!: string;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsString()
  licenseNumber!: string;

  @IsString()
  licenseExpiryDate!: string;

  /** JSON-encoded {[questionKey]: boolean} — 8 مفاتيح Config.gs::APPLICATION_QUESTIONS. */
  @IsString()
  answers!: string;

  /** 'true'|'false' نصًا (multipart) — يجب أن يكون 'true' حرفيًا. */
  @IsString()
  pledgeAccepted!: string;

  /** honeypot — يجب أن يبقى فارغًا من مستخدم حقيقي. */
  @IsOptional()
  @IsString()
  website?: string;
}

export class ReviewApplicationDto {
  @IsIn(['accept', 'reject'])
  decision!: 'accept' | 'reject';

  @IsOptional()
  @IsString()
  reason?: string;

  @IsString()
  opId!: string;
}
