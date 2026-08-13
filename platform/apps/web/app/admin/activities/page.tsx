'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  ACTIVITY_STATUS_LABELS,
  ApiClientError,
  listActivities,
  saveActivity,
  type Activity,
  type ActivityStatus,
} from '../../lib/api';
import { useRoleGuard } from '../../lib/use-role-guard';
import { AppShell } from '../../components/AppShell';
import {
  cardStyle,
  errorStyle,
  inputStyle,
  labelStyle,
  modalOverlayStyle,
  modalStyle,
  mutedStyle,
  primaryButtonStyle,
  secondaryButtonStyle,
  statusBadgeStyle,
  successStyle,
} from '../../lib/ui';

function statusTone(status: ActivityStatus): 'neutral' | 'good' | 'bad' {
  if (status === 'COMPLETED') return 'good';
  if (status === 'LATE') return 'bad';
  return 'neutral';
}

/** ADMIN — متابعة المشروع (المراحل/الأنشطة الرئيسية والفرعية). يوازي getActivitiesBundle/saveActivity القديمتين. إرفاق أدلة الملفات مؤجَّل صراحةً (راجع activities.service.ts). */
export default function AdminActivitiesPage() {
  const { user, loading: guardLoading } = useRoleGuard(['ADMIN']);
  const [activities, setActivities] = useState<Activity[] | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [editing, setEditing] = useState<Activity | 'new' | null>(null);

  const load = useCallback(async () => {
    try {
      setActivities(await listActivities());
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : 'تعذّر تحميل الأنشطة.');
    }
  }, []);

  useEffect(() => {
    if (user) void load();
  }, [user, load]);

  if (guardLoading || !user) return null;

  // تجميع حسب المرحلة ثم النشاط الرئيسي — نفس البنية الهرمية القديمة.
  const phases = new Map<string, Activity[]>();
  for (const a of activities ?? []) {
    const key = `${a.phaseOrder}::${a.phaseName}`;
    if (!phases.has(key)) phases.set(key, []);
    phases.get(key)!.push(a);
  }

  return (
    <AppShell user={user}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 16 }}>
        <h1 style={{ fontSize: 22 }}>متابعة المشروع</h1>
        <button type="button" style={primaryButtonStyle} onClick={() => setEditing('new')}>إضافة نشاط</button>
      </div>

      {error && <p role="alert" style={errorStyle}>{error}</p>}
      {notice && <p style={successStyle}>{notice}</p>}
      {activities?.length === 0 && <p style={mutedStyle}>لا توجد أنشطة مسجَّلة بعد.</p>}

      {[...phases.entries()].map(([key, items]) => (
        <section key={key} style={{ marginBottom: 20 }}>
          <h2 style={{ fontSize: 16, marginBottom: 8 }}>{items[0].phaseName}</h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 12 }}>
            {items.map((a) => (
              <div key={a.id} style={cardStyle}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start', marginBottom: 6 }}>
                  <strong>{a.mainActivityName}{a.subActivityName ? ` — ${a.subActivityName}` : ''}</strong>
                  <span style={statusBadgeStyle(statusTone(a.status))}>{ACTIVITY_STATUS_LABELS[a.status]}</span>
                </div>
                {a.responsible && <p style={{ ...mutedStyle, margin: '2px 0' }}>المسؤول: {a.responsible}</p>}
                <p style={{ ...mutedStyle, margin: '2px 0' }}>نسبة الإنجاز: {a.completionPercent}%</p>
                {(a.startDate || a.endDate) && (
                  <p style={{ ...mutedStyle, margin: '2px 0' }}>
                    {a.startDate ? new Date(a.startDate).toLocaleDateString('ar-SA') : '—'} → {a.endDate ? new Date(a.endDate).toLocaleDateString('ar-SA') : '—'}
                  </p>
                )}
                {a.evidenceUrl && (
                  <p style={{ margin: '2px 0' }}>
                    <a href={a.evidenceUrl} target="_blank" rel="noopener noreferrer">رابط الشاهد ↗</a>
                  </p>
                )}
                <button type="button" style={{ ...secondaryButtonStyle, marginTop: 8 }} onClick={() => setEditing(a)}>تعديل</button>
              </div>
            ))}
          </div>
        </section>
      ))}

      {editing && (
        <ActivityForm
          activity={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={(message) => {
            setEditing(null);
            setNotice(message);
            void load();
          }}
        />
      )}
    </AppShell>
  );
}

function ActivityForm({ activity, onClose, onSaved }: { activity: Activity | null; onClose: () => void; onSaved: (message: string) => void }) {
  const isNew = activity === null;
  const [phaseOrder, setPhaseOrder] = useState(activity?.phaseOrder ?? 1);
  const [phaseName, setPhaseName] = useState(activity?.phaseName ?? '');
  const [mainActivityOrder, setMainActivityOrder] = useState(activity?.mainActivityOrder ?? 1);
  const [mainActivityName, setMainActivityName] = useState(activity?.mainActivityName ?? '');
  const [subActivityName, setSubActivityName] = useState(activity?.subActivityName ?? '');
  const [responsible, setResponsible] = useState(activity?.responsible ?? '');
  const [startDate, setStartDate] = useState(activity?.startDate?.slice(0, 10) ?? '');
  const [endDate, setEndDate] = useState(activity?.endDate?.slice(0, 10) ?? '');
  const [completionPercent, setCompletionPercent] = useState(activity ? Number(activity.completionPercent) : 0);
  const [status, setStatus] = useState<ActivityStatus>(activity?.status ?? 'NOT_STARTED');
  const [notes, setNotes] = useState(activity?.notes ?? '');
  const [evidenceUrl, setEvidenceUrl] = useState(activity?.evidenceUrl ?? '');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      await saveActivity({
        id: activity?.id,
        phaseOrder, phaseName, mainActivityOrder, mainActivityName,
        subActivityName: subActivityName || undefined,
        responsible: responsible || undefined,
        startDate: startDate || undefined,
        endDate: endDate || undefined,
        completionPercent,
        status,
        notes: notes || undefined,
        evidenceUrl: evidenceUrl || undefined,
      });
      onSaved(isNew ? 'تم إضافة النشاط.' : 'تم حفظ تعديلات النشاط.');
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : 'تعذّر الحفظ.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={modalOverlayStyle} role="dialog" aria-modal="true">
      <form onSubmit={submit} style={{ ...modalStyle, maxWidth: 560, display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h2 style={{ fontSize: 19 }}>{isNew ? 'إضافة نشاط' : 'تعديل نشاط'}</h2>
          <button type="button" style={secondaryButtonStyle} onClick={onClose}>إغلاق</button>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
          <label style={labelStyle}>ترتيب المرحلة<input required type="number" min={1} value={phaseOrder} onChange={(e) => setPhaseOrder(Number(e.target.value))} style={inputStyle} /></label>
          <label style={labelStyle}>اسم المرحلة<input required value={phaseName} onChange={(e) => setPhaseName(e.target.value)} style={inputStyle} /></label>
          <label style={labelStyle}>ترتيب النشاط الرئيسي<input required type="number" min={1} value={mainActivityOrder} onChange={(e) => setMainActivityOrder(Number(e.target.value))} style={inputStyle} /></label>
          <label style={labelStyle}>النشاط الرئيسي<input required value={mainActivityName} onChange={(e) => setMainActivityName(e.target.value)} style={inputStyle} /></label>
          <label style={labelStyle}>النشاط الفرعي (اختياري)<input value={subActivityName} onChange={(e) => setSubActivityName(e.target.value)} style={inputStyle} /></label>
          <label style={labelStyle}>المسؤول<input value={responsible} onChange={(e) => setResponsible(e.target.value)} style={inputStyle} /></label>
          <label style={labelStyle}>تاريخ البدء<input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} style={inputStyle} /></label>
          <label style={labelStyle}>تاريخ الانتهاء<input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} style={inputStyle} /></label>
          <label style={labelStyle}>نسبة الإنجاز %<input type="number" min={0} max={100} value={completionPercent} onChange={(e) => setCompletionPercent(Number(e.target.value))} style={inputStyle} /></label>
          <label style={labelStyle}>
            الحالة
            <select value={status} onChange={(e) => setStatus(e.target.value as ActivityStatus)} style={inputStyle}>
              {Object.entries(ACTIVITY_STATUS_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </label>
        </div>

        <label style={labelStyle}>رابط الشاهد (اختياري)<input type="url" dir="ltr" placeholder="https://…" value={evidenceUrl} onChange={(e) => setEvidenceUrl(e.target.value)} style={inputStyle} /></label>
        <label style={labelStyle}>ملاحظات<textarea value={notes} onChange={(e) => setNotes(e.target.value)} style={{ ...inputStyle, minHeight: 70 }} maxLength={1000} /></label>

        {error && <p role="alert" style={errorStyle}>{error}</p>}

        <div>
          <button type="submit" disabled={busy} style={primaryButtonStyle}>{busy ? 'جارٍ الحفظ…' : 'حفظ'}</button>
        </div>
      </form>
    </div>
  );
}
