import { IsIn, IsOptional, IsString } from 'class-validator';
import { AssociationStatus } from '@alzad/db';
import { PaginationQueryDto } from '../../../common/validation/pagination-query.dto';
import { ASSOCIATION_SORT_FIELDS, type AssociationSortField } from '../association-sort.util';

export class CreateAssociationDto {
  @IsString()
  name!: string;

  @IsOptional()
  @IsString()
  category?: string;

  @IsString()
  region!: string;

  @IsString()
  city!: string;

  @IsString()
  phone!: string;

  @IsString()
  email!: string;

  @IsOptional()
  @IsIn(['ACTIVE', 'INACTIVE'])
  status?: 'ACTIVE' | 'INACTIVE';

  @IsString()
  temporaryPassword!: string;

  @IsString()
  opId!: string;
}

export class UpdateAssociationDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  category?: string;

  @IsOptional()
  @IsString()
  region?: string;

  @IsOptional()
  @IsString()
  city?: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsString()
  email?: string;

  @IsOptional()
  @IsIn(['ACTIVE', 'INACTIVE'])
  status?: 'ACTIVE' | 'INACTIVE';
}

export class AssociationSelfSettingsDto {
  @IsString()
  phone!: string;

  @IsString()
  email!: string;
}

/**
 * NODE-2.1 — معاملات `GET /associations` بتحقق زمن تشغيل حقيقي.
 *
 * `status` كان مُعلَنًا `AssociationStatus` في التوقيع فقط (نوع TypeScript
 * يُمحى عند البناء)، فكانت أي سلسلة عشوائية تمرّ كما هي إلى
 * `where.status` في Prisma. الآن `@IsIn` يرفضها بـ400 قبل أي استعلام.
 *
 * `sortBy` قائمة بيضاء صارمة مقابل أعمدة Prisma حقيقية — لا يُبنى أي
 * مرجع عمود من نص العميل (راجع ASSOCIATIONS.md §الترتيب).
 */
export class ListAssociationsQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsIn(Object.values(AssociationStatus))
  status?: AssociationStatus;

  @IsOptional()
  @IsIn(ASSOCIATION_SORT_FIELDS)
  sortBy?: AssociationSortField;

  @IsOptional()
  @IsIn(['asc', 'desc'])
  sortDir?: 'asc' | 'desc';
}
