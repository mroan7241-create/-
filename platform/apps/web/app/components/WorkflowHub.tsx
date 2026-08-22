'use client';

import { useCallback, useEffect, useState } from 'react';
import type { CurrentUser, WorkflowRecord } from '../lib/api';
import { activateParticipation, apiFetch, completeParticipationSetup, decideDelivery, decideEscalation, listDeliveries, listEscalations, listNotifications, listParticipations, listProcurement, listSystemSettings, markNotificationRead, promoteReserve, saveSystemSetting, setBeneficiaryList } from '../lib/api';
import { cardStyle, errorStyle, inputStyle, primaryButtonStyle, secondaryButtonStyle, successStyle } from '../lib/ui';

type Section = { key: string; title: string; rows: WorkflowRecord[]; error?: string };

export function WorkflowHub({ user }: { user: CurrentUser }) {
  const [sections, setSections] = useState<Section[]>([]); const [busy, setBusy] = useState(''); const [message, setMessage] = useState('');
  const load = useCallback(async () => {
    const jobs: Array<[string, string, Promise<unknown>]> = [
      ['participations', 'المشاركات والاتفاقيات', listParticipations()], ['deliveries', 'اعتمادات التسليم والإرجاع', listDeliveries({ pageSize: 50 })],
      ['procurement', 'أوامر الشراء والشحنات', listProcurement()], ['escalations', 'التصعيدات', listEscalations()], ['notifications', 'الإشعارات', listNotifications()],
      ['beneficiaries', 'قوائم المستفيدين', apiFetch('/beneficiaries?page=1&pageSize=50')],
    ];
    if (user.role === 'ADMIN') jobs.push(['settings', 'الإعدادات التشغيلية', listSystemSettings()]);
    const settled = await Promise.allSettled(jobs.map((job) => job[2]));
    setSections(settled.map((result, index) => { const [key, title] = jobs[index]; if (result.status === 'rejected') return { key, title, rows: [], error: result.reason instanceof Error ? result.reason.message : 'فشل التحميل' }; const body = result.value as { items?: WorkflowRecord[] }; const rows = Array.isArray(body) ? body : body.items ?? (key === 'settings' ? Object.entries(body).map(([id, value]) => ({ id, value })) : []); return { key, title, rows }; }));
  }, [user.role]);
  useEffect(() => { void load(); }, [load]);

  async function act(label: string, action: () => Promise<unknown>) { setBusy(label); setMessage(''); try { await action(); setMessage('تم تنفيذ العملية وتحديث القائمة.'); await load(); } catch (error) { setMessage(error instanceof Error ? error.message : 'تعذر التنفيذ'); } finally { setBusy(''); } }
  return <div style={{ display: 'grid', gap: 16 }}>
    <p>هذه القوائم مستقلة: فشل مؤشر واحد لا يخفي بقية العمليات، والخادم يعيد التحقق من الأهلية قبل أي تغيير.</p>
    {message && <p style={message.includes('تم ') ? successStyle : errorStyle}>{message}</p>}
    {user.role === 'ADMIN' && <SettingEditor busy={busy} act={act} />}
    {sections.map((section) => <section key={section.key} style={cardStyle}><h2 style={{ fontSize: 18 }}>{section.title}</h2>{section.error ? <p style={errorStyle}>{section.error}</p> : section.rows.length === 0 ? <p>لا توجد عناصر.</p> : section.rows.map((row) => <article key={row.id} style={{ borderTop: '1px solid var(--line)', padding: '12px 0' }}><code dir="ltr">{String(row.publicCode ?? row.key ?? row.id)}</code> <span>{String(row.status ?? row.title ?? '')}</span><div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}><Actions user={user} section={section.key} row={row} busy={busy} act={act} /></div></article>)}</section>)}
  </div>;
}

function SettingEditor({ busy, act }: { busy: string; act: (label: string, action: () => Promise<unknown>) => Promise<void> }) { const [threshold, setThreshold] = useState(''); return <section style={cardStyle}><h2 style={{ fontSize: 18 }}>بوابة الاختيار</h2><label>حد الاجتياز (0–100)<input style={inputStyle} type="number" min="0" max="100" value={threshold} onChange={(event) => setThreshold(event.target.value)} /></label><button style={primaryButtonStyle} disabled={!!busy || threshold === ''} onClick={() => act('threshold', () => saveSystemSetting('selection.passThreshold', Number(threshold)))}>حفظ الحد</button></section>; }

function Actions({ user, section, row, busy, act }: { user: CurrentUser; section: string; row: WorkflowRecord; busy: string; act: (label: string, action: () => Promise<unknown>) => Promise<void> }) {
  const button = (label: string, action: () => Promise<unknown>) => <button key={label} style={secondaryButtonStyle} disabled={!!busy} onClick={() => act(`${section}-${row.id}-${label}`, action)}>{label}</button>;
  if (section === 'participations') return user.role === 'ADMIN' ? <>{button('إكمال التجهيز', () => completeParticipationSetup(row.id))}{button('تفعيل', () => activateParticipation(row.id))}{button('فحص جاهزية الإغلاق', () => apiFetch(`/reports/closure/readiness/${row.id}`))}</> : button('فحص جاهزية الإغلاق', () => apiFetch(`/reports/closure/readiness/${row.id}`));
  if (section === 'deliveries' && row.status === 'PENDING_DELIVERY_APPROVAL') return user.role === 'ADMIN' ? button('اعتماد الزاد النهائي', () => decideDelivery(row.id, 'zaad', 'APPROVED')) : button('اعتماد الجمعية', () => decideDelivery(row.id, 'association', 'APPROVED'));
  if (section === 'escalations' && user.role === 'ADMIN' && (row.status === 'OPEN' || row.status === 'NEEDS_INFO')) return button('اعتماد', () => decideEscalation(row.id, 'APPROVED', window.prompt('سبب القرار') ?? ''));
  if (section === 'notifications' && !row.readAt) return button('تعليم كمقروء', () => markNotificationRead(row.id));
  if (section === 'beneficiaries' && user.role === 'ADMIN') return <>{button('MAIN', () => setBeneficiaryList(row.id, 'MAIN', Number(window.prompt('الترتيب') ?? 0), window.prompt('سبب القرار') ?? ''))}{button('RESERVE', () => setBeneficiaryList(row.id, 'RESERVE', Number(window.prompt('الترتيب') ?? 0), window.prompt('سبب القرار') ?? ''))}{row.listType === 'RESERVE' && button('ترقية إلى MAIN', () => promoteReserve(row.id, window.prompt('سبب الترقية') ?? ''))}</>;
  return null;
}
