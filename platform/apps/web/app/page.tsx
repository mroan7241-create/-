/**
 * شاشة health/dev فقط لهذه المرحلة (NODE-0) — تتحقق من وصول الواجهة إلى
 * الـAPI الجديد، ولا تمثل أي شاشة إنتاجية بعد.
 */
export const dynamic = 'force-dynamic';

async function fetchApiHealth() {
  const apiBase = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:3001/api/v1';
  try {
    const res = await fetch(`${apiBase}/health`, { cache: 'no-store' });
    const body = await res.json();
    return { ok: res.ok, body };
  } catch (error) {
    return { ok: false, body: { error: error instanceof Error ? error.message : String(error) } };
  }
}

export default async function DevHomePage() {
  const health = await fetchApiHealth();

  return (
    <main style={{ maxWidth: 720, margin: '48px auto', padding: '0 20px' }}>
      <h1>منصة جمعية الزاد — بيئة تطوير (NODE-0)</h1>
      <p>
        هذه شاشة تأسيس فقط تتحقق من الاتصال بالـAPI الجديد. لا تمثّل أي واجهة
        مستخدم نهائية — راجع <code>platform/docs/MIGRATION_ROADMAP.md</code>{' '}
        لخطة نقل الشاشات الفعلية.
      </p>
      <section
        style={{
          marginTop: 24,
          padding: 16,
          borderRadius: 14,
          border: '1px solid var(--line)',
          background: health.ok ? 'var(--zad-100)' : '#fde8e8',
        }}
      >
        <h2 style={{ fontSize: 16 }}>حالة الاتصال بالـAPI</h2>
        <pre style={{ whiteSpace: 'pre-wrap', direction: 'ltr', textAlign: 'left' }}>
          {JSON.stringify(health.body, null, 2)}
        </pre>
      </section>
    </main>
  );
}
