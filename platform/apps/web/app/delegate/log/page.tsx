'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ApiClientError, listAuditLog, type AuditLogEntry, type Paginated } from '../../lib/api';
import { useRoleGuard } from '../../lib/use-role-guard';
import { cardStyle, errorStyle, mutedStyle, secondaryButtonStyle } from '../../lib/ui';

const PAGE_SIZE = 30;

/** سجل حركات المندوب الشخصي — NORM-009، إجراءات مرئية للمندوب فقط (نطاق محدَّد من الخادم). */
export default function DelegateLogPage() {
  const { user, loading: guardLoading } = useRoleGuard(['DELEGATE']);
  const router = useRouter();
  const [data, setData] = useState<Paginated<AuditLogEntry> | null>(null);
  const [page, setPage] = useState(1);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setError('');
    try {
      setData(await listAuditLog({ page, pageSize: PAGE_SIZE }));
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : 'تعذّر تحميل السجل.');
    }
  }, [page]);

  useEffect(() => {
    if (user) void load();
  }, [user, load]);

  if (guardLoading || !user) return null;

  return (
    <main style={{ maxWidth: 640, margin: '0 auto', padding: '16px 16px 60px' }}>
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 0', marginBottom: 8 }}>
        <h1 style={{ fontSize: 19 }}>سجل حركاتي</h1>
        <button type="button" onClick={() => router.push('/delegate')} style={secondaryButtonStyle}>رجوع</button>
      </header>

      {error && <p role="alert" style={errorStyle}>{error}</p>}

      {data?.items.length === 0 && <p style={mutedStyle}>لا توجد حركات مسجَّلة بعد.</p>}
      {data?.items.map((row) => (
        <div key={row.id} style={{ ...cardStyle, marginBottom: 10 }}>
          <p style={{ margin: 0, fontSize: 14 }}>{ACTION_LABELS[row.action] ?? row.action}</p>
          <p style={{ ...mutedStyle, margin: '4px 0 0' }}>{new Date(row.createdAt).toLocaleString('ar-SA')}</p>
        </div>
      ))}

      {data && data.totalPages > 1 && (
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginTop: 16 }}>
          <button type="button" style={secondaryButtonStyle} disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>السابق</button>
          <span style={mutedStyle}>صفحة {data.page} من {data.totalPages}</span>
          <button type="button" style={secondaryButtonStyle} disabled={page >= data.totalPages} onClick={() => setPage((p) => p + 1)}>التالي</button>
        </div>
      )}
    </main>
  );
}

const ACTION_LABELS: Record<string, string> = {
  LOGIN_SUCCESS: 'تسجيل دخول',
  DELIVERY_ASSIGNED: 'إسناد مهمة تسليم',
  DELIVERY_CONFIRMED: 'تأكيد تسليم',
  DELIVERY_FAILED: 'تسجيل تعذّر تسليم',
  DELIVERY_RETRIED: 'إعادة محاولة تسليم',
  DELEGATE_ACTIVATED: 'تفعيل الحساب',
  DELEGATE_DEACTIVATED: 'تعطيل الحساب',
  DELEGATE_CODE_REGENERATED: 'تجديد رمز الدخول',
};
