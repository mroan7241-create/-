'use client';

import { useCallback, useEffect, useState } from 'react';
import { ApiClientError, listAuditLog, type AuditLogEntry, type Paginated } from '../../lib/api';
import { useRoleGuard } from '../../lib/use-role-guard';
import { AppShell } from '../../components/AppShell';
import { AssociationSelect } from '../../lib/association-select';
import { cardStyle, errorStyle, labelStyle, ltrStyle, mutedStyle, secondaryButtonStyle, tableStyle, tdStyle, thStyle } from '../../lib/ui';

const PAGE_SIZE = 50;

/** ADMIN — سجل العمليات (append-only، بلا أي حذف/تعديل). يوازي listAuditLog القديمة. */
export default function AdminAuditPage() {
  const { user, loading: guardLoading } = useRoleGuard(['ADMIN']);
  const [data, setData] = useState<Paginated<AuditLogEntry> | null>(null);
  const [page, setPage] = useState(1);
  const [associationId, setAssociationId] = useState('');
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setError('');
    try {
      setData(await listAuditLog({ page, pageSize: PAGE_SIZE, associationId: associationId || undefined }));
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : 'تعذّر تحميل سجل العمليات.');
    }
  }, [page, associationId]);

  useEffect(() => {
    if (user) void load();
  }, [user, load]);

  if (guardLoading || !user) return null;

  return (
    <AppShell user={user}>
      <h1 style={{ fontSize: 22, marginBottom: 16 }}>سجل العمليات</h1>

      <label style={{ ...labelStyle, maxWidth: 280, marginBottom: 16 }}>
        تصفية حسب الجمعية (اختياري)
        <AssociationSelect value={associationId} onChange={(id) => { setPage(1); setAssociationId(id); }} />
      </label>

      {error && <p role="alert" style={errorStyle}>{error}</p>}

      <div style={{ ...cardStyle, padding: 0, overflowX: 'auto' }}>
        <table style={tableStyle}>
          <thead>
            <tr>
              <th style={thStyle}>الوقت</th>
              <th style={thStyle}>الفاعل</th>
              <th style={thStyle}>الإجراء</th>
              <th style={thStyle}>القسم</th>
            </tr>
          </thead>
          <tbody>
            {data?.items.length === 0 && <tr><td style={{ ...tdStyle, textAlign: 'center' }} colSpan={4}>لا توجد حركات مطابقة.</td></tr>}
            {data?.items.map((row) => (
              <tr key={row.id}>
                <td style={{ ...tdStyle, ...ltrStyle }}>{new Date(row.createdAt).toLocaleString('ar-SA')}</td>
                <td style={tdStyle}>{row.actorAccount ? `${row.actorAccount.name} (${row.actorAccount.publicCode})` : 'النظام'}</td>
                <td style={{ ...tdStyle, ...ltrStyle }}>{row.action}</td>
                <td style={{ ...tdStyle, ...ltrStyle }}>{row.entityType}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {data && data.totalPages > 1 && (
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginTop: 16, flexWrap: 'wrap' }}>
          <button type="button" style={secondaryButtonStyle} disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>السابق</button>
          <span style={mutedStyle}>صفحة {data.page} من {data.totalPages} — {data.total} حركة</span>
          <button type="button" style={secondaryButtonStyle} disabled={page >= data.totalPages} onClick={() => setPage((p) => p + 1)}>التالي</button>
        </div>
      )}
    </AppShell>
  );
}
