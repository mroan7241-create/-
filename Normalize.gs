// -------------------- التطبيع والتجميع --------------------

function normalizeBeneficiary_(row) {
  return {
    id: String(row['رقم المستفيد'] || ''),
    associationId: String(row['رقم الجمعية'] || ''),
    name: String(row['الاسم'] || ''),
    region: String(row['المنطقة'] || ''),
    city: String(row['المدينة'] || ''),
    district: String(row['الحي'] || ''),
    address: String(row['العنوان'] || ''),
    phone: displayPhone_(row['رقم الجوال']),
    phone2: displayPhone_(row['رقم جوال إضافي']),
    familyCount: safeNumber_(row['عدد الأفراد']),
    socialSecurity: String(row['ضمان اجتماعي']) === 'نعم',
    socialStatus: String(row['الحالة الاجتماعية'] || ''),
    income: safeNumber_(row['مبلغ الدخل']),
    needs: splitList_(row['الاحتياج']),
    status: String(row['حالة المستفيد'] || 'جديد'),
    deliveryStatus: String(row['حالة التسليم'] || 'لم يبدأ'),
    delegateId: String(row['رقم المندوب'] || ''),
    notes: String(row['الملاحظات'] || ''),
    createdAt: formatDate_(parseDate_(row['تاريخ الإنشاء'])),
    deliveredAt: formatDateTime_(parseDate_(row['تاريخ التسليم'])),
    updatedAt: formatDateTime_(parseDate_(row['آخر تحديث'])),
    lat: row['خط العرض'] !== undefined && row['خط العرض'] !== '' ? safeNumber_(row['خط العرض']) : null,
    lng: row['خط الطول'] !== undefined && row['خط الطول'] !== '' ? safeNumber_(row['خط الطول']) : null,
    landmark: String(row['علامة مميزة'] || ''),
    locationSource: String(row['مصدر الموقع'] || ''),
    locationUpdatedAt: formatDateTime_(parseDate_(row['تاريخ تحديث الموقع'])),
    // مشتقة من وجود الإحداثيات فعليًا (beneficiaryLocationConfirmed_)، لا
    // عمود منفصل ولا اختيار يدوي — الواجهة تعرضها كشارة حالة فقط، والخادم
    // هو من يفرضها فعليًا عند الإحالة (انظر assignDelegate في Beneficiaries.gs).
    locationConfirmed: beneficiaryLocationConfirmed_(row)
  };
}

function normalizeAssociation_(row, beneficiaries, devices, delegates) {
  row = row || {};
  const id = String(row['رقم الجمعية'] || '');
  beneficiaries = beneficiaries || [];
  devices = devices || [];
  delegates = delegates || [];
  const ownDevices = devices.filter(x => !id || String(x['رقم الجمعية']) === id);
  const delivered = ownDevices.filter(x => String(x['حالة الجهاز']) === 'تم التسليم').length;
  return {
    id: id, name: String(row['اسم الجمعية'] || ''), category: String(row['التصنيف'] || ''),
    region: String(row['المنطقة'] || ''), city: String(row['المدينة'] || ''),
    phone: displayPhone_(row['أرقام التواصل']), email: String(row['البريد الإلكتروني'] || ''),
    status: String(row['الحالة'] || ''), beneficiaries: beneficiaries.filter(x => !id || String(x['رقم الجمعية']) === id).length,
    approvedDevices: ownDevices.length, receivedDevices: ownDevices.filter(x => String(x['حالة الجهاز']) !== 'بالمستودع').length,
    deliveredDevices: delivered, delegates: delegates.filter(x => !id || String(x['رقم الجمعية']) === id).length,
    progress: ownDevices.length ? Math.round(delivered / ownDevices.length * 100) : 0
  };
}

function normalizeDevice_(row) {
  return {
    id: String(row['رقم الجهاز'] || ''), name: String(row['اسم الجهاز'] || ''),
    type: String(row['النوع'] || ''), associationId: String(row['رقم الجمعية'] || ''),
    beneficiaryId: String(row['رقم المستفيد'] || ''), status: String(row['حالة الجهاز'] || ''),
    createdAt: formatDate_(parseDate_(row['تاريخ الإضافة'])),
    deliveredAt: formatDateTime_(parseDate_(row['تاريخ التسليم'])),
    notes: String(row['ملاحظات'] || '')
  };
}

function normalizeDelegate_(row, beneficiaries) {
  row = row || {};
  beneficiaries = beneficiaries || [];
  const id = String(row['رقم المندوب'] || '');
  const served = beneficiaries.filter(x => String(x['رقم المندوب']) === id && String(x['حالة التسليم']) === 'تم التسليم').length;
  const assigned = beneficiaries.filter(x => String(x['رقم المندوب']) === id && String(x['حالة التسليم']) !== 'تم التسليم').length;
  return {
    id: id, associationId: String(row['رقم الجمعية'] || ''), name: String(row['اسم المندوب'] || ''),
    phone: displayPhone_(row['رقم الجوال']), status: String(row['الحالة'] || ''),
    served: served, assigned: assigned, lastLogin: formatDateTime_(parseDate_(row['آخر دخول']))
  };
}

function devicesForBeneficiary_(beneficiaryId) {
  return readTable_(APP.sheets.devices).rows
    .filter(row => String(row['رقم المستفيد']) === String(beneficiaryId))
    .map(normalizeDevice_);
}

function getDeliveryHistory_(delegateId) {
  const beneficiaries = readTable_(APP.sheets.beneficiaries).rows;
  return readTable_(APP.sheets.deliveries).rows
    .filter(row => String(row['رقم المندوب']) === String(delegateId) && String(row['الحالة']) === 'تم التسليم')
    .map(row => {
      const beneficiary = beneficiaries.find(x => String(x['رقم المستفيد']) === String(row['رقم المستفيد']));
      return {
        beneficiaryName: beneficiary ? String(beneficiary['الاسم']) : String(row['رقم المستفيد']),
        deliveredAt: formatDateTime_(parseDate_(row['تاريخ ووقت التسليم'])),
        devices: splitList_(row['أرقام الأجهزة'])
      };
    }).reverse();
}

/** كل صفوف سجل العمليات المطابقة لنطاق جمعية معيّنة (أو الكل)، الأحدث أولًا، بلا حد أقصى. */
function auditRowsFiltered_(associationId) {
  const rows = readTable_(APP.sheets.audit).rows;
  let actorIds = null;
  let recordIds = null;
  if (associationId) {
    const associationKey = String(associationId);
    actorIds = new Set(
      readTable_(APP.sheets.users).rows
        .filter(row => String(row['رقم الجمعية']) === associationKey)
        .map(row => String(row['رقم المستخدم']))
    );
    recordIds = new Set([associationKey]);
    [
      [APP.sheets.beneficiaries, 'رقم الجمعية', 'رقم المستفيد'],
      [APP.sheets.devices, 'رقم الجمعية', 'رقم الجهاز'],
      [APP.sheets.delegates, 'رقم الجمعية', 'رقم المندوب']
    ].forEach(definition => {
      readTable_(definition[0]).rows
        .filter(row => String(row[definition[1]]) === associationKey)
        .forEach(row => recordIds.add(String(row[definition[2]])));
    });
    readTable_(APP.sheets.delegates).rows
      .filter(row => String(row['رقم الجمعية']) === associationKey)
      .forEach(row => actorIds.add(String(row['رقم المندوب'])));
  }
  return rows.filter(row => {
    if (!associationId) return true;
    const record = String(row['رقم السجل'] || '');
    return actorIds.has(String(row['رقم المستخدم'])) || recordIds.has(record);
  }).reverse().map(row => ({
    user: String(row['اسم المستخدم'] || ''), actorId: String(row['رقم المستخدم'] || ''),
    action: String(row['العملية'] || ''),
    section: String(row['القسم'] || ''), recordId: String(row['رقم السجل'] || ''),
    notes: String(row['ملاحظات'] || ''), at: formatDateTime_(parseDate_(row['التاريخ والوقت']))
  }));
}

function getAuditRows_(limit, associationId) {
  return auditRowsFiltered_(associationId).slice(0, limit);
}

/**
 * سجل العمليات مُرقَّم — أثقل جدول قراءةً بعد المستفيدين لأنه يتراكم مع
 * كل عملية في النظام. لم يعد ضمن Bootstrap إطلاقًا؛ يُجلب فقط عند فتح
 * صفحة "سجل العمليات"، صفحة بصفحة.
 */
function listAuditLog(token, options) {
  return perfTime_('listAuditLog', () => {
    const user = requireSession_(token, ['ADMIN', 'ASSOCIATION']);
    return withMeta_(listAuditLog_(user, options));
  });
}

function listAuditLog_(user, options) {
  options = options || {};
  const associationId = user.role === 'ASSOCIATION' ? user.associationId
    : (options.associationId ? cleanId_(options.associationId) : null);
  let items = auditRowsFiltered_(associationId);
  items = applySearch_(items, options.search, ['user', 'action', 'section', 'recordId', 'notes']);
  if (options.filter) items = items.filter(item => item.section === options.filter);
  // options.recordId: يُستخدم لسجل عمليات سجل مرتبط بسجل واحد بعينه (مثل
  // جهاز محدَّد) — نفس عزل الجمعية أعلاه يبقى ساريًا قبل هذا الفلتر.
  if (options.recordId) items = items.filter(item => item.recordId === cleanId_(options.recordId));
  return Object.assign({ok: true}, paginate_(items, options));
}

// الأحداث التشغيلية المسموح أن يراها المندوب نفسه في سجله — تستثني عمدًا
// أي حدث إداري حسّاس (مثل تعديل بياناته من الإدارة) لا علاقة له بعمله
// اليومي، ولا تُدرَج فيها رموز الدخول أو كلمات المرور أو الموقع الحي إطلاقًا
// لأن audit_ أصلًا لا يسجّل أيًّا من هذه القيم في أي مكان بالنظام.
const DELEGATE_VISIBLE_AUDIT_ACTIONS_ = Object.freeze([
  'تسجيل دخول', 'تعيين مندوب', 'تعذر التسليم', 'تأكيد تسليم', 'تفعيل مندوب', 'تعطيل مندوب', 'إعادة إنشاء رمز الدخول'
]);

/**
 * سجل عمليات مفلتر لمندوب واحد بعينه:
 * - ADMIN: أي مندوب، السجل الكامل المرتبط به (أفعاله + الأحداث الإدارية عن حسابه).
 * - ASSOCIATION: مندوبوها فقط، بنفس السجل الكامل المرتبط بهم.
 * - DELEGATE: نفسه فقط، ومقتصر على الأحداث التشغيلية المسموحة أعلاه دون أي بيانات إدارية حساسة.
 */
function listDelegateAuditLog(token, delegateId, options) {
  return perfTime_('listDelegateAuditLog', () => {
    const user = requireSession_(token, ['ADMIN', 'ASSOCIATION', 'DELEGATE']);
    options = options || {};
    delegateId = cleanId_(delegateId || (user.role === 'DELEGATE' ? user.id : ''));
    if (!delegateId) throw new Error('رقم المندوب مطلوب');
    const delegate = findById_(APP.sheets.delegates, 'رقم المندوب', delegateId);
    if (!delegate) throw new Error('المندوب غير موجود');
    if (user.role === 'DELEGATE' && delegateId !== user.id) throw new Error('ليس لديك صلاحية لعرض سجل مندوب آخر');
    if (user.role === 'ASSOCIATION' && String(delegate['رقم الجمعية']) !== user.associationId) throw new Error('ليس لديك صلاحية');
    const associationScope = user.role === 'ADMIN' ? null : String(delegate['رقم الجمعية']);
    const assignmentPrefix = 'المندوب: ' + delegateId;
    let items = auditRowsFiltered_(associationScope).filter(row =>
      row.actorId === delegateId ||
      (row.section === 'المناديب' && row.recordId === delegateId) ||
      (row.action === 'تعيين مندوب' && row.notes.indexOf(assignmentPrefix) === 0)
    );
    if (user.role === 'DELEGATE') {
      items = items.filter(row => DELEGATE_VISIBLE_AUDIT_ACTIONS_.indexOf(row.action) >= 0);
    }
    items = applySearch_(items, options.search, ['user', 'action', 'section', 'recordId', 'notes']);
    return Object.assign({ok: true, delegateName: String(delegate['اسم المندوب'] || '')}, paginate_(items, options));
  });
}

