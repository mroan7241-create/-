// -------------------- Phase 3.1: محاضر استلام دفعات الأجهزة --------------------
//
// نموذج خادمي بحت لمحضر استلام واحد بعدة أصناف: ADMIN (يمثّل جمعية
// الزاد) ينشئ المحضر ويرسله لجمعية واحدة محدَّدة، والجمعية وحدها تؤكد
// الاستلام (كاملًا أو مع فروقات موثَّقة بالصور). بعد التأكيد الناجح
// فقط، تُنشأ سجلات "الأجهزة" تلقائيًا للكمية السليمة (راجع
// createDevicesFromReceiptItem_)، ثم يُشغَّل محرك التخصيص التلقائي
// (AutoAllocation.gs) للجمعية المستلمة.
//
// عقد الواجهة اللاحقة (لم تُبنَ الآن — Index.html لم يُعدَّل):
//   اختيار الجمعية → المورد → إضافة الأصناف والكميات → إرسال →
//   الجمعية تختار استلام كامل أو يوجد فرق → الصورة العامة → التوقيع → التأكيد.
//
// ⚠️ طور تصميم بالكامل: الأوراق الثلاث الجديدة (محاضر استلام الأجهزة/
// بنود محضر الاستلام/صور تلف الاستلام) وعمود "رقم بند الاستلام" في
// "الأجهزة" غير موجودة على أي شيت حي حتى يُشغَّل applyReleaseSchema_
// يدويًا خارج هذه الجلسة — لم يُشغَّل ولن يُشغَّل من هنا.

/**
 * Phase 3.1.1 (القسم 7) — يتحقق أن الجمعية موجودة **ونشطة صراحة**
 * (assoc['الحالة'] === 'نشطة' بالضبط، لا مجرد "ليست غير نشطة") — أي قيمة
 * أخرى (فارغة، غير معروفة، أو أي شيء غير 'نشطة' حرفيًا) تُرفض. يُستدعى
 * **داخل القفل الممسوك مسبقًا** في كل نقطة تمس دورة الاستلام/التخصيص:
 * createReceiptBatch_، sendReceiptBatch_، confirmReceiptBatch_،
 * runAutoAllocation_ — لا يكفي التحقق عند الإنشاء فقط، فحالة الجمعية قد
 * تتغيّر بين إنشاء المحضر وإرساله أو تأكيده. الجمعيات المرفوضة/المحذوفة
 * أصلًا لا تُنشأ كصف في هذا الجدول (تُستبعد ببساطة بعدم وجودها).
 */
function assertActiveAssociationForReceipt_(associationId) {
  const assoc = findById_(APP.sheets.associations, 'رقم الجمعية', associationId);
  if (!assoc) throw new Error('الجمعية المحدَّدة غير موجودة');
  if (String(assoc['الحالة']) !== 'نشطة') {
    throw new Error('الجمعية المحدَّدة غير نشطة — لا يمكن إتمام عمليات محاضر الاستلام أو التخصيص التلقائي لها');
  }
  return assoc;
}

function receiptProofFolder_() {
  const props = PropertiesService.getScriptProperties();
  const folderId = props.getProperty('RECEIPT_PROOF_FOLDER_ID');
  if (folderId) {
    try { return DriveApp.getFolderById(folderId); } catch (ignore) {}
  }
  const folder = DriveApp.createFolder(APP.receiptProofFolder);
  props.setProperty('RECEIPT_PROOF_FOLDER_ID', folder.getId());
  return folder;
}

/**
 * نفس مبدأ saveProofImage_ (Delegates.gs) حرفيًا — تعيد استخدام
 * verifyImageMagicBytes_ العامة نفسها (تحقّق التوقيع الحقيقي للبايتات لا
 * mime المُعلَن فقط) بدل تكرارها، لكن بمجلد Drive مستقل خاص بمحاضر
 * الاستلام. لا يُستدعى getUrl()/setSharing() — يبقى الملف خاصًا بمالك
 * المشروع، والقراءة اللاحقة الآمنة الوحيدة عبر مسار محروس مخصَّص.
 */
function saveReceiptImage_(dataUrl) {
  const match = String(dataUrl || '').match(/^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/);
  if (!match) throw new Error('أرفق صورة بصيغة JPG أو PNG أو WEBP');
  const bytes = Utilities.base64Decode(match[2]);
  if (bytes.length > 6 * 1024 * 1024) throw new Error('حجم الصورة يتجاوز 6 ميجابايت');
  if (!verifyImageMagicBytes_(bytes, match[1])) {
    throw new Error('محتوى الملف الفعلي لا يطابق صيغة الصورة المُعلَنة — أرفق صورة JPG أو PNG أو WEBP حقيقية');
  }
  const mime = 'image/' + match[1];
  const ext = match[1] === 'jpeg' ? 'jpg' : match[1];
  const filename = Utilities.getUuid() + '.' + ext;
  const folder = receiptProofFolder_();
  const file = folder.createFile(Utilities.newBlob(bytes, mime, filename));
  return {fileId: file.getId(), fileName: filename, fileType: mime, fileSize: bytes.length};
}

/**
 * Phase 3.1.1 (القسم 5) — نقل ملفات Drive المرفوعة فعلًا إلى المهملات
 * best-effort عند فشل العملية **قبل** نجاح الالتزام (commit) بالكامل:
 * صورة كمية/تلف/توقيع رُفعت بنجاح ثم فشلت العملية لاحقًا (صورة تالية،
 * كتابة البنود/الرأس/الأجهزة) يجب ألا تبقى يتيمة في Drive بلا أي سجل
 * يشير إليها. لا تُستدعى إطلاقًا بعد نجاح commit — الملفات الناجحة تبقى
 * دائمًا (حتى لو فشل التخصيص التلقائي أو الإثراء اللاحق، فتلك مرحلة
 * ما بعد النجاح ولا علاقة لها بهذه الدالة). فشل نقل ملف بعينه لا يُخفي
 * معرّفه ولا يُسقط محاولة البقية — يُسجَّل بمعرّف الملف فقط، بلا أي بيانات
 * شخصية (لا اسم مستخدم ولا محتوى الصورة).
 */
function trashReceiptImages_(fileIds) {
  (fileIds || []).forEach(fileId => {
    if (!fileId) return;
    try {
      DriveApp.getFileById(fileId).setTrashed(true);
    } catch (trashError) {
      Logger.log('تحذير: تعذّر نقل ملف صورة استلام غير مُلتزَم به إلى المهملات — traceId=' + requestMeta_().traceId + ' fileId=' + fileId + ' — ' + trashError.message);
    }
  });
}

/** كمية صحيحة غير سالبة إلزامية (لا كسور، لا سالب) — أدقّ من boundedNumber_ العامة التي تقبل الكسور. */
function requiredNonNegativeInt_(value, label) {
  const number = Number(value);
  if (!isFinite(number) || number < 0 || Math.floor(number) !== number) {
    throw new Error(label + ' يجب أن يكون رقمًا صحيحًا غير سالب');
  }
  return number;
}

/**
 * يتحقق من صيغة صنف واحد في المحضر (نوع الجهاز + المواصفة + الكمية
 * المرسلة) — بلا أي قراءة بيانات مشتركة، نفس مبدأ validateNewNeedDeviceTypes_
 * (BeneficiaryNeeds.gs). المواصفة نص حر بالتحقّق اللين المعتاد (قائمة
 * مرجعية إن جهزت، وإلا نص حر) عبر validateDeviceSpec_ (ReferenceData.gs).
 */
function validateReceiptItemInput_(item) {
  item = item || {};
  const deviceType = requiredText_(item.deviceType, 'نوع الجهاز', 80);
  if (NEW_NEED_DEVICE_TYPES.indexOf(deviceType) === -1) {
    throw new Error('نوع الجهاز «' + deviceType + '» غير مسموح به في محضر الاستلام — الأنواع المتاحة: ' + NEW_NEED_DEVICE_TYPES.join('، '));
  }
  const spec = validateDeviceSpec_(deviceType, item.spec, null);
  const sentQty = requiredNonNegativeInt_(item.sentQty, 'الكمية المرسلة');
  if (sentQty < 1) throw new Error('الكمية المرسلة يجب أن تكون واحدًا على الأقل');
  return {deviceType: deviceType, spec: spec, sentQty: sentQty};
}

/**
 * إنشاء محضر استلام + بنوده **كعملية ذرّية واحدة** (نفس نمط
 * createBeneficiaryWithNeeds_ حرفيًا): تحقّق كامل قبل أي كتابة، توليد
 * معرّفات البند والمحضر معًا، كتابة البنود أولًا (appendObjects_ ذرّية)
 * ثم المحضر أخيرًا — فشل كتابة المحضر بعد نجاح البنود يحذف البنود
 * المعلَّقة الجديدة فقط (تنظيف تعويضي، لا يتيم يبقى). الحالة الابتدائية
 * "مسودة" دائمًا — الإرسال الفعلي خطوة منفصلة صريحة (sendReceiptBatch).
 */
function createReceiptBatch(token, payload) {
  return perfTime_('createReceiptBatch', () => {
    const user = requireSession_(token, ['ADMIN']);
    payload = payload || {};
    return runLockedIdempotent_('createReceiptBatch', user.id, payload.opId, () => createReceiptBatch_(user, payload));
  });
}

/**
 * ⚠️ تفترض أن المستدعي يُمسك ScriptLock فعلًا (عبر runLockedIdempotent_
 * في createReceiptBatch أعلاه) — لا تُمسك أي قفل بنفسها ولا تُستدعى
 * مباشرة من أي مسار آخر.
 */
function createReceiptBatch_(user, payload) {
  const associationId = cleanId_(payload.associationId);
  if (!associationId) throw new Error('اختر جمعية صحيحة');
  const supplierName = validateSupplier_(payload.supplierName);
  const sentDate = requiredDate_(payload.sentDate, 'تاريخ الإرسال');
  const notes = cleanText_(payload.notes, 1000);
  const rawItems = Array.isArray(payload.items) ? payload.items : [];
  if (!rawItems.length) throw new Error('أضف صنفًا واحدًا على الأقل للمحضر');
  const items = rawItems.map(validateReceiptItemInput_);

  invalidateTableCache_(APP.sheets.associations);
  invalidateTableCache_(APP.sheets.receiptBatches);
  invalidateTableCache_(APP.sheets.receiptItems);
  assertActiveAssociationForReceipt_(associationId);

  const batchId = nextIdsLocked_('RCB', 1)[0];
  const itemIds = nextIdsLocked_('RCI', items.length);
  const nowStamp = now_();
  const itemRows = items.map((item, index) => ({
    'رقم البند': itemIds[index], 'رقم المحضر': batchId, 'نوع الجهاز': item.deviceType, 'المواصفة': item.spec,
    'الكمية المرسلة': item.sentQty, 'الكمية السليمة': 0, 'الكمية التالفة': 0, 'الكمية الناقصة': 0,
    'سبب الفرق': '', 'ملاحظات الفرق': '', 'تاريخ الإنشاء': nowStamp, 'آخر تحديث': nowStamp
  }));

  let itemsWritten = false;
  try {
    appendObjects_(APP.sheets.receiptItems, itemRows);
    itemsWritten = true;
    appendObject_(APP.sheets.receiptBatches, {
      'رقم المحضر': batchId, 'رقم الجمعية': associationId, 'اسم المورد': supplierName, 'تاريخ الإرسال': sentDate,
      'رقم المستخدم المنشئ': user.id, 'الحالة': 'مسودة', 'الملاحظات': notes,
      'اسم المستلم': '', 'صفة المستلم': '', 'تاريخ ووقت التأكيد': '',
      'معرف صورة الكمية العامة': '', 'اسم ملف صورة الكمية العامة': '', 'نوع ملف صورة الكمية العامة': '', 'حجم ملف صورة الكمية العامة': '',
      'معرف ملف توقيع المستلم': '', 'اسم ملف توقيع المستلم': '', 'نوع ملف توقيع المستلم': '', 'حجم ملف توقيع المستلم': '',
      'تاريخ الإنشاء': nowStamp, 'آخر تحديث': nowStamp
    });
  } catch (writeError) {
    if (itemsWritten) {
      const cleanupErrors = [];
      itemIds.forEach(id => {
        try { deleteRowById_(APP.sheets.receiptItems, 'رقم البند', id); }
        catch (cleanupError) { cleanupErrors.push(id + ': ' + cleanupError.message); }
      });
      if (cleanupErrors.length) {
        Logger.log('حرج جدًا: فشل تنظيف بنود معلَّقة بعد تعذّر إنشاء محضر الاستلام — traceId=' + requestMeta_().traceId + ' — ' + cleanupErrors.join('؛ '));
        throw new Error('تعذّر إنشاء محضر الاستلام، وتعذّر تنظيف البنود المؤقتة أيضًا — يتطلب مراجعة يدوية فورية (traceId: ' + requestMeta_().traceId + ')');
      }
    }
    throw new Error('تعذّر إنشاء محضر الاستلام: ' + writeError.message);
  }

  clearDashboardCache();
  try {
    audit_(user, 'إنشاء محضر استلام', 'محاضر الاستلام', batchId, 'عدد الأصناف: ' + items.length);
  } catch (auditError) {
    Logger.log('تحذير: فشل تسجيل العملية بعد نجاح إنشاء المحضر فعليًا — traceId=' + requestMeta_().traceId + ' — ' + auditError.message);
  }
  try {
    return {ok: true, id: batchId, batch: receiptBatchDetail_(batchId)};
  } catch (enrichError) {
    Logger.log('تحذير: نجح إنشاء المحضر فعليًا لكن فشل بناء استجابة مُثراة — traceId=' + requestMeta_().traceId + ' batchId=' + batchId + ' — ' + enrichError.message);
    return {ok: true, id: batchId, refreshRequired: true};
  }
}

/** ينقل محضرًا من "مسودة" إلى "بانتظار تأكيد الجمعية" — لا كتابة أخرى معه. */
function sendReceiptBatch(token, batchId) {
  return perfTime_('sendReceiptBatch', () => {
    const user = requireSession_(token, ['ADMIN']);
    batchId = cleanId_(batchId);
    return runLockedIdempotent_('sendReceiptBatch:' + batchId, user.id, null, () => sendReceiptBatch_(user, batchId));
  });
}

function sendReceiptBatch_(user, batchId) {
  invalidateTableCache_(APP.sheets.receiptBatches);
  invalidateTableCache_(APP.sheets.associations);
  const batch = findById_(APP.sheets.receiptBatches, 'رقم المحضر', batchId);
  if (!batch) throw new Error('محضر الاستلام غير موجود');
  // Phase 3.1.1 (القسم 7): إعادة التحقق من نشاط الجمعية داخل القفل عند
  // الإرسال أيضًا — قد تصبح الجمعية غير نشطة بعد إنشاء المحضر (مسودة)
  // وقبل إرساله فعليًا.
  assertActiveAssociationForReceipt_(String(batch['رقم الجمعية']));
  const currentStatus = String(batch['الحالة']);
  assertReceiptBatchTransition_(currentStatus, 'بانتظار تأكيد الجمعية');
  const snapshot = {'الحالة': batch['الحالة'], 'آخر تحديث': batch['آخر تحديث']};
  try {
    updateById_(APP.sheets.receiptBatches, 'رقم المحضر', batchId, {'الحالة': 'بانتظار تأكيد الجمعية', 'آخر تحديث': now_()});
  } catch (writeError) {
    const traceId = requestMeta_().traceId;
    try {
      updateById_(APP.sheets.receiptBatches, 'رقم المحضر', batchId, snapshot);
      throw new Error('تعذّر إرسال محضر الاستلام (traceId: ' + traceId + ') — أُعيد لحالته السابقة تلقائيًا.');
    } catch (rollbackError) {
      if (rollbackError.message && rollbackError.message.indexOf('traceId: ' + traceId) !== -1) throw rollbackError;
      Logger.log('حرج جدًا: فشل تراجع إرسال محضر الاستلام — traceId=' + traceId + ' batchId=' + batchId + ' — ' + rollbackError.message);
      throw new Error('تعذّر إرسال محضر الاستلام (traceId: ' + traceId + ') — تعذّر التراجع، يتطلب مراجعة يدوية فورية.');
    }
  }
  clearDashboardCache();
  try {
    audit_(user, 'إرسال محضر استلام', 'محاضر الاستلام', batchId, '');
  } catch (auditError) {
    Logger.log('تحذير: فشل تسجيل العملية بعد نجاح الإرسال فعليًا — traceId=' + requestMeta_().traceId + ' — ' + auditError.message);
  }
  try {
    return {ok: true, id: batchId, batch: receiptBatchDetail_(batchId)};
  } catch (enrichError) {
    Logger.log('تحذير: نجح الإرسال فعليًا لكن فشل بناء استجابة مُثراة — traceId=' + requestMeta_().traceId + ' batchId=' + batchId + ' — ' + enrichError.message);
    return {ok: true, id: batchId, refreshRequired: true};
  }
}

/**
 * القسم 2: تأكيد الجمعية — العملية الأكبر في هذا الملف. تحقّق كامل بلا
 * أي كتابة أولًا (كميات كل بند، صورة الكمية العامة، التوقيع، صور
 * التلف)، ثم كتابة واحدة مترابطة: البنود أولًا، صور التلف، رأس المحضر،
 * والأجهزة الجديدة **آخر كتابة على الإطلاق** (القسم 4 من Phase 2.3.2 —
 * فشل أي خطوة سابقة يعني عدم إنشاء أي جهاز أصلًا، فلا "جهاز شبح" يحتاج
 * حذفًا). بعد النجاح الكامل فقط يُشغَّل محرك التخصيص التلقائي، معزولًا
 * بحيث فشله لا يُسقط نجاح التأكيد نفسه أبدًا.
 *
 * payload = {
 *   batchId, items: [{itemId, receivedQty, damagedQty, missingQty}] (اختياري
 *     لكل بند — بند لم يُذكر يُعامَل كاستلام كامل: السليم=المرسل)،
 *   receiverTitle, signature, quantityPhoto (data URL),
 *   damagePhotos: [{itemIds: [...], photo (data URL)}],
 *   opId
 * }
 */
function confirmReceiptBatch(token, payload) {
  return perfTime_('confirmReceiptBatch', () => {
    const user = requireSession_(token, ['ASSOCIATION']);
    payload = payload || {};
    const batchId = cleanId_(payload.batchId);
    return runLockedIdempotent_('confirmReceiptBatch:' + batchId, user.id, payload.opId, () => confirmReceiptBatch_(user, payload));
  });
}

function confirmReceiptBatch_(user, payload) {
  const batchId = cleanId_(payload.batchId);
  if (!batchId) throw new Error('رقم محضر غير صالح');

  invalidateTableCache_(APP.sheets.receiptBatches);
  invalidateTableCache_(APP.sheets.receiptItems);
  invalidateTableCache_(APP.sheets.receiptDamagePhotos);
  invalidateTableCache_(APP.sheets.devices);
  invalidateTableCache_(APP.sheets.associations);

  const batch = findById_(APP.sheets.receiptBatches, 'رقم المحضر', batchId);
  if (!batch) throw new Error('محضر الاستلام غير موجود');
  if (String(batch['رقم الجمعية']) !== user.associationId) {
    throw new Error('ليس لديك صلاحية لتأكيد هذا المحضر');
  }
  // Phase 3.1.1 (القسم 7): إعادة التحقق من نشاط الجمعية داخل القفل عند
  // التأكيد أيضًا — قد تصبح غير نشطة بين الإرسال والتأكيد الفعلي.
  assertActiveAssociationForReceipt_(String(batch['رقم الجمعية']));
  if (String(batch['الحالة']) !== 'بانتظار تأكيد الجمعية') {
    throw new Error('لا يمكن تأكيد محضر بحالته الحالية «' + String(batch['الحالة']) + '» — يجب أن يكون «بانتظار تأكيد الجمعية»');
  }

  const items = readTable_(APP.sheets.receiptItems).rows.filter(row => String(row['رقم المحضر']) === batchId);
  if (!items.length) throw new Error('تعذّر تأكيد محضر بلا أي بند');
  const itemById = {};
  items.forEach(row => { itemById[String(row['رقم البند'])] = row; });

  const requestedByItemId = {};
  (Array.isArray(payload.items) ? payload.items : []).forEach(entry => {
    const itemId = String((entry && entry.itemId) || '');
    if (!itemId) throw new Error('رقم بند غير صالح ضمن بيانات التأكيد');
    if (!itemById[itemId]) throw new Error('بند غير تابع لهذا المحضر: ' + itemId);
    if (requestedByItemId[itemId]) throw new Error('البند «' + itemId + '» مكرَّر أكثر من مرة في نفس طلب التأكيد');
    requestedByItemId[itemId] = entry;
  });

  // -------- تخطيط بلا كتابة: كميات كل بند --------
  let totalDamaged = 0;
  let hasAnyDifference = false;
  const itemPlans = items.map(row => {
    const itemId = String(row['رقم البند']);
    const sentQty = Number(row['الكمية المرسلة']);
    const entry = requestedByItemId[itemId];
    // استلام كامل هو الافتراضي لأي بند لم يُذكر صراحة ضمن payload.items.
    const receivedQty = entry ? requiredNonNegativeInt_(entry.receivedQty, 'الكمية السليمة للبند ' + itemId) : sentQty;
    const damagedQty = entry ? requiredNonNegativeInt_(entry.damagedQty, 'الكمية التالفة للبند ' + itemId) : 0;
    const missingQty = entry ? requiredNonNegativeInt_(entry.missingQty, 'الكمية الناقصة للبند ' + itemId) : 0;
    if (receivedQty + damagedQty + missingQty !== sentQty) {
      throw new Error('معادلة الكميات غير متوازنة للبند ' + itemId + ': السليم(' + receivedQty + ') + التالف(' + damagedQty + ') + الناقص(' + missingQty + ') يجب أن تساوي المرسل(' + sentQty + ')');
    }
    const itemHasDifference = damagedQty > 0 || missingQty > 0;
    if (itemHasDifference) hasAnyDifference = true;
    totalDamaged += damagedQty;
    const differenceReason = itemHasDifference
      ? validateDifferenceReason_(entry && entry.differenceReason)
      : '';
    const differenceNotes = cleanText_(entry && entry.differenceNotes, 500);
    return {
      row: row, itemId: itemId, deviceType: String(row['نوع الجهاز']), spec: String(row['المواصفة']),
      receivedQty: receivedQty, damagedQty: damagedQty, missingQty: missingQty,
      differenceReason: differenceReason, differenceNotes: differenceNotes
    };
  });

  const finalStatus = hasAnyDifference ? 'تم الاستلام مع فروقات' : 'تم الاستلام كاملًا';
  assertReceiptBatchTransition_(String(batch['الحالة']), finalStatus);

  // -------- بيانات التأكيد الإلزامية --------
  // Phase 3.1.1 (القسم 6): التوقيع إثبات صورة حقيقي إلزامي — لا نص، ولا
  // يُقبَل أي بديل عنه (لا توقيع نصي، لا مستند آخر) — يُرفَع ويُخزَّن
  // بنفس مسار صورة الكمية العامة تمامًا.
  const receiverTitle = validateReceiverTitle_(payload.receiverTitle);
  if (!payload.signatureImage) throw new Error('توقيع المستلم (صورة) إلزامي قبل التأكيد');
  if (!payload.quantityPhoto) throw new Error('صورة الكمية المستلمة كاملة عن المحضر إلزامية قبل التأكيد');

  // -------- صور التلف: تحقّق العدد حسب إجمالي التالف قبل أي كتابة --------
  const rawDamagePhotos = Array.isArray(payload.damagePhotos) ? payload.damagePhotos : [];
  if (totalDamaged === 1 && rawDamagePhotos.length !== 1) {
    throw new Error('تلف جهاز واحد يتطلب صورة تلف واحدة بالضبط');
  }
  if (totalDamaged > 1 && rawDamagePhotos.length < 1) {
    throw new Error('وجود أكثر من جهاز تالف يتطلب صورة تلف واحدة على الأقل');
  }
  if (totalDamaged === 0 && rawDamagePhotos.length > 0) {
    throw new Error('لا يمكن إرفاق صور تلف دون تسجيل أي كمية تالفة في بنود المحضر');
  }
  // Phase 3.1.1 (القسم 4): كل itemId مرتبط بصورة تلف يجب أن يتبع هذا
  // المحضر **وأن يحمل كمية تالفة فعليًا (damagedQty > 0)**، لا يجوز تكرار
  // نفس itemId داخل الصورة نفسها، ثم — بعد بناء كل الخطط — يجب أن يظهر
  // كل بند بكمية تالفة فعلية في صورة واحدة على الأقل. كل ذلك قبل أي كتابة.
  const itemPlanById = {};
  itemPlans.forEach(plan => { itemPlanById[plan.itemId] = plan; });
  const damagePhotoPlans = rawDamagePhotos.map((entry, index) => {
    const itemIds = Array.isArray(entry && entry.itemIds) ? entry.itemIds.map(String) : [];
    if (!itemIds.length) throw new Error('كل صورة تلف يجب أن تُربَط ببند واحد على الأقل');
    const seenInThisPhoto = {};
    itemIds.forEach(itemId => {
      if (!itemById[itemId]) throw new Error('صورة تلف مرتبطة ببند غير تابع لهذا المحضر: ' + itemId);
      if (itemPlanById[itemId].damagedQty <= 0) {
        throw new Error('صورة تلف مرتبطة ببند لا يحمل أي كمية تالفة فعلية: ' + itemId);
      }
      if (seenInThisPhoto[itemId]) throw new Error('البند «' + itemId + '» مكرَّر أكثر من مرة ضمن نفس صورة التلف');
      seenInThisPhoto[itemId] = true;
    });
    if (!entry || !entry.photo) throw new Error('صورة التلف رقم ' + (index + 1) + ' مفقودة');
    return {itemIds: itemIds, dataUrl: entry.photo};
  });
  const damagedItemIdsCovered = {};
  damagePhotoPlans.forEach(plan => plan.itemIds.forEach(itemId => { damagedItemIdsCovered[itemId] = true; }));
  itemPlans.forEach(plan => {
    if (plan.damagedQty > 0 && !damagedItemIdsCovered[plan.itemId]) {
      throw new Error('البند «' + plan.itemId + '» يحمل كمية تالفة بلا أي صورة تلف تغطيه');
    }
  });

  // -------- لقطات خام قبل أي كتابة --------
  const batchSnapshot = {
    'الحالة': batch['الحالة'], 'اسم المستلم': batch['اسم المستلم'], 'صفة المستلم': batch['صفة المستلم'],
    'تاريخ ووقت التأكيد': batch['تاريخ ووقت التأكيد'],
    'معرف صورة الكمية العامة': batch['معرف صورة الكمية العامة'], 'اسم ملف صورة الكمية العامة': batch['اسم ملف صورة الكمية العامة'],
    'نوع ملف صورة الكمية العامة': batch['نوع ملف صورة الكمية العامة'], 'حجم ملف صورة الكمية العامة': batch['حجم ملف صورة الكمية العامة'],
    'معرف ملف توقيع المستلم': batch['معرف ملف توقيع المستلم'], 'اسم ملف توقيع المستلم': batch['اسم ملف توقيع المستلم'],
    'نوع ملف توقيع المستلم': batch['نوع ملف توقيع المستلم'], 'حجم ملف توقيع المستلم': batch['حجم ملف توقيع المستلم'],
    'آخر تحديث': batch['آخر تحديث']
  };
  const itemSnapshots = {};
  itemPlans.forEach(plan => {
    itemSnapshots[plan.itemId] = {
      'الكمية السليمة': plan.row['الكمية السليمة'], 'الكمية التالفة': plan.row['الكمية التالفة'], 'الكمية الناقصة': plan.row['الكمية الناقصة'],
      'سبب الفرق': plan.row['سبب الفرق'], 'ملاحظات الفرق': plan.row['ملاحظات الفرق'], 'آخر تحديث': plan.row['آخر تحديث']
    };
  });

  // -------- رفع الصور (خارج الكتابة الجدولية) --------
  // Phase 3.1.1 (القسم 5): كل ملف يُرفع فعليًا بنجاح إلى Drive يُسجَّل
  // معرّفه فورًا في uploadedFileIds — فشل رفع صورة **لاحقة** بعد نجاح
  // سابقة (مثال: صورة الكمية نجحت، ثم صورة تلف تالية فشلت) يجب ألا يترك
  // الصورة الناجحة يتيمة في Drive بلا أي سجل يشير إليها؛ best-effort نقل
  // كل ما نجح فعلًا إلى المهملات قبل رفع الاستثناء.
  const uploadedFileIds = [];
  let quantityPhotoMeta;
  let signatureMeta;
  let damagePhotoMetas;
  try {
    quantityPhotoMeta = saveReceiptImage_(payload.quantityPhoto);
    uploadedFileIds.push(quantityPhotoMeta.fileId);
    signatureMeta = saveReceiptImage_(payload.signatureImage);
    uploadedFileIds.push(signatureMeta.fileId);
    damagePhotoMetas = damagePhotoPlans.map(plan => {
      const meta = Object.assign({}, plan, saveReceiptImage_(plan.dataUrl));
      uploadedFileIds.push(meta.fileId);
      return meta;
    });
  } catch (uploadError) {
    trashReceiptImages_(uploadedFileIds);
    throw uploadError;
  }

  // -------- الكتابة: البنود أولًا، ثم صور التلف، ثم رأس المحضر، والأجهزة آخر كتابة --------
  const itemsAttempted = [];
  let batchAttempted = false;
  let photoIds = [];
  let deviceIds = [];
  const nowStamp = now_();
  try {
    itemPlans.forEach(plan => {
      itemsAttempted.push(plan.itemId);
      updateById_(APP.sheets.receiptItems, 'رقم البند', plan.itemId, {
        'الكمية السليمة': plan.receivedQty, 'الكمية التالفة': plan.damagedQty, 'الكمية الناقصة': plan.missingQty,
        'سبب الفرق': plan.differenceReason, 'ملاحظات الفرق': plan.differenceNotes, 'آخر تحديث': nowStamp
      });
    });

    // Phase 3.1.1 (القسم 4): معرّف فريد مستقل لكل صف ربط (صورة↔بند) — لا
    // معرّف واحد يتكرر بين عدة صفوف. معرف الملف (fileId) نفسه يتكرر بحرّية
    // بين صفوف الصورة الواحدة المرتبطة بأكثر من بند (نفس الصورة، بنود
    // متعددة)، لكن العمود الأساسي "رقم الربط" لا يتكرر أبدًا بين الصفوف.
    const totalLinkRows = damagePhotoMetas.reduce((sum, meta) => sum + meta.itemIds.length, 0);
    if (totalLinkRows) {
      const linkIds = nextIdsLocked_('RCD', totalLinkRows);
      let linkCursor = 0;
      const photoRows = [];
      damagePhotoMetas.forEach(meta => {
        meta.itemIds.forEach(itemId => {
          const linkId = linkIds[linkCursor++];
          photoIds.push(linkId);
          photoRows.push({
            'رقم الربط': linkId, 'رقم المحضر': batchId, 'رقم البند': itemId,
            'معرف الملف': meta.fileId, 'اسم الملف': meta.fileName, 'نوع الملف': meta.fileType, 'حجم الملف': meta.fileSize,
            'تاريخ الرفع': nowStamp
          });
        });
      });
      appendObjects_(APP.sheets.receiptDamagePhotos, photoRows);
    }

    batchAttempted = true;
    updateById_(APP.sheets.receiptBatches, 'رقم المحضر', batchId, {
      'الحالة': finalStatus, 'اسم المستلم': user.name, 'صفة المستلم': receiverTitle,
      'تاريخ ووقت التأكيد': nowStamp,
      'معرف صورة الكمية العامة': quantityPhotoMeta.fileId, 'اسم ملف صورة الكمية العامة': quantityPhotoMeta.fileName,
      'نوع ملف صورة الكمية العامة': quantityPhotoMeta.fileType, 'حجم ملف صورة الكمية العامة': quantityPhotoMeta.fileSize,
      'معرف ملف توقيع المستلم': signatureMeta.fileId, 'اسم ملف توقيع المستلم': signatureMeta.fileName,
      'نوع ملف توقيع المستلم': signatureMeta.fileType, 'حجم ملف توقيع المستلم': signatureMeta.fileSize,
      'آخر تحديث': nowStamp
    });

    const deviceRowsToCreate = [];
    itemPlans.forEach(plan => {
      if (plan.receivedQty <= 0) return;
      const ids = nextIdsLocked_('DEV', plan.receivedQty);
      deviceIds = deviceIds.concat(ids);
      ids.forEach(id => {
        deviceRowsToCreate.push({
          'رقم الجهاز': id, 'اسم الجهاز': plan.deviceType + ' — ' + plan.spec, 'النوع': plan.deviceType,
          'رقم الجمعية': String(batch['رقم الجمعية']), 'رقم المستفيد': '', 'حالة الجهاز': 'بالمستودع',
          'تاريخ الإضافة': nowStamp, 'تاريخ التسليم': '', 'ملاحظات': '', 'رقم الاحتياج': '', 'رقم بند الاستلام': plan.itemId
        });
      });
    });
    if (deviceRowsToCreate.length) appendObjects_(APP.sheets.devices, deviceRowsToCreate);
  } catch (writeError) {
    const restored = [];
    const failedToRestore = [];
    // Phase 3.1.1 (القسم 3): الأجهزة آخر كتابة أساسية، لكن هذا لا يعني أن
    // appendObjects_ لم تكتب فعليًا لمجرد أنها رمت استثناءً — قد تكتب
    // Sheets الصفوف فعليًا ثم يفشل استدعاء لاحق (مثال: invalidateTableCache_
    // أو أي كود بعدها ضمن نفس try) دون أن يعني ذلك عدم كتابة. deviceIds
    // تحمل كل معرّف "حاولنا" إنشاءه (وُلِّد قبل appendObjects_ مباشرة)،
    // فتُفحَص كل واحدة فعليًا: إن وُجد صفها فعلًا وكان لا يزال بحالته
    // الابتدائية النظيفة (بالمستودع، بلا مستفيد، بلا احتياج) — أي لم
    // يُلمَس بعد بأي عملية لاحقة — يُحذَف؛ إن لم يوجد الصف أصلًا فلا شيء
    // للتنظيف (ليس فشلًا). لا نفترض أبدًا عدم الكتابة بلا تحقّق فعلي.
    deviceIds.forEach(id => {
      try {
        const deviceRow = findById_(APP.sheets.devices, 'رقم الجهاز', id);
        if (deviceRow
          && String(deviceRow['حالة الجهاز']) === 'بالمستودع'
          && !String(deviceRow['رقم المستفيد'] || '')
          && !String(deviceRow['رقم الاحتياج'] || '')) {
          deleteRowById_(APP.sheets.devices, 'رقم الجهاز', id);
          restored.push('device:' + id);
        }
      } catch (e) {
        failedToRestore.push('device:' + id + ' (' + e.message + ')');
      }
    });
    if (batchAttempted) {
      try { updateById_(APP.sheets.receiptBatches, 'رقم المحضر', batchId, batchSnapshot); restored.push('batch:' + batchId); }
      catch (e) { failedToRestore.push('batch:' + batchId + ' (' + e.message + ')'); }
    }
    photoIds.forEach(id => {
      try { deleteRowById_(APP.sheets.receiptDamagePhotos, 'رقم الربط', id); restored.push('photo:' + id); }
      catch (e) { failedToRestore.push('photo:' + id + ' (' + e.message + ')'); }
    });
    itemsAttempted.forEach(itemId => {
      try { updateById_(APP.sheets.receiptItems, 'رقم البند', itemId, itemSnapshots[itemId]); restored.push('item:' + itemId); }
      catch (e) { failedToRestore.push('item:' + itemId + ' (' + e.message + ')'); }
    });
    // Phase 3.1.1 (القسم 5): فشل الكتابة الجدولية يعني عدم اكتمال العملية
    // إطلاقًا رغم أن الصور رُفعت فعلًا في الخطوة السابقة — best-effort نقل
    // كل ما رُفع لهذا المحضر إلى المهملات بدل تركه يتيمًا في Drive بلا سجل.
    trashReceiptImages_(uploadedFileIds);
    const traceId = requestMeta_().traceId;
    if (failedToRestore.length) {
      Logger.log('حرج جدًا: فشل تراجع جزئي في تأكيد محضر استلام — traceId=' + traceId
        + ' — أُعيدت: [' + restored.join('، ') + '] — تعذّر إعادة: [' + failedToRestore.join('، ') + '] — خطأ الكتابة الأصلي: ' + writeError.message);
      throw new Error('تعذّر إتمام تأكيد المحضر (traceId: ' + traceId + ') — تعذّر التراجع الكامل، يتطلب مراجعة يدوية فورية للسجلات: ' + failedToRestore.map(s => s.split(' (')[0]).join('، '));
    }
    throw new Error('تعذّر إتمام تأكيد المحضر (traceId: ' + traceId + ') — أُعيدت كل السجلات المتأثرة لحالتها السابقة تلقائيًا.');
  }

  clearDashboardCache();
  try {
    audit_(user, 'تأكيد محضر استلام', 'محاضر الاستلام', batchId, 'الحالة: ' + finalStatus + ' — أجهزة جديدة: ' + deviceIds.length);
  } catch (auditError) {
    Logger.log('تحذير: فشل تسجيل العملية بعد نجاح التأكيد فعليًا — traceId=' + requestMeta_().traceId + ' — ' + auditError.message);
  }

  // القسم 4: محرك التخصيص التلقائي يُشغَّل بعد دخول مخزون سليم — معزول
  // تمامًا؛ فشله لا يجوز أن يُسقط نجاح التأكيد نفسه (نفس مبدأ عزل audit).
  if (deviceIds.length) {
    try {
      runAutoAllocation_(String(batch['رقم الجمعية']), user);
    } catch (allocationError) {
      Logger.log('تحذير: نجح تأكيد المحضر وإدخال المخزون فعليًا لكن فشل محرك التخصيص التلقائي بعده — traceId=' + requestMeta_().traceId + ' batchId=' + batchId + ' — ' + allocationError.message);
    }
  }

  try {
    return {ok: true, id: batchId, batch: receiptBatchDetail_(batchId)};
  } catch (enrichError) {
    Logger.log('تحذير: نجح تأكيد المحضر فعليًا لكن فشل بناء استجابة مُثراة — traceId=' + requestMeta_().traceId + ' batchId=' + batchId + ' — ' + enrichError.message);
    return {ok: true, id: batchId, refreshRequired: true};
  }
}

/** تفاصيل محضر واحد (رأس + بنود + عدد صور تلف لكل بند، بلا الصور نفسها). */
function receiptBatchDetail_(batchId) {
  const batch = findById_(APP.sheets.receiptBatches, 'رقم المحضر', batchId);
  if (!batch) throw new Error('محضر الاستلام غير موجود');
  const items = readTable_(APP.sheets.receiptItems).rows.filter(row => String(row['رقم المحضر']) === batchId);
  // Phase 3.1.2 (القسم 3): تُعاد معرّفات الربط الآمنة (linkId = "رقم
  // الربط") فقط — لا fileId ولا أي رابط Drive خام في أي استجابة. القراءة
  // الفعلية للصورة تمر حصرًا عبر getReceiptEvidenceImage(token, batchId,
  // 'damage', linkId) بعد كل تحقّق صلاحية هناك.
  const damagePhotosByItem = {};
  readTable_(APP.sheets.receiptDamagePhotos).rows
    .filter(row => String(row['رقم المحضر']) === batchId)
    .forEach(row => {
      const itemId = String(row['رقم البند']);
      (damagePhotosByItem[itemId] = damagePhotosByItem[itemId] || []).push({linkId: String(row['رقم الربط'])});
    });
  return {
    id: String(batch['رقم المحضر']), associationId: String(batch['رقم الجمعية']),
    supplierName: String(batch['اسم المورد'] || ''), sentDate: formatDate_(parseDate_(batch['تاريخ الإرسال'])),
    createdByUserId: String(batch['رقم المستخدم المنشئ'] || ''), status: String(batch['الحالة']),
    notes: String(batch['الملاحظات'] || ''), receiverName: String(batch['اسم المستلم'] || ''),
    receiverTitle: String(batch['صفة المستلم'] || ''), confirmedAt: formatDateTime_(parseDate_(batch['تاريخ ووقت التأكيد'])),
    hasQuantityPhoto: !!String(batch['معرف صورة الكمية العامة'] || ''),
    hasSignature: !!String(batch['معرف ملف توقيع المستلم'] || ''),
    createdAt: formatDateTime_(parseDate_(batch['تاريخ الإنشاء'])), updatedAt: formatDateTime_(parseDate_(batch['آخر تحديث'])),
    items: items.map(row => ({
      // Phase 3.1.1 (القسم 9): إصلاح مباشر — نوع الجهاز يُقرأ حصرًا من
      // عمود "نوع الجهاز" في بند المحضر نفسه، لا من عمود "النوع" (الذي
      // لا وجود له إطلاقًا في ورقة "بنود محضر الاستلام" — كان هذا يعتمد
      // خطأً على undefined يتراجع صامتًا للقيمة الصحيحة الثانية).
      id: String(row['رقم البند']), deviceType: String(row['نوع الجهاز'] || ''),
      spec: String(row['المواصفة'] || ''), sentQty: Number(row['الكمية المرسلة']) || 0,
      receivedQty: Number(row['الكمية السليمة']) || 0, damagedQty: Number(row['الكمية التالفة']) || 0,
      missingQty: Number(row['الكمية الناقصة']) || 0, differenceReason: String(row['سبب الفرق'] || ''),
      differenceNotes: String(row['ملاحظات الفرق'] || ''),
      damagePhotos: damagePhotosByItem[String(row['رقم البند'])] || [],
      damagePhotoCount: (damagePhotosByItem[String(row['رقم البند'])] || []).length
    }))
  };
}

/** ADMIN: كل المحاضر (اختياريًا مصفَّاة بجمعية). ASSOCIATION: محاضرها فقط. */
function listReceiptBatches(token, options) {
  return perfTime_('listReceiptBatches', () => {
    const user = requireSession_(token, ['ADMIN', 'ASSOCIATION']);
    options = options || {};
    let rows = readTable_(APP.sheets.receiptBatches).rows;
    if (user.role === 'ASSOCIATION') {
      rows = rows.filter(row => String(row['رقم الجمعية']) === user.associationId);
    } else if (options.associationId) {
      rows = rows.filter(row => String(row['رقم الجمعية']) === cleanId_(options.associationId));
    }
    return withMeta_({ok: true, items: rows.map(row => receiptBatchDetail_(String(row['رقم المحضر'])))});
  });
}

/** تفاصيل محضر واحد محمية بنفس عزل الجمعية أعلاه. */
function getReceiptBatchDetail(token, batchId) {
  return perfTime_('getReceiptBatchDetail', () => {
    const user = requireSession_(token, ['ADMIN', 'ASSOCIATION']);
    batchId = cleanId_(batchId);
    const batch = findById_(APP.sheets.receiptBatches, 'رقم المحضر', batchId);
    if (!batch) throw new Error('محضر الاستلام غير موجود');
    if (user.role === 'ASSOCIATION' && String(batch['رقم الجمعية']) !== user.associationId) {
      throw new Error('ليس لديك صلاحية لعرض هذا المحضر');
    }
    return withMeta_({ok: true, batch: receiptBatchDetail_(batchId)});
  });
}

/**
 * Phase 3.1.1 (القسم 6) — endpoint قراءة محروس لإثباتات محضر استلام
 * (صورة الكمية العامة، صورة التوقيع، أو صورة تلف واحدة بمعرّف ربطها)،
 * على غرار getDeliveryProofImage (Delegates.gs) حرفيًا: ADMIN يرى إثباتات
 * أي محضر، ASSOCIATION يرى إثباتات محاضرها فقط، ويُعاد دائمًا data URL
 * بعد قراءة المحتوى الفعلي من Drive — لا رابط Drive عام في أي استجابة.
 * evidenceType ∈ 'quantity' | 'signature' | 'damage' (الأخيرة تتطلب
 * photoLinkId — معرّف صف الربط في "صور تلف الاستلام").
 */
function getReceiptEvidenceImage(token, batchId, evidenceType, photoLinkId) {
  const user = requireSession_(token, ['ADMIN', 'ASSOCIATION']);
  return withMeta_(perfTime_('getReceiptEvidenceImage', () => {
    batchId = cleanId_(batchId);
    const batch = findById_(APP.sheets.receiptBatches, 'رقم المحضر', batchId);
    if (!batch) throw new Error('محضر الاستلام غير موجود');
    if (user.role === 'ASSOCIATION' && String(batch['رقم الجمعية']) !== user.associationId) {
      throw new Error('ليس لديك صلاحية لعرض إثباتات هذا المحضر');
    }
    let fileId = '';
    if (evidenceType === 'quantity') {
      fileId = String(batch['معرف صورة الكمية العامة'] || '');
    } else if (evidenceType === 'signature') {
      fileId = String(batch['معرف ملف توقيع المستلم'] || '');
    } else if (evidenceType === 'damage') {
      const linkId = cleanId_(photoLinkId);
      if (!linkId) throw new Error('معرّف صورة التلف مطلوب');
      const link = findById_(APP.sheets.receiptDamagePhotos, 'رقم الربط', linkId);
      if (!link || String(link['رقم المحضر']) !== batchId) throw new Error('صورة تلف غير تابعة لهذا المحضر');
      fileId = String(link['معرف الملف'] || '');
    } else {
      throw new Error('نوع إثبات غير معروف: ' + evidenceType);
    }
    if (!fileId) throw new Error('لا توجد صورة إثبات مرفقة بهذا النوع');
    let file;
    try {
      file = DriveApp.getFileById(fileId);
    } catch (error) {
      throw new Error('تعذّر الوصول إلى صورة الإثبات — قد تكون محذوفة');
    }
    const blob = file.getBlob();
    const base64 = Utilities.base64Encode(blob.getBytes());
    audit_(user, 'عرض إثبات محضر استلام', 'محاضر الاستلام', batchId, 'النوع: ' + evidenceType);
    return {ok: true, dataUrl: 'data:' + blob.getContentType() + ';base64,' + base64};
  }));
}
