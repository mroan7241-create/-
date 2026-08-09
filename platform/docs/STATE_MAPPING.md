# خرائط الحالات (Legacy → Internal Enum)

هذا الملف يوثّق تحويل كل حالة نصية عربية في النظام القديم (Google Apps
Script) إلى enum داخلي مستقر بالإنجليزية في المنصة الجديدة. **لا حالة
جديدة اخترعناها هنا** — كل قيمة مأخوذة حرفيًا من `StateRules.gs`
و`Config.gs` على الفرع `claude/code-index-review-kz5k4u`
(baseline: `daa5e6d5d98b3b724bd867ce1d9117ded14db3f9`).

القيم enum الفعلية: `platform/packages/shared/src/enums.ts`.
تعريب العرض: `platform/packages/shared/src/status-maps.ts`.

---

## 1) Application (طلب انضمام جمعية)

**المصدر**: `Config.gs` → `APPLICATION_STATUSES` (لا جدول انتقالات صريح — دورة خطية في `Applications.gs`).

| Legacy (عربي) | Internal enum (`ApplicationStatus`) |
|---|---|
| قيد المراجعة | `UNDER_REVIEW` |
| مقبول | `ACCEPTED` |
| مرفوض | `REJECTED` |

الانتقالات: `UNDER_REVIEW → ACCEPTED \| REJECTED` فقط (لا رجوع، حسب `Applications.gs`).

**منفَّذ فعليًا في NODE-2.** لا توجد ولن تُضاف أي حالة أخرى: لا
`DRAFT`/`SUBMITTED`/`INCOMPLETE`/`ELIGIBLE`/`INELIGIBLE`/`SCORED`/
`MAIN_LIST`/`RESERVE_LIST`/`AWAITING_AGREEMENT`/`ACTIVATED` — لأن أيًّا
منها غير موجود في النظام القديم، ولا محرّك تقييم ولا بوابة أهلية.

- **النهائية مفروضة على مستوى الكود وقاعدة البيانات معًا**: كل مراجعة
  تبدأ بـ`SELECT … FOR UPDATE` على صف الطلب داخل المعاملة، فأي محاولة
  ثانية (بما فيها قبول ورفض متزامنان) ترى الحالة المبتوتة وتُرفض بـ
  `APPLICATION_ALREADY_REVIEWED` (409).
- **`ACCEPTED` هو الانتقال الوحيد المتعدي**: ينشئ في نفس المعاملة
  `associations` + `accounts` (دور `ASSOCIATION`) + `auth_credentials`
  ويربط `resulting_association_id`. `REJECTED` لا ينشئ شيئًا ويشترط
  سببًا نصيًا (≤ 300 حرفًا).
- **مؤشّر «7/8» ليس حالة ولا مدخلًا لقرار** — عدد إجابات «نعم» يُحسب
  للعرض فقط ولا يُخزَّن كحقل مشتق ولا يؤثر في أي انتقال.

راجع ASSOCIATION_APPLICATIONS.md §5 للتسلسل الكامل.

---

## 2) Association (حالة الجمعية)

**منفَّذ فعليًا في NODE-2**: `ACTIVE ⇄ INACTIVE` عبر
`PATCH /associations/:id` (ADMIN فقط). الانتقال `ACTIVE → INACTIVE`
يُبطل فورًا كل جلسات حسابات الجمعية (`ASSOCIATION` + `DELEGATE`)؛
والانتقال العكسي **لا** يُحيي جلسة مُبطلة. الجمعية لا تستطيع تغيير حالتها
بنفسها (مسار الإعدادات الذاتية لا يقبل الحقل أصلًا).


**المصدر**: `DevicesAssociations.gs` (الحقل `'الحالة'` في ورقة "الجمعيات": `'نشطة' / 'غير نشطة'`).

| Legacy (عربي) | Internal enum (`AssociationStatus`) |
|---|---|
| نشطة | `ACTIVE` |
| غير نشطة | `INACTIVE` |

---

## 3) Account (حالة الحساب)

**المصدر**: `Auth.gs` (الحقل `'الحالة'` في ورقتَي "المستخدمون"/"المناديب": يُفحص بمقارنة `=== 'نشط'`).

| Legacy (عربي) | Internal enum (`AccountStatus`) |
|---|---|
| نشط | `ACTIVE` |
| (غير ذلك) | `SUSPENDED` |

---

## 4) Beneficiary Review (حالة مراجعة المستفيد) — Source of Truth الجديد

**المصدر**: `StateRules.gs` → `BENEFICIARY_REVIEW_STATUSES` + `BENEFICIARY_REVIEW_TRANSITIONS_` + `assertBeneficiaryReviewTransition_`.

| Legacy (عربي) | Internal enum (`BeneficiaryReviewStatus`) |
|---|---|
| تحت المراجعة | `UNDER_REVIEW` |
| معتمد | `APPROVED` |
| مرفوض | `REJECTED` |

**الانتقالات المسموحة** (حرفيًا من `BENEFICIARY_REVIEW_TRANSITIONS_`):

```
UNDER_REVIEW → UNDER_REVIEW | APPROVED | REJECTED
APPROVED     → (لا انتقال — حالة نهائية، بلا حلقة ذاتية)
REJECTED     → (لا انتقال — حالة نهائية، بلا حلقة ذاتية)
```

ملاحظة حرجة يجب الحفاظ عليها عند نقل المنطق في NODE-3: حالة فارغة
(`fromStatus` غير موجودة — مستفيد لم يُراجَع قط) تُعامَل كـ`UNDER_REVIEW`
(`assertBeneficiaryReviewTransition_`: `if (!fromStatus) return true`).

**المصدر الوظيفي**: `BeneficiaryNeeds.gs` → `reviewBeneficiaryNeeds_`
(القواعد الكاملة: سبب الرفض إلزامي عند الرفض، اعتماد يتطلب احتياجًا
معتمدًا واحدًا على الأقل، رفض المستفيد يرفض كل احتياجاته المعلَّقة
تلقائيًا بنفس السبب الموحَّد).

**منفَّذ فعليًا في NODE-3** — راجع BENEFICIARIES.md. ملاحظات التنفيذ:
- النهائية مفروضة على مستوى الكود وقاعدة البيانات معًا: كل مراجعة تبدأ
  بـ`SELECT … FOR UPDATE` على صف المستفيد داخل المعاملة، فأي محاولة ثانية
  (بما فيها اعتماد ورفض متزامنان) ترى الحالة المبتوتة وتُرفض بـ
  `BENEFICIARY_ALREADY_REVIEWED` (409) — نفس نمط الطلبات في §1.
- الحالة الفارغة المذكورة أعلاه (`if (!fromStatus) return true`) لا تنشأ
  في النموذج الجديد أصلًا: العمود `review_status` غير قابل لـNULL
  وافتراضه `UNDER_REVIEW`، فيتطابق السلوكان دون حاجة لفرع خاص.

---

## 5) Legacy Beneficiary Status (الحقل القديم "حالة المستفيد")

**المصدر**: `Config.gs` → `BENEFICIARY_STATUSES`. **منفصل تمامًا** عن
"حالة مراجعة المستفيد" أعلاه (حقلان مختلفان في نفس الورقة القديمة) —
يُحفظ فقط للقراءة التاريخية في `beneficiaries.legacy_status`، **ليس**
Source of Truth جديدًا.

| Legacy (عربي) | Internal enum (`LegacyBeneficiaryStatus`) |
|---|---|
| جديد | `NEW` |
| تحت المراجعة | `UNDER_REVIEW` |
| معتمد | `APPROVED` |
| بانتظار الأجهزة | `AWAITING_DEVICES` |
| جاري التسليم | `DELIVERY_IN_PROGRESS` |
| تم التسليم | `DELIVERED` |
| ملغي | `CANCELLED` |

---

## 6) Need Decision (حالة قرار احتياج واحد)

**المصدر**: `StateRules.gs` → `NEED_DECISION_STATUSES` + `NEED_DECISION_TRANSITIONS_`.

| Legacy (عربي) | Internal enum (`NeedDecisionStatus`) |
|---|---|
| بانتظار المراجعة | `PENDING` |
| معتمد | `APPROVED` |
| مرفوض | `REJECTED` |

**الانتقالات المسموحة**:

```
PENDING  → PENDING | APPROVED | REJECTED
APPROVED → APPROVED (حلقة ذاتية فقط — لا انتقال آخر)
REJECTED → REJECTED (حلقة ذاتية فقط — لا انتقال آخر)
```

**منفَّذ فعليًا في NODE-3**: قرار الاحتياج يُتَّخذ حصرًا ضمن عملية مراجعة
المستفيد (فردية أو بالجملة)، ولا مسار آخر يكتبه. اعتماد احتياج يضبط في
نفس المعاملة `fulfillment_status = APPROVED_ENTITLEMENT` (§7) — استحقاق
معتمد بلا أي فحص مخزون، فالمخزون نفسه غير مُهاجَر بعد (NODE-4/NODE-5).

---

## 7) Need Fulfillment (حالة تنفيذ احتياج معتمد)

**المصدر**: `StateRules.gs` → `NEED_FULFILLMENT_STATUSES` + `NEED_FULFILLMENT_TRANSITIONS_` (عشر حالات، أعقد جدول انتقال في النظام).

| Legacy (عربي) | Internal enum (`NeedFulfillmentStatus`) |
|---|---|
| استحقاق معتمد | `APPROVED_ENTITLEMENT` |
| بانتظار توفر الجهاز | `AWAITING_DEVICE` |
| جهاز جاهز | `DEVICE_READY` |
| بانتظار تعيين مندوب | `AWAITING_DELEGATE_ASSIGNMENT` |
| معيّن للمندوب — بانتظار التنفيذ | `ASSIGNED_TO_DELEGATE_PENDING` |
| خرج مع المندوب | `OUT_WITH_DELEGATE` |
| مؤجل | `DEFERRED` |
| بانتظار تأكيد الإرجاع | `AWAITING_RETURN_CONFIRMATION` |
| أعيد للجمعية/المستودع | `RETURNED_TO_ASSOCIATION_WAREHOUSE` |
| تم التسليم | `DELIVERED` |

**حالة التنفيذ في NODE-3**: `APPROVED_ENTITLEMENT` وحدها هي التي تُكتب
فعليًا حتى الآن (لحظة اعتماد الاحتياج). كل الحالات التسع الباقية تتطلب
مخزون أجهزة/عهدة/تسليم لم تُهاجَر بعد — تُكتب في NODE-4/NODE-5.

**جدول الانتقالات الكامل** (حرفيًا من `NEED_FULFILLMENT_TRANSITIONS_`):

```
APPROVED_ENTITLEMENT              → APPROVED_ENTITLEMENT | AWAITING_DEVICE
AWAITING_DEVICE                   → AWAITING_DEVICE | DEVICE_READY
DEVICE_READY                      → DEVICE_READY | AWAITING_DELEGATE_ASSIGNMENT | AWAITING_DEVICE
AWAITING_DELEGATE_ASSIGNMENT      → AWAITING_DELEGATE_ASSIGNMENT | ASSIGNED_TO_DELEGATE_PENDING | AWAITING_DEVICE | DEVICE_READY
ASSIGNED_TO_DELEGATE_PENDING      → ASSIGNED_TO_DELEGATE_PENDING | OUT_WITH_DELEGATE
OUT_WITH_DELEGATE                 → OUT_WITH_DELEGATE | DELIVERED | DEFERRED | AWAITING_RETURN_CONFIRMATION
DEFERRED                          → DEFERRED | OUT_WITH_DELEGATE
AWAITING_RETURN_CONFIRMATION      → AWAITING_RETURN_CONFIRMATION | RETURNED_TO_ASSOCIATION_WAREHOUSE
RETURNED_TO_ASSOCIATION_WAREHOUSE → RETURNED_TO_ASSOCIATION_WAREHOUSE | AWAITING_DELEGATE_ASSIGNMENT
DELIVERED                         → (حالة نهائية — بلا انتقال)
```

**مسارات مركَّبة محددة (لا بحث BFS عام)** — `StateRules.gs` يفرض عمدًا
مسارات صريحة مسمّاة بدل بحث عام عن أي مسار صالح نظريًا (Phase 2.3.3
القسم 5). عند نقل هذا المنطق في NODE-3/NODE-5 يجب الحفاظ على نفس القيد:
كل عملية تُعلن مسارها المقصود صراحة، لا أن تُثبت أي تسلسل يمر تقنيًا:

- `assertDeviceLinkFulfillment_`: ربط جهاز باحتياج → ينتهي عند `DEVICE_READY` فقط.
- `assertGroupCompletionFulfillment_`: اكتمال المجموعة الجماعي → قفزة واحدة من `DEVICE_READY` إلى `AWAITING_DELEGATE_ASSIGNMENT`.
- `assertGroupRegressionFulfillment_`: تراجُع المجموعة → قفزة واحدة من `AWAITING_DELEGATE_ASSIGNMENT` إلى `DEVICE_READY` فقط (لا يجوز لاحتياج تجاوز هذه الحالة).
- `assertDeviceUnlinkFulfillment_`: فكّ ربط جهاز → من `DEVICE_READY` أو `AWAITING_DELEGATE_ASSIGNMENT` إلى `AWAITING_DEVICE` فقط.
- `assertDelegateAssignFulfillment_`: تعيين مندوب → من `DEVICE_READY`/`AWAITING_DELEGATE_ASSIGNMENT`/`ASSIGNED_TO_DELEGATE_PENDING` إلى `ASSIGNED_TO_DELEGATE_PENDING`.

---

## 8) Device (حالة الجهاز المادي)

**المصدر**: `StateRules.gs` → `DEVICE_STATUS_TRANSITIONS_` (`Config.gs` → `DEVICE_STATUSES`).

| Legacy (عربي) | Internal enum (`DeviceStatus`) |
|---|---|
| بالمستودع | `WAREHOUSE` |
| مخصص | `ALLOCATED` |
| مع المندوب | `WITH_DELEGATE` |
| تم التسليم | `DELIVERED` |
| تالف | `DAMAGED` |

**الانتقالات المسموحة**:

```
WAREHOUSE     → WAREHOUSE | ALLOCATED | DAMAGED
ALLOCATED     → ALLOCATED | WAREHOUSE | WITH_DELEGATE | DAMAGED
WITH_DELEGATE → WITH_DELEGATE | ALLOCATED | DELIVERED | DAMAGED
DELIVERED     → (حالة نهائية — بلا حلقة ذاتية، رفض إعادة تأكيد تسليم مكتمل)
DAMAGED       → DAMAGED | WAREHOUSE
```

---

## 9) Delivery Status (حالة تسليم المستفيد التشغيلية)

**المصدر**: `StateRules.gs` → `DELIVERY_STATUS_TRANSITIONS_` (`Config.gs` → `DELIVERY_STATUSES`). تُستخدم أيضًا لحالة `delivery_missions`/`delivery_attempts` في المنصة الجديدة.

| Legacy (عربي) | Internal enum (`DeliveryStatus`) |
|---|---|
| لم يبدأ | `NOT_STARTED` |
| جاري التجهيز | `PREPARING` |
| خرج مع المندوب | `OUT_WITH_DELEGATE` |
| تم التسليم | `DELIVERED` |
| تعذر التسليم | `DELIVERY_FAILED` |

**الانتقالات المسموحة**:

```
NOT_STARTED       → NOT_STARTED | PREPARING | OUT_WITH_DELEGATE
PREPARING         → PREPARING | OUT_WITH_DELEGATE | NOT_STARTED
OUT_WITH_DELEGATE → OUT_WITH_DELEGATE | DELIVERED | DELIVERY_FAILED
DELIVERY_FAILED   → DELIVERY_FAILED | OUT_WITH_DELEGATE | PREPARING
DELIVERED         → (حالة نهائية)
```

قاعدة تشغيلية حرجة (Phase 2.3/2.3.3): `assignDelegate` ينفّذ **حصرًا**
مرحلة "التعيين" (`NOT_STARTED/… → PREPARING`) — لا يحرّك أي جهاز إلى
`WITH_DELEGATE` ولا حالة تنفيذ احتياج إلى `OUT_WITH_DELEGATE`. تلك لا
تُكتَبان إلا عبر مسار استلام/عهدة فعلية مستقل (لم يُنشأ بعد في النظام
القديم عمدًا — Phase 3 لاحقة).

**أسباب تعذّر التسليم** (`Config.gs` → `FAILED_REASONS`):

| Legacy (عربي) | Internal enum (`DeliveryFailureReason`) |
|---|---|
| لم يتم التواصل | `COULD_NOT_REACH` |
| لا يرد | `NO_ANSWER` |
| طلب تأجيل | `POSTPONEMENT_REQUESTED` |
| العنوان غير صحيح | `INCORRECT_ADDRESS` |
| غير موجود | `NOT_FOUND` |
| رفض الاستلام | `RECEIPT_REFUSED` |

---

## 10) Receipt Batch (محضر استلام الأجهزة)

**المصدر**: `StateRules.gs` → `RECEIPT_BATCH_TRANSITIONS_` (`Config.gs` → `RECEIPT_BATCH_STATUSES`).

| Legacy (عربي) | Internal enum (`ReceiptBatchStatus`) |
|---|---|
| مسودة | `DRAFT` |
| بانتظار تأكيد الجمعية | `AWAITING_ASSOCIATION_CONFIRMATION` |
| تم الاستلام كاملًا | `RECEIVED_COMPLETE` |
| تم الاستلام مع فروقات | `RECEIVED_WITH_DISCREPANCIES` |

**الانتقالات المسموحة** (بلا حلقة ذاتية على أي حالة — كل انتقال تقدُّمي فقط):

```
DRAFT                              → AWAITING_ASSOCIATION_CONFIRMATION
AWAITING_ASSOCIATION_CONFIRMATION  → RECEIVED_COMPLETE | RECEIVED_WITH_DISCREPANCIES
RECEIVED_COMPLETE                  → (نهائية)
RECEIVED_WITH_DISCREPANCIES        → (نهائية)
```

قاعدة عمل يجب الحفاظ عليها عند نقل `ReceiptBatches.gs` في NODE-4: من
ينشئ المحضر لا يكون نفس الطرف الذي يؤكد الاستلام.

---

## 11) DeviceType (أنواع الجهاز المعتمدة)

**المصدر**: `Config.gs` → `NEW_NEED_DEVICE_TYPES` (محصورة عمدًا في ثلاثة فقط — منفصلة عن `REFERENCE_SEED_DEVICE_TYPES` الأوسع تاريخيًا).

| Legacy (عربي) | Internal enum (`DeviceType`) |
|---|---|
| ثلاجة | `REFRIGERATOR` |
| فرن | `OVEN` |
| غسالة | `WASHING_MACHINE` |

**NODE-0.1**: وُحِّد enum واحد باسم `DeviceType` (لا `NeedDeviceType`
منفصل) عبر `beneficiary_needs`/`receipt_items`/`device_units` معًا —
إلزامي على `beneficiary_needs` (يطابق قيد النظام القديم عند تسجيل
احتياج جديد)، واختياري على `receipt_items`/`device_units` مع حقل أرشيف
منفصل `legacyDeviceTypeText` للقيم التاريخية خارج الأنواع الثلاثة (ورقة
"الأجهزة" القديمة كانت تسمح بنطاق أوسع). راجع `DATA_MODEL.md` §14
و`LEGACY_DATA_MIGRATION.md`.

---

## 12) Location Source (مصدر الموقع الجغرافي)

**المصدر**: `Config.gs` → `LOCATION_SOURCES`.

| Legacy (عربي) | Internal enum (`LocationSource`) |
|---|---|
| خريطة | `MAP` |
| الموقع الحالي | `CURRENT_LOCATION` |
| استيراد | `IMPORT` |
| يدوي | `MANUAL` |
