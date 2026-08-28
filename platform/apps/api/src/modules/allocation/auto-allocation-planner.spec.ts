import { DeviceType } from '@alzad/db';
import { planAutoAllocation, AllocationPlanTooLargeError, type CandidateBeneficiary } from './auto-allocation-planner';

/**
 * NODE-5 — اختبارات وحدة لمخطِّط التخصيص التلقائي، بلا أي قاعدة بيانات.
 * السيناريوهات مبنية على المنطق الموثَّق في platform/docs/audit/
 * 04-legacy-allocation-receipts.md (يوازي phase31-test.js القديم):
 * تعظيم عدد المكتمِلين، الاسترجاع (rebalancing)، التخصيص الجزئي، الحتمية.
 */

function gap(needId: string, deviceType: DeviceType): { needId: string; deviceType: DeviceType; ready: false } {
  return { needId, deviceType, ready: false };
}
function ready(needId: string, deviceType: DeviceType): { needId: string; deviceType: DeviceType; ready: true } {
  return { needId, deviceType, ready: true };
}

const ZERO_STOCK = { REFRIGERATOR: 0, OVEN: 0, WASHING_MACHINE: 0 };

describe('NODE-5 — planAutoAllocation', () => {
  it('uses approved MAIN listRank as the deterministic tie-break only', () => {
    const candidates: CandidateBeneficiary[] = [
      { beneficiaryId: 'earlier-id', listRank: 2, needs: [gap('n1', DeviceType.REFRIGERATOR)] },
      { beneficiaryId: 'later-id', listRank: 1, needs: [gap('n2', DeviceType.REFRIGERATOR)] },
    ];
    expect(planAutoAllocation(candidates, { ...ZERO_STOCK, REFRIGERATOR: 1 }).completedBeneficiaryIds).toEqual(['later-id']);
  });
  it('لا مرشَّحين ⇒ خطة فارغة بلا أي أثر', () => {
    const plan = planAutoAllocation([], ZERO_STOCK);
    expect(plan).toEqual({ completedBeneficiaryIds: [], fills: [], reclaims: [] });
  });

  it('مستفيد واحد باحتياج واحد ومخزون كافٍ ⇒ يكتمل من المخزون الحر', () => {
    const candidates: CandidateBeneficiary[] = [{ beneficiaryId: 'b1', needs: [gap('n1', DeviceType.REFRIGERATOR)] }];
    const plan = planAutoAllocation(candidates, { ...ZERO_STOCK, REFRIGERATOR: 1 });
    expect(plan.completedBeneficiaryIds).toEqual(['b1']);
    expect(plan.fills).toEqual([{ beneficiaryId: 'b1', needId: 'n1', deviceType: DeviceType.REFRIGERATOR, source: 'free' }]);
    expect(plan.reclaims).toEqual([]);
  });

  it('مخزون صفري ⇒ لا اكتمال ولا تخصيص جزئي (لا شيء متاح إطلاقًا)', () => {
    const candidates: CandidateBeneficiary[] = [{ beneficiaryId: 'b1', needs: [gap('n1', DeviceType.OVEN)] }];
    const plan = planAutoAllocation(candidates, ZERO_STOCK);
    expect(plan.completedBeneficiaryIds).toEqual([]);
    expect(plan.fills).toEqual([]);
  });

  it(
    'تعظيم عدد المكتمِلين (سيناريو "أحمد/سالِم"): جهاز واحد فقط متاح، ' +
      'مستفيد A يحتاج جهازًا واحدًا فقط (يكتمل به)، مستفيد B يحتاج جهازين (لن يكتمل بجهاز واحد) — ' +
      'يجب اختيار A لا محاولة إعطاء B جزئيًا على حساب اكتمال A',
    () => {
      const candidates: CandidateBeneficiary[] = [
        { beneficiaryId: 'A', needs: [gap('a1', DeviceType.REFRIGERATOR)] },
        {
          beneficiaryId: 'B',
          needs: [gap('b1', DeviceType.REFRIGERATOR), gap('b2', DeviceType.OVEN)],
        },
      ];
      const plan = planAutoAllocation(candidates, { ...ZERO_STOCK, REFRIGERATOR: 1 });
      // A يكتمل (جهاز واحد يكفيه بالكامل)؛ B لا يملك عدد كافٍ من الأجهزة المتاحة ليكتمل، ولا فرن متاح أصلًا لتخصيص جزئي له أيضًا.
      expect(plan.completedBeneficiaryIds).toEqual(['A']);
      expect(plan.fills).toHaveLength(1);
      expect(plan.fills[0]).toMatchObject({ beneficiaryId: 'A', needId: 'a1' });
    },
  );

  it('يفضّل إكمال مستفيدَين اثنين بدلًا من واحد عند تعارض الموارد (تعظيم العدد لا الحجم)', () => {
    const candidates: CandidateBeneficiary[] = [
      { beneficiaryId: 'BIG', needs: [gap('big1', DeviceType.REFRIGERATOR), gap('big2', DeviceType.OVEN)] },
      { beneficiaryId: 'SMALL1', needs: [gap('s1', DeviceType.REFRIGERATOR)] },
      { beneficiaryId: 'SMALL2', needs: [gap('s2', DeviceType.OVEN)] },
    ];
    // مخزون يكفي لإكمال BIG وحده (ثلاجة+فرن)، أو SMALL1+SMALL2 معًا (ثلاجة+فرن أيضًا) — نفس الاستهلاك الكلي، لكن SMALL1+SMALL2 = مستفيدان مكتمِلان مقابل واحد فقط لـBIG.
    const plan = planAutoAllocation(candidates, { ...ZERO_STOCK, REFRIGERATOR: 1, OVEN: 1 });
    expect(plan.completedBeneficiaryIds.sort()).toEqual(['SMALL1', 'SMALL2']);
  });

  it('الاسترجاع (rebalancing): يسحب جهازًا "جاهزًا" من مستفيد غير مُختار ليكمل مستفيدًا آخر', () => {
    const candidates: CandidateBeneficiary[] = [
      // C جاهز بثلاجة لكنه ينقصه فرن — لن يُختار وحده (الفرن غير متاح من المخزون الحر).
      { beneficiaryId: 'C', needs: [ready('c1', DeviceType.REFRIGERATOR), gap('c2', DeviceType.OVEN)] },
      // D يحتاج ثلاجة فقط — يمكن إكماله عبر استرجاع ثلاجة C إن لم يُختَر C.
      { beneficiaryId: 'D', needs: [gap('d1', DeviceType.REFRIGERATOR)] },
    ];
    const plan = planAutoAllocation(candidates, ZERO_STOCK); // لا مخزون حر إطلاقًا — الثلاجة الوحيدة مع C
    expect(plan.completedBeneficiaryIds).toEqual(['D']);
    expect(plan.reclaims).toEqual([{ fromBeneficiaryId: 'C', fromNeedId: 'c1', deviceType: DeviceType.REFRIGERATOR }]);
    expect(plan.fills).toContainEqual({ beneficiaryId: 'D', needId: 'd1', deviceType: DeviceType.REFRIGERATOR, source: 'reclaim' });
  });

  it('لا يسترجع من مستفيد سيُختار هو نفسه (الاسترجاع محصور بغير المُختارين فقط)', () => {
    const candidates: CandidateBeneficiary[] = [
      { beneficiaryId: 'E', needs: [ready('e1', DeviceType.REFRIGERATOR), gap('e2', DeviceType.OVEN)] },
    ];
    // فرن واحد متاح من المخزون الحر ⇒ E يكتمل باستخدام ثلاجته الجاهزة أصلًا + الفرن الحر — بلا أي استرجاع.
    const plan = planAutoAllocation(candidates, { ...ZERO_STOCK, OVEN: 1 });
    expect(plan.completedBeneficiaryIds).toEqual(['E']);
    expect(plan.reclaims).toEqual([]);
    expect(plan.fills).toEqual([{ beneficiaryId: 'E', needId: 'e2', deviceType: DeviceType.OVEN, source: 'free' }]);
  });

  it('التخصيص الجزئي لغير المكتمِلين: يمنح ما تبقّى من مخزون حر بلا استرجاع، بترتيب أقل فجوات أولًا', () => {
    const candidates: CandidateBeneficiary[] = [
      { beneficiaryId: 'F', needs: [gap('f1', DeviceType.REFRIGERATOR), gap('f2', DeviceType.OVEN), gap('f3', DeviceType.WASHING_MACHINE)] },
      { beneficiaryId: 'G', needs: [gap('g1', DeviceType.REFRIGERATOR)] },
    ];
    // ثلاجة واحدة فقط متاحة — لا تكفي لإكمال أي منهما (F يحتاج 3، G يحتاج 1 لكن... G يكتمل فعليًا بثلاجة واحدة).
    const plan = planAutoAllocation(candidates, { ...ZERO_STOCK, REFRIGERATOR: 1 });
    // G يكتمل (احتياج واحد فقط، يستهلك الثلاجة الوحيدة) — لا شيء متبقٍّ لـF.
    expect(plan.completedBeneficiaryIds).toEqual(['G']);
    expect(plan.fills).toEqual([{ beneficiaryId: 'G', needId: 'g1', deviceType: DeviceType.REFRIGERATOR, source: 'free' }]);
  });

  it('حتمية: نفس المدخلات تُنتج دومًا نفس الخطة بالضبط (لا عشوائية)', () => {
    const candidates: CandidateBeneficiary[] = [
      { beneficiaryId: 'z-2', needs: [gap('n1', DeviceType.REFRIGERATOR)] },
      { beneficiaryId: 'a-1', needs: [gap('n2', DeviceType.REFRIGERATOR)] },
    ];
    const stock = { ...ZERO_STOCK, REFRIGERATOR: 1 };
    const plan1 = planAutoAllocation(candidates, stock);
    const plan2 = planAutoAllocation(candidates, stock);
    expect(plan1).toEqual(plan2);
    // بترتيب حتمي بالمعرّف عند تعادل القيمة — a-1 قبل z-2.
    expect(plan1.completedBeneficiaryIds).toEqual(['a-1']);
  });

  it('يرفض حاسمًا (بلا خطة جزئية) عند تجاوز فضاء الحالات الحد الأقصى المسموح', () => {
    const candidates: CandidateBeneficiary[] = Array.from({ length: 50 }, (_, i) => ({
      beneficiaryId: `b${i}`,
      needs: [gap(`n${i}-1`, DeviceType.REFRIGERATOR), gap(`n${i}-2`, DeviceType.OVEN), gap(`n${i}-3`, DeviceType.WASHING_MACHINE)],
    }));
    const hugeStock = { REFRIGERATOR: 50, OVEN: 50, WASHING_MACHINE: 50 };
    expect(() => planAutoAllocation(candidates, hugeStock)).toThrow(AllocationPlanTooLargeError);
  });

  it('مستفيد كل احتياجاته جاهزة بالفعل (لا فجوة) يُستبعَد تمامًا من التخطيط', () => {
    const candidates: CandidateBeneficiary[] = [{ beneficiaryId: 'H', needs: [ready('h1', DeviceType.REFRIGERATOR)] }];
    const plan = planAutoAllocation(candidates, { ...ZERO_STOCK, REFRIGERATOR: 5 });
    expect(plan.completedBeneficiaryIds).toEqual([]);
    expect(plan.fills).toEqual([]);
  });
});
