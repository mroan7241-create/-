# LEGACY_DATA_MIGRATION.md — تصميم فقط، لا استيراد بيانات حقيقية الآن

**ممنوع صراحة في NODE-0 وحتى NODE-8**: أي اتصال مباشر ببيانات
Production الحقيقية على Google Sheets. هذا الملف تصميم للعملية فقط.

## خط الأنابيب المخطَّط

```
Google Sheets export (كل ورقة → CSV/JSON عبر Apps Script تصدير موثَّق،
                       ليس استعلامًا مباشرًا من المنصة الجديدة)
        │
        ▼
staging/import parser (Node.js — يقرأ التصدير، يطبّع كل صف حسب
                        STATE_MAPPING.md وDATA_MODEL.md، بلا كتابة بعد)
        │
        ▼
validation report (تقرير كامل row-level: كل صف صالح/فاسد ولماذا،
                    قبل أي كتابة إطلاقًا — نفس فلسفة migrateLegacyReferenceValues_
                    dry-run في النظام القديم)
        │
        ▼
transaction (كتابة فعلية دفعة واحدة أو دفعات صغيرة، كل دفعة
             transaction مستقلة — فشل دفعة لا يفسد الدفعات الناجحة قبلها)
        │
        ▼
PostgreSQL (المنصة الجديدة)
```

## المتطلبات الإلزامية لأي import run لاحق

1. **idempotent imports** — تشغيل الاستيراد مرتين على نفس التصدير لا
   يُنتج سجلات مكرَّرة. الآلية المقترحة: `import_run_id` (UUID لكل
   تشغيل) + مطابقة `legacy_id` (رقم بشري قديم، `BEN-000001`...) كمفتاح
   طبيعي للبحث عن سجل موجود مسبقًا قبل الإدراج (upsert بمفتاح
   `publicCode`، **ليس** إنشاء PK جديد إن وُجد `publicCode` مطابق).
2. **preserve legacy IDs** — كل `publicCode` من النظام القديم يُنسخ
   حرفيًا دون تعديل. لا إعادة ترقيم.
3. **duplicate detection** — قبل الكتابة، فحص تكرار على مستوى الدفعة
   المستوردة نفسها (لا فقط مقابل قاعدة البيانات الحالية) — نفس مبدأ
   فحص `needId` المكرَّر داخل نفس الطلب في `reviewBeneficiaryNeeds_`.
4. **row-level validation errors** — كل صف فاسد يُسجَّل بخطأ محدَّد
   (اسم العمود، القيمة الخام، سبب الرفض) في تقرير الـdry-run، لا رسالة
   عامة واحدة تُسقط الاستيراد بالكامل.
5. **import run ID** — كل تشغيل يحمل معرّفًا فريدًا يُسجَّل في
   `audit_logs` (`entity_type = 'IMPORT_RUN'`) — يتيح تتبّع أي سجل جاء
   من أي دفعة استيراد بالضبط.
6. **dry-run mode** — الوضع الافتراضي. الكتابة الفعلية خطوة ثانية
   صريحة منفصلة، تمامًا مثل `migrateLegacyReferenceValues_(token, true)`
   ثم `(token, false)` في النظام القديم.
7. **reconciliation totals** — بعد كل تشغيل فعلي: عدد الصفوف
   المصدر مقابل عدد السجلات المكتوبة/المتجاهَلة/الفاشلة، لكل كيان على
   حدة (مستفيدون، احتياجات، أجهزة، ...) — يجب أن يتطابق المجموع دائمًا
   (لا صف يختفي بصمت).

## ترتيب الاستيراد المقترح (يحترم الاعتماديات بين الكيانات)

```
1. reference_values  (مناطق/مدن/تصنيفات/حالات اجتماعية/أنواع أجهزة)
2. associations
3. accounts (ADMIN, ASSOCIATION, DELEGATE) + auth_credentials
   (⚠ كلمات المرور/رموز الدخول القديمة *لا* تُنقل كنص أو تجزئة قديمة —
   كل حساب يحصل على مسار "يجب تغيير كلمة المرور" فور أول دخول، تمامًا
   كآلية "بيانات المدير المؤقتة" في setupSheets_ القديمة)
4. association_applications + application_answers (أرشيف تاريخي فقط)
5. beneficiaries (بما فيها legacy_status/legacy_needs_text كحقول أرشيف)
6. beneficiary_needs
7. receipt_batches + receipt_items (النوع القديم لكل بند يُطابَق مقابل
   enum DeviceType الثلاثة الجديدة إن أمكن → device_type؛ غير ذلك
   → legacy_device_type_text فقط، device_type يبقى NULL — راجع
   DATA_MODEL.md §14 وSTATE_MAPPING.md §11) + receipt_damage_photos
8. device_units (من سجلات "الأجهزة" القديمة — current_location_type
   يُشتق من الحالة القديمة، راجع STATE_MAPPING.md §8؛ نفس مطابقة
   device_type/legacy_device_type_text المذكورة أعلاه لبنود الاستلام؛
   current_location_ref يُشتق من "رقم المندوب"/"رقم المستفيد" القديم
   حسب current_location_type — يجب أن يحترم استيراد كل صف CHECK
   constraint ck_device_units_location_ref_by_type من أول كتابة، لا بعدها)
9. device_allocations (يُشتق من ربط "رقم المستفيد"/"رقم الاحتياج" على
   الجهاز القديم — active فقط للأجهزة غير "تم التسليم"/"تالف". **لا**
   يُكتب أي beneficiaryNeedId مباشر على device_units — device_allocations
   هي المصدر الوحيد بعد NODE-0.1، راجع DATA_MODEL.md §11)
10. device_movements (سجل تاريخي — إن لم يوجد سجل حركة قديم مفصَّل،
    يُنشأ سطر واحد "IMPORTED" لكل جهاز بدل تاريخ مفقود، موثَّق كذلك)
11. delivery_missions + delivery_attempts (من ورقة "التسليمات" القديمة)
12. activities + activity_evidence
13. audit_logs (استيراد تاريخي فقط، append-only — لا تُدرَج ضمن أي
    منطق أعمال جديد)
14. files (metadata فقط في هذه المرحلة التصميمية — نقل الملفات الفعلية
    من Google Drive إلى Object Storage الجديد قرار تنفيذي منفصل يحتاج
    تصميم إضافي وقت NODE-8 الفعلي، خارج نطاق هذا المستند)

كل خطوة transaction مستقلة بحد أقصى لحجم الدفعة (batch size) — لا
transaction واحدة ضخمة لكامل الاستيراد.
```

## ما لا يُنقَل تلقائيًا

- كلمات مرور/رموز دخول مندوبين خامًا أو حتى بتجزئتهم القديمة (خوارزمية
  تجزئة مختلفة عن `auth_credentials.secret_hash` الجديدة) — إعادة تعيين
  إلزامية لكل حساب.
- أي بيانات لا تطابق `STATE_MAPPING.md` (قيمة حالة غير معروفة) — تُسجَّل
  في تقرير الفحص كـ`ambiguous`، ولا تُستورَد آليًا (نفس فلسفة
  `diagnoseReferenceDataIssues_`/`migrateLegacyReferenceValues_` في
  النظام القديم — القيم الغامضة تحتاج مراجعة يدوية سطرًا سطرًا، لا
  تخمينًا آليًا).
