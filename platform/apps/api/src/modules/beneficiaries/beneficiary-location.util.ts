import { LocationSource, Prisma } from '@alzad/db';
import { ApiError } from '../../common/api-error';
import { cleanText } from '../../common/validation/text.util';

/**
 * موقع المستفيد — NODE-3.1.
 *
 * منقول حرفيًا عن الـbaseline القديم
 * `daa5e6d5d98b3b724bd867ce1d9117ded14db3f9`:
 *  - `Validation.gs::optionalCoordinate_` (السطور 179-201)
 *  - `Validation.gs::validateLocationSource_` (السطور 202-206)
 *  - `Validation.gs::beneficiaryLocationConfirmed_` (السطور 217-223)
 *  - `Beneficiaries.gs::buildBeneficiaryFieldValues_` (السطور 209-230)
 *  - `Config.gs::LOCATION_SOURCES` (السطر 166)
 */

/**
 * `Config.gs::LOCATION_SOURCES = ['خريطة','الموقع الحالي','استيراد','يدوي']`
 * — أربع قيم بالضبط، تقابل واحدةً بواحدة `enum LocationSource` الموجود
 * أصلًا في المخطط منذ NODE-0. لا قيمة مخترعة خارج المصدر القديم.
 */
const LOCATION_SOURCE_BY_LEGACY_LABEL: Record<string, LocationSource> = {
  'خريطة': LocationSource.MAP,
  'الموقع الحالي': LocationSource.CURRENT_LOCATION,
  'استيراد': LocationSource.IMPORT,
  'يدوي': LocationSource.MANUAL,
};

export interface Coordinates {
  latitude: Prisma.Decimal;
  longitude: Prisma.Decimal;
}

/**
 * `optionalCoordinate_` حرفيًا:
 *  - كلاهما فارغ ⇒ `null` (لا إحداثيات — وهذا **صالح تمامًا**، الحفظ بلا
 *    موقع مسموح دائمًا).
 *  - أحدهما فارغ دون الآخر ⇒ خطأ صريح (لا إسقاط صامت للطرف الناقص).
 *  - غير رقمي/NaN/Infinity ⇒ خطأ.
 *  - المدى العالمي القياسي: [-90, 90] و[-180, 180] (لا يُحصَر بمربع
 *    السعودية — توسعة مقصودة في المصدر القديم نفسه).
 */
export function optionalCoordinate(lat: unknown, lng: unknown): Coordinates | null {
  const latEmpty = lat === '' || lat === null || lat === undefined;
  const lngEmpty = lng === '' || lng === null || lng === undefined;
  if (latEmpty && lngEmpty) return null;
  if (latEmpty !== lngEmpty) {
    throw new ApiError(
      'BENEFICIARY_INCOMPLETE_COORDINATES',
      'أدخل خط العرض وخط الطول معًا، أو اترك الحقلين فارغين معًا',
      400,
    );
  }

  const latNum = Number(lat);
  const lngNum = Number(lng);
  if (!Number.isFinite(latNum) || !Number.isFinite(lngNum)) {
    throw new ApiError('BENEFICIARY_INVALID_COORDINATES', 'الإحداثيات يجب أن تكون أرقامًا صحيحة', 400);
  }
  if (latNum < -90 || latNum > 90) {
    throw new ApiError('BENEFICIARY_INVALID_COORDINATES', 'خط العرض يجب أن يكون بين -90 و90', 400);
  }
  if (lngNum < -180 || lngNum > 180) {
    throw new ApiError('BENEFICIARY_INVALID_COORDINATES', 'خط الطول يجب أن يكون بين -180 و180', 400);
  }

  // العمودان `Decimal(9,6)` — نقصّ إلى ست خانات عشرية هنا صراحةً حتى
  // تكون المقارنة "هل تغيّرت الإحداثيات؟" على نفس دقّة التخزين تمامًا،
  // فلا يُعَدّ فرق تقريب في الخانة السابعة تغييرًا وهميًا للموقع.
  return {
    latitude: new Prisma.Decimal(latNum.toFixed(6)),
    longitude: new Prisma.Decimal(lngNum.toFixed(6)),
  };
}

/**
 * `validateLocationSource_(value, hasCoordinates)` حرفيًا:
 *  - بلا إحداثيات ⇒ لا مصدر إطلاقًا (`null` هنا بدل `''` القديمة، لأن
 *    العمود enum قابل لِnull).
 *  - قيمة غير معروفة ⇒ تُصحَّح إلى "يدوي" (`MANUAL`) **ولا تُرفض** — حقل
 *    تشخيصي وصفي لا حرج في تساهله، بخلاف حقول التحقق الإلزامية.
 *
 * يقبل الاسم الإنجليزي للـenum (ما ترسله الواجهة الجديدة) والتسمية
 * العربية القديمة معًا، فتبقى أي حمولة تاريخية مفهومة.
 */
export function validateLocationSource(value: unknown, hasCoordinates: boolean): LocationSource | null {
  if (!hasCoordinates) return null;
  const cleaned = cleanText(value, 30);
  if (cleaned in LOCATION_SOURCE_BY_LEGACY_LABEL) return LOCATION_SOURCE_BY_LEGACY_LABEL[cleaned];
  if ((Object.values(LocationSource) as string[]).includes(cleaned)) return cleaned as LocationSource;
  return LocationSource.MANUAL;
}

/**
 * `beneficiaryLocationConfirmed_` — حالة مشتقة بالكامل، لا عمود لها:
 * الموقع مؤكَّد ⇔ العمودان موجودان معًا.
 */
export function locationConfirmed(row: { latitude: unknown; longitude: unknown }): boolean {
  return row.latitude !== null && row.latitude !== undefined && row.longitude !== null && row.longitude !== undefined;
}

/** الحقول التي قد تُكتب على صف المستفيد نتيجة قرار الموقع (قد تكون فارغة = لا تُمسّ). */
export interface LocationWrite {
  latitude?: Prisma.Decimal | null;
  longitude?: Prisma.Decimal | null;
  locationSource?: LocationSource | null;
  locationUpdatedAt?: Date | null;
}

/**
 * قرار كتابة الموقع — جوهر `buildBeneficiaryFieldValues_` (السطور 210-227)
 * مع فارق **واحد مقصود وموثَّق**: النظام القديم يكتب صف الورقة كاملًا في
 * كل حفظ، فغياب `lat`/`lng` عن الحمولة كان يمسح الموقع ضمنيًا. مسار
 * `PATCH` هنا تعديل **جزئي**، فلا يجوز أن يُترجَم "الحقل غير مُرسَل" إلى
 * "امسح الموقع" — وإلا لمَحا كل تعديل لا علاقة له بالموقع (تغيير اسم
 * مثلًا) موقعًا مؤكَّدًا، وهو نقيض النية الصريحة المكتوبة في المصدر
 * القديم نفسه ("تعديل حقل آخر لا علاقة له بالموقع لا يُعيد ضبط آخر تحديث
 * للموقع زورًا"). لذلك:
 *  - `lat`/`lng` غائبان (`undefined`) ⇒ لا يُكتب أي حقل موقع إطلاقًا.
 *  - `lat`/`lng` = `null` صراحةً ⇒ مسح كامل (يطابق "✕ مسح الموقع" في
 *    `Index.html::clearLocationFields` ثم الحفظ).
 *  - إحداثيات صالحة **لم تتغيّر** عن المخزَّن ⇒ لا يُمسّ
 *    `locationSource`/`locationUpdatedAt` (حرفيًا كالقديم).
 *  - إحداثيات صالحة **تغيّرت فعلًا** (أو سُجّلت لأول مرة) ⇒ تُكتب مع
 *    مصدر جديد و`locationUpdatedAt = now`.
 */
export function buildLocationWrite(
  input: { lat?: number | null; lng?: number | null; locationSource?: string },
  existing: { latitude: Prisma.Decimal | null; longitude: Prisma.Decimal | null } | null,
  now: Date,
): LocationWrite {
  if (input.lat === undefined && input.lng === undefined) return {};

  const coordinates = optionalCoordinate(input.lat, input.lng);

  if (!coordinates) {
    // مسح صريح — لا معنى لمصدر أو تاريخ تحديث بلا موقع.
    return { latitude: null, longitude: null, locationSource: null, locationUpdatedAt: null };
  }

  const unchanged =
    !!existing &&
    existing.latitude !== null &&
    existing.longitude !== null &&
    existing.latitude.equals(coordinates.latitude) &&
    existing.longitude.equals(coordinates.longitude);

  if (unchanged) return {};

  return {
    latitude: coordinates.latitude,
    longitude: coordinates.longitude,
    locationSource: validateLocationSource(input.locationSource, true),
    locationUpdatedAt: now,
  };
}

/**
 * ================================================================
 * NODE-3.2 — «نيّة الموقع» المعيارية لأغراض بصمة idempotency وحدها
 * ================================================================
 *
 * `buildLocationWrite` أعلاه يُنتج **أمر كتابة فعلي** يحمل
 * `locationUpdatedAt = now` — قيمة تُولَّد لحظة التنفيذ وتختلف في كل
 * استدعاء. إدخال ذلك الكائن في حمولة `IdempotencyService.claim` كان
 * يجعل طلبين متطابقين منطقيًا (نفس `opId`، نفس المُدخَل الحقيقي)
 * يُنتِجان بصمتين مختلفتين، فيُرَدّ على إعادة المحاولة المشروعة بـ409
 * `APPLICATION_IDEMPOTENCY_CONFLICT` بدل إعادة تشغيل صحيحة.
 *
 * الحل: قيمة معيارية **ثابتة زمنيًا** تصف نيّة الطلب لا نتيجته، بثلاث
 * أشكال حصرية لا رابع لها:
 *  - `PRESERVE` — وسم بلا بيانات: الحقل غائب عن الطلب ⇒ لا يُمسّ الموقع.
 *  - `CLEAR` — وسم بلا بيانات: `lat`/`lng` = `null` صراحةً ⇒ مسح كامل.
 *  - `SET { lat, lng, locationSource }` — إحداثيات فعلية.
 *
 * قواعد ملزِمة:
 *  1. **لا تاريخ ولا أي قيمة تُولَّد وقت التنفيذ** داخل هذه البنية إطلاقًا.
 *  2. **لا تعتمد على الحالة المخزَّنة في القاعدة**: البصمة تصف الطلب، لا
 *     أثره. لو دخلت الحالة المخزَّنة في الحساب لانقلبت البصمة بعد أول
 *     تنفيذ ناجح (لأنه هو نفسه يغيّر تلك الحالة)، فتفشل كل إعادة محاولة
 *     لاحقة — وهو عين العطب الذي نُصلحه. لذلك لا وسيط `existing` هنا.
 *  3. **تُستعمل للبصمة فقط**: قرار الكتابة الحقيقي يبقى بيد
 *     `buildLocationWrite` بلا أي تغيير في سلوكه.
 *
 * تطابق التقريب مضمون **بالبناء** لا بالمصادفة: الدالتان تستدعيان
 * `optionalCoordinate` نفسها، فتخضع الإحداثيات لنفس القصّ إلى ست خانات
 * عشرية (`Decimal(9,6)` — دقّة التخزين الفعلية). ولا مخطَّط تقريب ثانٍ في
 * المشروع يمكن أن يخالفه. وكذلك المصدر يمرّ بـ`validateLocationSource`
 * نفسها، فقيمتان خامّتان مجهولتان تؤولان كلتاهما إلى `MANUAL` ⇒ بصمة
 * واحدة (نيّة واحدة فعلًا)، بينما `MAP` مقابل `CURRENT_LOCATION` ⇒ 409.
 */
export type LocationIntent =
  | { intent: 'PRESERVE' }
  | { intent: 'CLEAR' }
  | { intent: 'SET'; lat: string; lng: string; locationSource: LocationSource };

export function canonicalizeLocationIntent(input: {
  lat?: number | null;
  lng?: number | null;
  locationSource?: string;
}): LocationIntent {
  // نفس شرط `buildLocationWrite` حرفيًا — الغياب التام وحده هو "لا تمسّ".
  // لا `?? null` هنا بحال: طيّ `undefined` و`null` في قيمة واحدة هو ما كان
  // يجعل «احفظ الموقع كما هو» و«امسح الموقع» يتقاسمان بصمة واحدة.
  if (input.lat === undefined && input.lng === undefined) return { intent: 'PRESERVE' };

  const coordinates = optionalCoordinate(input.lat, input.lng);
  if (!coordinates) return { intent: 'CLEAR' };

  return {
    intent: 'SET',
    // صيغة نصية بست خانات — تمثيل `Decimal(9,6)` نفسه بلا أي رحلة ذهاب
    // وإياب عبر float، فالبصمة مستقرة تمامًا عبر العمليات.
    lat: coordinates.latitude.toFixed(6),
    lng: coordinates.longitude.toFixed(6),
    // `hasCoordinates = true` هنا يقينًا، فالمُرجَع لا يكون `null` أبدًا.
    locationSource: validateLocationSource(input.locationSource, true) ?? LocationSource.MANUAL,
  };
}

/**
 * `normalizeNameForMatch_` حرفيًا (Beneficiaries.gs السطر 116-118):
 * قصّ + توحيد المسافات + حالة أحرف صغيرة. إشارة "مطابق محتمل" فقط، لا
 * دليل قاطع أبدًا وحده.
 */
export function normalizeNameForMatch(name: unknown): string {
  return String(name ?? '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();
}
