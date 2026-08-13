/**
 * قراءة قيمة أولية من query string المتصفح لعمل deep-link من لوحات
 * التحكم إلى صفحات مُفلترة (مثال: /admin/beneficiaries?reviewStatus=UNDER_REVIEW).
 * عمدًا بلا `next/navigation`'s useSearchParams — كل الصفحات التي
 * تستخدمها هي 'use client' بالكامل خلف جلسة، فلا حاجة لأي static
 * prerendering لها أصلًا، واستخدام useSearchParams كان يفرض على Next.js
 * محاولة توليد قشرة ثابتة (build error: missing-suspense-with-csr-bailout)
 * رغم كون الصفحة ديناميكية بالكامل فعليًا.
 */
export function initialQueryParam(name: string): string {
  if (typeof window === 'undefined') return '';
  return new URLSearchParams(window.location.search).get(name) ?? '';
}
