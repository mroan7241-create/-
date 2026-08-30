'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  ApiClientError,
  ACCOUNT_STATUS_LABELS,
  createDelegate,
  listDelegates,
  regenerateDelegateCode,
  setDelegateStatus,
  updateDelegate,
  type AccountStatus,
  type DelegateSummary,
  type Paginated,
} from '../../lib/api';
import { useRoleGuard } from '../../lib/use-role-guard';
import { AppShell } from '../../components/AppShell';
import { ConfirmDialog, type ConfirmDialogProps } from '../../components/ConfirmDialog';
import { buildWhatsAppShareUrl, delegateWelcomeMessage } from '../../lib/credential-share';
import {
  cardStyle,
  errorStyle,
  inputStyle,
  labelStyle,
  ltrStyle,
  modalOverlayStyle,
  modalStyle,
  mutedStyle,
  primaryButtonStyle,
  secondaryButtonStyle,
  statusBadgeStyle,
  successStyle,
} from '../../lib/ui';

const PAGE_SIZE = 25;

/** ASSOCIATION — مناديبها فقط، بطاقات لا جدول (مطابقةً لنمط بطاقات المستفيدين لدى الجمعية). associationId من الجلسة حصرًا. */
export default function AssociationDelegatesPage() {
  const { user, loading: guardLoading } = useRoleGuard(['ASSOCIATION']);

  const [data, setData] = useState<Paginated<DelegateSummary> | null>(null);
  const [page, setPage] = useState(1);
  const [listError, setListError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [editing, setEditing] = useState<DelegateSummary | 'new' | null>(null);
  const [revealedCode, setRevealedCode] = useState<{ name: string; code: string; phone: string } | null>(null);
  const [confirmation, setConfirmation] = useState<Omit<ConfirmDialogProps, 'onCancel'> | null>(null);

  const load = useCallback(async () => {
    setListError(null);
    try {
      setData(await listDelegates({ page, pageSize: PAGE_SIZE }));
    } catch (err) {
      setListError(err instanceof ApiClientError ? err.message : 'تعذّر تحميل قائمة المناديب.');
    }
  }, [page]);

  useEffect(() => {
    if (user) void load();
  }, [user, load]);

  function toggleStatus(row: DelegateSummary) {
    const next = row.status === 'ACTIVE' ? 'SUSPENDED' : 'ACTIVE';
    setConfirmation({
      title: next === 'SUSPENDED' ? 'تأكيد تعطيل المندوب' : 'تأكيد تفعيل المندوب',
      message: next === 'SUSPENDED' ? `تعطيل «${row.name}» سيُنهي جلسته فورًا. متابعة؟` : `إعادة تفعيل «${row.name}»؟`,
      confirmLabel: next === 'SUSPENDED' ? 'تعطيل' : 'تفعيل', tone: next === 'SUSPENDED' ? 'danger' : 'primary',
      onConfirm: async () => {
        try { await setDelegateStatus(row.id, next); setNotice(next === 'SUSPENDED' ? 'تم تعطيل المندوب.' : 'تم تفعيل المندوب.'); setConfirmation(null); await load(); }
        catch (err) { setListError(err instanceof ApiClientError ? err.message : 'تعذّر تغيير حالة المندوب.'); }
      },
    });
  }

  function regenerateCode(row: DelegateSummary) {
    setConfirmation({
      title: 'تأكيد إعادة توليد رمز الدخول',
      message: `إعادة توليد رمز دخول «${row.name}»؟ الرمز الحالي سيتوقف عن العمل فورًا.`,
      confirmLabel: 'إعادة توليد الرمز', tone: 'danger',
      onConfirm: async () => {
        try { const res = await regenerateDelegateCode(row.id); setConfirmation(null); setRevealedCode({ name: row.name, code: res.accessCode, phone: row.phone ?? '' }); }
        catch (err) { setListError(err instanceof ApiClientError ? err.message : 'تعذّرت إعادة توليد الرمز.'); }
      },
    });
  }

  if (guardLoading || !user) return null;

  return (
    <AppShell user={user}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 16 }}>
        <h1 style={{ fontSize: 22 }}>مناديبنا</h1>
        <button type="button" style={primaryButtonStyle} onClick={() => setEditing('new')}>إضافة مندوب</button>
      </div>

      {listError && <p role="alert" style={errorStyle}>{listError}</p>}
      {notice && <p style={successStyle}>{notice}</p>}

      {data?.items.length === 0 && <p style={mutedStyle}>لا يوجد مناديب بعد.</p>}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 14 }}>
        {data?.items.map((row) => (
          <div key={row.id} style={cardStyle}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start', marginBottom: 8 }}>
              <strong>{row.name}</strong>
              <span style={statusBadgeStyle(row.status === 'ACTIVE' ? 'good' : 'bad')}>{ACCOUNT_STATUS_LABELS[row.status]}</span>
            </div>
            <p style={{ ...mutedStyle, ...ltrStyle, textAlign: 'right', margin: '2px 0' }}>{row.publicCode}</p>
            <p style={{ ...mutedStyle, ...ltrStyle, textAlign: 'right', margin: '2px 0' }}>{row.phone ?? '—'}</p>
            <p style={mutedStyle}>{row.lastLoginAt ? `آخر دخول: ${new Date(row.lastLoginAt).toLocaleString('ar-SA')}` : 'لم يسجّل دخول بعد'}</p>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
              <button type="button" style={secondaryButtonStyle} onClick={() => setEditing(row)}>تعديل</button>
              <button type="button" style={secondaryButtonStyle} onClick={() => toggleStatus(row)}>{row.status === 'ACTIVE' ? 'تعطيل' : 'تفعيل'}</button>
              <button type="button" style={secondaryButtonStyle} onClick={() => regenerateCode(row)}>إعادة توليد الرمز</button>
            </div>
          </div>
        ))}
      </div>

      {data && data.totalPages > 1 && (
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginTop: 16, flexWrap: 'wrap' }}>
          <button type="button" style={secondaryButtonStyle} disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>السابق</button>
          <span style={mutedStyle}>صفحة {data.page} من {data.totalPages}</span>
          <button type="button" style={secondaryButtonStyle} disabled={page >= data.totalPages} onClick={() => setPage((p) => p + 1)}>التالي</button>
        </div>
      )}

      {editing && (
        <DelegateForm
          delegate={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={(message, code, phone, name) => {
            setEditing(null);
            setNotice(message);
            if (code) setRevealedCode({ name: name ?? 'المندوب الجديد', code, phone: phone ?? '' });
            void load();
          }}
        />
      )}

      {revealedCode && (
        <div style={modalOverlayStyle} role="dialog" aria-modal="true">
          <section style={{ ...modalStyle, maxWidth: 520 }}>
            <h2 style={{ fontSize: 19, marginBottom: 12 }}>رمز دخول المندوب — {revealedCode.name}</h2>
            <p style={{ ...cardStyle, background: 'var(--zad-100)', borderColor: 'var(--zad-300)', fontWeight: 700 }}>
              يظهر مرة واحدة فقط ولن يُعرض مجددًا — انسخه وسلّمه للمندوب الآن.
            </p>
            <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
              <code style={{ ...ltrStyle, fontSize: 20, padding: '10px 14px', background: 'var(--canvas)', borderRadius: 'var(--r-sm)' }}>{revealedCode.code}</code>
              <button type="button" style={secondaryButtonStyle} onClick={() => navigator.clipboard.writeText(revealedCode.code)}>نسخ</button>
            </div>
            <div style={{ marginTop: 14, display: 'flex', flexWrap: 'wrap', gap: 10 }}>
              <button
                type="button"
                style={secondaryButtonStyle}
                onClick={() => navigator.clipboard.writeText(delegateWelcomeMessage(revealedCode.name, revealedCode.code))}
              >
                ⧉ نسخ الرسالة كاملة
              </button>
              {(() => {
                const waUrl = buildWhatsAppShareUrl(revealedCode.phone, delegateWelcomeMessage(revealedCode.name, revealedCode.code));
                return waUrl ? (
                  <a href={waUrl} target="_blank" rel="noopener noreferrer" style={{ ...primaryButtonStyle, textDecoration: 'none', display: 'inline-block' }}>
                    إرسال عبر واتساب
                  </a>
                ) : (
                  <span style={mutedStyle}>رقم الجوال غير صالح لإرسال واتساب مباشر.</span>
                );
              })()}
            </div>
            <div style={{ marginTop: 20 }}>
              <button type="button" style={primaryButtonStyle} onClick={() => setRevealedCode(null)}>إغلاق</button>
            </div>
          </section>
        </div>
      )}
      {confirmation && <ConfirmDialog {...confirmation} onCancel={() => setConfirmation(null)} />}
    </AppShell>
  );
}

function DelegateForm({ delegate, onClose, onSaved }: { delegate: DelegateSummary | null; onClose: () => void; onSaved: (message: string, code?: string, phone?: string, name?: string) => void }) {
  const isNew = delegate === null;
  const [name, setName] = useState(delegate?.name ?? '');
  const [phone, setPhone] = useState(delegate?.phone ?? '');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      if (isNew) {
        const res = await createDelegate({ name, phone });
        onSaved('تم إنشاء المندوب وإصدار رمز دخوله.', res.accessCode ?? undefined, phone, name);
      } else {
        await updateDelegate(delegate.id, { name, phone });
        onSaved('تم حفظ تعديلات المندوب.');
      }
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : 'تعذّر الحفظ. حاول مرة أخرى.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={modalOverlayStyle} role="dialog" aria-modal="true">
      <form onSubmit={save} style={{ ...modalStyle, maxWidth: 480, display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
          <h2 style={{ fontSize: 19 }}>{isNew ? 'إضافة مندوب' : `تعديل — ${delegate.name}`}</h2>
          <button type="button" style={secondaryButtonStyle} onClick={onClose}>إغلاق</button>
        </div>

        <label style={labelStyle}>
          اسم المندوب
          <input required maxLength={120} value={name} onChange={(e) => setName(e.target.value)} style={inputStyle} />
        </label>

        <label style={labelStyle}>
          رقم الجوال
          <input required placeholder="05XXXXXXXX" value={phone} onChange={(e) => setPhone(e.target.value)} style={{ ...inputStyle, ...ltrStyle }} />
        </label>

        {isNew && <p style={mutedStyle}>سيُصدَر رمز دخول عشوائي (MND-XXXXXX) ويظهر مرة واحدة فقط بعد الحفظ.</p>}

        {error && <p role="alert" style={errorStyle}>{error}</p>}

        <div>
          <button type="submit" disabled={busy} style={primaryButtonStyle}>{busy ? 'جارٍ الحفظ…' : 'حفظ'}</button>
        </div>
      </form>
    </div>
  );
}
