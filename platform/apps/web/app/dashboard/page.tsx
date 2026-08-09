'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { CurrentUser, getMe, logout } from '../lib/api';

/**
 * غلاف موثَّق أدنى (NODE-1 فقط) — يعرض بيانات /auth/me وزر خروج. ليست
 * لوحة تحكم فعلية؛ الشاشات الحقيقية (إدارة الجمعيات/المستفيدين/الأجهزة)
 * تُنقل تدريجيًا في NODE اللاحقة — راجع MIGRATION_ROADMAP.md.
 */
export default function DashboardShellPage() {
  const router = useRouter();
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getMe()
      .then(setUser)
      .catch(() => router.replace('/login'))
      .finally(() => setLoading(false));
  }, [router]);

  async function handleLogout() {
    await logout().catch(() => undefined);
    router.push('/login');
  }

  if (loading) return null;
  if (!user) return null;

  const roleLabel = { ADMIN: 'إدارة', ASSOCIATION: 'جمعية', DELEGATE: 'مندوب' }[user.role];

  return (
    <main style={{ maxWidth: 640, margin: '48px auto', padding: '0 20px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <h1 style={{ fontSize: 22 }}>مرحبًا، {user.name}</h1>
        <button onClick={handleLogout} style={logoutStyle}>
          تسجيل الخروج
        </button>
      </div>
      <section style={{ padding: 16, borderRadius: 14, border: '1px solid var(--line)', background: 'var(--paper)' }}>
        <dl style={{ margin: 0, display: 'grid', gridTemplateColumns: '140px 1fr', rowGap: 10 }}>
          <dt>الرمز التعريفي</dt>
          <dd style={{ margin: 0, direction: 'ltr', textAlign: 'left' }}>{user.publicCode}</dd>
          <dt>الدور</dt>
          <dd style={{ margin: 0 }}>{roleLabel}</dd>
          <dt>الجمعية</dt>
          <dd style={{ margin: 0 }}>{user.associationId ?? '—'}</dd>
        </dl>
      </section>
      <p style={{ marginTop: 20, fontSize: 14, opacity: 0.75 }}>
        هذا غلاف تأسيس أدنى (NODE-1) — شاشات الأعمال الحقيقية قيد النقل التدريجي.
      </p>
    </main>
  );
}

const logoutStyle: React.CSSProperties = {
  padding: '8px 14px',
  borderRadius: 'var(--r-sm)',
  border: '1px solid var(--line)',
  background: 'var(--paper)',
  cursor: 'pointer',
  fontSize: 14,
};
