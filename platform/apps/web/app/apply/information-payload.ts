export function buildInformationPayload(items: Array<{ type: string; key: string; kind?: string }>, response: Record<string, string>): Record<string, unknown> {
  const payload: Record<string, unknown> = {};
  for (const item of items) {
    if (item.type !== 'FIELD') continue;
    const parts = item.key.split('.');
    if (parts.some((part) => !/^[a-zA-Z][a-zA-Z0-9]*$/.test(part))) throw new Error('الحقل المطلوب غير صالح. تواصل مع إدارة المشروع.');
    let current = payload;
    for (const part of parts.slice(0, -1)) {
      if (!(part in current)) current[part] = {};
      if (typeof current[part] !== 'object' || current[part] === null) throw new Error('تعارض في الحقول المطلوبة. تواصل مع إدارة المشروع.');
      current = current[part] as Record<string, unknown>;
    }
    const raw = response[item.key]?.trim() ?? '';
    if (item.kind === 'number') {
      const value = Number(raw);
      if (!raw || !Number.isFinite(value)) throw new Error('أدخل رقمًا صالحًا للحقل المطلوب.');
      current[parts[parts.length - 1]!] = value;
    } else if (item.kind === 'boolean') {
      if (raw !== 'true' && raw !== 'false') throw new Error('اختر نعم أو لا للحقل المطلوب.');
      current[parts[parts.length - 1]!] = raw === 'true';
    } else current[parts[parts.length - 1]!] = raw;
  }
  return payload;
}
