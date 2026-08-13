'use client';

import { useEffect, useState } from 'react';
import { ApiClientError, apiFetch } from '../../lib/api';
import { useRoleGuard } from '../../lib/use-role-guard';
import { AppShell } from '../../components/AppShell';
import {
  cardStyle,
  errorStyle,
  inputStyle,
  labelStyle,
  ltrStyle,
  mutedStyle,
  primaryButtonStyle,
  successStyle,
} from '../../lib/ui';

/**
 * إعدادات الجمعية الذاتية — جوال وبريد فقط، مطابقةً لـupdateAssociationSettings
 * القديمة. الجمعية المستهدَفة تُشتق من الجلسة على الخادم حصرًا؛ لا يوجد حقل
 * associationId في هذا النموذج ولا في عقد الـAPI أصلًا.
 */
export default function AssociationSettingsPage() {
  const { user, loading } = useRoleGuard(['ASSOCIATION']);
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [loadError, setLoadError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!user) return;
    apiFetch<{ phone: string; email: string }>('/associations/me/settings')
      .then((res) => {
        setPhone(res.phone);
        setEmail(res.email);
      })
      .catch((err) => setLoadError(err instanceof ApiClientError ? err.message : 'تعذّر تحميل الإعدادات الحالية.'));
  }, [user]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSaved(false);
    setBusy(true);
    try {
      await apiFetch('/associations/me/settings', { method: 'PATCH', body: JSON.stringify({ phone, email }) });
      setSaved(true);
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : 'تعذّر حفظ الإعدادات. حاول مرة أخرى.');
    } finally {
      setBusy(false);
    }
  }

  if (loading || !user) return null;

  return (
    <AppShell user={user}>
      <div style={{ maxWidth: 480 }}>
        <h1 style={{ fontSize: 22, marginBottom: 8 }}>إعدادات الجمعية</h1>
        <p style={{ ...mutedStyle, marginTop: 0, marginBottom: 24 }}>
          يمكن تحديث بيانات التواصل فقط. لتغيير اسم الجمعية أو تصنيفها أو حالتها تواصل مع إدارة المشروع.
        </p>

        {loadError && (
          <p role="alert" style={errorStyle}>
            {loadError}
          </p>
        )}
        <form onSubmit={save} style={{ ...cardStyle, display: 'flex', flexDirection: 'column', gap: 14 }}>
        <label style={labelStyle}>
          رقم الجوال
          <input
            required
            placeholder="05XXXXXXXX"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            style={{ ...inputStyle, ...ltrStyle }}
          />
        </label>

        <label style={labelStyle}>
          البريد الإلكتروني
          <input required type="email" value={email} onChange={(e) => setEmail(e.target.value)} style={{ ...inputStyle, ...ltrStyle }} />
        </label>

        {error && (
          <p role="alert" style={errorStyle}>
            {error}
          </p>
        )}
        {saved && <p style={successStyle}>تم حفظ الإعدادات.</p>}

          <div>
            <button type="submit" disabled={busy} style={primaryButtonStyle}>
              {busy ? 'جارٍ الحفظ…' : 'حفظ'}
            </button>
          </div>
        </form>
      </div>
    </AppShell>
  );
}
