import { Injectable } from '@nestjs/common';
import { prisma, Prisma, AccountRole, AccountStatus, AssociationStatus, AuthCredentialType } from '@alzad/db';
import { ApiError, authForbidden } from '../../common/api-error';
import { PublicCodeService } from '../../common/public-code.service';
import { IdempotencyService } from '../../common/idempotency.service';
import { AuditService } from '../audit/audit.service';
import { hashSecret } from '../../common/password.util';
import { assertPasswordPolicy } from '../../common/password-policy';
import { associationCreatePasswordFingerprint } from '../../common/crypto.util';
import { cleanText, requiredEmail, requiredText } from '../../common/validation/text.util';
import { normalizeSaudiPhone } from '../../common/validation/phone.util';
import { normalizePagination, toPaginatedResult, type PaginatedResult, type PaginationParams } from '../../common/pagination.util';
import {
  canonicalizeAssociationCategory,
  validateAssociationCategory,
  validateRegionCity,
} from '../applications/application-reference.util';
import { associationOrderBy, type AssociationSortField } from './association-sort.util';
import type { AuthContext } from '../auth/auth.types';

export interface CreateAssociationInput {
  name: string;
  category?: string;
  region: string;
  city: string;
  phone: string;
  email: string;
  status?: 'ACTIVE' | 'INACTIVE';
  temporaryPassword: string;
  opId: string;
}

export interface UpdateAssociationInput {
  name?: string;
  category?: string;
  region?: string;
  city?: string;
  phone?: string;
  email?: string;
  status?: 'ACTIVE' | 'INACTIVE';
}

export interface SelfSettingsInput {
  phone: string;
  email: string;
}

@Injectable()
export class AssociationsService {
  constructor(
    private readonly publicCode: PublicCodeService,
    private readonly idempotency: IdempotencyService,
    private readonly audit: AuditService,
  ) {}

  async listAssociations(
    params: PaginationParams & { search?: string; status?: AssociationStatus; sortBy?: AssociationSortField; sortDir?: 'asc' | 'desc' },
  ): Promise<PaginatedResult<unknown>> {
    const { page, pageSize, skip, take } = normalizePagination(params);
    const where: Prisma.AssociationWhereInput = {};
    if (params.status) where.status = params.status;
    if (params.search) {
      const q = params.search.trim();
      const or: Prisma.AssociationWhereInput[] = [
        { name: { contains: q, mode: 'insensitive' } },
        { publicCode: { contains: q, mode: 'insensitive' } },
        { email: { contains: q, mode: 'insensitive' } },
        { region: { contains: q, mode: 'insensitive' } },
        { city: { contains: q, mode: 'insensitive' } },
      ];

      // NODE-2.1: البحث بالجوال — Legacy يبحث في حقل phone ضمن
      // applySearch_(items, search, ['name','id','email','phone','region','city']).
      // `phones` هنا عمود text[]، وفلاتر Prisma للمصفوفات لا توفّر
      // مطابقة جزئية (has/hasSome/hasEvery فقط، لا contains) — لذلك
      // نطبّع المُدخَل أولًا بنفس normalizeSaudiPhone المستخدَم عند
      // التخزين، فيُطابَق الرقم الكامل بأي صيغة مقبولة
      // (05XXXXXXXX / 5XXXXXXXX / 966… / +966…) مطابقةً دقيقة.
      // مُدخَل غير قابل للتطبيع (رقم جزئي أثناء الكتابة) لا يضيف شرطًا
      // ولا يُفشل البحث — بقية الحقول تعمل كما هي. موثَّق في ASSOCIATIONS.md.
      const normalizedPhone = tryNormalizePhone(q);
      if (normalizedPhone) or.push({ phones: { has: normalizedPhone } });

      where.OR = or;
    }

    const [rows, total] = await Promise.all([
      prisma.association.findMany({ where, orderBy: associationOrderBy(params.sortBy, params.sortDir), skip, take }),
      prisma.association.count({ where }),
    ]);

    const ids = rows.map((r) => r.id);
    const counts = await this.countsByAssociation(ids);

    return toPaginatedResult(
      rows.map((row) => ({ ...mapAssociation(row), ...counts[row.id] })),
      total,
      page,
      pageSize,
    );
  }

  async getAssociationDetail(id: string) {
    const association = await prisma.association.findUnique({ where: { id } });
    if (!association) throw new ApiError('ASSOCIATION_NOT_FOUND', 'الجمعية غير موجودة', 404);

    const account = await prisma.account.findFirst({
      where: { associationId: id, role: AccountRole.ASSOCIATION, archivedAt: null },
      select: { id: true, publicCode: true, email: true, status: true, mustChangePassword: true, lastLoginAt: true },
    });
    const counts = await this.countsByAssociation([id]);

    return { ...mapAssociation(association), ...counts[id], account: account ?? null };
  }

  // ================================================================
  // ADMIN — إنشاء مباشر (saveAssociation Legacy — بلا payload.id)
  // ================================================================
  async createAssociation(ctx: AuthContext, input: CreateAssociationInput) {
    const name = requiredText(input.name, 'اسم الجمعية', 150);
    const email = requiredEmail(input.email);
    const phone = normalizeSaudiPhone(input.phone);
    // NODE-2.1: الإنشاء المباشر يمرّ الآن بنفس مُتحقِّقات البيانات المرجعية
    // التي يمرّ بها طلب الانضمام العام (validateRegionCity_/
    // validateAssociationCategory_ في Legacy) — لا grandfathering هنا
    // إطلاقًا لأن السجل جديد (previous فارغة عند الإنشاء في Legacy أيضًا).
    // المرادف التاريخي "بر" يُطبَّع إلى "جمعية بر" قبل التخزين.
    const category = await validateAssociationCategory(input.category);
    const { region, city } = await validateRegionCity(input.region, input.city);
    const status = input.status === 'INACTIVE' ? AssociationStatus.INACTIVE : AssociationStatus.ACTIVE;
    const finalPassword = await assertPasswordPolicy(input.temporaryPassword, '', null);

    // NODE-2.1 (أمني): كلمة المرور المؤقتة جزء من هوية الطلب فعليًا —
    // إعادة تشغيل بنفس opId بكلمة مرور مختلفة **ليست** نفس الطلب ويجب أن
    // تُرفَض بـ409 لا أن تُعاد كنجاح idempotent. لكنها لا يجوز أن تصل
    // خامًا إلى أي شيء يُخزَّن (request_hash/response_json/audit/سجلات).
    // الحل: بصمة HMAC حتمية بمفتاح مُدار قائم مع فصل نطاق صريح — راجع
    // common/crypto.util.ts وSECURITY_MODEL.md. لا كلمة مرور خام في payload.
    const payload = {
      name,
      email,
      phone,
      category,
      region,
      city,
      status,
      temporaryPasswordFingerprint: associationCreatePasswordFingerprint(finalPassword),
    };

    const outcome = await prisma.$transaction(async (tx) => {
      const claim = await this.idempotency.claim<{ associationId: string; accountId: string }>(tx, ctx.accountId, 'association-create', input.opId, payload);
      if (!claim.claimed) return { replayed: true as const, response: claim.existingResponse! };

      const existingCredential = await tx.authCredential.findUnique({
        where: { type_identifier: { type: AuthCredentialType.EMAIL_PASSWORD, identifier: email } },
      });
      if (existingCredential) throw new ApiError('ASSOCIATION_EMAIL_IN_USE', 'البريد الإلكتروني مستخدم في حساب آخر', 409);

      const associationCode = await this.publicCode.nextPublicCode(tx, 'ASC');
      const association = await tx.association.create({
        data: { publicCode: associationCode, name, category: category ?? '', region, city, phones: [phone], email, status },
      });

      const userCode = await this.publicCode.nextPublicCode(tx, 'USR');
      const account = await tx.account.create({
        data: {
          publicCode: userCode,
          name,
          email,
          role: AccountRole.ASSOCIATION,
          associationId: association.id,
          status: AccountStatus.ACTIVE,
          mustChangePassword: true,
        },
      });

      const secretHash = await hashSecret(finalPassword);
      await tx.authCredential.create({ data: { accountId: account.id, type: AuthCredentialType.EMAIL_PASSWORD, identifier: email, secretHash } });

      const response = { associationId: association.id, accountId: account.id };
      await this.idempotency.complete(tx, ctx.accountId, 'association-create', input.opId, response);
      return { replayed: false as const, response, association };
    });

    if (!outcome.replayed) {
      await this.audit.log({ id: ctx.accountId, role: ctx.role, associationId: ctx.associationId }, 'ASSOCIATION_CREATED', 'associations', outcome.response.associationId);
    }

    return { ok: true as const, associationId: outcome.response.associationId };
  }

  // ================================================================
  // ADMIN — تعديل (saveAssociation Legacy — payload.id موجود)
  // ================================================================
  async updateAssociation(ctx: AuthContext, id: string, input: UpdateAssociationInput) {
    const before = await prisma.association.findUnique({ where: { id } });
    if (!before) throw new ApiError('ASSOCIATION_NOT_FOUND', 'الجمعية غير موجودة', 404);

    const data: Prisma.AssociationUpdateInput = {};
    if (input.name !== undefined) data.name = requiredText(input.name, 'اسم الجمعية', 150);

    // NODE-2.1 — البيانات المرجعية عند التعديل، بسلوك grandfathering مطابق لِLegacy.
    // راجع التوثيق أعلى resolveUpdatedCategory/resolveUpdatedPlace.
    if (input.category !== undefined) {
      data.category = await resolveUpdatedCategory(input.category, before.category ?? '');
    }
    if (input.region !== undefined || input.city !== undefined) {
      const place = await resolveUpdatedPlace(input, before);
      if (input.region !== undefined) data.region = place.region;
      if (input.city !== undefined) data.city = place.city;
    }

    if (input.phone !== undefined) {
      const phone = normalizeSaudiPhone(input.phone);
      data.phones = [phone];
    }
    if (input.email !== undefined) data.email = requiredEmail(input.email);

    const newStatus = input.status === 'INACTIVE' ? AssociationStatus.INACTIVE : input.status === 'ACTIVE' ? AssociationStatus.ACTIVE : undefined;
    if (newStatus) data.status = newStatus;

    const deactivating = newStatus === AssociationStatus.INACTIVE && before.status !== AssociationStatus.INACTIVE;

    // NODE-2: على خلاف saveAssociation القديمة (لا تُزامن البريد على حساب الدخول عند تعديل ADMIN — ثغرة توثَّق كذلك)،
    // نحن نتعمَّد عدم تغيير AuthCredential.identifier هنا إطلاقًا — البريد التشغيلي (contact email) منفصل عن بريد الدخول.
    //
    // NODE-2.1 (ذرّية): تحديث الحالة وإبطال الجلسات كانا استدعاءين
    // منفصلين — فشل بينهما كان يترك الجمعية INACTIVE وجلساتها حيّة
    // (نافذة وصول لحساب موقوف) أو العكس. الآن الاثنان داخل معاملة واحدة
    // بنفس عميل tx: إمّا يثبتان معًا أو لا يثبت أيّهما.
    await prisma.$transaction(async (tx) => {
      await tx.association.update({ where: { id }, data });
      if (deactivating) {
        await revokeAssociationSessions(tx, id);
      }
    });

    await this.audit.log(
      { id: ctx.accountId, role: ctx.role, associationId: ctx.associationId },
      'ASSOCIATION_UPDATED',
      'associations',
      id,
      newStatus ? { statusTransition: `${before.status}->${newStatus}` } : undefined,
    );

    return { ok: true as const };
  }

  // ================================================================
  // ASSOCIATION self-settings — قراءة القيم الحالية (لتعبئة النموذج مسبقًا)
  // ================================================================
  async getSelfSettings(ctx: AuthContext): Promise<{ phone: string; email: string }> {
    if (ctx.role !== AccountRole.ASSOCIATION || !ctx.associationId) throw authForbidden();
    const [association, account] = await Promise.all([
      prisma.association.findUniqueOrThrow({ where: { id: ctx.associationId }, select: { phones: true } }),
      prisma.account.findUniqueOrThrow({ where: { id: ctx.accountId }, select: { email: true } }),
    ]);
    return { phone: association.phones[0] ?? '', email: account.email ?? '' };
  }

  // ================================================================
  // ASSOCIATION self-settings — phone/email فقط
  // ================================================================
  async updateSelfSettings(ctx: AuthContext, input: SelfSettingsInput) {
    if (ctx.role !== AccountRole.ASSOCIATION || !ctx.associationId) throw authForbidden();

    const phone = normalizeSaudiPhone(input.phone);
    const email = requiredEmail(input.email);

    const duplicate = await prisma.account.findFirst({
      where: { id: { not: ctx.accountId }, email },
    });
    if (duplicate) throw new ApiError('ASSOCIATION_EMAIL_IN_USE', 'البريد الإلكتروني مستخدم في حساب آخر', 409);

    // NODE-2: يطابق updateAssociationSettings القديمة — تحديث Association (بيانات تواصل) وAccount.email
    // (بريد العرض على الحساب، وليس AuthCredential.identifier/بريد تسجيل الدخول) معًا بنفس المعاملة.
    await prisma.$transaction([
      prisma.association.update({ where: { id: ctx.associationId }, data: { phones: [phone], email } }),
      prisma.account.update({ where: { id: ctx.accountId }, data: { email } }),
    ]);

    await this.audit.log({ id: ctx.accountId, role: ctx.role, associationId: ctx.associationId }, 'ASSOCIATION_SETTINGS_UPDATED', 'associations', ctx.associationId);

    return { ok: true as const };
  }

  private async countsByAssociation(ids: string[]): Promise<Record<string, { beneficiariesCount: number; devicesCount: number; delegatesCount: number }>> {
    const result: Record<string, { beneficiariesCount: number; devicesCount: number; delegatesCount: number }> = {};
    for (const id of ids) result[id] = { beneficiariesCount: 0, devicesCount: 0, delegatesCount: 0 };
    if (ids.length === 0) return result;

    const [beneficiaryCounts, deviceCounts, delegateCounts] = await Promise.all([
      prisma.beneficiary.groupBy({ by: ['associationId'], where: { associationId: { in: ids } }, _count: { _all: true } }),
      prisma.deviceUnit.groupBy({ by: ['associationId'], where: { associationId: { in: ids } }, _count: { _all: true } }),
      prisma.account.groupBy({ by: ['associationId'], where: { associationId: { in: ids }, role: AccountRole.DELEGATE }, _count: { _all: true } }),
    ]);
    for (const row of beneficiaryCounts) result[row.associationId].beneficiariesCount = row._count._all;
    for (const row of deviceCounts) result[row.associationId].devicesCount = row._count._all;
    for (const row of delegateCounts) {
      if (row.associationId) result[row.associationId].delegatesCount = row._count._all;
    }
    return result;
  }
}

/**
 * ACTIVE→INACTIVE يُبطل جلسات كل حسابات الجمعية (ASSOCIATION + DELEGATE)
 * — يطابق revokeAssociationSessions_ القديمة. النطاق هو `associationId`
 * حصرًا، وحسابات ADMIN لا تحمل associationId أصلًا فلا تدخل النطاق أبدًا.
 *
 * NODE-2.1: تأخذ الآن `tx` صراحةً حتى تنفَّذ داخل نفس معاملة تحديث
 * الحالة (ذرّية التعطيل). إعادة التفعيل (INACTIVE→ACTIVE) لا تستدعيها
 * إطلاقًا — الجلسات المُبطَلة لا تُحيا أبدًا.
 */
async function revokeAssociationSessions(tx: Prisma.TransactionClient, associationId: string): Promise<void> {
  const accounts = await tx.account.findMany({ where: { associationId }, select: { id: true } });
  if (accounts.length === 0) return;
  await tx.authSession.updateMany({
    where: { accountId: { in: accounts.map((a) => a.id) }, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

/** تطبيع مُدخَل بحث إلى رقم جوال سعودي مخزَّن، أو undefined إن لم يكن رقمًا كاملًا صالحًا. */
function tryNormalizePhone(search: string): string | undefined {
  if (!/\d/.test(search)) return undefined;
  try {
    return normalizeSaudiPhone(search);
  } catch {
    return undefined;
  }
}

/**
 * NODE-2.1 — grandfathering للتصنيف عند التعديل، مطابق لِLegacy.
 *
 * الحقيقة المُتحقَّق منها في المصدر القديم
 * (`ReferenceData.gs::isGrandfatheredValue_` =
 * `!!previous && String(value) === String(previous)`، ويُستدعى من
 * `validateAssociationCategory_(value, previous)` الذي يمرّره
 * `DevicesAssociations.gs::saveAssociation` من قيمة السجل المخزَّنة):
 * إرسال **نفس** القيمة المخزَّنة يُقبَل ويُعاد حفظه كما هو حتى لو لم يعد
 * ضمن القائمة المعتمدة — أي أن مجرّد تمرير الحقل لا يُفعِّل الرفض. أما
 * أي قيمة **مختلفة** فيجب أن تكون معتمدة حاليًا. فلا يمكن أبدًا استبدال
 * قيمة غير صالحة بأخرى غير صالحة.
 *
 * كما في Legacy، تُعاد القيمة الرسمية بعد تطبيع المرادفات حتى في فرع
 * القيمة التاريخية المقبولة.
 */
async function resolveUpdatedCategory(inputCategory: string, storedCategory: string): Promise<string> {
  const cleaned = cleanText(inputCategory, 150);
  if (!cleaned) return ''; // التصنيف اختياري دائمًا — إفراغه مسموح (يطابق Legacy).
  try {
    return (await validateAssociationCategory(cleaned)) ?? '';
  } catch (error) {
    if (storedCategory && cleaned === storedCategory) return canonicalizeAssociationCategory(cleaned);
    throw error;
  }
}

/**
 * NODE-2.1 — grandfathering للمنطقة/المدينة عند التعديل.
 *
 * قاعدتان معًا:
 *  1) إن لم يُرسَل أيٌّ من الحقلين لا يُتحقَّق من شيء إطلاقًا — تعديل حقل
 *     غير ذي صلة (اسم/جوال/بريد) لا يُفشله موقعٌ تاريخي غير معتمد. هذا
 *     هو جوهر grandfathering في Legacy (تعليق isGrandfatheredValue_ نفسه).
 *  2) إن أُرسل أحدهما أو كلاهما، يُتحقَّق من **الزوج النهائي المدمَج**
 *     (الجديد لما أُرسل + المخزَّن لما لم يُرسَل) كعلاقة أب/ابن كاملة، ما
 *     لم يكن الزوج النهائي مطابقًا تمامًا للمخزَّن (إعادة إرسال نفس القيم
 *     = القيمة التاريخية المقبولة في Legacy).
 *
 * انحراف مقصود وموثَّق عن Legacy: `validateRegionCity_` القديمة تُمرِّر
 * grandfathering لكل حقل **على حدة**، فتسمح بتغيير المنطقة إلى قيمة
 * معتمدة مع إبقاء مدينة قديمة لا تتبعها — أي تكوين زوج غير صالح جديد.
 * نحن نمنع ذلك: أي تغيير فعلي يوجب أن يكون الزوج الناتج صالحًا بالكامل،
 * تنفيذًا لقاعدة "لا تُستبدَل قيمة غير صالحة بأخرى غير صالحة".
 */
async function resolveUpdatedPlace(
  input: UpdateAssociationInput,
  before: { region: string; city: string },
): Promise<{ region: string; city: string }> {
  const region = input.region !== undefined ? requiredText(input.region, 'المنطقة', 80) : before.region;
  const city = input.city !== undefined ? requiredText(input.city, 'المدينة', 80) : before.city;

  const unchanged = region === before.region && city === before.city;
  if (unchanged) return { region, city };

  return validateRegionCity(region, city);
}

function mapAssociation(row: {
  id: string;
  publicCode: string;
  name: string;
  category: string | null;
  region: string;
  city: string;
  phones: string[];
  email: string | null;
  status: string;
  createdAt: Date;
}) {
  return {
    id: row.id,
    publicCode: row.publicCode,
    name: row.name,
    category: row.category,
    region: row.region,
    city: row.city,
    phone: row.phones[0] ?? null,
    email: row.email,
    status: row.status,
    createdAt: row.createdAt,
  };
}
