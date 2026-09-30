import { PROJECT_ACTIVITY_CATALOG, PROJECT_ACTIVITY_PHASE, projectActivityRows } from './project-activities.catalog';

describe('خطة مشروع الأجهزة الكهربائية', () => {
  it('تحفظ 13 نشاطًا رئيسيًا وأربع خطوات لكل نشاط دون تكرار', () => {
    expect(PROJECT_ACTIVITY_CATALOG).toHaveLength(13);
    expect(PROJECT_ACTIVITY_CATALOG.map((item) => item.order)).toEqual(Array.from({ length: 13 }, (_, i) => i + 1));
    expect(PROJECT_ACTIVITY_CATALOG.every((item) => item.steps.length === 4)).toBe(true);
    const rows = projectActivityRows();
    expect(rows).toHaveLength(65);
    expect(new Set(rows.map((row) => `${row.mainActivityOrder}:${row.subActivityName ?? ''}`)).size).toBe(65);
    expect(rows.every((row) => row.phaseName === PROJECT_ACTIVITY_PHASE)).toBe(true);
  });

  it('لا تضع إنجازًا أو شواهد نيابة عن المسؤول؛ وتطابق حدود الجدول الزمني بالمصدر', () => {
    const rows = projectActivityRows();
    expect(rows.every((row) => row.status === 'NOT_STARTED' && row.completionPercent === 0 && row.evidenceUrl === null)).toBe(true);
    expect(rows[0].startDate.toISOString().slice(0, 10)).toBe('2026-07-30');
    expect(rows.at(-1)?.endDate.toISOString().slice(0, 10)).toBe('2027-01-04');
  });
});
