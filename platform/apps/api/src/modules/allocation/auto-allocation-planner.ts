import { DeviceType } from '@alzad/db';

/**
 * ============================================================
 * محرّك تخطيط التخصيص التلقائي — NODE-5 (يوازي AutoAllocation.gs Legacy)
 * ============================================================
 *
 * دالة نقية بلا أي I/O — تُختبَر بمعزل تام عن قاعدة البيانات. الخدمة
 * المستدعية (auto-allocation.service.ts) مسؤولة عن القراءة/الكتابة/القفل؛
 * هذا الملف مسؤول فقط عن "من يُخصَّص له ماذا" رياضيًا.
 *
 * ## الهدف (مطابق حرفيًا لِLegacy AutoAllocation.gs — راجع
 * platform/docs/audit/04-legacy-allocation-receipts.md)
 * تعظيم **عدد المستفيدين المكتمَلين بالكامل** (كل احتياجاتهم المعتمدة
 * تصبح "جهاز جاهز" في نفس التشغيلة) — لا الأسبقية الزمنية (FIFO) ولا
 * أولوية جمعية (أصلًا محصور بجمعية واحدة هنا). "الاكتمال الجزئي" لا
 * يُحتسَب في الهدف الأساسي، لكنه يُمنَح لمن تبقّى من مخزون حر بعد ذلك.
 *
 * ## الموارد القابلة لإعادة التوزيع
 * وعاء مورد واحد لكل association+deviceType = المخزون الحر (WAREHOUSE)
 * + كل جهاز "جاهز" (DEVICE_READY) مرتبط حاليًا بمستفيد **لم يُختَر** في
 * الحل الأمثل — الاثنان معًا يُبنيان دفعة واحدة قبل الاختيار، لا مخزونًا
 * حرًا أولًا ثم استرجاعًا جشعًا لاحقًا (القرار نفسه في Legacy، يتجنّب حلولًا
 * أفضل عالميًا كانت ستُفقَد لو تم تجزئة الموردَين).
 *
 * ## الخوارزمية
 * حقيبة 0/1 (knapsack) بثلاثة أبعاد سعة (لاجيًا لكل deviceType الثلاثة) —
 * تعظيم عدد المستفيدين المُكتمَلين. عند تعادل عدة حلول بنفس العدد الأقصى:
 * تُفضَّل الحلول الأقل استهلاكًا للمورد الكلي (تُبقي أكثر للمستقبل)، ثم
 * دومًا بترتيب حتمي (لا عشوائية) لضمان نفس النتيجة عند إعادة التشغيل على
 * نفس المدخلات.
 */

export interface CandidateNeed {
  needId: string;
  deviceType: DeviceType;
  /** true ⇔ fulfillmentStatus الحالي = DEVICE_READY (له جهاز بالفعل، لم يُسلَّم بعد). */
  ready: boolean;
}

export interface CandidateBeneficiary {
  beneficiaryId: string;
  /** فقط الاحتياجات المعتمدة (decisionStatus=APPROVED) غير المبدوء عهدتها. */
  needs: CandidateNeed[];
}

const DEVICE_TYPES: DeviceType[] = [DeviceType.REFRIGERATOR, DeviceType.OVEN, DeviceType.WASHING_MACHINE];

/** الحد الأقصى لحجم فضاء حالات الحقيبة (مطابق لـALLOC-012 في Legacy) — رفض حاسم بلا حل جزئي بدل تعليق العملية. */
const MAX_DP_STATES = 4_000_000;

export class AllocationPlanTooLargeError extends Error {
  constructor() {
    super('حجم مسألة التخصيص كبير جدًا لتشغيلة واحدة — قسّم الدفعة أو راجع الفريق التقني.');
  }
}

export interface DeviceFillInstruction {
  beneficiaryId: string;
  needId: string;
  deviceType: DeviceType;
  /** 'free' = من المخزون الحر مباشرة، 'reclaim' = من جهاز "جاهز" مسحوب من مستفيد آخر لم يُختَر. */
  source: 'free' | 'reclaim';
}

export interface ReclaimInstruction {
  /** المستفيد المتنازِل — لم يُختَر ضمن المكتملين، وأحد أجهزته "الجاهزة" يُعاد لإعادة التوزيع. */
  fromBeneficiaryId: string;
  fromNeedId: string;
  deviceType: DeviceType;
}

export interface AllocationPlan {
  /** المستفيدون الذين اكتملت **كل** احتياجاتهم المعتمدة في هذه التشغيلة (انتقال جماعي لاحقًا: جهاز جاهز → بانتظار تعيين مندوب). */
  completedBeneficiaryIds: string[];
  /** كل ملء جهاز فردي مطلوب (لمكتمِلين أو لتخصيص جزئي لغير المكتمِلين). */
  fills: DeviceFillInstruction[];
  /** كل استرجاع جهاز من مستفيد غير مُختار (الجهاز المُسترجَع نفسه يُعاد ربطه عبر fill بمصدر 'reclaim' بنفس deviceType). */
  reclaims: ReclaimInstruction[];
}

interface InternalCandidate {
  beneficiaryId: string;
  /** فجوة لكل نوع (0 أو 1 — لا يمكن لمستفيد واحد أن يملك أكثر من احتياج واحد لنفس النوع). */
  gap: Record<DeviceType, 0 | 1>;
  totalGap: number;
  readyNeeds: CandidateNeed[];
  gapNeeds: CandidateNeed[];
}

function buildInternalCandidates(candidates: CandidateBeneficiary[]): InternalCandidate[] {
  return candidates
    .map((c) => {
      const gap: Record<DeviceType, 0 | 1> = { REFRIGERATOR: 0, OVEN: 0, WASHING_MACHINE: 0 };
      const readyNeeds: CandidateNeed[] = [];
      const gapNeeds: CandidateNeed[] = [];
      for (const need of c.needs) {
        if (need.ready) readyNeeds.push(need);
        else {
          gap[need.deviceType] = 1;
          gapNeeds.push(need);
        }
      }
      const totalGap = gapNeeds.length;
      return { beneficiaryId: c.beneficiaryId, gap, totalGap, readyNeeds, gapNeeds };
    })
    // ALLOC-003: مستفيد كل احتياجاته جاهزة بالفعل (لا فجوة) مكتمل فعليًا — يُستبعَد من هذه التشغيلة (مسؤولية الخطوة اللاحقة: الانتقال الجماعي فقط).
    .filter((c) => c.totalGap > 0);
}

/**
 * يخطط تشغيلة تخصيص واحدة لجمعية واحدة. لا يقرأ ولا يكتب أي شيء — كل
 * المدخلات ممرَّرة صراحةً، وكل المخرجات وصفية بحتة (الخدمة المستدعية هي
 * من تتحقق من الخطة عبر StateRules الفعلية ثم تكتبها ذرّيًا).
 */
export function planAutoAllocation(candidates: CandidateBeneficiary[], freeStock: Record<DeviceType, number>): AllocationPlan {
  const internal = buildInternalCandidates(candidates);
  if (internal.length === 0) return { completedBeneficiaryIds: [], fills: [], reclaims: [] };
  // ترتيب حتمي **قبل** الحقيبة نفسها: عند تعادل قيمة/وزن بين مرشَّحين، تفضّل إعادة البناء رجوعًا العنصر
  // الأسبق فهرسًا (راجع حلقة الإرجاع أدناه: `withItem > cur[cell]` بمقارنة صارمة تُبقي أول كاتب فائزًا
  // عند التعادل) — الفرز هنا بالمعرّف تصاعديًا يجعل "الفهرس الأسبق" مطابقًا حرفيًا لـ"أصغر معرّف" (ALLOC-004، كسر التعادل الرابع).
  internal.sort((a, b) => a.beneficiaryId.localeCompare(b.beneficiaryId));

  // وعاء الموارد الكلي لكل نوع = مخزون حر + كل الأجهزة "الجاهزة" لدى مرشَّحين (سواء اختِيروا لاحقًا أم لا).
  const readyPoolByType: Record<DeviceType, number> = { REFRIGERATOR: 0, OVEN: 0, WASHING_MACHINE: 0 };
  for (const c of internal) for (const n of c.readyNeeds) readyPoolByType[n.deviceType]++;

  const cap: Record<DeviceType, number> = {
    REFRIGERATOR: Math.min(freeStock.REFRIGERATOR + readyPoolByType.REFRIGERATOR, internal.length),
    OVEN: Math.min(freeStock.OVEN + readyPoolByType.OVEN, internal.length),
    WASHING_MACHINE: Math.min(freeStock.WASHING_MACHINE + readyPoolByType.WASHING_MACHINE, internal.length),
  };

  const stateSpace = (cap.REFRIGERATOR + 1) * (cap.OVEN + 1) * (cap.WASHING_MACHINE + 1) * internal.length;
  if (stateSpace > MAX_DP_STATES) throw new AllocationPlanTooLargeError();

  // dp[i][r][o][w] = أقصى عدد مكتمِلين باستخدام أول i مرشَّحًا وسعة (r,o,w) مستهلَكة كحد أقصى.
  // طبقة كاملة لكل مرشَّح (لا تكرار في المكان) — يلزم لإعادة بناء المختارين بدقة (backtracking حتمي).
  const n = internal.length;
  type Layer = Int16Array; // مفهرسة يدويًا كمصفوفة ثلاثية الأبعاد مسطَّحة
  const dimO = cap.OVEN + 1;
  const dimW = cap.WASHING_MACHINE + 1;
  const idx = (r: number, o: number, w: number) => (r * dimO + o) * dimW + w;
  const layerSize = (cap.REFRIGERATOR + 1) * dimO * dimW;

  const layers: Layer[] = [new Int16Array(layerSize)]; // layers[0] = حالة ابتدائية (لا مرشَّحين بعد)، كلها 0

  for (let i = 0; i < n; i++) {
    const prev = layers[i];
    const cur = new Int16Array(layerSize);
    cur.set(prev);
    const { gap } = internal[i];
    for (let r = gap.REFRIGERATOR; r <= cap.REFRIGERATOR; r++) {
      for (let o = gap.OVEN; o <= cap.OVEN; o++) {
        for (let w = gap.WASHING_MACHINE; w <= cap.WASHING_MACHINE; w++) {
          const withItem = prev[idx(r - gap.REFRIGERATOR, o - gap.OVEN, w - gap.WASHING_MACHINE)] + 1;
          const cell = idx(r, o, w);
          if (withItem > cur[cell]) cur[cell] = withItem;
        }
      }
    }
    layers.push(cur);
  }

  // أفضل خلية عند السعة الكاملة: أقصى عدد، ثم أقل استهلاك كلي (r+o+w) بين المتعادلين، ثم ترتيب حتمي (أصغر r ثم o ثم w).
  const last = layers[n];
  let bestCount = -1;
  let bestUsage = Infinity;
  let bestCell: [number, number, number] = [0, 0, 0];
  for (let r = 0; r <= cap.REFRIGERATOR; r++) {
    for (let o = 0; o <= cap.OVEN; o++) {
      for (let w = 0; w <= cap.WASHING_MACHINE; w++) {
        const count = last[idx(r, o, w)];
        const usage = r + o + w;
        if (count > bestCount || (count === bestCount && usage < bestUsage)) {
          bestCount = count;
          bestUsage = usage;
          bestCell = [r, o, w];
        }
      }
    }
  }

  // إعادة بناء المختارين من الخلية المثلى رجوعًا عبر الطبقات.
  const selected: InternalCandidate[] = [];
  let [r, o, w] = bestCell;
  for (let i = n; i >= 1; i--) {
    const cur = layers[i][idx(r, o, w)];
    const prev = layers[i - 1][idx(r, o, w)];
    if (cur !== prev) {
      const cand = internal[i - 1];
      selected.push(cand);
      r -= cand.gap.REFRIGERATOR;
      o -= cand.gap.OVEN;
      w -= cand.gap.WASHING_MACHINE;
    }
  }
  const selectedIds = new Set(selected.map((c) => c.beneficiaryId));
  // ترتيب حتمي للكتابة (لا يؤثر في اختيار DP نفسه، فقط في ترتيب استهلاك المخزون الفعلي لاحقًا).
  selected.sort((a, b) => a.beneficiaryId.localeCompare(b.beneficiaryId));

  // مِرْجَل استرجاع: أجهزة "جاهزة" لدى مرشَّحين غير مُختارين، مُتاحة للاسترجاع فقط لصالح مُختارين.
  const reclaimPoolByType: Record<DeviceType, ReclaimInstruction[]> = { REFRIGERATOR: [], OVEN: [], WASHING_MACHINE: [] };
  for (const c of internal) {
    if (selectedIds.has(c.beneficiaryId)) continue;
    for (const n2 of c.readyNeeds) {
      reclaimPoolByType[n2.deviceType].push({ fromBeneficiaryId: c.beneficiaryId, fromNeedId: n2.needId, deviceType: n2.deviceType });
    }
  }
  for (const type of DEVICE_TYPES) reclaimPoolByType[type].sort((a, b) => a.fromBeneficiaryId.localeCompare(b.fromBeneficiaryId));

  const remainingFree: Record<DeviceType, number> = { ...freeStock };
  const fills: DeviceFillInstruction[] = [];
  const reclaims: ReclaimInstruction[] = [];

  // خطوة 1 — إكمال المُختارين: المخزون الحر أولًا، ثم الاسترجاع فقط عند نفاد الحر (يقلّل عدد الاسترجاعات الفعلية تلقائيًا).
  for (const cand of selected) {
    for (const need of cand.gapNeeds) {
      const type = need.deviceType;
      if (remainingFree[type] > 0) {
        remainingFree[type]--;
        fills.push({ beneficiaryId: cand.beneficiaryId, needId: need.needId, deviceType: type, source: 'free' });
      } else {
        const donor = reclaimPoolByType[type].shift();
        if (!donor) {
          // لا يجب أن يحدث أبدًا إن كانت السعة الحسابية صحيحة — حراسة صريحة بدل خطأ صامت.
          throw new Error(`تعذّر تنفيذ خطة التخصيص: نفاد مورد ${type} رغم اجتيازها التخطيط — تحقّق من اتساق البيانات.`);
        }
        reclaims.push(donor);
        fills.push({ beneficiaryId: cand.beneficiaryId, needId: need.needId, deviceType: type, source: 'reclaim' });
      }
    }
  }

  // خطوة 2 — تخصيص جزئي لغير المكتمِلين من المخزون الحر المتبقي فقط (بلا استرجاع) — أقل فجوات أولًا، ثم ترتيب حتمي بالمعرّف.
  const leftovers = internal
    .filter((c) => !selectedIds.has(c.beneficiaryId))
    .sort((a, b) => a.totalGap - b.totalGap || a.beneficiaryId.localeCompare(b.beneficiaryId));
  for (const cand of leftovers) {
    for (const need of cand.gapNeeds) {
      const type = need.deviceType;
      if (remainingFree[type] > 0) {
        remainingFree[type]--;
        fills.push({ beneficiaryId: cand.beneficiaryId, needId: need.needId, deviceType: type, source: 'free' });
      }
    }
  }

  return { completedBeneficiaryIds: selected.map((c) => c.beneficiaryId), fills, reclaims };
}
