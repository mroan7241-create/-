import { Injectable } from '@nestjs/common';
import { prisma, Prisma, ReferenceValueType } from '@alzad/db';
import { LEGACY_APPLICATION_PLEDGE_TEXT, LEGACY_APPLICATION_QUESTIONS } from '@alzad/shared';
import { ApiError } from '../../common/api-error';
import { IdempotencyService } from '../../common/idempotency.service';
import { AuditService } from '../audit/audit.service';
import type { AuthContext } from '../auth/auth.types';
import type { AddReferenceValueDto } from './dto/add-reference-value.dto';

/** الأنواع التي تشترط أبًا من نوع مُحدَّد — يوازي addReferenceValue_ القديمة. الأنواع غير المذكورة هنا ترفض أي parentId. */
const REQUIRED_PARENT_TYPE: Partial<Record<ReferenceValueType, ReferenceValueType>> = {
  CITY: ReferenceValueType.REGION,
  DEVICE_SPEC: ReferenceValueType.DEVICE_TYPE,
};

export interface ReferenceDataResponse {
  regions: string[];
  citiesByRegion: Record<string, string[]>;
  deviceTypes: string[];
  socialStatuses: string[];
  associationCategories: string[];
  associationSectors: string[];
  deviceSpecsByType: Record<string, string[]>;
  suppliers: string[];
  differenceReasons: string[];
  receiverTitles: string[];
  applicationQuestions: { key: string; label: string }[];
  pledgeText: string;
  ready: boolean;
  source: 'db' | 'empty';
}

/**
 * يطابق بنية getReferenceData القديمة (ReferenceData.gs) قدر الإمكان —
 * فرق تصميمي متعمَّد: لا "builtin fallback" صامت هنا. القديم كان يعيد
 * قيمًا مضمَّنة في الكود عند خلوّ الجدول (Phase 3.1.1 hotfix لحادثة حية
 * محدَّدة). منصتنا الجديدة تبدأ دائمًا من seed صريح ومُوثَّق (راجع
 * packages/db/src/reference-data.seed.ts) — إن كانت DB فارغة فعلًا فهذا
 * عطل إعداد حقيقي يجب أن يظهر (ready:false)، لا أن يُخفى وراء نسخة
 * مكرَّرة من نفس بيانات الـseed مضمَّنة هنا أيضًا (مصدر ازدواج محتمل).
 */
@Injectable()
export class ReferenceDataService {
  constructor(
    private readonly idempotency: IdempotencyService,
    private readonly audit: AuditService,
  ) {}

  async getReferenceData(): Promise<ReferenceDataResponse> {
    const rows = await prisma.referenceValue.findMany({
      where: { active: true },
      orderBy: { sortOrder: 'asc' },
    });

    const result: ReferenceDataResponse = {
      regions: [],
      citiesByRegion: {},
      deviceTypes: [],
      socialStatuses: [],
      associationCategories: [],
      associationSectors: [],
      deviceSpecsByType: {},
      suppliers: [],
      differenceReasons: [],
      receiverTitles: [],
      applicationQuestions: LEGACY_APPLICATION_QUESTIONS,
      pledgeText: LEGACY_APPLICATION_PLEDGE_TEXT,
      ready: rows.length > 0,
      source: rows.length > 0 ? 'db' : 'empty',
    };

    if (!rows.length) return result;

    const valueById = new Map(rows.map((r) => [r.id, r.value]));

    rows.forEach((row) => {
      switch (row.type) {
        case 'REGION':
          result.regions.push(row.value);
          if (!result.citiesByRegion[row.value]) result.citiesByRegion[row.value] = [];
          break;
        case 'CITY': {
          const parentRegion = row.parentId ? valueById.get(row.parentId) : undefined;
          if (parentRegion) {
            if (!result.citiesByRegion[parentRegion]) result.citiesByRegion[parentRegion] = [];
            result.citiesByRegion[parentRegion].push(row.value);
          }
          break;
        }
        case 'DEVICE_TYPE':
          result.deviceTypes.push(row.value);
          break;
        case 'SOCIAL_STATUS':
          result.socialStatuses.push(row.value);
          break;
        case 'ASSOCIATION_CATEGORY':
          result.associationCategories.push(row.value);
          break;
        case 'ASSOCIATION_SECTOR':
          result.associationSectors.push(row.value);
          break;
        case 'DEVICE_SPEC': {
          const parentType = row.parentId ? valueById.get(row.parentId) : undefined;
          if (parentType) {
            if (!result.deviceSpecsByType[parentType]) result.deviceSpecsByType[parentType] = [];
            result.deviceSpecsByType[parentType].push(row.value);
          }
          break;
        }
        case 'SUPPLIER':
          result.suppliers.push(row.value);
          break;
        case 'DIFFERENCE_REASON':
          result.differenceReasons.push(row.value);
          break;
        case 'RECEIVER_TITLE':
          result.receiverTitles.push(row.value);
          break;
      }
    });

    return result;
  }

  /**
   * REF-008 — يوازي addReferenceValue_ القديمة (ReferenceData.gs:616-668):
   * إضافة قيمة واحدة لنوع موجود مسبقًا، لا يخترع نوعًا جديدًا. CITY يشترط
   * أبًا REGION موجودًا وفعّالًا، DEVICE_SPEC يشترط أبًا DEVICE_TYPE موجودًا
   * وفعّالًا، بقية الأنواع ترفض أي parentId. التكرار داخل (type, parent)
   * يُرفَض عبر partial unique index الحقيقي في DB (لا فحص سباقي منفصل).
   */
  async addReferenceValue(ctx: AuthContext, dto: AddReferenceValueDto): Promise<{ ok: true; id: string; value: string }> {
    const value = dto.value.trim();
    if (!value) throw new ApiError('REFERENCE_VALUE_REQUIRED', 'القيمة مطلوبة', 400);

    const requiredParentType = REQUIRED_PARENT_TYPE[dto.type];
    if (requiredParentType && !dto.parentValue) {
      throw new ApiError('REFERENCE_VALUE_PARENT_REQUIRED', `هذا النوع يشترط تحديد أب من نوع ${requiredParentType}`, 400);
    }
    if (!requiredParentType && dto.parentValue) {
      throw new ApiError('REFERENCE_VALUE_PARENT_NOT_ALLOWED', 'هذا النوع لا يقبل أبًا', 400);
    }

    const payload = { type: dto.type, value, parentValue: dto.parentValue ?? null };

    const outcome = await prisma.$transaction(async (tx) => {
      const claim = await this.idempotency.claim<{ ok: true; id: string; value: string }>(tx, ctx.accountId, 'reference-value-create', dto.opId, payload);
      if (!claim.claimed) return { replayed: true as const, response: claim.existingResponse! };

      let parentId: string | null = null;
      if (requiredParentType && dto.parentValue) {
        // الآباء دائمًا صفوف جذرية (parentId=null) — REGION وDEVICE_TYPE كلاهما بلا أب في هذا النموذج.
        const parent = await tx.referenceValue.findFirst({
          where: { type: requiredParentType, value: dto.parentValue, parentId: null, active: true },
        });
        if (!parent) {
          throw new ApiError('REFERENCE_VALUE_PARENT_NOT_FOUND', 'الأب المحدَّد غير موجود أو غير فعّال', 400);
        }
        parentId = parent.id;
      }

      const siblingCount = await tx.referenceValue.count({ where: { type: dto.type, parentId } });

      let created: { id: string; value: string };
      try {
        created = await tx.referenceValue.create({
          data: { type: dto.type, value, parentId, sortOrder: siblingCount },
          select: { id: true, value: true },
        });
      } catch (err) {
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
          throw new ApiError('REFERENCE_VALUE_DUPLICATE', 'هذه القيمة موجودة مسبقًا لنفس النوع/الأب', 409);
        }
        throw err;
      }

      const response = { ok: true as const, id: created.id, value: created.value };
      await this.idempotency.complete(tx, ctx.accountId, 'reference-value-create', dto.opId, response);
      return { replayed: false as const, response };
    });

    if (!outcome.replayed) {
      await this.audit.log({ id: ctx.accountId, role: ctx.role, associationId: ctx.associationId }, 'REFERENCE_VALUE_CREATED', 'reference_values', outcome.response.id, { type: dto.type, value });
    }
    return outcome.response;
  }
}
