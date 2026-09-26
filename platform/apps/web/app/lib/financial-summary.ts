/** Descriptive arithmetic only: these indicators do not decide eligibility. */
export function financialSummary(finance: unknown): string[] {
  if (!finance || typeof finance !== 'object') return [];
  const data = finance as Record<string, unknown>;
  const amount = (key: string): number | null => typeof data[key] === 'number' && Number.isFinite(data[key]) && (data[key] as number) >= 0 ? data[key] as number : null;
  const revenue = amount('revenue'), expenses = amount('expenses');
  const assets = amount('currentAssets'), liabilities = amount('currentLiabilities');
  const format = (value: number) => new Intl.NumberFormat('ar-SA', { maximumFractionDigits: 2 }).format(value);
  const result: string[] = [];
  if (revenue !== null && expenses !== null) {
    const balance = revenue - expenses;
    result.push(balance > 0 ? `فائض مالي: ${format(balance)} ريال` : balance < 0 ? `المصروفات تتجاوز الإيرادات بعجز ${format(-balance)} ريال` : 'الإيرادات والمصروفات متوازنة');
    if (revenue > 0) result.push(`المصروفات تمثل ${format(expenses / revenue * 100)}٪ من الإيرادات`);
  }
  if (assets !== null && liabilities !== null) {
    const balance = assets - liabilities;
    result.push(liabilities === 0 ? 'لا توجد خصوم متداولة وفق البيانات المدخلة' : balance >= 0 ? `الأصول المتداولة تغطي الخصوم المتداولة؛ الفرق ${format(balance)} ريال` : `الخصوم المتداولة تتجاوز الأصول المتداولة بمقدار ${format(-balance)} ريال`);
  }
  return result;
}
