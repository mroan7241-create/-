// -------------------- سلامة الحالات: مصدر واحد لقواعد الانتقال --------------------
//
// هذا الملف هو المصدر المركزي الوحيد لقواعد انتقال حالة الجهاز وحالة
// التسليم. أي دالة تُعدّل "حالة الجهاز" أو "حالة التسليم" يجب أن تمر
// عبر assertDeviceTransition_/assertDeliveryTransition_ هنا بدل تعديل
// الحقل مباشرة، حتى لا تتفرّق قواعد الانتقال بين ملفات متعددة وتتعارض.
//
// دورة حياة الجهاز المعتمدة:
//   بالمستودع → مخصص → مع المندوب → تم التسليم
//                  ↘ (رجوع للمستودع)      ↘ (تعذّر التسليم: يبقى مع المندوب)
//   أي حالة (عدا تم التسليم) → تالف
//
// دورة حياة حالة التسليم للمستفيد المعتمدة:
//   لم يبدأ → خرج مع المندوب → تم التسليم
//   (جاري التجهيز) حالة وسيطة اختيارية قبل الخروج مع مندوب، لم تعد
//   تُستخدم فعليًا من أي مسار حالي (assignDelegate ينقل مباشرة من "لم
//   يبدأ" إلى "خرج مع المندوب" بمجرد تخصيص جهاز وتعيين مندوب)، لكنها
//   أُبقيت في القائمة لتوافق البيانات القديمة/المستوردة.
//                                        ↘ تعذر التسليم → خرج مع المندوب (إعادة محاولة)
//
// كل الانتقالات "من الحالة نفسها إلى نفسها" مسموحة دائمًا (لا تُغيّر شيئًا).

// ملاحظة مهمة: الحلقات الذاتية (حالة → نفسها) مُدرَجة صراحة فقط حيث
// يكون تكرار العملية منطقيًا وآمنًا (مثل إعادة تعيين مندوب لمستفيد
// أجهزته "مع المندوب" أصلًا). الحالتان النهائيتان "تم التسليم" (للجهاز
// والتسليم) لا تحملان حلقة ذاتية عمدًا — إعادة تأكيد تسليم مكتمل بالفعل
// يجب أن تُرفض دائمًا، لا أن تُقبل كعملية بلا أثر. لهذا لا يوجد أي
// اختصار عام "from === to → مسموح" في الدالتين أدناه.
const DEVICE_STATUS_TRANSITIONS_ = Object.freeze({
  'بالمستودع': ['بالمستودع', 'مخصص', 'تالف'],
  'مخصص': ['مخصص', 'بالمستودع', 'مع المندوب', 'تالف'],
  'مع المندوب': ['مع المندوب', 'مخصص', 'تم التسليم', 'تالف'],
  'تم التسليم': [],
  'تالف': ['تالف', 'بالمستودع']
});

const DELIVERY_STATUS_TRANSITIONS_ = Object.freeze({
  'لم يبدأ': ['لم يبدأ', 'جاري التجهيز', 'خرج مع المندوب'],
  'جاري التجهيز': ['جاري التجهيز', 'خرج مع المندوب', 'لم يبدأ'],
  'خرج مع المندوب': ['خرج مع المندوب', 'تم التسليم', 'تعذر التسليم'],
  'تعذر التسليم': ['تعذر التسليم', 'خرج مع المندوب', 'جاري التجهيز'],
  'تم التسليم': []
});

/**
 * يتحقق أن الانتقال من "from" إلى "to" مسموح لحالة الجهاز، ويرمي خطأ
 * عربيًا واضحًا إن لم يكن كذلك. حالة غير معروفة (بيانات قديمة فاسدة)
 * تُرفض صراحة بدل افتراض أنها صالحة. عمدًا لا يوجد اختصار عام يسمح
 * بـ"from === to" تلقائيًا — الحالات النهائية (تم التسليم) تُرفض حتى
 * لو كان الانتقال إلى نفسها، لمنع إعادة تأكيد عملية مكتملة فعلًا.
 */
function assertDeviceTransition_(fromStatus, toStatus) {
  fromStatus = String(fromStatus || '');
  toStatus = String(toStatus || '');
  if (DEVICE_STATUSES.indexOf(toStatus) === -1) throw new Error('حالة جهاز غير معروفة: ' + toStatus);
  if (!fromStatus) return true; // جهاز جديد بلا حالة سابقة — أي حالة ابتدائية صالحة تُفحص لاحقًا بمكان الاستدعاء
  const allowed = DEVICE_STATUS_TRANSITIONS_[fromStatus];
  if (!allowed) throw new Error('حالة جهاز حالية غير معروفة: ' + fromStatus);
  if (allowed.indexOf(toStatus) === -1) {
    throw new Error('انتقال غير مسموح لحالة الجهاز: من «' + fromStatus + '» إلى «' + toStatus + '»');
  }
  return true;
}

/** نفس المبدأ، لحالة تسليم المستفيد. */
function assertDeliveryTransition_(fromStatus, toStatus) {
  fromStatus = String(fromStatus || '');
  toStatus = String(toStatus || '');
  if (DELIVERY_STATUSES.indexOf(toStatus) === -1) throw new Error('حالة تسليم غير معروفة: ' + toStatus);
  if (!fromStatus) return true;
  const allowed = DELIVERY_STATUS_TRANSITIONS_[fromStatus];
  if (!allowed) throw new Error('حالة تسليم حالية غير معروفة: ' + fromStatus);
  if (allowed.indexOf(toStatus) === -1) {
    throw new Error('انتقال غير مسموح لحالة التسليم: من «' + fromStatus + '» إلى «' + toStatus + '»');
  }
  return true;
}

/** أجهزة مستفيد معيّن التي حالتها الحالية "مخصص" فقط (جاهزة للخروج مع مندوب). */
function assignedDevicesForBeneficiary_(beneficiaryId) {
  return devicesForBeneficiary_(beneficiaryId).filter(device => device.status === 'مخصص');
}

/** أجهزة مستفيد معيّن التي حالتها الحالية "مع المندوب" فقط (جاهزة لتأكيد التسليم). */
function dispatchedDevicesForBeneficiary_(beneficiaryId) {
  return devicesForBeneficiary_(beneficiaryId).filter(device => device.status === 'مع المندوب');
}

/**
 * تشخيص قراءة فقط — لا يكتب أي شيء إطلاقًا. يفحص كل الأجهزة والمستفيدين
 * بحثًا عن حالات متعارضة (بيانات قديمة أو تعديل يدوي سابق من داخل
 * الشيت مباشرة قد يكون كسر الترابط)، ويعيد تقريرًا منظَّمًا.
 * يمكن تشغيلها يدويًا من محرر Apps Script في أي وقت بأمان تام. يتطلب
 * رمز وصول صيانة صالح رغم كونها قراءة فقط. دالة خاصة، لا تُستدعى من الواجهة.
 */
function diagnoseStateIntegrity_(token) {
  requireMaintenanceAccess_(token);
  const beneficiaries = readTable_(APP.sheets.beneficiaries).rows.map(normalizeBeneficiary_);
  const devices = readTable_(APP.sheets.devices).rows.map(normalizeDevice_);
  const beneficiaryById = {};
  beneficiaries.forEach(b => { beneficiaryById[b.id] = b; });
  const devicesByBeneficiary = {};
  devices.forEach(d => {
    if (!d.beneficiaryId) return;
    (devicesByBeneficiary[d.beneficiaryId] = devicesByBeneficiary[d.beneficiaryId] || []).push(d);
  });

  const issues = [];
  function report(severity, type, message, extra) {
    issues.push(Object.assign({severity: severity, type: type, message: message}, extra || {}));
  }

  devices.forEach(device => {
    if (DEVICE_STATUSES.indexOf(device.status) === -1) {
      report('critical', 'DEVICE_STATUS_UNKNOWN', 'جهاز بحالة غير معروفة/فاسدة: "' + device.status + '"', {deviceId: device.id});
      return;
    }
    const hasBeneficiary = !!device.beneficiaryId;
    const activeStatuses = ['مخصص', 'مع المندوب', 'تم التسليم'];
    if (activeStatuses.indexOf(device.status) >= 0 && !hasBeneficiary) {
      report('critical', 'DEVICE_ORPHAN_STATUS', 'جهاز بحالة "' + device.status + '" بلا رقم مستفيد', {deviceId: device.id});
    }
    if (device.status === 'بالمستودع' && hasBeneficiary) {
      report('high', 'DEVICE_ASSIGNED_BUT_WAREHOUSE', 'جهاز مرتبط بمستفيد لكن حالته لا تزال "بالمستودع"', {deviceId: device.id, beneficiaryId: device.beneficiaryId});
    }
    if (hasBeneficiary && !beneficiaryById[device.beneficiaryId]) {
      report('critical', 'DEVICE_UNKNOWN_BENEFICIARY', 'جهاز يشير إلى رقم مستفيد غير موجود', {deviceId: device.id, beneficiaryId: device.beneficiaryId});
    } else if (hasBeneficiary && beneficiaryById[device.beneficiaryId].associationId !== device.associationId) {
      report('high', 'DEVICE_ASSOCIATION_MISMATCH', 'جهاز وجمعيته لا تطابق جمعية المستفيد المرتبط به', {deviceId: device.id, beneficiaryId: device.beneficiaryId});
    }
  });

  beneficiaries.forEach(beneficiary => {
    if (DELIVERY_STATUSES.indexOf(beneficiary.deliveryStatus) === -1) {
      report('critical', 'DELIVERY_STATUS_UNKNOWN', 'مستفيد بحالة تسليم غير معروفة/فاسدة: "' + beneficiary.deliveryStatus + '"', {beneficiaryId: beneficiary.id});
    }
    const ownDevices = devicesByBeneficiary[beneficiary.id] || [];
    if (beneficiary.deliveryStatus === 'تم التسليم') {
      if (!ownDevices.length) {
        report('critical', 'DELIVERED_WITHOUT_DEVICES', 'مستفيد حالته "تم التسليم" بلا أي جهاز مرتبط', {beneficiaryId: beneficiary.id});
      } else if (ownDevices.some(d => d.status !== 'تم التسليم')) {
        report('critical', 'DELIVERED_DEVICE_MISMATCH', 'مستفيد حالته "تم التسليم" لكن بعض أجهزته ليست كذلك', {beneficiaryId: beneficiary.id});
      }
    }
    if (beneficiary.deliveryStatus === 'خرج مع المندوب' && !beneficiary.delegateId) {
      report('high', 'DISPATCHED_WITHOUT_DELEGATE', 'مستفيد حالته "خرج مع المندوب" بلا رقم مندوب', {beneficiaryId: beneficiary.id});
    }
    if (beneficiary.status === 'ملغي' && ownDevices.some(d => ['مخصص', 'مع المندوب'].indexOf(d.status) >= 0)) {
      report('high', 'CANCELLED_WITH_ACTIVE_DEVICES', 'مستفيد ملغى لكن له أجهزة لا تزال مخصصة أو مع المندوب', {beneficiaryId: beneficiary.id});
    }
  });

  return {
    ok: issues.length === 0,
    generatedAt: formatDateTime_(new Date()),
    totalBeneficiaries: beneficiaries.length,
    totalDevices: devices.length,
    issueCount: issues.length,
    bySeverity: {
      critical: issues.filter(x => x.severity === 'critical').length,
      high: issues.filter(x => x.severity === 'high').length
    },
    issues: issues
  };
}

/**
 * دالة إصلاح مُجهَّزة ومختبرة، لكنها **غير مُستدعاة من أي مكان آخر في
 * المشروع** ولا تُشغَّل تلقائيًا. تُصلح فقط الحالات الآمنة التي لا
 * تحتمل أكثر من تفسير واحد صحيح؛ أي حالة غامضة (مثل تعارض الجمعية) تُترك
 * دون لمس وتُذكر في التقرير المُعاد ضمن "skipped". يجب تشغيلها يدويًا من
 * محرر Apps Script فقط، بعد مراجعة تقرير diagnoseStateIntegrity_() أولًا.
 * تتطلب رمز وصول صيانة صالح. دالة خاصة، لا تُستدعى من الواجهة.
 */
function repairStateIntegrityIssues_(token) {
  requireMaintenanceAccess_(token);
  const diagnosis = diagnoseStateIntegrity_(token);
  const fixed = [];
  const skipped = [];

  diagnosis.issues.forEach(issue => {
    if (issue.type === 'DEVICE_ORPHAN_STATUS') {
      updateById_(APP.sheets.devices, 'رقم الجهاز', issue.deviceId, {'حالة الجهاز': 'بالمستودع', 'تاريخ التسليم': ''});
      fixed.push(Object.assign({action: 'أُعيد الجهاز لحالة "بالمستودع" لغياب رقم المستفيد'}, issue));
    } else if (issue.type === 'DEVICE_ASSIGNED_BUT_WAREHOUSE') {
      updateById_(APP.sheets.devices, 'رقم الجهاز', issue.deviceId, {'حالة الجهاز': 'مخصص'});
      fixed.push(Object.assign({action: 'حُدِّثت حالة الجهاز إلى "مخصص" لمطابقة ارتباطه بمستفيد'}, issue));
    } else if (issue.type === 'DEVICE_UNKNOWN_BENEFICIARY') {
      updateById_(APP.sheets.devices, 'رقم الجهاز', issue.deviceId, {'رقم المستفيد': '', 'حالة الجهاز': 'بالمستودع', 'تاريخ التسليم': ''});
      fixed.push(Object.assign({action: 'أُزيل ارتباط الجهاز بمستفيد غير موجود وأُعيد للمستودع'}, issue));
    } else if (issue.type === 'DELIVERED_DEVICE_MISMATCH') {
      dispatchedAndAssignedDevicesForBeneficiary_(issue.beneficiaryId).forEach(device => {
        updateById_(APP.sheets.devices, 'رقم الجهاز', device.id, {'حالة الجهاز': 'تم التسليم'});
      });
      fixed.push(Object.assign({action: 'حُدِّثت أجهزة المستفيد لمطابقة حالة تسليمه المسجَّلة "تم التسليم"'}, issue));
    } else {
      skipped.push(Object.assign({reason: 'يتطلب مراجعة يدوية — لا يوجد إصلاح آلي آمن بمعنى واحد قاطع'}, issue));
    }
  });

  return {ok: true, fixedCount: fixed.length, skippedCount: skipped.length, fixed: fixed, skipped: skipped};
}

/** يُستخدم فقط داخل repairStateIntegrityIssues_ أعلاه — أجهزة مستفيد بحالة "مخصص" أو "مع المندوب" معًا. */
function dispatchedAndAssignedDevicesForBeneficiary_(beneficiaryId) {
  return devicesForBeneficiary_(beneficiaryId).filter(device => ['مخصص', 'مع المندوب'].indexOf(device.status) >= 0);
}

// -------------------- دورة اعتماد المستفيد والاحتياج (طور تصميم — لم تُفعَّل بعد) --------------------
//
// هذا القسم يضيف مصدر حقيقة مركزيًا لثلاث حالات منفصلة تمامًا لا يجوز
// خلطها في حقل واحد: حالة مراجعة المستفيد نفسه، حالة قرار كل احتياج
// (جهاز) على حدة، وحالة تنفيذ ذلك الاحتياج بعد اعتماده. لا تستبدل أو
// تُعدّل جداول DEVICE_STATUS_TRANSITIONS_/DELIVERY_STATUS_TRANSITIONS_
// أعلاه — تلك تبقى كما هي لحالة سجل الجهاز المادي الفردي نفسه، وهذا
// القسم طبقة أعلى منها (حالة "الاستحقاق" لا حالة "القطعة").
//
// حالة مراجعة المستفيد: تحت المراجعة → معتمد | مرفوض (نهائيتان، لا رجوع).
const BENEFICIARY_REVIEW_STATUSES = ['تحت المراجعة', 'معتمد', 'مرفوض'];
// عمدًا بلا حلقة ذاتية على الحالتين النهائيتين (نفس مبدأ "تم التسليم"
// في جداول الجهاز/التسليم أعلاه): إعادة إرسال قرار مطابق لحالة نهائية
// موجودة أصلًا يجب أن تُرفض بوضوح ("منع تنفيذ قرار الاعتماد مرتين")،
// لا أن تُقبل بصمت كعملية بلا أثر.
const BENEFICIARY_REVIEW_TRANSITIONS_ = Object.freeze({
  'تحت المراجعة': ['تحت المراجعة', 'معتمد', 'مرفوض'],
  'معتمد': [],
  'مرفوض': []
});

// حالة قرار الاحتياج الواحد (نوع جهاز واحد لمستفيد واحد): بانتظار
// المراجعة → معتمد | مرفوض. مستقلة عن قرار بقية احتياجات المستفيد نفسه.
const NEED_DECISION_STATUSES = ['بانتظار المراجعة', 'معتمد', 'مرفوض'];
const NEED_DECISION_TRANSITIONS_ = Object.freeze({
  'بانتظار المراجعة': ['بانتظار المراجعة', 'معتمد', 'مرفوض'],
  'معتمد': ['معتمد'],
  'مرفوض': ['مرفوض']
});

// حالة تنفيذ الاحتياج المعتمد فقط (لا معنى لها قبل الاعتماد). تفصل
// صراحة بين "استحقاق معتمد" (قرار إداري منجز، لا جهاز مادي بعد) و"جهاز
// جاهز" (جهاز مادي فعلي أُخذ من المخزون وربط بهذا الاستحقاق تحديدًا)
// — لا خطوة تخصيص يدوية إضافية بين الاثنتين، فقط ربط تلقائي عند توفر
// جهاز مطابق النوع (انظر Phase 2: linkAvailableDeviceToNeed_).
const NEED_FULFILLMENT_STATUSES = [
  'استحقاق معتمد', 'بانتظار توفر الجهاز', 'جهاز جاهز',
  'بانتظار تعيين مندوب', 'معيّن للمندوب — بانتظار التنفيذ',
  'خرج مع المندوب', 'مؤجل', 'بانتظار تأكيد الإرجاع',
  'أعيد للجمعية/المستودع', 'تم التسليم'
];
const NEED_FULFILLMENT_TRANSITIONS_ = Object.freeze({
  'استحقاق معتمد': ['استحقاق معتمد', 'بانتظار توفر الجهاز'],
  'بانتظار توفر الجهاز': ['بانتظار توفر الجهاز', 'جهاز جاهز'],
  'جهاز جاهز': ['جهاز جاهز', 'بانتظار تعيين مندوب'],
  'بانتظار تعيين مندوب': ['بانتظار تعيين مندوب', 'معيّن للمندوب — بانتظار التنفيذ'],
  'معيّن للمندوب — بانتظار التنفيذ': ['معيّن للمندوب — بانتظار التنفيذ', 'خرج مع المندوب'],
  'خرج مع المندوب': ['خرج مع المندوب', 'تم التسليم', 'مؤجل', 'بانتظار تأكيد الإرجاع'],
  'مؤجل': ['مؤجل', 'خرج مع المندوب'],
  'بانتظار تأكيد الإرجاع': ['بانتظار تأكيد الإرجاع', 'أعيد للجمعية/المستودع'],
  'أعيد للجمعية/المستودع': ['أعيد للجمعية/المستودع', 'بانتظار تعيين مندوب'],
  'تم التسليم': []
});

/** يتحقق من انتقال حالة مراجعة المستفيد، بنفس مبدأ assertDeviceTransition_ أعلاه. */
function assertBeneficiaryReviewTransition_(fromStatus, toStatus) {
  fromStatus = String(fromStatus || '');
  toStatus = String(toStatus || '');
  if (BENEFICIARY_REVIEW_STATUSES.indexOf(toStatus) === -1) throw new Error('حالة مراجعة مستفيد غير معروفة: ' + toStatus);
  if (!fromStatus) return true;
  const allowed = BENEFICIARY_REVIEW_TRANSITIONS_[fromStatus];
  if (!allowed) throw new Error('حالة مراجعة مستفيد حالية غير معروفة: ' + fromStatus);
  if (allowed.indexOf(toStatus) === -1) {
    throw new Error('انتقال غير مسموح لحالة مراجعة المستفيد: من «' + fromStatus + '» إلى «' + toStatus + '»');
  }
  return true;
}

/** يتحقق من انتقال حالة قرار احتياج واحد. */
function assertNeedDecisionTransition_(fromStatus, toStatus) {
  fromStatus = String(fromStatus || '');
  toStatus = String(toStatus || '');
  if (NEED_DECISION_STATUSES.indexOf(toStatus) === -1) throw new Error('حالة قرار احتياج غير معروفة: ' + toStatus);
  if (!fromStatus) return true;
  const allowed = NEED_DECISION_TRANSITIONS_[fromStatus];
  if (!allowed) throw new Error('حالة قرار احتياج حالية غير معروفة: ' + fromStatus);
  if (allowed.indexOf(toStatus) === -1) {
    throw new Error('انتقال غير مسموح لحالة قرار الاحتياج: من «' + fromStatus + '» إلى «' + toStatus + '»');
  }
  return true;
}

/** يتحقق من انتقال حالة تنفيذ احتياج معتمد. */
function assertNeedFulfillmentTransition_(fromStatus, toStatus) {
  fromStatus = String(fromStatus || '');
  toStatus = String(toStatus || '');
  if (NEED_FULFILLMENT_STATUSES.indexOf(toStatus) === -1) throw new Error('حالة تنفيذ احتياج غير معروفة: ' + toStatus);
  if (!fromStatus) return true;
  const allowed = NEED_FULFILLMENT_TRANSITIONS_[fromStatus];
  if (!allowed) throw new Error('حالة تنفيذ احتياج حالية غير معروفة: ' + fromStatus);
  if (allowed.indexOf(toStatus) === -1) {
    throw new Error('انتقال غير مسموح لحالة تنفيذ الاحتياج: من «' + fromStatus + '» إلى «' + toStatus + '»');
  }
  return true;
}
