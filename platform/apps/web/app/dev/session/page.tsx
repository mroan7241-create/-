'use client';

import { useEffect, useState } from 'react';
import { apiFetch } from '../../lib/api';

/**
 * شاشة تطوير فقط (NODE-1) — تعرض استجابة /auth/me الخام لتسهيل تصحيح
 * الأخطاء أثناء التطوير المحلي. لا تُستخدم في أي بيئة إنتاجية ولا تُربط
 * من أي شاشة أخرى.
 */
export const dynamic = 'force-dynamic';

export default function DevSessionPage() {
  const [state, setState] = useState<{ ok: boolean; body: unknown } | null>(null);

  useEffect(() => {
    apiFetch('/auth/me')
      .then((body) => setState({ ok: true, body }))
      .catch((error) => setState({ ok: false, body: { message: String(error) } }));
  }, []);

  return (
    <main style={{ maxWidth: 640, margin: '48px auto', padding: '0 20px' }}>
      <h1 style={{ fontSize: 20 }}>Dev — Session Inspector</h1>
      <pre style={{ whiteSpace: 'pre-wrap', direction: 'ltr', textAlign: 'left', background: 'var(--paper)', padding: 16, borderRadius: 12, border: '1px solid var(--line)' }}>
        {state ? JSON.stringify(state, null, 2) : 'جارٍ التحميل…'}
      </pre>
    </main>
  );
}
