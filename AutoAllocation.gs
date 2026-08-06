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
  // تجارية ولا FIFO.
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

  // -------- Phase 3.1.1 (القسم 2): تعظيم عدد الطلبيات المكتملة فعليًا --------
  // خوارزمية greedy السابقة (ترتيب حسب missingCount/id فقط) لم تكن تضمن
  // أكبر عدد ممكن من الطلبيات المكتملة (مثال ب/ج الإلزامي في الطلب: كان
  // من الممكن أن تُستهلك الثلاجة الوحيدة على "أ" فيبقى الفرن مهدورًا).
  // بما أن كل مستفيد يطلب صفرًا أو واحدًا من كل نوع من الأنواع الثلاثة
  // فقط (لا يوجد أكثر من صف احتياج واحد لكل نوع لكل مستفيد)، فإن نمط
  // الطلب محصور في 7 أنماط غير فارغة كحد أقصى — هذا يجعل مسألة "أكبر
  // عدد طلبيات مكتملة من المخزون الحرّ فقط (بلا استرجاع)" قابلة للحل
  // حصريًا وحتميًا عبر برمجة ديناميكية 0/1 knapsack بثلاثة أبعاد (سعة كل
  // نوع)، بدل التخمين الجشع. تُستخدَم فقط للمخزون الحرّ (لا استرجاع هنا
  // — الاسترجاع يبقى مرحلة لاحقة منفصلة كما كان، انظر أدناه).
  const typesOrder = NEW_NEED_DEVICE_TYPES; // ['ثلاجة', 'فرن', 'غسالة'] — ترتيب ثابت لأبعاد الخوارزمية
  const dpItems = beneficiaryModels
    .filter(bm => bm.needs.some(n => !n.linkedDevice))
    .map(bm => {
      const missingTypes = Array.from(new Set(bm.needs.filter(n => !n.linkedDevice).map(n => n.type)));
      return {bm: bm, cost: typesOrder.map(t => (missingTypes.indexOf(t) !== -1 ? 1 : 0))};
    })
    .sort((x, y) => (x.bm.beneficiaryId < y.bm.beneficiaryId ? -1 : (x.bm.beneficiaryId > y.bm.beneficiaryId ? 1 : 0)));

  const totalDemand = typesOrder.map((t, idx) => dpItems.reduce((sum, it) => sum + it.cost[idx], 0));
  const caps = typesOrder.map((t, idx) => Math.min((freePool[t] || []).length, totalDemand[idx]));
  // حارس أداء: حجم جدول DP محدود عمليًا (حجم الدفعات الواقعي لهذا
  // المشروع صغير) — تجاوز هذا السقف (نادر جدًا) يتراجع بأمان لعدم تفعيل
  // مرحلة DP إطلاقًا (لا يعطّل أي شيء، فقط يترك الإكمال بالكامل لمرحلة
  // الاسترجاع الجشعة التالية القائمة أصلًا).
  const dpFeasible = dpItems.length > 0 && (caps[0] + 1) * (caps[1] + 1) * (caps[2] + 1) * dpItems.length <= 2000000;
  const dpSelectedIds = {};
  if (dpFeasible) {
    const capA = caps[0], capB = caps[1], capC = caps[2];
    let dp = [];
    for (let a = 0; a <= capA; a++) {
      dp[a] = [];
      for (let b = 0; b <= capB; b++) dp[a][b] = new Array(capC + 1).fill(0);
    }
    const choices = [];
    dpItems.forEach(item => {
      const cA = item.cost[0], cB = item.cost[1], cC = item.cost[2];
      const take = [];
      for (let a = 0; a <= capA; a++) {
        take[a] = [];
        for (let b = 0; b <= capB; b++) take[a][b] = new Array(capC + 1).fill(false);
      }
      for (let a = capA; a >= 0; a--) {
        for (let b = capB; b >= 0; b--) {
          for (let c = capC; c >= 0; c--) {
            const na = a - cA, nb = b - cB, nc = c - cC;
            if (na >= 0 && nb >= 0 && nc >= 0) {
              const withItem = dp[na][nb][nc] + 1;
              if (withItem > dp[a][b][c]) { dp[a][b][c] = withItem; take[a][b][c] = true; }
            }
          }
        }
      }
      choices.push(take);
    });
    let a = capA, b = capB, c = capC;
    for (let i = dpItems.length - 1; i >= 0; i--) {
      if (choices[i][a][b][c]) {
        dpSelectedIds[dpItems[i].bm.beneficiaryId] = true;
        a -= dpItems[i].cost[0]; b -= dpItems[i].cost[1]; c -= dpItems[i].cost[2];
      }
    }
  }

  // إكمال المستفيدين الذين اختارتهم DP من المخزون الحرّ فقط — يحافظ هذا
  // تلقائيًا على أي جهاز مرتبط أصلًا بالمستفيد (لا يُمَس إطلاقًا، فقط
  // الاحتياجات الناقصة تأخذ أجهزة جديدة)، ويُقفَل هؤلاء المستفيدون خارج
  // مرحلة الاسترجاع التالية (أجهزتهم — الجديدة والقديمة معًا — لم تعد
  // قابلة للاسترجاع لغيرهم بعد اكتمال طلبيتهم بالكامل).
  dpItems.forEach(item => {
    if (!dpSelectedIds[item.bm.beneficiaryId]) return;
    const bm = item.bm;
    const missing = bm.needs.filter(n => !n.linkedDevice);
    missing.forEach(n => {
      const device = (freePool[n.type] || []).shift();
      n.linkedDevice = device;
      devicePlans.push({deviceId: String(device['رقم الجهاز']), type: n.type, toBeneficiaryId: bm.beneficiaryId, toNeedId: n.needId, reclaimed: false});
      needPlans.push({needId: n.needId, fromStatus: n.fulfillment, toStatus: 'بانتظار تعيين مندوب', kind: 'link-complete'});
    });
    bm.needs.forEach(n => {
      if (missing.indexOf(n) === -1 && n.fulfillment === 'جهاز جاهز') {
        needPlans.push({needId: n.needId, fromStatus: 'جهاز جاهز', toStatus: 'بانتظار تعيين مندوب', kind: 'group-complete'});
      }
    });
    completedBeneficiaryIds[bm.beneficiaryId] = true;
  });

  // -------- الاسترجاع (reclaim) بين طلبيات لم تكتمل من المخزون الحرّ وحده --------
  // مبنية فقط من مستفيدين لم يكتملوا بعد عبر DP أعلاه — أجهزة المستفيدين
  // المكتملين مقفَلة، لا تدخل مصدر استرجاع لأي أحد آخر بعد اكتمالهم.
  const reclaimPool = {};
  beneficiaryModels.forEach(bm => {
    if (completedBeneficiaryIds[bm.beneficiaryId]) return;
    bm.needs.forEach(n => {
      if (n.fulfillment === 'جهاز جاهز' && n.linkedDevice) {
        (reclaimPool[n.type] = reclaimPool[n.type] || []).push({device: n.linkedDevice, sourceBeneficiaryId: bm.beneficiaryId, sourceNeedId: n.needId, sourceNeedModel: n});
      }
    });
  });
  Object.keys(reclaimPool).forEach(t => reclaimPool[t].sort((a, b) => String(a.device['رقم الجهاز']).localeCompare(String(b.device['رقم الجهاز']))));

  function pickDevice_(type, excludeBeneficiaryId) {
    const free = freePool[type] || [];
    if (free.length) return {device: free.shift(), reclaimed: false};
    const reclaim = reclaimPool[type] || [];
    for (let i = 0; i < reclaim.length; i++) {
      if (reclaim[i].sourceBeneficiaryId === excludeBeneficiaryId) continue;
      const candidate = reclaim.splice(i, 1)[0];
      return {device: candidate.device, reclaimed: true, sourceBeneficiaryId: candidate.sourceBeneficiaryId, sourceNeedId: candidate.sourceNeedId, sourceNeedModel: candidate.sourceNeedModel};
    }
    return null;
  }
  function releaseDevice_(type, pick) {
    if (pick.reclaimed) {
      (reclaimPool[type] = reclaimPool[type] || []).unshift({device: pick.device, sourceBeneficiaryId: pick.sourceBeneficiaryId, sourceNeedId: pick.sourceNeedId, sourceNeedModel: pick.sourceNeedModel});
    } else {
      (freePool[type] = freePool[type] || []).unshift(pick.device);
    }
  }

  // -------- المرحلة الأولى (استرجاع): إكمال طلبيات كاملة فقط (ذرّي لكل مستفيد) --------
  beneficiaryModels.forEach(bm => {
    if (completedBeneficiaryIds[bm.beneficiaryId]) return;
    const missing = bm.needs.filter(n => !n.linkedDevice);
    if (!missing.length) return;
    const picks = [];
    let ok = true;
    for (let i = 0; i < missing.length; i++) {
      const need = missing[i];
      const pick = pickDevice_(need.type, bm.beneficiaryId);
      if (!pick) { ok = false; break; }
      picks.push({need: need, pick: pick});
    }
    if (!ok) {
      picks.forEach(p => releaseDevice_(p.need.type, p.pick));
      return;
    }
    picks.forEach(p => {
      p.need.linkedDevice = p.pick.device;
      devicePlans.push({
        deviceId: String(p.pick.device['رقم الجهاز']), type: p.need.type,
        toBeneficiaryId: bm.beneficiaryId, toNeedId: p.need.needId,
        reclaimed: p.pick.reclaimed, sourceBeneficiaryId: p.pick.sourceBeneficiaryId, sourceNeedId: p.pick.sourceNeedId
      });
      if (p.pick.reclaimed) {
        // Phase 3.1.1 (القسم 1): يجب تحديث نموذج احتياج المصدر فورًا —
        // وإلا تبقى حالته القديمة "جهاز جاهز" ظاهرة لبقية هذه الدورة،
        // فيُحسَب خطأً ضمن اكتمال جماعي (group-complete) رغم أن جهازه
        // انتقل فعليًا لمستفيد آخر (بالضبط سيناريو أ/ب الإلزامي في الطلب).
        p.pick.sourceNeedModel.linkedDevice = null;
        p.pick.sourceNeedModel.fulfillment = 'بانتظار توفر الجهاز';
        needPlans.push({needId: p.pick.sourceNeedId, fromStatus: 'جهاز جاهز', toStatus: 'بانتظار توفر الجهاز', kind: 'unlink'});
      }
      // القسم 4 مثال إلزامي: الاحتياج المُكمِل لطلبية مستفيد يصل مباشرة
      // إلى "بانتظار تعيين مندوب" ضمن نفس الخطة — لا يتوقف عند "جهاز جاهز".
      needPlans.push({needId: p.need.needId, fromStatus: p.need.fulfillment, toStatus: 'بانتظار تعيين مندوب', kind: 'link-complete'});
    });
    // بقية احتياجات المستفيد التي كانت "جهاز جاهز" مسبقًا (لم تحتج جهازًا جديدًا) تكتمل معه جماعيًا الآن أيضًا.
    bm.needs.forEach(n => {
      if (missing.indexOf(n) === -1 && n.fulfillment === 'جهاز جاهز') {
        needPlans.push({needId: n.needId, fromStatus: 'جهاز جاهز', toStatus: 'بانتظار تعيين مندوب', kind: 'group-complete'});
      }
    });
    completedBeneficiaryIds[bm.beneficiaryId] = true;
  });

  // -------- المرحلة الثانية: تخصيص جزئي للأجهزة المتبقية (بلا استرجاع) --------
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
