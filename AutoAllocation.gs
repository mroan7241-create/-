// -------------------- Phase 3.1: محرك التخصيص التلقائي --------------------
//
// يُشغَّل تلقائيًا (لا endpoint عام يستدعيه المستخدم مباشرة) من نقطتين
// فقط: بعد نجاح تأكيد محضر استلام يُدخل مخزونًا سليمًا (ReceiptBatches.gs)،
// وبعد نجاح اعتماد احتياجات مستفيد جديدة (BeneficiaryNeeds.gs). كلا
// الموضعين يستدعيانه من **داخل** قفلهما الخاص أصلًا (runLockedIdempotent_)
// فيُمسك بلا قفل إضافي مطلقًا (نفس مبدأ saveDevice_/assignDelegate_).
//
// التصميم (القسم 6 من الطلب): planAutoAllocation_ دالة **نقية بلا أي
// كتابة**، تُتبَع بتحقّق كامل لكل خطة عبر مسارات StateRules الصريحة
// نفسها المُستخدَمة في commitDeviceWithNeed_، ثم commitAutoAllocationPlan_
// تكتب الخطة **كاملة كمعاملة واحدة**. لا ربط متسلسل جهازًا بعد جهاز عبر
// أي endpoint عام — كل الكتابة مباشرة على الجداول ضمن هذه المعاملة فقط.

/** حالات تنفيذ احتياج تعني أن عهدة فعلية بدأت بالفعل — لا يُلمَس أي احتياج أو جهاز مرتبط بها إطلاقًا. */
const AUTO_ALLOCATION_CUSTODY_STARTED_ = Object.freeze([
  'معيّن للمندوب — بانتظار التنفيذ', 'خرج مع المندوب', 'مؤجل', 'بانتظار تأكيد الإرجاع', 'أعيد للجمعية/المستودع', 'تم التسليم'
]);

/**
 * دالة نقية بالكامل — لا تكتب أي شيء، ولا تُعدّل أي حالة عامة. تقرأ
 * لقطة واحدة متّسقة من المستفيدين/الاحتياجات/الأجهزة (يفترض أنها تُستدعى
 * من داخل قفل ممسوك مسبقًا فتكون readTable_ قراءة طازجة داخل نفس القفل).
 *
 * يرمي خطأ سلامة بيانات فورًا (بلا أي خطة جزئية) إن وجد احتياجًا "جهاز
 * جاهز"/"بانتظار تعيين مندوب" بلا جهاز صالح واحد بالضبط مرتبط به فعليًا —
 * نفس مبدأ planNeedTransitionsForDeviceChange_ (BeneficiaryNeeds.gs)
 * تمامًا، لا تخمين ولا إصلاح صامت.
 */
function planAutoAllocation_(associationId) {
  const beneficiaryRows = readTable_(APP.sheets.beneficiaries).rows
    .filter(row => String(row['رقم الجمعية']) === associationId
      && String(row['حالة مراجعة المستفيد']) === 'معتمد'
      && String(row['حالة المستفيد']) !== 'ملغي'
      && String(row['حالة التسليم']) !== 'تم التسليم');

  const approvedNeeds = readTable_(APP.sheets.beneficiaryNeeds).rows
    .filter(row => String(row['رقم الجمعية']) === associationId && String(row['حالة القرار']) === 'معتمد');

  const devicesByNeed = {};
  readTable_(APP.sheets.devices).rows.forEach(row => {
    const needId = String(row['رقم الاحتياج'] || '');
    if (!needId) return;
    (devicesByNeed[needId] = devicesByNeed[needId] || []).push(row);
  });

  function linkedDeviceFor_(needRow) {
    const needId = String(needRow['رقم الاحتياج']);
    const linked = devicesByNeed[needId] || [];
    if (linked.length > 1) {
      throw new Error('تعذّر تشغيل محرك التخصيص التلقائي: يوجد أكثر من جهاز مرتبط بالاستحقاق ' + needId + '، ويلزم تصحيح سلامة البيانات أولًا.');
    }
    const device = linked[0];
    const valid = device
      && String(device['النوع']) === String(needRow['نوع الجهاز'])
      && String(device['رقم الجمعية']) === associationId
      && String(device['رقم المستفيد']) === String(needRow['رقم المستفيد'])
      && String(device['حالة الجهاز']) === 'مخصص';
    return valid ? device : null;
  }

  const beneficiaryModels = [];
  beneficiaryRows.forEach(row => {
    const beneficiaryId = String(row['رقم المستفيد']);
    const myNeeds = approvedNeeds.filter(n => String(n['رقم المستفيد']) === beneficiaryId);
    if (!myNeeds.length) return;
    const custodyStarted = myNeeds.some(n => AUTO_ALLOCATION_CUSTODY_STARTED_.indexOf(String(n['حالة التنفيذ'])) !== -1);
    if (custodyStarted) return; // عهدة فعلية بدأت لأحد الاحتياجات — لا يُلمَس هذا المستفيد إطلاقًا
    const alreadyComplete = myNeeds.every(n => String(n['حالة التنفيذ']) === 'بانتظار تعيين مندوب');
    if (alreadyComplete) return; // مكتمل جماعيًا فعلًا — بانتظار تعيين مندوب فقط، لا حاجة له

    const needModels = myNeeds.map(n => {
      const needId = String(n['رقم الاحتياج']);
      const fulfillment = String(n['حالة التنفيذ']);
      const type = String(n['نوع الجهاز']);
      let linkedDevice = null;
      if (fulfillment === 'جهاز جاهز' || fulfillment === 'بانتظار تعيين مندوب') {
        linkedDevice = linkedDeviceFor_(n);
        if (!linkedDevice) {
          throw new Error('تعذّر تشغيل محرك التخصيص التلقائي: الاحتياج ' + needId + ' بحالة "' + fulfillment + '" بلا جهاز صالح مرتبط فعليًا — يلزم تصحيح سلامة البيانات أولًا.');
        }
      } else if (fulfillment !== 'استحقاق معتمد' && fulfillment !== 'بانتظار توفر الجهاز') {
        return null; // حالة غير قابلة للأتمتة (نظريًا لا تحدث بعد استبعاد عهدة بدأت أعلاه) — تُستبعَد بأمان
      }
      return {needId: needId, type: type, fulfillment: fulfillment, linkedDevice: linkedDevice};
    }).filter(Boolean);
    if (!needModels.length) return;

    beneficiaryModels.push({beneficiaryId: beneficiaryId, needs: needModels});
  });

  // القسم 4.4: ترتيب ثابت تقني — أقل عدد احتياجات ناقصة أولًا (أقرب
  // لإكمال الطلبية)، ثم رقم المستفيد تصاعديًا عند التعادل. لا أولوية
  // تجارية ولا FIFO. يُستخدَم فقط لترتيب المرحلة الجزئية الأخيرة أدناه.
  beneficiaryModels.forEach(bm => { bm.missingCount = bm.needs.filter(n => !n.linkedDevice).length; });
  beneficiaryModels.sort((a, b) => (a.missingCount - b.missingCount) || (a.beneficiaryId < b.beneficiaryId ? -1 : (a.beneficiaryId > b.beneficiaryId ? 1 : 0)));

  const freePool = {};
  readTable_(APP.sheets.devices).rows
    .filter(d => String(d['رقم الجمعية']) === associationId && String(d['حالة الجهاز']) === 'بالمستودع' && !String(d['رقم المستفيد'] || ''))
    .forEach(d => { const t = String(d['النوع']); (freePool[t] = freePool[t] || []).push(d); });
  Object.keys(freePool).forEach(t => freePool[t].sort((a, b) => String(a['رقم الجهاز']).localeCompare(String(b['رقم الجهاز']))));

  const devicePlans = [];
  const needPlans = [];
  const completedBeneficiaryIds = {};

  // -------- Phase 3.1.2 (القسم 1): هدف تخصيص عالمي واحد --------
  // القرار "من يكتمل" قرار واحد يبني مجموعة الموارد القابلة لإعادة
  // التوزيع من المخزون الحرّ **وكل جهاز "مخصص" لاحتياج جزئي "جهاز جاهز"**
  // معًا، لا مرحلة حرّة أولًا ثم استرجاع جشع لاحقًا (كان يفوّت حلولًا
  // أفضل عالميًا). بما أن مجموع (وحدات حرّة + وحدات جاهزة قابلة للاسترجاع)
  // لكل نوع = العرض الكلي الفعلي لذلك النوع، ومطلب أي مستفيد لنوع ما
  // (سواء كان جاهزًا له بالفعل أو ناقصًا) = طلب واحد على هذا العرض، فإن
  // "أكبر عدد مستفيدين يكتمل الجميع" = مسألة 0/1 knapsack قياسية بثلاثة
  // أبعاد (الأنواع الثلاثة فقط)، إذ لكل مستفيد نمط طلب واحد من 7 أنماط
  // غير فارغة كحد أقصى (نفس مبدأ Phase 3.1.1 لكن الآن يشمل العرض/الطلب
  // الكامل معًا في قرار واحد، لا مرحلتين منفصلتين).
  const typesOrder = NEW_NEED_DEVICE_TYPES; // ['ثلاجة', 'فرن', 'غسالة'] — ترتيب ثابت لأبعاد الخوارزمية

  // مجمَّع الأجهزة "الجاهزة" القابلة لإعادة التوزيع (احتياج جزئي بحالة
  // "جهاز جاهز" فقط) — عبر كل المستفيدين المرشَّحين، بلا استبعاد مسبق
  // لأي أحد (الاستبعاد يأتي لاحقًا حسب اختيار DP الفعلي).
  const readyPool = {};
  beneficiaryModels.forEach(bm => {
    bm.needs.forEach(n => {
      if (n.fulfillment === 'جهاز جاهز' && n.linkedDevice) {
        (readyPool[n.type] = readyPool[n.type] || []).push({device: n.linkedDevice, sourceBeneficiaryId: bm.beneficiaryId, sourceNeedId: n.needId, sourceNeedModel: n});
      }
    });
  });
  Object.keys(readyPool).forEach(t => readyPool[t].sort((a, b) => String(a.device['رقم الجهاز']).localeCompare(String(b.device['رقم الجهاز']))));

  // Phase 3.1.2a (القسم 1-4) — كل مستفيد مرشَّح: fullCost (الأنواع
  // الجاهزة+الناقصة معًا، لضبط سعة الموارد القابلة لإعادة التوزيع) و
  // gapCost (الأنواع الناقصة فقط، لضبط عدد الاحتياجات التي تحتاج جهازًا
  // جديدًا فعليًا — لا يمكن أن يتجاوز fullCost لنفس النوع أبدًا).
  const dpItems = beneficiaryModels.map(bm => {
    const allTypes = Array.from(new Set(bm.needs.map(n => n.type)));
    const missingTypes = Array.from(new Set(bm.needs.filter(n => !n.linkedDevice).map(n => n.type)));
    return {
      bm: bm,
      fullCost: typesOrder.map(t => (allTypes.indexOf(t) !== -1 ? 1 : 0)),
      gapCost: typesOrder.map(t => (missingTypes.indexOf(t) !== -1 ? 1 : 0))
    };
  }).sort((x, y) => (x.bm.beneficiaryId < y.bm.beneficiaryId ? -1 : (x.bm.beneficiaryId > y.bm.beneficiaryId ? 1 : 0)));

  const freeByType = typesOrder.map(t => (freePool[t] || []).length);
  const readyByType = typesOrder.map(t => (readyPool[t] || []).length);
  const fullDemandByType = typesOrder.map((t, idx) => dpItems.reduce((sum, it) => sum + it.fullCost[idx], 0));
  const gapDemandByType = typesOrder.map((t, idx) => dpItems.reduce((sum, it) => sum + it.gapCost[idx], 0));
  // سعة كل نوع: الطلب الكلي (جاهز+ناقص) مقابل العرض الكلي (حرّ+جاهز قابل
  // لإعادة التوزيع)، وسعة "الناقص" (لا يمكن أن تتجاوز سعة الكلي لنفس النوع).
  const demandCap = typesOrder.map((t, idx) => Math.min(freeByType[idx] + readyByType[idx], fullDemandByType[idx]));
  const gapCap = typesOrder.map((t, idx) => Math.min(gapDemandByType[idx], demandCap[idx]));

  // أبعاد حالة DP الستّة: [طلب_0، ناقص_0، طلب_1، ناقص_1، طلب_2، ناقص_2] —
  // مُدمَجتان معًا (لا 3 أبعاد فقط) لأن "الاسترجاع الفعلي لكل نوع" =
  // max(0, ناقص_ذلك_النوع − الحرّ_له) يعتمد على القيمة الدقيقة للناقص لكل
  // نوع على حدة، لا مجموعها الكلي فقط. هذا ما يسمح بحساب قيمة الاسترجاع
  // الحقيقية للمقارنة الدقيقة بين الحلول (القسم 3 من الطلب) بدل الاكتفاء
  // بعدّ missingTypes.length كما في الإصدار السابق.
  const dims = [];
  typesOrder.forEach((t, idx) => { dims.push(demandCap[idx] + 1); dims.push(gapCap[idx] + 1); });
  const strides = new Array(dims.length);
  strides[dims.length - 1] = 1;
  for (let k = dims.length - 2; k >= 0; k--) strides[k] = strides[k + 1] * dims[k + 1];
  const totalStates = strides[0] * dims[0];

  // حارس أداء صريح — لا fallback صامت لأي حل أقل من الأمثل. تجاوز هذا
  // السقف (نادر جدًا عمليًا لحجم دفعة واحدة) يرمي خطأً يوقف التخطيط
  // بالكامل بلا أي كتابة (معزول أصلًا لدى كل مستدعٍ خارجي).
  if (dpItems.length && totalStates * dpItems.length > 4000000) {
    throw new Error('تعذّر حساب خطة التخصيص التلقائي الأمثل عالميًا لحجم البيانات الحالي (حارس أداء) — لن تُكتب أي خطة تخصيص أقل من الأمثل؛ يلزم تدخّل يدوي أو تقسيم الدفعة.');
  }

  function decodeState_(z) {
    const vals = new Array(dims.length);
    let rem = z;
    for (let k = 0; k < dims.length; k++) { vals[k] = Math.floor(rem / strides[k]); rem -= vals[k] * strides[k]; }
    return vals;
  }
  function itemOffset_(item) {
    let off = 0;
    typesOrder.forEach((t, idx) => {
      off += item.fullCost[idx] * strides[2 * idx];
      off += item.gapCost[idx] * strides[2 * idx + 1];
    });
    return off;
  }
  function itemContribution_(item) {
    const c = new Array(dims.length).fill(0);
    typesOrder.forEach((t, idx) => { c[2 * idx] = item.fullCost[idx]; c[2 * idx + 1] = item.gapCost[idx]; });
    return c;
  }

  // القسم 1-2-3-4 (بترتيب صارم): DP بمجموع دقيق (exact-sum، لا "بحد
  // أقصى") — dp[z] = أكبر عدد مستفيدين تصل مجموع مساهماتهم بالضبط إلى
  // الحالة z (أو -1 إن تعذّر الوصول إليها). لا حاجة لتتبّع "تكلفة" منفصلة
  // في كل خلية: بما أن كل بُعد ناقص جزء من الحالة نفسها، مجموع الأبعاد
  // الناقصة لأي حالة z يُعطي عدد الاحتياجات الناقصة بدقة (القسم 2)، وقيمة
  // الاسترجاع الفعلية تُحسَب مباشرة من هذه الأبعاد (القسم 3) — كلاهما
  // خاصية للحالة ذاتها لا تحتاج تتبعًا إضافيًا أثناء التحديث.
  const selectedSet = {};
  if (dpItems.length && totalStates > 0) {
    const dp = new Array(totalStates).fill(-1);
    dp[0] = 0;
    const takeTables = [];
    dpItems.forEach(item => {
      const offset = itemOffset_(item);
      const contribution = itemContribution_(item);
      const take = new Array(totalStates).fill(false);
      // نمر على كل الحالات تنازليًا (يمنع إعادة استخدام نفس العنصر مرتين
      // — نفس أسلوب 0/1 knapsack القياسي، هنا بفهرس مسطَّح بدل حلقات متداخلة).
      for (let z = totalStates - 1; z >= 0; z--) {
        const state = decodeState_(z);
        let feasible = true;
        for (let k = 0; k < dims.length; k++) {
          if (state[k] < contribution[k]) { feasible = false; break; }
        }
        if (!feasible) continue;
        const sourceZ = z - offset;
        if (dp[sourceZ] === -1) continue;
        const candidate = dp[sourceZ] + 1;
        if (candidate > dp[z]) { dp[z] = candidate; take[z] = true; }
      }
      takeTables.push(take);
    });

    // البحث عن أفضل حالة نهائية: أكبر عدد إكمال أولًا (1)، ثم أصغر مجموع
    // الأبعاد الناقصة (2)، ثم أصغر قيمة استرجاع فعلية محسوبة من نفس
    // الحالة (3)، ثم ترتيب ثابت (فهرس أصغر) عند استمرار التعادل (4).
    let bestZ = -1, bestCount = -1, bestGaps = Infinity, bestReclaim = Infinity;
    for (let z = 0; z < totalStates; z++) {
      if (dp[z] === -1) continue;
      const state = decodeState_(z);
      let totalGaps = 0;
      let reclaim = 0;
      typesOrder.forEach((t, idx) => {
        const gapsOfType = state[2 * idx + 1];
        totalGaps += gapsOfType;
        reclaim += Math.max(0, gapsOfType - freeByType[idx]);
      });
      const better = dp[z] > bestCount
        || (dp[z] === bestCount && totalGaps < bestGaps)
        || (dp[z] === bestCount && totalGaps === bestGaps && reclaim < bestReclaim);
      if (better) { bestZ = z; bestCount = dp[z]; bestGaps = totalGaps; bestReclaim = reclaim; }
    }

    if (bestZ !== -1) {
      let cur = bestZ;
      for (let i = dpItems.length - 1; i >= 0; i--) {
        if (takeTables[i][cur]) {
          selectedSet[dpItems[i].bm.beneficiaryId] = true;
          cur -= itemOffset_(dpItems[i]);
        }
      }
    }
  }

  // -------- بناء الخطة الفعلية للمستفيدين المختارين (قرار عالمي واحد) --------
  // لكل مستفيد مختار: الأنواع التي يحملها بالفعل ("جهاز جاهز") تبقى دون
  // أي مسّ (القسم 1(ب) — حافظ على الروابط الحالية قدر الإمكان)؛ فقط
  // الأنواع الناقصة تحتاج تخصيصًا: من المخزون الحرّ أولًا، وإلا من جهاز
  // جاهز يخصّ مستفيدًا **غير مختار** فقط (البرهان الرياضي أعلاه يضمن أن
  // هذا المصدر يكفي دائمًا لكل الفجوات بالضبط بلا نقص).
  const selectedItems = dpItems.filter(it => selectedSet[it.bm.beneficiaryId]);
  function pickForGap_(type) {
    const free = freePool[type] || [];
    if (free.length) return {device: free.shift(), reclaimed: false};
    const ready = readyPool[type] || [];
    for (let i = 0; i < ready.length; i++) {
      if (selectedSet[ready[i].sourceBeneficiaryId]) continue; // محجوز لصاحبه المختار أصلًا — لا يُنتزع منه أبدًا
      const candidate = ready.splice(i, 1)[0];
      return {device: candidate.device, reclaimed: true, sourceBeneficiaryId: candidate.sourceBeneficiaryId, sourceNeedId: candidate.sourceNeedId, sourceNeedModel: candidate.sourceNeedModel};
    }
    return null;
  }

  selectedItems.forEach(item => {
    const bm = item.bm;
    bm.needs.forEach(n => {
      if (n.linkedDevice) {
        // بالفعل "جهاز جاهز" لهذا المستفيد نفسه — يبقى كما هو، فقط
        // ينتقل جماعيًا إلى "بانتظار تعيين مندوب" (ما لم يكن هناك أصلًا،
        // حالة نظرية هامشية لا تحتاج خطة إطلاقًا).
        if (n.fulfillment === 'جهاز جاهز') {
          needPlans.push({needId: n.needId, fromStatus: 'جهاز جاهز', toStatus: 'بانتظار تعيين مندوب', kind: 'group-complete'});
        }
        return;
      }
      const pick = pickForGap_(n.type);
      if (!pick) {
        // لن يحدث رياضيًا إن كانت DP صحيحة — خطأ سلامة داخلي دفاعي، لا كتابة جزئية.
        throw new Error('عطل داخلي في محرك التخصيص: تعذّر إيجاد جهاز لفجوة مضمونة رياضيًا (نوع ' + n.type + ' للاحتياج ' + n.needId + ')');
      }
      n.linkedDevice = pick.device;
      devicePlans.push({
        deviceId: String(pick.device['رقم الجهاز']), type: n.type,
        toBeneficiaryId: bm.beneficiaryId, toNeedId: n.needId,
        reclaimed: pick.reclaimed, sourceBeneficiaryId: pick.sourceBeneficiaryId, sourceNeedId: pick.sourceNeedId
      });
      if (pick.reclaimed) {
        // Phase 3.1.1 (القسم 1): تحديث نموذج احتياج المصدر فورًا — يمنع
        // اعتباره جاهزًا خطأً لاحقًا رغم انتقال جهازه فعليًا لغيره.
        pick.sourceNeedModel.linkedDevice = null;
        pick.sourceNeedModel.fulfillment = 'بانتظار توفر الجهاز';
        needPlans.push({needId: pick.sourceNeedId, fromStatus: 'جهاز جاهز', toStatus: 'بانتظار توفر الجهاز', kind: 'unlink'});
      }
      needPlans.push({needId: n.needId, fromStatus: n.fulfillment, toStatus: 'بانتظار تعيين مندوب', kind: 'link-complete'});
    });
    completedBeneficiaryIds[bm.beneficiaryId] = true;
  });

  // -------- المرحلة الأخيرة: تخصيص جزئي لمن لم يكتمل (مخزون حرّ متبقٍّ فقط، بلا استرجاع) --------
  // القسم 5 (Phase 3.1 الأصلي): الاسترجاع مخصَّص حصرًا لتمكين إكمال —
  // لا يُستخدَم إطلاقًا لتوزيع جزئي أعمى على من لم يُختَر ضمن الحل الأمثل.
  beneficiaryModels.forEach(bm => {
    if (completedBeneficiaryIds[bm.beneficiaryId]) return;
    bm.needs.forEach(n => {
      if (n.linkedDevice) return;
      const free = freePool[n.type] || [];
      if (!free.length) return;
      const device = free.shift();
      n.linkedDevice = device;
      devicePlans.push({deviceId: String(device['رقم الجهاز']), type: n.type, toBeneficiaryId: bm.beneficiaryId, toNeedId: n.needId, reclaimed: false});
      needPlans.push({needId: n.needId, fromStatus: n.fulfillment, toStatus: 'جهاز جاهز', kind: 'link'});
    });
  });

  return {
    devicePlans: devicePlans, needPlans: needPlans,
    summary: {
      completedBeneficiaryCount: Object.keys(completedBeneficiaryIds).length,
      deviceMoveCount: devicePlans.length,
      reclaimCount: devicePlans.filter(p => p.reclaimed).length
    }
  };
}

/**
 * يتحقق كل خطة انتقال احتياج عبر مسار StateRules الصريح المطابق لنوعها
 * (نفس نمط commitDeviceWithNeed_ حرفيًا)، ثم Phase 3.1.1 (القسم 1):
 * يرفض أي خطط متعارضة (أكثر من خطة نهائية لنفس الاحتياج أو الجهاز) وأي
 * احتياج سينتهي بحالة "جهاز جاهز"/"بانتظار تعيين مندوب" بلا جهاز صحيح
 * مرتبط فعليًا — كل ذلك **قبل أول كتابة**، بلا استثناء.
 */
function validateAutoAllocationPlan_(plan) {
  const needIdSeen = {};
  plan.needPlans.forEach(p => {
    if (needIdSeen[p.needId]) {
      throw new Error('خطة تخصيص تلقائي متعارضة: أكثر من خطة نهائية لنفس الاحتياج ' + p.needId);
    }
    needIdSeen[p.needId] = true;
  });
  const deviceIdSeen = {};
  plan.devicePlans.forEach(p => {
    if (deviceIdSeen[p.deviceId]) {
      throw new Error('خطة تخصيص تلقائي متعارضة: أكثر من خطة نهائية لنفس الجهاز ' + p.deviceId);
    }
    deviceIdSeen[p.deviceId] = true;
  });
  const deviceTargetByNeed = {};
  plan.devicePlans.forEach(p => { deviceTargetByNeed[p.toNeedId] = p.deviceId; });

  plan.needPlans.forEach(p => {
    if (p.kind === 'link') assertDeviceLinkFulfillment_(p.fromStatus);
    else if (p.kind === 'unlink') assertDeviceUnlinkFulfillment_(p.fromStatus);
    else if (p.kind === 'group-complete') assertGroupCompletionFulfillment_(p.fromStatus);
    else if (p.kind === 'link-complete') assertLinkAndGroupCompleteFulfillment_(p.fromStatus);
    else throw new Error('نوع خطة تخصيص تلقائي غير معروف: ' + p.kind);

    if (p.toStatus === 'جهاز جاهز' || p.toStatus === 'بانتظار تعيين مندوب') {
      const hasNewDevice = !!deviceTargetByNeed[p.needId];
      // group-complete وحدها مسموح لها بلا جهاز جديد ضمن هذه الخطة —
      // جهازها كان مرتبطًا فعليًا مسبقًا (ولم يُفكّ ضمن نفس الخطة، وإلا
      // لكان needIdSeen أعلاه رفض التعارض على نفس الاحتياج أصلًا).
      if (!hasNewDevice && p.kind !== 'group-complete') {
        throw new Error('خطة تخصيص تلقائي غير سليمة: الاحتياج ' + p.needId + ' سينتهي بحالة «' + p.toStatus + '» بلا جهاز مرتبط فعليًا');
      }
    }
  });
}

/**
 * يكتب خطة كاملة كمعاملة واحدة: كل انتقالات الاحتياجات أولًا
 * (attempted-before-write)، ثم كل حركات الأجهزة أخيرًا. عند أي فشل:
 * تراجع best-effort لكل ما جرت "محاولة" كتابته فعليًا، بلقطات خام
 * سابقة، وتقرير traceId عند فشل التراجع نفسه جزئيًا — نفس مبدأ
 * commitDeviceWithNeed_/reviewBeneficiaryNeeds_ حرفيًا.
 */
function commitAutoAllocationPlan_(user, associationId, plan) {
  if (!plan.needPlans.length && !plan.devicePlans.length) return {ok: true, moved: 0};

  const needSnapshots = {};
  plan.needPlans.forEach(p => {
    const row = findById_(APP.sheets.beneficiaryNeeds, 'رقم الاحتياج', p.needId);
    needSnapshots[p.needId] = {'حالة التنفيذ': row['حالة التنفيذ'], 'آخر تحديث': row['آخر تحديث']};
  });
  const deviceSnapshots = {};
  plan.devicePlans.forEach(p => {
    const row = findById_(APP.sheets.devices, 'رقم الجهاز', p.deviceId);
    deviceSnapshots[p.deviceId] = {'رقم المستفيد': row['رقم المستفيد'], 'رقم الاحتياج': row['رقم الاحتياج'], 'حالة الجهاز': row['حالة الجهاز']};
  });

  const needsWritten = [];
  const devicesWritten = [];
  const nowStamp = now_();
  try {
    plan.needPlans.forEach(p => {
      needsWritten.push(p.needId);
      updateById_(APP.sheets.beneficiaryNeeds, 'رقم الاحتياج', p.needId, {'حالة التنفيذ': p.toStatus, 'آخر تحديث': nowStamp});
    });
    plan.devicePlans.forEach(p => {
      devicesWritten.push(p.deviceId);
      updateById_(APP.sheets.devices, 'رقم الجهاز', p.deviceId, {'رقم المستفيد': p.toBeneficiaryId, 'رقم الاحتياج': p.toNeedId, 'حالة الجهاز': 'مخصص'});
    });
  } catch (writeError) {
    const restored = [];
    const failedToRestore = [];
    devicesWritten.forEach(id => {
      try { updateById_(APP.sheets.devices, 'رقم الجهاز', id, deviceSnapshots[id]); restored.push('device:' + id); }
      catch (e) { failedToRestore.push('device:' + id + ' (' + e.message + ')'); }
    });
    needsWritten.forEach(id => {
      try { updateById_(APP.sheets.beneficiaryNeeds, 'رقم الاحتياج', id, needSnapshots[id]); restored.push('need:' + id); }
      catch (e) { failedToRestore.push('need:' + id + ' (' + e.message + ')'); }
    });
    const traceId = requestMeta_().traceId;
    if (failedToRestore.length) {
      Logger.log('حرج جدًا: فشل تراجع جزئي في محرك التخصيص التلقائي — traceId=' + traceId
        + ' associationId=' + associationId + ' — أُعيدت: [' + restored.join('، ') + '] — تعذّر إعادة: [' + failedToRestore.join('، ') + '] — خطأ الكتابة الأصلي: ' + writeError.message);
      throw new Error('تعذّر إتمام التخصيص التلقائي (traceId: ' + traceId + ') — تعذّر التراجع الكامل، يتطلب مراجعة يدوية فورية للسجلات: ' + failedToRestore.map(s => s.split(' (')[0]).join('، '));
    }
    throw new Error('تعذّر إتمام التخصيص التلقائي (traceId: ' + traceId + ') — أُعيدت كل السجلات المتأثرة لحالتها السابقة تلقائيًا.');
  }

  clearDashboardCache();
  // القسم 6: كل تخصيص أو فك أو إعادة موازنة يُسجَّل في audit بمعرفات فقط.
  plan.devicePlans.forEach(p => {
    try {
      const notes = p.reclaimed
        ? ('نقل من مستفيد ' + p.sourceBeneficiaryId + ' (احتياج ' + p.sourceNeedId + ') إلى مستفيد ' + p.toBeneficiaryId + ' (احتياج ' + p.toNeedId + ')')
        : ('تخصيص تلقائي لمستفيد ' + p.toBeneficiaryId + ' (احتياج ' + p.toNeedId + ')');
      audit_(user, p.reclaimed ? 'إعادة موازنة تخصيص تلقائي' : 'تخصيص تلقائي', 'الأجهزة', p.deviceId, notes);
    } catch (auditError) {
      Logger.log('تحذير: فشل تسجيل عملية تخصيص تلقائي بعد نجاحها فعليًا — traceId=' + requestMeta_().traceId + ' deviceId=' + p.deviceId + ' — ' + auditError.message);
    }
  });

  return {ok: true, moved: plan.devicePlans.length};
}

/**
 * نقطة الدخول الوحيدة المُستدعاة من الخارج (ReceiptBatches.gs بعد تأكيد
 * محضر، BeneficiaryNeeds.gs بعد اعتماد احتياجات) — تخطيط ثم تحقّق ثم
 * كتابة واحدة، كلها **داخل قفل ممسوك مسبقًا من المستدعي** (لا تُمسك أي
 * قفل بنفسها، ولا تُستدعى مباشرة من أي endpoint عام).
 */
function runAutoAllocation_(associationId, user) {
  associationId = String(associationId || '');
  if (!associationId) return {ok: true, moved: 0};
  invalidateTableCache_(APP.sheets.associations);
  invalidateTableCache_(APP.sheets.beneficiaries);
  invalidateTableCache_(APP.sheets.beneficiaryNeeds);
  invalidateTableCache_(APP.sheets.devices);
  // Phase 3.1.1 (القسم 7): جمعية غير نشطة لا يُشغَّل لها تخصيص تلقائي
  // إطلاقًا — إعادة تحقّق داخل القفل الممسوك مسبقًا من المستدعي (لا
  // تُمسك قفلًا هنا). تخطٍّ صامت (لا رمي استثناء) لأن هذا مسار داخلي
  // معزول أصلًا يُستدعى دائمًا بعد نجاح عملية أخرى (تأكيد محضر أو اعتماد
  // احتياجات) — فشله لا يجوز أن يظهر كخطأ لتلك العملية الناجحة فعليًا.
  const assoc = findById_(APP.sheets.associations, 'رقم الجمعية', associationId);
  if (!assoc || String(assoc['الحالة']) !== 'نشطة') return {ok: true, moved: 0, skipped: 'inactive-association'};
  const plan = planAutoAllocation_(associationId);
  if (!plan.devicePlans.length && !plan.needPlans.length) return {ok: true, moved: 0};
  validateAutoAllocationPlan_(plan);
  return commitAutoAllocationPlan_(user, associationId, plan);
}
