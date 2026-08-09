import { IsIn, IsOptional } from 'class-validator';
import { ApplicationStatus } from '@alzad/db';
import { PaginationQueryDto } from '../../../common/validation/pagination-query.dto';

/**
 * NODE-2.1 — معاملات `GET /association-applications` بتحقق زمن تشغيل حقيقي.
 *
 * `status` كان مُعلَنًا `ApplicationStatus` في توقيع الـcontroller فقط،
 * وهو نوع TypeScript يُمحى عند البناء — فكانت أي سلسلة عشوائية تصل
 * كما هي إلى `where.status` في Prisma. الآن `@IsIn` على قيم الـenum
 * الفعلية يرفضها بـ400 قبل أي استعلام.
 *
 * لا يوجد `sortBy`/`sortDir` هنا عمدًا: `Applications.gs::listApplications_`
 * في الفرع القديم **لا** يستدعي `applySort_` إطلاقًا (بخلاف
 * `listAssociations_`/`listDevices_`)، و`Index.html::renderApplications`
 * لا يمرّر `sortFields` إلى `toolbar` فلا يُرسم أي عنصر ترتيب لهذه
 * الصفحة. الترتيب ثابت دائمًا `submittedAt` تنازليًا
 * (`getAssociationApplications_`). راجع ASSOCIATION_APPLICATIONS.md.
 */
export class ListApplicationsQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsIn(Object.values(ApplicationStatus))
  status?: ApplicationStatus;
}
