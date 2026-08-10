import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  prisma,
  Prisma,
  AccountRole,
  BeneficiaryReviewStatus,
  DeviceType,
  NeedDecisionStatus,
  NeedFulfillmentStatus,
} from '@alzad/db';
import { ApiError, authForbidden } from '../../common/api-error';
import { PublicCodeService } from '../../common/public-code.service';
import { IdempotencyService } from '../../common/idempotency.service';
import { AuditService } from '../audit/audit.service';
import { cleanText, requiredText } from '../../common/validation/text.util';
import { normalizeSaudiPhone } from '../../common/validation/phone.util';
import { normalizePagination, toPaginatedResult, type PaginatedResult, type PaginationParams } from '../../common/pagination.util';
import { validateRegionCity } from '../applications/application-reference.util';
import { validateSocialStatus } from './beneficiary-reference.util';
import { beneficiaryOrderBy, type BeneficiarySortField } from './beneficiary-sort.util';
import {
  buildLocationWrite,
  canonicalizeLocationIntent,
  locationConfirmed,
  normalizeNameForMatch,
} from './beneficiary-location.util';
import { acquirePhoneLocks } from './beneficiary-phone-lock.util';
import { ALLOCATION_TRIGGER_PORT, type AllocationTriggerPort } from '../allocation/allocation-trigger.port';
import type { AuthContext } from '../auth/auth.types';

/**
 * حدود النصوص — مأخوذة حرفيًا من `Beneficiaries.gs::buildBeneficiaryFieldValues_`
 * و`BeneficiaryNeeds.gs::requiredIfRejected_` على الـbaseline القديم.
 *
 * ملاحظة parity مهمة: سبب الرفض هنا 500 حرفًا لا 300. الـ300 هي حد
 * `rejectReason` لطلبات الانضمام (NODE-2)، بينما مسار المستفيد يستخدم
 * `cleanText_(reason, 500)` في `requiredIfRejected_` — حدّان مختلفان
 * فعلًا في النظام القديم، فلا يجوز توحيدهما.
 */
export const BENEFICIARY_LIMITS = {
  name: 120,
  district: 120,
  address: 250,
  landmark: 200,
  notes: 1000,
  rejectReason: 500,
  familyCountMin: 1,
  familyCountMax: 99,
  incomeMin: 0,
  incomeMax: 1_000_000,
} as const;

/** `Config.gs::NEW_NEED_DEVICE_TYPES` = ['ثلاجة','فرن','غسالة'] — الثلاثة فقط، لا غير. */
const NEW_NEED_DEVICE_TYPES: DeviceType[] = [DeviceType.REFRIGERATOR, DeviceType.OVEN, DeviceType.WASHING_MACHINE];

export interface BeneficiaryWriteInput {
  associationId?: string;
  name: string;
  region: string;
  city: string;
  district: string;
  phone: string;
  phone2?: string;
  familyCount: number;
  socialSecurity?: boolean;
  socialStatus: string;
  income?: number;
  notes?: string;
  lat?: number | null;
  lng?: number | null;
  locationSource?: string;
  deviceTypes?: DeviceType[];
  opId: string;
}

/**
 * تنبيه "مطابق محتمل" غير حاجب — `findPossibleDuplicateBeneficiary_`.
 * يحمل `publicCode` البشري فقط، ولا يُسرَّب معه أي معرّف داخلي (UUID).
 */
export interface PossibleDuplicateWarning {
  publicCode: string;
  message: string;
}

export interface NeedDecisionInput {
  needId: string;
  decision: 'APPROVED' | 'REJECTED';
  rejectReason?: string;
}

export interface ReviewInput {
  beneficiaryDecision: 'APPROVED' | 'REJECTED';
  beneficiaryRejectReason?: string;
  needDecisions?: NeedDecisionInput[];
  opId: string;
}

export interface BulkReviewItemInput extends ReviewInput {
  beneficiaryId: string;
}

interface ReviewOutcome {
  beneficiaryId: string;
  beneficiaryDecision: BeneficiaryReviewStatus;
  approvedCount: number;
  rejectedCount: number;
  associationId: string;
}

@Injectable()
export class BeneficiariesService {
  private readonly logger = new Logger('BeneficiariesService');

  constructor(
    private readonly publicCode: PublicCodeService,
    private readonly idempotency: IdempotencyService,
    private readonly audit: AuditService,
    @Inject(ALLOCATION_TRIGGER_PORT) private readonly allocationTrigger: AllocationTriggerPort,
  ) {}

  // ================================================================
  // listBeneficiaries — Beneficiaries.gs::listBeneficiaries_
  // ================================================================
  async listBeneficiaries(
    ctx: AuthContext,
    params: PaginationParams & {
      search?: string;
      associationId?: string;
      reviewStatus?: BeneficiaryReviewStatus;
      locationStatus?: 'PENDING' | 'CONFIRMED';
      sortBy?: BeneficiarySortField;
      sortDir?: 'asc' | 'desc';
    },
  ): Promise<PaginatedResult<unknown>> {
    const { page, pageSize, skip, take } = normalizePagination(params);

    const where: Prisma.BeneficiaryWhereInput = { archivedAt: null };

    // العزل بين الجمعيات مفروض **قبل** أي بحث أو ترقيم، تمامًا كِLegacy:
    // «جمعية لا تستطيع طلب صفحة تخص جمعية أخرى مهما كانت options.associationId».
    // مصدر associationId لفاعل ASSOCIATION هو AuthContext حصرًا — أي قيمة
    // مرسَلة من العميل تُتجاهَل تمامًا هنا (وترفضها الـDTO أصلًا).
    where.associationId = this.resolveTenantScope(ctx, params.associationId);

    if (params.reviewStatus) where.reviewStatus = params.reviewStatus;

    // NODE-3.1 — "بانتظار تحديد الموقع" مشتقة لا مخزَّنة، مطابقةً لِ
    // `beneficiaryLocationConfirmed_`: مؤكَّد ⇔ العمودان موجودان معًا،
    // ومعلَّق ⇔ أحدهما (أو كلاهما) غائب. يُوضَع الشرط في `AND` لا في `OR`
    // حتى لا يصطدم بشرط البحث الحر أدناه (الذي يحجز `where.OR` لنفسه).
    if (params.locationStatus === 'PENDING') {
      where.AND = [{ OR: [{ latitude: null }, { longitude: null }] }];
    } else if (params.locationStatus === 'CONFIRMED') {
      where.AND = [{ latitude: { not: null } }, { longitude: { not: null } }];
    }

    if (params.search) {
      const q = params.search.trim();
      // يطابق applySearch_(items, search, ['name','id','phone','region','city'])
      // حيث `id` القديم هو الرقم المعروض للمستخدم = publicCode الجديد.
      const or: Prisma.BeneficiaryWhereInput[] = [
        { name: { contains: q, mode: 'insensitive' } },
        { publicCode: { contains: q, mode: 'insensitive' } },
        { region: { contains: q, mode: 'insensitive' } },
        { city: { contains: q, mode: 'insensitive' } },
      ];
      // الجوال مخزَّن مطبَّعًا (05XXXXXXXX)؛ نطبّع مُدخَل البحث بنفس الدالة
      // فيُطابَق بأي صيغة مقبولة. مُدخَل غير قابل للتطبيع (بحث بالاسم) لا
      // يضيف شرطًا ولا يُفشل البحث — نفس نمط NODE-2.1 في الجمعيات.
      const normalizedPhone = tryNormalizePhone(q);
      if (normalizedPhone) {
        or.push({ phone: normalizedPhone }, { secondaryPhone: normalizedPhone });
      } else {
        or.push({ phone: { contains: q } });
      }
      where.OR = or;
    }

    const [rows, total] = await Promise.all([
      prisma.beneficiary.findMany({ where, orderBy: beneficiaryOrderBy(params.sortBy, params.sortDir), skip, take }),
      prisma.beneficiary.count({ where }),
    ]);

    // لا N+1: استعلام تجميعي **واحد** لكل الصفحة (لا استعلام لكل صف)،
    // بنفس مبدأ `attachNeedsSummaryToBeneficiaries_` القديمة (قراءة واحدة
    // لورقة الاحتياجات ثم Map)، وبنفس نمط `countsByAssociation` في NODE-2.
    const counts = await this.needCountsByBeneficiary(rows.map((r) => r.id));

    return toPaginatedResult(
      rows.map((row) => ({ ...mapBeneficiary(row), ...counts[row.id] })),
      total,
      page,
      pageSize,
    );
  }

  async getBeneficiaryDetail(ctx: AuthContext, id: string) {
    const beneficiary = await prisma.beneficiary.findFirst({
      where: { id, archivedAt: null },
      include: { needs: { orderBy: { createdAt: 'asc' } } },
    });
    if (!beneficiary) throw beneficiaryNotFound();
    this.assertTenantAccess(ctx, beneficiary.associationId);

    return { ...mapBeneficiary(beneficiary), needs: beneficiary.needs.map(mapNeed) };
  }

  // ================================================================
  // createBeneficiaryWithNeeds_ — إنشاء ذرّي: مستفيد + احتياجاته معًا
  // ================================================================
  async createBeneficiary(ctx: AuthContext, input: BeneficiaryWriteInput) {
    // «كل مستفيد جديد يجب أن يحمل احتياجًا واحدًا على الأقل»
    // (validateNewNeedDeviceTypes_ — Phase 2.2 المعتمدة).
    const deviceTypes = validateNewNeedDeviceTypes(input.deviceTypes);

    const associationId = this.resolveWriteAssociation(ctx, input.associationId);
    const fields = await this.buildFieldValues(input, null);
    // سجل جديد ⇒ لا موقع سابق للمقارنة؛ أي إحداثيات مُرسَلة تُعَدّ تغييرًا
    // (وهو حرفيًا شرط `!existing` في `buildBeneficiaryFieldValues_`).
    const location = buildLocationWrite(input, null, new Date());

    // NODE-3.2 — البصمة تأخذ **نيّة** الموقع المعيارية لا أمر الكتابة:
    // `location` أعلاه يحمل `locationUpdatedAt = new Date()`، وإدخاله في
    // الحمولة كان يغيّر التجزئة في كل استدعاء فيُرَدّ على كل إعادة محاولة
    // مشروعة بـ409. `buildLocationWrite` نفسه لم يتغيّر ولا يزال هو مصدر
    // الكتابة الفعلية في `create` أدناه — الفارق أنه لم يعد مُدخَلًا للبصمة.
    // على سجل جديد لا موقع سابق له إطلاقًا، فغياب `lat`/`lng` يُعيَّر
    // `PRESERVE` (لا `CLEAR`) بنفس دالة المسار الآخر حرفيًا: لا حالة خاصة
    // للإنشاء أصلًا، ونيّة «لم أرسل موقعًا» تبقى متميّزة عن «امسح الموقع
    // صراحةً» — تمييز محافظ يميل دائمًا إلى 409 صريح بدل إعادة تشغيل
    // صامتة لطلب نيّته مختلفة.
    const locationIntent = canonicalizeLocationIntent(input);

    const payload = { associationId, ...fields, locationIntent, deviceTypes, phone: fields.phone };

    const outcome = await prisma.$transaction(async (tx) => {
      const claim = await this.idempotency.claim<{ beneficiaryId: string; possibleDuplicate?: PossibleDuplicateWarning }>(
        tx,
        ctx.accountId,
        'beneficiary-create',
        input.opId,
        payload,
      );
      if (!claim.claimed) return { replayed: true as const, response: claim.existingResponse! };

      const association = await tx.association.findUnique({ where: { id: associationId }, select: { id: true } });
      if (!association) throw new ApiError('BENEFICIARY_ASSOCIATION_NOT_FOUND', 'اختر جمعية صحيحة', 400);

      // قفل استشاري لكل (جمعية، جوال) **قبل** فحص التكرار وقبل الكتابة —
      // يغلق سباق TOCTOU الذي كان يسمح لطلبين متزامنين بالمرور معًا.
      await acquirePhoneLocks(tx, associationId, [fields.phone, fields.secondaryPhone]);
      await this.assertNoConfirmedDuplicate(tx, associationId, fields.phone, fields.secondaryPhone, null);

      const possibleDuplicate = await this.findPossibleDuplicate(tx, associationId, fields.name, fields.city, null);

      const beneficiary = await tx.beneficiary.create({
        data: {
          publicCode: await this.publicCode.nextPublicCode(tx, 'BEN'),
          associationId,
          ...fields,
          ...location,
          reviewStatus: BeneficiaryReviewStatus.UNDER_REVIEW,
        },
      });

      // كل احتياج صف مستقل بنوع جهاز واحد — بلا حقل كمية إطلاقًا (قرار
      // تصميمي محافِظ على سلوك Legacy حرفيًا: صف = استحقاق جهاز واحد).
      for (const deviceType of deviceTypes) {
        await tx.beneficiaryNeed.create({
          data: {
            publicCode: await this.publicCode.nextPublicCode(tx, 'NED'),
            beneficiaryId: beneficiary.id,
            associationId,
            deviceType,
            decisionStatus: NeedDecisionStatus.PENDING,
          },
        });
      }

      // التنبيه جزء من الرد المخزَّن حتى تُعيد إعادة المحاولة بنفس opId
      // نفس التنبيه بالضبط بدل ردٍّ مختلف عن الأصل.
      const response = { beneficiaryId: beneficiary.id, ...(possibleDuplicate ? { possibleDuplicate } : {}) };
      await this.idempotency.complete(tx, ctx.accountId, 'beneficiary-create', input.opId, response);
      return { replayed: false as const, response };
    });

    if (!outcome.replayed) {
      await this.audit.log(this.actor(ctx), 'BENEFICIARY_CREATED', 'beneficiaries', outcome.response.beneficiaryId, {
        deviceTypes,
      });
    }

    return {
      ok: true as const,
      beneficiaryId: outcome.response.beneficiaryId,
      replayed: outcome.replayed,
      ...(outcome.response.possibleDuplicate ? { possibleDuplicate: outcome.response.possibleDuplicate } : {}),
    };
  }

  // ================================================================
  // updateBeneficiaryWithNeeds_ — تعديل + مزامنة قائمة الاحتياجات
  // ================================================================
  async updateBeneficiary(ctx: AuthContext, id: string, input: BeneficiaryWriteInput) {
    const existing = await prisma.beneficiary.findFirst({ where: { id, archivedAt: null } });
    if (!existing) throw beneficiaryNotFound();
    this.assertTenantAccess(ctx, existing.associationId);

    // «جمعية المستفيد الحالية هي مصدر الحقيقة الوحيد من مسار التعديل
    // العام» — لا ADMIN ولا ASSOCIATION ينقل مستفيدًا بين جمعيتين من هنا.
    // أي associationId مختلف يُرفض صراحة، لا يُتجاهَل بصمت (Phase 2.3.4).
    if (input.associationId && input.associationId !== existing.associationId) {
      throw new ApiError(
        'BENEFICIARY_ASSOCIATION_IMMUTABLE',
        'لا يمكن تغيير جمعية المستفيد من نموذج التعديل العام — يتطلب النقل بين الجمعيات عملية مستقلة صريحة',
        400,
      );
    }

    // deviceTypes غائبة تمامًا ⇒ لا تُمسّ قائمة الاحتياجات إطلاقًا.
    // مُرسَلة ⇒ تُعامَل كقائمة نهائية كاملة (وفارغة صراحةً تُرفض دائمًا).
    const touchesNeeds = input.deviceTypes !== undefined && input.deviceTypes !== null;
    const requestedTypes = touchesNeeds ? validateNewNeedDeviceTypes(input.deviceTypes) : null;

    if (touchesNeeds && isFinalReviewStatus(existing.reviewStatus)) {
      throw needsLocked();
    }

    const fields = await this.buildFieldValues(input, existing);
    // NODE-3.2 — كان هنا `lat: input.lat ?? null, lng: input.lng ?? null`،
    // وهو طيّ يجعل «الحقل غائب» (= احفظ الموقع كما هو) و«الحقل = null
    // صراحةً» (= امسح الموقع) يتقاسمان بصمة واحدة، فيمرّ طلب مسح متنكّرًا
    // في هيئة إعادة محاولة لطلب حفظ — أو العكس. النيّة المعيارية تفصلهما
    // إلى `PRESERVE` و`CLEAR`، وتُدخِل `locationSource` المطبَّع في حالة
    // `SET` لأنه جزء أصيل من نيّة الطلب لا زينة.
    const payload = { id, ...fields, locationIntent: canonicalizeLocationIntent(input), deviceTypes: requestedTypes };

    const outcome = await prisma.$transaction(async (tx) => {
      const scope = `beneficiary-update:${id}`;
      const claim = await this.idempotency.claim<{ ok: true; possibleDuplicate?: PossibleDuplicateWarning }>(
        tx,
        ctx.accountId,
        scope,
        input.opId,
        payload,
      );
      if (!claim.claimed) return { replayed: true as const, response: claim.existingResponse ?? { ok: true as const } };

      // إعادة قراءة الحالة **داخل** المعاملة مع قفل الصف — القرار لا يُبنى
      // على قراءة سابقة تجاوزها الزمن (سباق: الإدارة تبتّ بينما التعديل
      // في الطريق). نفس مبدأ «كل قراءة يُبنى عليها قرار تحدث داخل القفل».
      // NODE-3.1 — الأقفال الاستشارية تُكتسَب على **اتحاد** الأرقام:
      // القيم المخزَّنة حاليًا (قد يتسابق طلب آخر على ادّعاء الرقم الذي
      // نتخلّى عنه) + القيم الجديدة المستهدَفة. الترتيب حتمي داخل
      // `acquirePhoneLocks`، فمعاملتان تتبادلان رقمين لا تتجمّدان.
      await acquirePhoneLocks(tx, existing.associationId, [
        existing.phone,
        existing.secondaryPhone,
        fields.phone,
        fields.secondaryPhone,
      ]);

      // إعادة القراءة **بعد** اكتساب الأقفال: قرار الكتابة لا يُبنى على أي
      // قراءة سبقت القفل. `FOR UPDATE` هنا يجلب أيضًا الإحداثيات المخزَّنة
      // فعليًا لحظة القرار، فيُبنى قرار "هل تغيّر الموقع؟" على الحالة
      // الراهنة لا على لقطة قديمة.
      const locked = await this.lockBeneficiary(tx, id);
      if (!locked) throw beneficiaryNotFound();
      if (touchesNeeds && isFinalReviewStatus(locked.review_status as BeneficiaryReviewStatus)) {
        throw needsLocked();
      }

      await this.assertNoConfirmedDuplicate(tx, existing.associationId, fields.phone, fields.secondaryPhone, id);

      const location = buildLocationWrite(
        input,
        { latitude: locked.latitude, longitude: locked.longitude },
        new Date(),
      );

      const possibleDuplicate = await this.findPossibleDuplicate(tx, existing.associationId, fields.name, fields.city, id);

      // `address`/`landmark` **لا يُذكران هنا إطلاقًا** — لا مفتاحًا ولا
      // قيمة `undefined`. قيمتهما التاريخية تبقى كما هي حرفيًا (البند 1).
      await tx.beneficiary.update({ where: { id }, data: { ...fields, ...location } });

      if (touchesNeeds && requestedTypes) {
        await this.syncNeeds(tx, id, existing.associationId, requestedTypes);
      }

      const response = { ok: true as const, ...(possibleDuplicate ? { possibleDuplicate } : {}) };
      await this.idempotency.complete(tx, ctx.accountId, scope, input.opId, response);
      return { replayed: false as const, response };
    });

    if (!outcome.replayed) {
      await this.audit.log(this.actor(ctx), 'BENEFICIARY_UPDATED', 'beneficiaries', id);
    }

    return {
      ok: true as const,
      replayed: outcome.replayed,
      ...(outcome.response.possibleDuplicate ? { possibleDuplicate: outcome.response.possibleDuplicate } : {}),
    };
  }

  /**
   * مزامنة قائمة الاحتياجات النهائية (يطابق فرع `touchesNeeds` في
   * `updateBeneficiaryWithNeeds_`):
   *  - يُضاف كل نوع مطلوب غير موجود.
   *  - يُحذف كل احتياج **معلَّق** غاب عن القائمة الجديدة.
   *  - محاولة حذف احتياج **محسوم** (معتمد/مرفوض) تُرفض بلا أي كتابة.
   *  - لا يجوز أن ينتهي المستفيد بلا أي احتياج.
   */
  private async syncNeeds(tx: Prisma.TransactionClient, beneficiaryId: string, associationId: string, requestedTypes: DeviceType[]) {
    const existingNeeds = await tx.beneficiaryNeed.findMany({ where: { beneficiaryId } });
    const existingByType = new Map(existingNeeds.map((n) => [n.deviceType, n]));

    const toAdd = requestedTypes.filter((t) => !existingByType.has(t));
    const toRemove = existingNeeds.filter((n) => !requestedTypes.includes(n.deviceType));

    for (const need of toRemove) {
      if (need.decisionStatus !== NeedDecisionStatus.PENDING) {
        throw new ApiError(
          'BENEFICIARY_NEED_ALREADY_DECIDED',
          `لا يمكن إزالة احتياج سبق البتّ فيه من القائمة (${need.deviceType}) — الحالة الحالية: ${need.decisionStatus}`,
          409,
        );
      }
    }

    if (existingNeeds.length - toRemove.length + toAdd.length === 0) {
      throw requiresNeed();
    }

    if (toRemove.length) {
      await tx.beneficiaryNeed.deleteMany({ where: { id: { in: toRemove.map((n) => n.id) } } });
    }
    for (const deviceType of toAdd) {
      await tx.beneficiaryNeed.create({
        data: {
          publicCode: await this.publicCode.nextPublicCode(tx, 'NED'),
          beneficiaryId,
          associationId,
          deviceType,
          decisionStatus: NeedDecisionStatus.PENDING,
        },
      });
    }
  }

  // ================================================================
  // removePendingBeneficiaryNeed_
  // ================================================================
  async removePendingNeed(ctx: AuthContext, needId: string, opId: string) {
    const outcome = await prisma.$transaction(async (tx) => {
      const scope = `beneficiary-need-remove:${needId}`;
      const claim = await this.idempotency.claim<{ beneficiaryId: string }>(tx, ctx.accountId, scope, opId, { needId });
      if (!claim.claimed) return { replayed: true as const, response: claim.existingResponse! };

      const need = await tx.beneficiaryNeed.findUnique({ where: { id: needId } });
      if (!need) throw new ApiError('BENEFICIARY_NEED_NOT_FOUND', 'الاحتياج غير موجود', 404);

      const locked = await this.lockBeneficiary(tx, need.beneficiaryId);
      if (!locked) throw new ApiError('BENEFICIARY_NOT_FOUND', 'المستفيد المرتبط بهذا الاحتياج غير موجود', 404);
      this.assertTenantAccess(ctx, need.associationId);

      // Legacy يشترط «تحت المراجعة» حرفيًا، لا مجرد "ليست نهائية".
      if ((locked.review_status as BeneficiaryReviewStatus) !== BeneficiaryReviewStatus.UNDER_REVIEW) {
        throw needsLocked();
      }
      if (need.decisionStatus !== NeedDecisionStatus.PENDING) {
        throw new ApiError(
          'BENEFICIARY_NEED_ALREADY_DECIDED',
          `لا يمكن إزالة احتياج سبق البتّ فيه (الحالة الحالية: ${need.decisionStatus})`,
          409,
        );
      }

      const remaining = await tx.beneficiaryNeed.count({ where: { beneficiaryId: need.beneficiaryId, id: { not: needId } } });
      if (remaining === 0) {
        throw new ApiError(
          'BENEFICIARY_REQUIRES_NEED',
          'لا يمكن ترك المستفيد بلا أي احتياج — أضف احتياجًا بديلًا أولًا إن أردت إزالة هذا',
          400,
        );
      }

      await tx.beneficiaryNeed.delete({ where: { id: needId } });

      const response = { beneficiaryId: need.beneficiaryId };
      await this.idempotency.complete(tx, ctx.accountId, scope, opId, response);
      return { replayed: false as const, response };
    });

    if (!outcome.replayed) {
      await this.audit.log(this.actor(ctx), 'BENEFICIARY_NEED_REMOVED', 'beneficiary_needs', needId, {
        beneficiaryId: outcome.response.beneficiaryId,
      });
    }

    return { ok: true as const, beneficiaryId: outcome.response.beneficiaryId, replayed: outcome.replayed };
  }

  // ================================================================
  // reviewBeneficiaryNeeds — مراجعة فردية (ADMIN)
  // ================================================================
  async reviewBeneficiary(ctx: AuthContext, id: string, input: ReviewInput) {
    const outcome = await this.runReviewTransaction(ctx, id, input);

    if (!outcome.replayed) {
      await this.audit.log(this.actor(ctx), 'BENEFICIARY_REVIEWED', 'beneficiaries', id, {
        decision: outcome.result.beneficiaryDecision,
        approvedCount: outcome.result.approvedCount,
        rejectedCount: outcome.result.rejectedCount,
      });

      // Patch 3.2A.1 — المراجعة الفردية تشغّل البذرة فورًا بعد الالتزام،
      // وفقط عند اعتماد حقيقي أنتج استحقاقًا واحدًا على الأقل. لا تُستدعى
      // عند الرفض، ولا عند إعادة تشغيل idempotent (لا قرار جديد حدث).
      if (
        outcome.result.beneficiaryDecision === BeneficiaryReviewStatus.APPROVED &&
        outcome.result.approvedCount > 0
      ) {
        await this.fireAllocationTrigger(outcome.result.associationId);
      }
    }

    return {
      ok: true as const,
      beneficiaryId: id,
      beneficiaryDecision: outcome.result.beneficiaryDecision,
      approvedCount: outcome.result.approvedCount,
      rejectedCount: outcome.result.rejectedCount,
      replayed: outcome.replayed,
    };
  }

  // ================================================================
  // bulkReviewBeneficiaries — Phase 3.2A + Patch 3.2A.1
  // ================================================================
  async bulkReview(ctx: AuthContext, items: BulkReviewItemInput[]) {
    if (!items.length) {
      throw new ApiError('BENEFICIARY_BULK_EMPTY', 'لا توجد عناصر لمراجعتها بالجملة', 400);
    }

    const success: { beneficiaryId: string; approvedCount: number; rejectedCount: number }[] = [];
    const failed: { beneficiaryId: string; code: string; error: string }[] = [];
    const associationIdsToAllocate = new Set<string>();

    // كل عنصر **معاملته الذرّية المستقلة**: قاعدة "كل شيء أو لا شيء" تبقى
    // محصورة داخل العنصر الواحد، لا عبر الدفعة. فشل عنصر لا يُرجِع أي
    // عنصر نجح قبله ولا يوقف من بعده — يطابق `bulkReviewBeneficiaries`
    // القديمة حرفيًا (try/catch حول كل عنصر داخل forEach).
    for (const item of items) {
      try {
        const outcome = await this.runReviewTransaction(ctx, item.beneficiaryId, item);
        success.push({
          beneficiaryId: item.beneficiaryId,
          approvedCount: outcome.result.approvedCount,
          rejectedCount: outcome.result.rejectedCount,
        });

        if (!outcome.replayed) {
          await this.audit.log(this.actor(ctx), 'BENEFICIARY_REVIEWED', 'beneficiaries', item.beneficiaryId, {
            decision: outcome.result.beneficiaryDecision,
            approvedCount: outcome.result.approvedCount,
            rejectedCount: outcome.result.rejectedCount,
            bulk: true,
          });

          if (
            outcome.result.beneficiaryDecision === BeneficiaryReviewStatus.APPROVED &&
            outcome.result.approvedCount > 0
          ) {
            // Patch 3.2A.1: تُجمَع الجمعيات فقط، ولا يُشغَّل التخصيص هنا.
            associationIdsToAllocate.add(outcome.result.associationId);
          }
        }
      } catch (error) {
        const apiError = error instanceof ApiError ? error : null;
        failed.push({
          beneficiaryId: item.beneficiaryId,
          code: apiError?.code ?? 'BENEFICIARY_BULK_ITEM_FAILED',
          // لا تسريب لأي خطأ Prisma/Postgres خام: الرسالة تُؤخذ فقط من
          // ApiError المعروف، وأي شيء آخر يُستبدَل برسالة عامة (ويُسجَّل
          // داخليًا فقط) — نفس سياسة HttpExceptionFilter.
          error: apiError?.message ?? 'تعذّر تنفيذ قرار المراجعة لهذا العنصر',
        });
        if (!apiError) {
          this.logger.error(
            `فشل غير متوقَّع في عنصر مراجعة بالجملة (beneficiaryId=${item.beneficiaryId}): ${
              error instanceof Error ? error.message : String(error)
            }`,
          );
        }
      }
    }

    // Patch 3.2A.1 — تشغيل واحد لكل **جمعية فريدة** بعد انتهاء الدفعة
    // كاملة، لا مرة لكل مستفيد. فشل التخصيص لجمعية لا يحوّل أيًّا من
    // عناصرها الناجحة إلى failed.
    const allocationWarnings: { associationId: string; error: string }[] = [];
    for (const associationId of associationIdsToAllocate) {
      const warning = await this.fireAllocationTrigger(associationId);
      if (warning) allocationWarnings.push({ associationId, error: warning });
    }

    await this.audit.log(this.actor(ctx), 'BENEFICIARY_BULK_REVIEWED', 'beneficiaries', null, {
      attempted: items.length,
      succeeded: success.length,
      failed: failed.length,
      associationsTriggered: associationIdsToAllocate.size,
    });

    return {
      ok: true as const,
      success,
      failed,
      ...(allocationWarnings.length ? { allocationWarnings } : {}),
    };
  }

  /**
   * جوهر `reviewBeneficiaryNeeds_` — معاملة واحدة ذرّية:
   * idempotency claim → قفل صف المستفيد (`FOR UPDATE`) → تحقق كامل قبل أي
   * كتابة → كتابة قرار المستفيد وكل احتياجاته → تخزين نتيجة opId.
   */
  private async runReviewTransaction(ctx: AuthContext, id: string, input: ReviewInput) {
    const decision = input.beneficiaryDecision;
    if (decision !== 'APPROVED' && decision !== 'REJECTED') {
      throw new ApiError('BENEFICIARY_INVALID_DECISION', 'قرار المستفيد يجب أن يكون APPROVED أو REJECTED', 400);
    }

    // سبب رفض المستفيد **إلزامي** عند الرفض (requiredIfRejected_)، ويُهمَل
    // تمامًا عند الاعتماد.
    const beneficiaryRejectReason = decision === 'REJECTED' ? requireRejectReason(input.beneficiaryRejectReason) : '';

    const requestedDecisions = input.needDecisions ?? [];
    const scope = `beneficiary-review:${id}`;
    const payload = { id, decision, beneficiaryRejectReason, needDecisions: requestedDecisions };

    return prisma.$transaction(async (tx) => {
      const claim = await this.idempotency.claim<ReviewOutcome>(tx, ctx.accountId, scope, input.opId, payload);
      if (!claim.claimed) return { replayed: true as const, result: claim.existingResponse! };

      // `SELECT ... FOR UPDATE` — مراجعتان متزامنتان لنفس المستفيد
      // تتسلسلان هنا؛ الثانية ترى الحالة المبتوتة وتُرفض بـ409 نظيف.
      const locked = await this.lockBeneficiary(tx, id);
      if (!locked) throw beneficiaryNotFound();

      const currentStatus = locked.review_status as BeneficiaryReviewStatus;
      // `assertBeneficiaryReviewTransition_`: UNDER_REVIEW وحدها قابلة
      // للانتقال؛ APPROVED/REJECTED نهائيتان بلا حلقة ذاتية ولا رجوع.
      if (isFinalReviewStatus(currentStatus)) {
        throw new ApiError('BENEFICIARY_ALREADY_REVIEWED', 'سبق البتّ نهائيًا في مراجعة هذا المستفيد', 409);
      }

      const allNeeds = await tx.beneficiaryNeed.findMany({ where: { beneficiaryId: id } });
      const needById = new Map(allNeeds.map((n) => [n.id, n]));
      const pendingNeeds = allNeeds.filter((n) => n.decisionStatus === NeedDecisionStatus.PENDING);
      if (pendingNeeds.length === 0) {
        throw new ApiError('BENEFICIARY_NO_PENDING_NEEDS', 'لا توجد احتياجات بانتظار المراجعة لهذا المستفيد', 409);
      }

      // ---- تحقق كامل أولًا: أول خطأ يوقف العملية قبل أي كتابة ----
      const resolved: { needId: string; decision: NeedDecisionStatus; rejectReason: string }[] = [];
      const seen = new Set<string>();

      for (const entry of requestedDecisions) {
        if (seen.has(entry.needId)) {
          throw new ApiError('BENEFICIARY_NEED_DUPLICATE_DECISION', `الاحتياج «${entry.needId}» مكرَّر أكثر من مرة في نفس الطلب`, 400);
        }
        seen.add(entry.needId);

        const need = needById.get(entry.needId);
        if (!need) throw new ApiError('BENEFICIARY_NEED_NOT_FOUND', `احتياج غير موجود لهذا المستفيد: ${entry.needId}`, 404);
        if (need.decisionStatus !== NeedDecisionStatus.PENDING) {
          throw new ApiError(
            'BENEFICIARY_NEED_ALREADY_DECIDED',
            `سبق اتخاذ قرار لهذا الاحتياج (${need.deviceType}) — لا يمكن إعادة تقرير احتياج محسوم`,
            409,
          );
        }

        // رفض المستفيد يفرض رفض كل احتياجاته بصرف النظر عمّا أُرسل.
        const needDecision =
          decision === 'REJECTED' ? NeedDecisionStatus.REJECTED : toNeedDecision(entry.decision, need.deviceType);

        // سبب رفض الاحتياج الفردي **اختياري دائمًا** — لا يُرفض القرار لغيابه.
        const rejectReason =
          needDecision === NeedDecisionStatus.REJECTED ? cleanText(entry.rejectReason, BENEFICIARY_LIMITS.rejectReason) : '';

        resolved.push({ needId: need.id, decision: needDecision, rejectReason });
      }

      for (const need of pendingNeeds) {
        if (seen.has(need.id)) continue;
        if (decision === 'REJECTED') {
          // رفض المستفيد يغلق كل احتياجاته المعلَّقة تلقائيًا.
          resolved.push({ needId: need.id, decision: NeedDecisionStatus.REJECTED, rejectReason: beneficiaryRejectReason });
        } else {
          throw new ApiError(
            'BENEFICIARY_NEED_DECISION_MISSING',
            `يجب البتّ في كل احتياجات المستفيد المعلَّقة قبل اعتماده — لم يُذكر قرار للاحتياج: ${need.deviceType}`,
            400,
          );
        }
      }

      // سبب موحَّد واحد لكل احتياجات مستفيد مرفوض — بما فيها ما أُرسل له
      // سبب فردي صراحةً (Phase 3.1 القسم 0). لا أسباب متفرقة.
      if (decision === 'REJECTED') {
        for (const item of resolved) item.rejectReason = beneficiaryRejectReason;
      }

      const approvedCount = resolved.filter((r) => r.decision === NeedDecisionStatus.APPROVED).length;

      // اعتماد المستفيد يستلزم احتياجًا معتمدًا واحدًا على الأقل — أي
      // "كل الاحتياجات مرفوضة" يستحيل معه الاعتماد، فينتهي المستفيد
      // مرفوضًا حتمًا. الشرط مفروض لحظة الاعتماد لا كملاحظة استعلام.
      if (decision === 'APPROVED' && approvedCount === 0) {
        throw new ApiError(
          'BENEFICIARY_ALL_NEEDS_REJECTED',
          'لا يمكن قبول المستفيد نهائيًا دون اعتماد احتياج واحد على الأقل',
          400,
        );
      }

      // ---- الكتابة الفعلية (بعد اكتمال كل التحقق) ----
      const now = new Date();
      const finalStatus = decision === 'APPROVED' ? BeneficiaryReviewStatus.APPROVED : BeneficiaryReviewStatus.REJECTED;

      await tx.beneficiary.update({
        where: { id },
        data: {
          reviewStatus: finalStatus,
          beneficiaryRejectReason: decision === 'REJECTED' ? beneficiaryRejectReason : null,
          reviewedById: ctx.accountId,
          reviewedAt: now,
        },
      });

      for (const item of resolved) {
        await tx.beneficiaryNeed.update({
          where: { id: item.needId },
          data: {
            decisionStatus: item.decision,
            rejectReason: item.decision === NeedDecisionStatus.REJECTED ? item.rejectReason || null : null,
            reviewedById: ctx.accountId,
            reviewedAt: now,
            // اعتماد الاحتياج يُنشئ **استحقاقًا معتمدًا** فورًا — حقيقة
            // بيانات/أعمال بحتة، مستقلة تمامًا عن توفر أي جهاز في أي
            // مخزون (لا يوجد فحص مخزون هنا، ولا مخزون أصلًا في NODE-3).
            fulfillmentStatus: item.decision === NeedDecisionStatus.APPROVED ? NeedFulfillmentStatus.APPROVED_ENTITLEMENT : null,
          },
        });
      }

      const result: ReviewOutcome = {
        beneficiaryId: id,
        beneficiaryDecision: finalStatus,
        approvedCount,
        rejectedCount: resolved.length - approvedCount,
        associationId: locked.association_id,
      };
      await this.idempotency.complete(tx, ctx.accountId, scope, input.opId, result);
      return { replayed: false as const, result };
    });
  }

  // ================================================================
  // أدوات داخلية
  // ================================================================

  /**
   * البذرة تُستدعى **بعد** التزام معاملة المراجعة حصرًا، وفشلها لا يُسقط
   * قرارًا نجح فعليًا — يُلتقَط ويُعاد كتحذير فقط (نفس عزل audit).
   */
  private async fireAllocationTrigger(associationId: string): Promise<string | null> {
    try {
      await this.allocationTrigger.triggerForAssociation(associationId);
      return null;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`نجح قرار المراجعة فعليًا لكن فشلت إشارة التخصيص للجمعية ${associationId}: ${message}`);
      return message;
    }
  }

  private async lockBeneficiary(tx: Prisma.TransactionClient, id: string) {
    const rows = await tx.$queryRaw<
      {
        id: string;
        review_status: string;
        association_id: string;
        latitude: Prisma.Decimal | null;
        longitude: Prisma.Decimal | null;
      }[]
    >`
      SELECT id, review_status, association_id, latitude, longitude
      FROM beneficiaries WHERE id = ${id}::uuid AND archived_at IS NULL FOR UPDATE
    `;
    return rows[0] ?? null;
  }

  /**
   * `findPossibleDuplicateBeneficiary_` — نفس الاسم بعد التطبيع + نفس
   * المدينة، ضمن **نفس الجمعية حصرًا**، مع استثناء السجل نفسه عند التعديل.
   *
   * تنبيه **غير حاجب**: الحفظ ينجح كما هو (201/200)، ويُرفَق التنبيه في
   * الرد فقط — تمامًا كـ`result.possibleDuplicateWarning` القديمة التي
   * تعرضها الواجهة كـtoast تحذيري لا كنافذة مانعة.
   *
   * التطبيع (`trim` + توحيد المسافات + حالة صغيرة) يُنفَّذ داخل SQL بنفس
   * منطق `normalizeNameForMatch_` حتى تتم المطابقة في القاعدة لا بسحب كل
   * صفوف الجمعية إلى التطبيق. النطاق مقيَّد بـ`association_id` في شرط
   * الاستعلام نفسه، فلا يمكن أن يقرأ صف جمعية أخرى إطلاقًا.
   */
  private async findPossibleDuplicate(
    tx: Prisma.TransactionClient,
    associationId: string,
    name: string,
    city: string,
    excludeId: string | null,
  ): Promise<PossibleDuplicateWarning | null> {
    const normalizedName = normalizeNameForMatch(name);
    if (!normalizedName) return null;

    const rows = await tx.$queryRaw<{ public_code: string }[]>`
      SELECT public_code FROM beneficiaries
      WHERE association_id = ${associationId}::uuid
        AND archived_at IS NULL
        AND (${excludeId}::uuid IS NULL OR id <> ${excludeId}::uuid)
        AND lower(regexp_replace(btrim(name), '\s+', ' ', 'g')) = ${normalizedName}
        AND city = ${city}
      ORDER BY created_at ASC
      LIMIT 1
    `;

    const match = rows[0];
    if (!match) return null;

    // الرسالة تذكر الرمز العام البشري فقط — لا UUID داخلي إطلاقًا.
    return {
      publicCode: match.public_code,
      message: `تنبيه: يوجد مستفيد آخر بنفس الاسم والمدينة (رقم ${match.public_code}) — تأكد أنه ليس تكرارًا قبل المتابعة`,
    };
  }

  /**
   * `findConfirmedDuplicateBeneficiary_` — نفس رقم الجوال (الأساسي أو
   * الإضافي) لمستفيد آخر ضمن **نفس الجمعية فقط**؛ لا يفحص جمعيات أخرى
   * إطلاقًا فلا يكشف بياناتها.
   */
  private async assertNoConfirmedDuplicate(
    tx: Prisma.TransactionClient,
    associationId: string,
    phone: string,
    secondaryPhone: string | null,
    excludeId: string | null,
  ) {
    const candidates = [phone, ...(secondaryPhone ? [secondaryPhone] : [])];
    const duplicate = await tx.beneficiary.findFirst({
      where: {
        associationId,
        archivedAt: null,
        ...(excludeId ? { id: { not: excludeId } } : {}),
        OR: [{ phone: { in: candidates } }, { secondaryPhone: { in: candidates } }],
      },
      select: { id: true },
    });
    if (duplicate) {
      throw new ApiError(
        'BENEFICIARY_DUPLICATE_PHONE',
        'يوجد مستفيد آخر بنفس رقم الجوال لدى هذه الجمعية بالفعل — تحقق من عدم تكرار الإضافة',
        409,
      );
    }
  }

  /** عدّادات الاحتياجات لكل مستفيد في الصفحة — استعلام تجميعي واحد، لا N+1. */
  private async needCountsByBeneficiary(
    ids: string[],
  ): Promise<Record<string, { needsTotal: number; needsPending: number; needsApproved: number; needsRejected: number }>> {
    const result: Record<string, { needsTotal: number; needsPending: number; needsApproved: number; needsRejected: number }> = {};
    for (const id of ids) result[id] = { needsTotal: 0, needsPending: 0, needsApproved: 0, needsRejected: 0 };
    if (ids.length === 0) return result;

    const grouped = await prisma.beneficiaryNeed.groupBy({
      by: ['beneficiaryId', 'decisionStatus'],
      where: { beneficiaryId: { in: ids } },
      _count: { _all: true },
    });

    for (const row of grouped) {
      const bucket = result[row.beneficiaryId];
      if (!bucket) continue;
      const count = row._count._all;
      bucket.needsTotal += count;
      if (row.decisionStatus === NeedDecisionStatus.PENDING) bucket.needsPending += count;
      else if (row.decisionStatus === NeedDecisionStatus.APPROVED) bucket.needsApproved += count;
      else if (row.decisionStatus === NeedDecisionStatus.REJECTED) bucket.needsRejected += count;
    }
    return result;
  }

  /** نطاق الاستعلام: ASSOCIATION مقيَّد بجمعيته حصرًا؛ ADMIN حر (أو مُصفّى اختياريًا). */
  private resolveTenantScope(ctx: AuthContext, requested?: string): string | undefined {
    if (ctx.role === AccountRole.ASSOCIATION) {
      if (!ctx.associationId) throw authForbidden();
      return ctx.associationId;
    }
    return requested || undefined;
  }

  /** جمعية الكتابة: من AuthContext لفاعل ASSOCIATION، ومن الطلب لِADMIN. */
  private resolveWriteAssociation(ctx: AuthContext, requested?: string): string {
    if (ctx.role === AccountRole.ASSOCIATION) {
      if (!ctx.associationId) throw authForbidden();
      return ctx.associationId;
    }
    const associationId = String(requested ?? '').trim();
    if (!associationId) throw new ApiError('BENEFICIARY_ASSOCIATION_REQUIRED', 'اختر جمعية صحيحة', 400);
    return associationId;
  }

  private assertTenantAccess(ctx: AuthContext, associationId: string) {
    if (ctx.role === AccountRole.ASSOCIATION && ctx.associationId !== associationId) {
      // 404 لا 403: فاعل ASSOCIATION لا يجوز أن يستدل حتى على **وجود**
      // سجل لدى جمعية أخرى (منع تعداد المعرّفات).
      throw beneficiaryNotFound();
    }
  }

  private actor(ctx: AuthContext) {
    return { id: ctx.accountId, role: ctx.role, associationId: ctx.associationId };
  }

  /** يطابق `buildBeneficiaryFieldValues_` — تحقق صيغة بحت، بلا أي قراءة/كتابة قرار. */
  private async buildFieldValues(input: BeneficiaryWriteInput, existing: { region: string; city: string; maritalStatus: string } | null) {
    const phone = normalizeSaudiPhone(input.phone);
    const secondaryPhone = input.phone2 ? normalizeSaudiPhone(input.phone2) : null;

    const place = await validateRegionCity(input.region, input.city);
    const maritalStatus = await validateSocialStatus(input.socialStatus, existing?.maritalStatus);

    return {
      name: requiredText(input.name, 'اسم المستفيد', BENEFICIARY_LIMITS.name),
      region: place.region,
      city: place.city,
      district: requiredText(input.district, 'الحي', BENEFICIARY_LIMITS.district),
      // NODE-3.1 — `address`/`landmark` غير مذكورين هنا إطلاقًا: لم يعودا
      // حقلَي إدخال، ولا يُكتَب إليهما من أي مسار REST. عند الإنشاء يبقى
      // `address` على قيمته الافتراضية في القاعدة ('') و`landmark` على
      // `null`؛ وعند التعديل تبقى قيمتهما التاريخية سليمة لأن مفتاحهما لا
      // يظهر في `data` أصلًا. (انحراف مقصود عن Legacy — راجع BENEFICIARIES.md.)
      phone,
      secondaryPhone,
      familyCount: boundedInt(input.familyCount, BENEFICIARY_LIMITS.familyCountMin, BENEFICIARY_LIMITS.familyCountMax, 'عدد الأفراد'),
      socialSecurity: input.socialSecurity === true,
      maritalStatus,
      income: new Prisma.Decimal(
        boundedInt(input.income ?? 0, BENEFICIARY_LIMITS.incomeMin, BENEFICIARY_LIMITS.incomeMax, 'مبلغ الدخل'),
      ),
      notes: cleanText(input.notes, BENEFICIARY_LIMITS.notes) || null,
    };
  }
}

// ================================================================
// دوال مساعدة على مستوى الوحدة
// ================================================================

function beneficiaryNotFound(): ApiError {
  return new ApiError('BENEFICIARY_NOT_FOUND', 'المستفيد غير موجود', 404);
}

function needsLocked(): ApiError {
  return new ApiError(
    'BENEFICIARY_NEEDS_LOCKED',
    'تم اتخاذ قرار مراجعة نهائي لهذا المستفيد، ولا يمكن تعديل احتياجاته بعد ذلك',
    409,
  );
}

/**
 * `requiredIfRejected_` — سبب رفض المستفيد إلزامي فعلًا عند الرفض.
 * كود خطأ مخصَّص (لا `BadRequestException` عام) حتى تستطيع الواجهة
 * والمراجعة بالجملة تمييز هذا السبب تحديدًا عن أي خطأ تحقق آخر.
 * فراغ/مسافات فقط = غياب (cleanText يقصّ المسافات أولًا).
 */
function requireRejectReason(value: unknown): string {
  const cleaned = cleanText(value, BENEFICIARY_LIMITS.rejectReason);
  if (!cleaned) {
    throw new ApiError('BENEFICIARY_REJECTION_REASON_REQUIRED', 'سبب رفض المستفيد إلزامي عند الرفض', 400);
  }
  return cleaned;
}

function requiresNeed(): ApiError {
  return new ApiError('BENEFICIARY_REQUIRES_NEED', 'اختر احتياجًا واحدًا على الأقل من الأنواع المتاحة', 400);
}

function isFinalReviewStatus(status: BeneficiaryReviewStatus): boolean {
  return status === BeneficiaryReviewStatus.APPROVED || status === BeneficiaryReviewStatus.REJECTED;
}

/**
 * `validateNewNeedDeviceTypes_` — قائمة غير فارغة، كل قيمة ضمن الأنواع
 * الثلاثة المعتمدة، والتكرار داخل الطلب يُدمَج بلا خطأ (uniqueTypes).
 *
 * ملاحظة "القيم التاريخية": عمود `device_type` هو enum من ثلاث قيم فقط
 * (`DeviceType` الموحَّد في NODE-0.1)، ولا توجد أي قيمة تاريخية أخرى
 * ممكنة على `beneficiary_needs` — القيد القديم نفسه كان محصورًا في
 * `NEW_NEED_DEVICE_TYPES` الثلاثة. النطاق الأوسع تاريخيًا يخصّ
 * `device_units`/`receipt_items` وحدهما، ولهما بالفعل حقل أرشيف نصي
 * منفصل `legacyDeviceTypeText` (NODE-0.1) — لا علاقة له بالاحتياجات.
 */
function validateNewNeedDeviceTypes(deviceTypes: DeviceType[] | undefined | null): DeviceType[] {
  if (!Array.isArray(deviceTypes) || deviceTypes.length === 0) throw requiresNeed();
  const unique: DeviceType[] = [];
  for (const type of deviceTypes) {
    if (!NEW_NEED_DEVICE_TYPES.includes(type)) {
      throw new ApiError('BENEFICIARY_INVALID_DEVICE_TYPE', `نوع جهاز غير مسموح به في احتياج جديد: «${type}»`, 400);
    }
    if (!unique.includes(type)) unique.push(type);
  }
  if (unique.length === 0) throw requiresNeed();
  return unique;
}

function toNeedDecision(decision: string, deviceType: DeviceType): NeedDecisionStatus {
  if (decision === 'APPROVED') return NeedDecisionStatus.APPROVED;
  if (decision === 'REJECTED') return NeedDecisionStatus.REJECTED;
  throw new ApiError('BENEFICIARY_INVALID_DECISION', `قرار الاحتياج (${deviceType}) يجب أن يكون APPROVED أو REJECTED`, 400);
}

/** يطابق `boundedNumber_` — يرفض غير الرقمي/خارج المدى بدل قصّه بصمت. */
function boundedInt(value: unknown, min: number, max: number, label: string): number {
  const num = Number(value);
  if (!Number.isFinite(num) || !Number.isInteger(num) || num < min || num > max) {
    throw new ApiError('BENEFICIARY_VALUE_OUT_OF_RANGE', `${label} يجب أن يكون عددًا صحيحًا بين ${min} و${max}`, 400);
  }
  return num;
}

function tryNormalizePhone(search: string): string | undefined {
  if (!/\d/.test(search)) return undefined;
  try {
    return normalizeSaudiPhone(search);
  } catch {
    return undefined;
  }
}

function mapBeneficiary(row: {
  id: string;
  publicCode: string;
  associationId: string;
  name: string;
  region: string;
  city: string;
  district: string | null;
  address: string;
  phone: string;
  secondaryPhone: string | null;
  familyCount: number;
  socialSecurity: boolean;
  maritalStatus: string;
  income: Prisma.Decimal | null;
  landmark: string | null;
  notes: string | null;
  latitude: Prisma.Decimal | null;
  longitude: Prisma.Decimal | null;
  locationSource: string | null;
  locationUpdatedAt: Date | null;
  reviewStatus: string;
  beneficiaryRejectReason: string | null;
  reviewedAt: Date | null;
  createdAt: Date;
}) {
  return {
    id: row.id,
    publicCode: row.publicCode,
    associationId: row.associationId,
    name: row.name,
    region: row.region,
    city: row.city,
    district: row.district,
    address: row.address,
    phone: row.phone,
    phone2: row.secondaryPhone,
    familyCount: row.familyCount,
    socialSecurity: row.socialSecurity,
    socialStatus: row.maritalStatus,
    income: row.income ? Number(row.income) : 0,
    // NODE-3.1 — `address`/`landmark` حقلا **قراءة تاريخية** فقط: يبقيان في
    // شكل الرد كما هما (سجلات مهاجَرة قد تحملهما)، لكنهما ليسا حقلَي إدخال.
    landmark: row.landmark,
    notes: row.notes,
    lat: row.latitude === null ? null : Number(row.latitude),
    lng: row.longitude === null ? null : Number(row.longitude),
    locationSource: row.locationSource,
    locationUpdatedAt: row.locationUpdatedAt,
    // حالة مشتقة لا عمود لها — `beneficiaryLocationConfirmed_`.
    locationConfirmed: locationConfirmed(row),
    reviewStatus: row.reviewStatus,
    beneficiaryRejectReason: row.beneficiaryRejectReason,
    reviewedAt: row.reviewedAt,
    createdAt: row.createdAt,
  };
}

function mapNeed(row: {
  id: string;
  publicCode: string;
  deviceType: string;
  decisionStatus: string;
  rejectReason: string | null;
  fulfillmentStatus: string | null;
  reviewedAt: Date | null;
  createdAt: Date;
}) {
  return {
    id: row.id,
    publicCode: row.publicCode,
    deviceType: row.deviceType,
    decisionStatus: row.decisionStatus,
    rejectReason: row.rejectReason,
    fulfillmentStatus: row.fulfillmentStatus,
    reviewedAt: row.reviewedAt,
    createdAt: row.createdAt,
  };
}
