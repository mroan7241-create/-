import { Injectable } from '@nestjs/common';
import { prisma } from '@alzad/db';
import { LEGACY_APPLICATION_PLEDGE_TEXT, LEGACY_APPLICATION_QUESTIONS } from '@alzad/shared';

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
}
