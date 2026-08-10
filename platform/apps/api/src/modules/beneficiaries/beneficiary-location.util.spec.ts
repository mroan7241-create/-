import { LocationSource, Prisma } from '@alzad/db';
import { buildLocationWrite, canonicalizeLocationIntent, classifyLocationPair } from './beneficiary-location.util';

/**
 * NODE-3.2 — اختبارات وحدة لنيّة الموقع المعيارية (بصمة idempotency).
 *
 * الغرض المحوري: إثبات أن ما يدخل التجزئة **لا يحمل أي أثر للزمن**، بينما
 * أمر الكتابة الفعلي لا يزال يحمله كما بناه NODE-3.1 بالضبط. هذان
 * التأكيدان معًا هما جوهر العطب المُصلَح: الطلب نفسه، لحظتان مختلفتان،
 * بصمة واحدة.
 */
describe('NODE-3.2 — canonicalizeLocationIntent', () => {
  const coords = { lat: 24.7136, lng: 46.6753, locationSource: 'MAP' };

  it('لا يدخل الزمن البصمة إطلاقًا: نفس المُدخَل يُنتج نفس القيمة مهما اختلفت لحظة التنفيذ', () => {
    const early = new Date('2020-01-01T00:00:00.000Z');
    const late = new Date('2030-12-31T23:59:59.999Z');

    // أمر الكتابة الحقيقي **يجب** أن يختلف بالتاريخ (سلوك NODE-3.1 سليم كما هو).
    const writeEarly = buildLocationWrite(coords, null, early);
    const writeLate = buildLocationWrite(coords, null, late);
    expect(writeEarly.locationUpdatedAt).toEqual(early);
    expect(writeLate.locationUpdatedAt).toEqual(late);
    expect(JSON.stringify(writeEarly)).not.toBe(JSON.stringify(writeLate));

    // بينما النيّة المعيارية متطابقة بايتًا ببايت — وهي وحدها ما يُجزَّأ.
    const intentA = canonicalizeLocationIntent(coords);
    const intentB = canonicalizeLocationIntent({ ...coords });
    expect(intentA).toEqual(intentB);
    expect(JSON.stringify(intentA)).toBe(JSON.stringify(intentB));
    expect(JSON.stringify(intentA)).not.toContain('locationUpdatedAt');
    expect(JSON.stringify(intentA)).not.toMatch(/\d{4}-\d{2}-\d{2}T/);
  });

  it('ثلاثة أشكال حصرية: PRESERVE عند الغياب، CLEAR عند null الصريح، SET عند إحداثيات فعلية', () => {
    expect(canonicalizeLocationIntent({})).toEqual({ intent: 'PRESERVE' });
    expect(canonicalizeLocationIntent({ locationSource: 'MAP' })).toEqual({ intent: 'PRESERVE' });
    expect(canonicalizeLocationIntent({ lat: null, lng: null })).toEqual({ intent: 'CLEAR' });
    expect(canonicalizeLocationIntent(coords).intent).toBe('SET');
  });

  it('undefined وnull لا ينطويان في قيمة واحدة — بصمتان مختلفتان حتمًا', () => {
    const preserve = JSON.stringify(canonicalizeLocationIntent({}));
    const clear = JSON.stringify(canonicalizeLocationIntent({ lat: null, lng: null }));
    expect(preserve).not.toBe(clear);
  });

  it('التقريب هو نفسه المستعمَل في قرار «هل تغيّر الموقع؟» — ست خانات، بلا مخطَّط ثانٍ', () => {
    // الخانة السابعة لا تُنتج نيّة مختلفة، تمامًا كما لا تُعَدّ تغييرًا للموقع.
    const a = canonicalizeLocationIntent({ lat: 24.71360004, lng: 46.67530001, locationSource: 'MAP' });
    const b = canonicalizeLocationIntent({ lat: 24.7136, lng: 46.6753, locationSource: 'MAP' });
    expect(a).toEqual(b);

    // ونفس التمثيل الذي يصل القاعدة فعلًا عبر buildLocationWrite.
    const write = buildLocationWrite(coords, null, new Date());
    expect(a).toEqual({
      intent: 'SET',
      lat: (write.latitude as Prisma.Decimal).toFixed(6),
      lng: (write.longitude as Prisma.Decimal).toFixed(6),
      locationSource: LocationSource.MAP,
    });

    // فرق حقيقي على مستوى الخانة السادسة **يُغيّر** النيّة فعلًا.
    expect(canonicalizeLocationIntent({ lat: 24.713601, lng: 46.6753, locationSource: 'MAP' })).not.toEqual(b);
  });

  it('تطبيع المصدر معاد الاستعمال حرفيًا: مجهولان يؤولان إلى MANUAL فيتطابقان، والمعروفان المختلفان لا', () => {
    const unknownA = canonicalizeLocationIntent({ ...coords, locationSource: 'قيمة غير معروفة' });
    const unknownB = canonicalizeLocationIntent({ ...coords, locationSource: 'شيء آخر مجهول تمامًا' });
    // فرق خام بلا فرق دلالي بعد التطبيع ⇒ نيّة واحدة، فلا 409 زائف.
    expect(unknownA).toEqual(unknownB);
    expect(unknownA).toEqual(expect.objectContaining({ locationSource: LocationSource.MANUAL }));

    // التسمية العربية القديمة تُطابِق اسم الـenum الإنجليزي — نفس النيّة.
    expect(canonicalizeLocationIntent({ ...coords, locationSource: 'خريطة' })).toEqual(
      canonicalizeLocationIntent({ ...coords, locationSource: 'MAP' }),
    );

    // فرق دلالي حقيقي بعد التطبيع ⇒ نيّتان مختلفتان.
    expect(canonicalizeLocationIntent({ ...coords, locationSource: 'CURRENT_LOCATION' })).not.toEqual(
      canonicalizeLocationIntent({ ...coords, locationSource: 'MAP' }),
    );
  });

  it('النيّة لا تعتمد على الحالة المخزَّنة — وإلا انقلبت البصمة بعد أول تنفيذ ناجح', () => {
    // نفس المُدخَل، وقد صار مخزَّنًا فعلًا بين الطلبين: النيّة لا تتأثر.
    const stored = { latitude: new Prisma.Decimal('24.713600'), longitude: new Prisma.Decimal('46.675300') };
    expect(buildLocationWrite(coords, stored, new Date())).toEqual({}); // الكتابة تعرف أن شيئًا لم يتغيّر…
    expect(canonicalizeLocationIntent(coords)).toEqual({
      intent: 'SET',
      lat: '24.713600',
      lng: '46.675300',
      locationSource: LocationSource.MAP,
    }); // …والبصمة تبقى كما هي فتنجح إعادة المحاولة.
  });

  it('يرفض إحداثية واحدة دون الأخرى بنفس خطأ مسار الكتابة (لا مسار تحقق موازٍ)', () => {
    expect(() => canonicalizeLocationIntent({ lat: 24.5 })).toThrow(/خط العرض وخط الطول/);
    expect(() => canonicalizeLocationIntent({ lat: 91, lng: 46 })).toThrow();
  });
});

/**
 * NODE-3.3 — تصنيف الزوج `(lat, lng)`.
 *
 * العطب المُصلَح: `undefined` و`null` كانا يُطويان في مفهوم «فارغ» واحد، فكان
 * الزوجان `(null, undefined)` و`(undefined, null)` يُصنَّفان «مسح» — أي **مسح
 * موقع مخزَّن استنادًا إلى طرف واحد فقط** من الطلب. الآن الحالات الصالحة ثلاث
 * بالضبط، والستّ المختلطة كلها مرفوضة، بدالة تصنيف **واحدة** يشترك فيها مسار
 * الكتابة ومسار البصمة معًا.
 */
describe('NODE-3.3 — classifyLocationPair', () => {
  it('الحالات الصالحة الثلاث وحدها تُصنَّف صالحة', () => {
    expect(classifyLocationPair(undefined, undefined)).toBe('PRESERVE');
    expect(classifyLocationPair(null, null)).toBe('CLEAR');
    expect(classifyLocationPair(24.7136, 46.6753)).toBe('SET');
    // الصفر إحداثية فعلية لا «فارغ» — خطّ الاستواء/غرينتش ليسا غيابًا.
    expect(classifyLocationPair(0, 0)).toBe('SET');
  });

  it('الصور الستّ المختلطة كلها INVALID بلا استثناء', () => {
    const mixed: Array<[unknown, unknown]> = [
      [null, undefined],
      [undefined, null],
      [24.7136, undefined],
      [undefined, 46.6753],
      [null, 46.6753],
      [24.7136, null],
    ];
    for (const [lat, lng] of mixed) {
      expect(classifyLocationPair(lat, lng)).toBe('INVALID');
    }
    expect(mixed).toHaveLength(6);
  });

  it('مسارا الكتابة والبصمة يرفضان الصور الستّ نفسها بنفس الخطأ 400', () => {
    const stored = { latitude: new Prisma.Decimal('24.500000'), longitude: new Prisma.Decimal('46.500000') };
    const mixed: Array<{ lat?: number | null; lng?: number | null }> = [
      { lat: null },
      { lng: null },
      { lat: 24.7136 },
      { lng: 46.6753 },
      { lat: null, lng: 46.6753 },
      { lat: 24.7136, lng: null },
    ];
    for (const input of mixed) {
      // الكتابة: ترمي 400 ولا تُنتج أي أمر كتابة — فلا مسح جزئي إطلاقًا.
      expect(() => buildLocationWrite(input, stored, new Date())).toThrow(/خط العرض وخط الطول/);
      // البصمة: نفس الرفض حرفيًا، فلا تُحتسَب نيّة لطلب غير صالح أصلًا.
      expect(() => canonicalizeLocationIntent(input)).toThrow(/خط العرض وخط الطول/);
    }
  });

  it('التصنيف مصدر وحيد: قرار الكتابة والنيّة يتطابقان على كل مُدخَل صالح', () => {
    const cases: Array<[{ lat?: number | null; lng?: number | null }, string]> = [
      [{}, 'PRESERVE'],
      [{ lat: null, lng: null }, 'CLEAR'],
      [{ lat: 24.7136, lng: 46.6753 }, 'SET'],
    ];
    for (const [input, kind] of cases) {
      expect(classifyLocationPair(input.lat, input.lng)).toBe(kind);
      // النيّة تعكس التصنيف نفسه (SET يحمل بيانات، والوسمان لا).
      expect(canonicalizeLocationIntent(input).intent).toBe(kind);
      expect(() => buildLocationWrite(input, null, new Date())).not.toThrow();
    }
  });
});
