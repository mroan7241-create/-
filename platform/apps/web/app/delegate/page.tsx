'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  ApiClientError, DELIVERY_FAILURE_REASON_LABELS, DELIVERY_STATUS_LABELS, DEVICE_TYPE_LABELS,
  confirmDelivery, confirmHandover, failDelivery, getDelivery, getDeliveryProofUrl, listDeliveries,
  logout, rescheduleDelivery, returnDelivery, updateBeneficiaryLocation,
  type DeliveryFailureReason, type DeliveryMissionSummary, type DeliveryStatus,
} from '../lib/api';
import { useRoleGuard } from '../lib/use-role-guard';
import { cardStyle, errorStyle, inputStyle, labelStyle, modalOverlayStyle, modalStyle, mutedStyle, primaryButtonStyle, secondaryButtonStyle } from '../lib/ui';
import { buildGoogleMapsSegments, orderStopsNearestNeighbour, type RoutePoint } from './delegate-route';

type Tab = 'tasks' | 'route' | 'history';
const ACTIVE_STATUSES: DeliveryStatus[] = ['PENDING_DELEGATE_ACKNOWLEDGEMENT', 'OUT_WITH_DELEGATE', 'DELIVERY_FAILED', 'DEFERRED', 'PENDING_RETURN_APPROVAL', 'PENDING_DELIVERY_APPROVAL'];
const HISTORY_STATUSES: DeliveryStatus[] = ['DELIVERY_CLOSED', 'DELIVERED', 'RETURNED'];

export default function DelegatePortalPage() {
  const { user, loading } = useRoleGuard(['DELEGATE']);
  const router = useRouter();
  const [tab, setTab] = useState<Tab>('tasks');
  const [missions, setMissions] = useState<DeliveryMissionSummary[] | null>(null);
  const [history, setHistory] = useState<DeliveryMissionSummary[]>([]);
  const [error, setError] = useState('');
  const [modal, setModal] = useState<{ type: 'deliver' | 'fail' | 'reschedule' | 'return' | 'location'; mission: DeliveryMissionSummary } | null>(null);
  const [routeStart, setRouteStart] = useState<RoutePoint | undefined>();
  const [locating, setLocating] = useState(false);

  const load = useCallback(async () => {
    setError('');
    try {
      const [activeGroups, historyGroups] = await Promise.all([
        Promise.all(ACTIVE_STATUSES.map(loadEveryPageForStatus)),
        Promise.all(HISTORY_STATUSES.map(loadEveryPageForStatus)),
      ]);
      setMissions(activeGroups.flat());
      setHistory(historyGroups.flat().sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)));
    } catch (caught) { setError(caught instanceof ApiClientError ? caught.message : 'تعذّر تحميل مهام المندوب.'); }
  }, []);
  useEffect(() => { if (user) void load(); }, [user, load]);

  const routeMissions = useMemo(() => {
    const eligible = (missions ?? []).filter((mission) => mission.status === 'OUT_WITH_DELEGATE' && isTodayOrReady(mission.scheduledFor) && hasCoordinates(mission));
    return orderStopsNearestNeighbour(eligible.map((mission) => ({ ...mission, latitude: mission.beneficiary.latitude!, longitude: mission.beneficiary.longitude! })), routeStart);
  }, [missions, routeStart]);
  const missingCoordinates = (missions ?? []).filter((mission) => mission.status === 'OUT_WITH_DELEGATE' && isTodayOrReady(mission.scheduledFor) && !hasCoordinates(mission));
  const routeLinks = buildGoogleMapsSegments(routeMissions, routeStart);

  function useCurrentLocation() {
    if (!navigator.geolocation) { setError('المتصفح لا يدعم تحديد الموقع الحالي. سيبدأ المسار من أول مهمة.'); return; }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (position) => { setRouteStart({ latitude: position.coords.latitude, longitude: position.coords.longitude }); setLocating(false); },
      () => { setError('تعذّر الوصول إلى موقعك. سيبدأ المسار من أول مهمة متاحة.'); setLocating(false); },
      { enableHighAccuracy: true, timeout: 10_000 },
    );
  }

  if (loading || !user) return null;
  return <main className="delegate-shell" dir="rtl">
    <header className="delegate-header"><div><span className="delegate-eyebrow">منصة الزاد الميدانية</span><h1>مرحبًا، {user.name}</h1><p>{missions?.length ?? 0} مهمة تشغيلية</p></div><button style={secondaryButtonStyle} onClick={async () => { await logout().catch(() => undefined); router.push('/login'); }}>خروج</button></header>
    <nav className="delegate-tabs" aria-label="أقسام بوابة المندوب">
      <TabButton active={tab === 'tasks'} onClick={() => setTab('tasks')}>مهامي</TabButton>
      <TabButton active={tab === 'route'} onClick={() => setTab('route')}>مسار اليوم</TabButton>
      <TabButton active={tab === 'history'} onClick={() => setTab('history')}>السجل</TabButton>
    </nav>
    {error && <p role="alert" style={errorStyle}>{error}</p>}

    {tab === 'tasks' && <TasksView missions={missions ?? []} onAction={(type, mission) => setModal({ type, mission })} onReload={load} setError={setError} />}
    {tab === 'route' && <section>
      <div className="delegate-section-heading"><div><h2>مسار اليوم</h2><p>ترتيب حتمي بالأقرب فالأقرب للمهمات الجاهزة ذات الإحداثيات.</p></div><button style={secondaryButtonStyle} disabled={locating} onClick={useCurrentLocation}>{locating ? 'جارٍ تحديد الموقع…' : 'ابدأ من موقعي'}</button></div>
      <div className="route-actions">{routeLinks.map((url, index) => <a key={url} className="route-link" href={url} target="_blank" rel="noreferrer">فتح المسار في خرائط Google{routeLinks.length > 1 ? ` — الجزء ${index + 1}` : ''}</a>)}</div>
      {!routeMissions.length && <Empty text="لا توجد مهام جاهزة لمسار اليوم بإحداثيات مكتملة." />}
      {routeMissions.map((mission, index) => <MissionCard key={mission.id} mission={mission} order={index + 1} />)}
      {!!missingCoordinates.length && <div style={cardStyle}><h3>تحتاج تحديث الموقع</h3>{missingCoordinates.map((mission) => <button key={mission.id} style={secondaryButtonStyle} onClick={() => setModal({ type: 'location', mission })}>{mission.beneficiary.name} — تحديث الإحداثيات</button>)}</div>}
    </section>}
    {tab === 'history' && <section><div className="delegate-section-heading"><div><h2>السجل</h2><p>التسليمات المغلقة والمرتجعات المكتملة.</p></div></div>{!history.length && <Empty text="لا يوجد سجل مكتمل بعد." />}{history.map((mission) => <MissionCard key={mission.id} mission={mission} onViewProof={() => void viewProof(mission, setError)} />)}</section>}

    {modal?.type === 'deliver' && <DeliveryModal mission={modal.mission} close={() => setModal(null)} done={async () => { setModal(null); await load(); }} />}
    {modal?.type === 'fail' && <FailureModal mission={modal.mission} close={() => setModal(null)} done={async () => { setModal(null); await load(); }} />}
    {modal?.type === 'reschedule' && <RescheduleModal mission={modal.mission} close={() => setModal(null)} done={async () => { setModal(null); await load(); }} />}
    {modal?.type === 'return' && <ReturnModal mission={modal.mission} close={() => setModal(null)} done={async () => { setModal(null); await load(); }} />}
    {modal?.type === 'location' && <LocationModal mission={modal.mission} close={() => setModal(null)} done={async () => { setModal(null); await load(); }} />}
  </main>;
}

function TasksView({ missions, onAction, onReload, setError }: { missions: DeliveryMissionSummary[]; onAction: (type: 'deliver' | 'fail' | 'reschedule' | 'return' | 'location', mission: DeliveryMissionSummary) => void; onReload: () => Promise<void>; setError: (message: string) => void }) {
  const groups: Array<{ title: string; statuses: DeliveryStatus[] }> = [
    { title: 'بانتظار استلام العهدة', statuses: ['PENDING_DELEGATE_ACKNOWLEDGEMENT'] },
    { title: 'مهام اليوم / جاهزة للتنفيذ', statuses: ['OUT_WITH_DELEGATE'] },
    { title: 'مؤجلة', statuses: ['DEFERRED'] },
    { title: 'تعذّر ويحتاج إجراء', statuses: ['DELIVERY_FAILED'] },
    { title: 'إرجاع بانتظار تأكيد الجمعية', statuses: ['PENDING_RETURN_APPROVAL'] },
    { title: 'تسليم بانتظار الاعتمادات', statuses: ['PENDING_DELIVERY_APPROVAL'] },
  ];
  return <section>{groups.map((group) => {
    const rows = missions.filter((mission) => group.statuses.includes(mission.status));
    if (!rows.length) return null;
    return <div key={group.title}><h2 className="delegate-group-title">{group.title}<span>{rows.length}</span></h2>{rows.map((mission) => <MissionCard key={mission.id} mission={mission} actions={<>
      {mission.status === 'PENDING_DELEGATE_ACKNOWLEDGEMENT' && <Action primary label="تأكيد استلام العهدة" run={async () => { try { await confirmHandover(mission.id); await onReload(); } catch (error) { setError(readError(error)); } }} />}
      {mission.status === 'OUT_WITH_DELEGATE' && <><Action primary label="بدء / تأكيد التسليم" run={() => onAction('deliver', mission)} /><Action label="تعذّر التسليم" run={() => onAction('fail', mission)} /><Action label="تحديث الموقع" run={() => onAction('location', mission)} /></>}
      {mission.status === 'DELIVERY_FAILED' && <><Action primary label="إعادة الجدولة" run={() => onAction('reschedule', mission)} /><Action label="إرجاع السلة" run={() => onAction('return', mission)} /></>}
      {mission.status === 'DEFERRED' && <><span style={mutedStyle}>ستعود للمسار التشغيلي في موعدها المحدد.</span><Action label="إرجاع السلة" run={() => onAction('return', mission)} /></>}
    </>} />)}</div>;
  })}{!missions.length && <Empty text="لا توجد مهام تشغيلية الآن." />}</section>;
}

function MissionCard({ mission, actions, order, onViewProof }: { mission: DeliveryMissionSummary; actions?: React.ReactNode; order?: number; onViewProof?: () => void }) {
  const beneficiary = mission.beneficiary; const digits = beneficiary.phone.replace(/\D/g, '');
  const basket = beneficiary.needs.map((need) => DEVICE_TYPE_LABELS[need.deviceType]).join('، ');
  return <article className="delegate-card"><div className="delegate-card-top">{order && <span className="route-order">{order}</span>}<div><strong>{beneficiary.name}</strong><p>{beneficiary.city}{beneficiary.district ? ` — ${beneficiary.district}` : ''}</p></div><span className="mission-status">{DELIVERY_STATUS_LABELS[mission.status]}</span></div>
    <dl className="mission-facts"><div><dt>السلة المعتمدة</dt><dd>{basket || 'لا توجد احتياجات معتمدة'}</dd></div><div><dt>الموعد</dt><dd>{mission.scheduledFor ? new Intl.DateTimeFormat('ar-SA', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(mission.scheduledFor)) : 'جاهزة دون موعد محدد'}</dd></div></dl>
    <div className="button-row"><a style={secondaryButtonStyle} href={`tel:${digits}`}>اتصال</a><a style={secondaryButtonStyle} href={`https://wa.me/966${digits.replace(/^0/, '')}`} target="_blank" rel="noreferrer">واتساب</a>{hasCoordinates(mission) && <a style={secondaryButtonStyle} href={`https://www.google.com/maps/search/?api=1&query=${beneficiary.latitude},${beneficiary.longitude}`} target="_blank" rel="noreferrer">فتح الموقع</a>}{onViewProof && <button style={secondaryButtonStyle} onClick={onViewProof}>عرض الإثبات</button>}</div>
    {actions && <div className="delegate-card-actions">{actions}</div>}
  </article>;
}

function DeliveryModal({ mission, close, done }: ModalProps) {
  const [proof, setProof] = useState<File | null>(null); const [signature, setSignature] = useState<File | null>(null); const [pledged, setPledged] = useState(false); const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  const missing = [!proof && 'صورة الإثبات', !signature && 'توقيع المستلم', !pledged && 'الإقرار'].filter(Boolean).join('، ');
  return <Dialog title={`تأكيد التسليم — ${mission.beneficiary.name}`} close={close}><p style={mutedStyle}>يلزم إرفاق صورة واضحة للتسليم، وتوقيع المستلم، ثم تأكيد الإقرار. يتحقق الخادم من العناصر الثلاثة قبل قبول العملية.</p><label style={labelStyle}>صورة إثبات التسليم (إلزامية)<input style={inputStyle} type="file" accept="image/jpeg,image/png,image/webp" capture="environment" onChange={(event) => setProof(validateImage(event.target.files?.[0], setError))} /></label><SignatureInput onChange={setSignature} setError={setError} /><label className="check-row"><input type="checkbox" checked={pledged} onChange={(event) => setPledged(event.target.checked)} />أؤكد تسليم كامل السلة للمستفيد وصحة الإثبات والتوقيع.</label>{missing && <p role="status">يلزم استكمال: {missing}.</p>}{error && <p style={errorStyle}>{error}</p>}<button style={primaryButtonStyle} disabled={!!missing || busy} onClick={async () => { if (!proof || !signature || !pledged) return; setBusy(true); try { await confirmDelivery(mission.id, proof, signature, true); await done(); } catch (caught) { setError(readError(caught)); } finally { setBusy(false); } }}>إرسال للمراجعة والاعتماد</button></Dialog>;
}

function FailureModal({ mission, close, done }: ModalProps) { const [reason, setReason] = useState<DeliveryFailureReason | ''>(''); const [notes, setNotes] = useState(''); const [error, setError] = useState(''); return <Dialog title={`تعذّر التسليم — ${mission.beneficiary.name}`} close={close}><label style={labelStyle}>السبب<select style={inputStyle} value={reason} onChange={(event) => setReason(event.target.value as DeliveryFailureReason)}><option value="">اختر السبب</option>{Object.entries(DELIVERY_FAILURE_REASON_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label style={labelStyle}>ملاحظات<textarea style={{ ...inputStyle, minHeight: 90 }} value={notes} onChange={(event) => setNotes(event.target.value)} /></label>{error && <p style={errorStyle}>{error}</p>}<button style={primaryButtonStyle} disabled={!reason || (reason === 'RECEIPT_REFUSED' && !notes.trim())} onClick={async () => { try { await failDelivery(mission.id, reason as DeliveryFailureReason, notes || undefined); await done(); } catch (caught) { setError(readError(caught)); } }}>تسجيل التعذّر</button></Dialog>; }
function RescheduleModal({ mission, close, done }: ModalProps) { const [reason, setReason] = useState(''); const [date, setDate] = useState(''); const [error, setError] = useState(''); const [minimumDate] = useState(() => new Date(Date.now() + 60_000).toISOString().slice(0, 16)); return <Dialog title="إعادة جدولة المهمة" close={close}><p>ستبقى السلة في عهدتك ولن تتحرك للمستودع.</p><label style={labelStyle}>سبب إعادة الجدولة<textarea style={{ ...inputStyle, minHeight: 80 }} value={reason} onChange={(event) => setReason(event.target.value)} /></label><label style={labelStyle}>موعد مستقبلي<input style={inputStyle} type="datetime-local" value={date} min={minimumDate} onChange={(event) => setDate(event.target.value)} /></label>{error && <p style={errorStyle}>{error}</p>}<button style={primaryButtonStyle} disabled={!reason.trim() || !date} onClick={async () => { try { await rescheduleDelivery(mission.id, reason, new Date(date).toISOString()); await done(); } catch (caught) { setError(readError(caught)); } }}>حفظ الموعد</button></Dialog>; }
function ReturnModal({ mission, close, done }: ModalProps) { const [notes, setNotes] = useState(''); const [confirmed, setConfirmed] = useState(false); const [error, setError] = useState(''); return <Dialog title="طلب إرجاع السلة" close={close}><p>هذا طلب إرجاع فقط. تبقى العهدة والأجهزة معك حتى تؤكد الجمعية الاستلام الفعلي.</p><label style={labelStyle}>ملاحظات الإرجاع<textarea style={{ ...inputStyle, minHeight: 80 }} value={notes} onChange={(event) => setNotes(event.target.value)} /></label><label className="check-row"><input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} />أفهم أن العهدة لا تُغلق بهذا الطلب.</label>{error && <p style={errorStyle}>{error}</p>}<button style={primaryButtonStyle} disabled={!confirmed} onClick={async () => { try { await returnDelivery(mission.id, notes || undefined); await done(); } catch (caught) { setError(readError(caught)); } }}>إرسال طلب الإرجاع</button></Dialog>; }
function LocationModal({ mission, close, done }: ModalProps) { const [lat, setLat] = useState(mission.beneficiary.latitude == null ? '' : String(mission.beneficiary.latitude)); const [lng, setLng] = useState(mission.beneficiary.longitude == null ? '' : String(mission.beneficiary.longitude)); const [error, setError] = useState(''); return <Dialog title="تحديث موقع المستفيد" close={close}><button style={secondaryButtonStyle} onClick={() => navigator.geolocation?.getCurrentPosition((position) => { setLat(String(position.coords.latitude)); setLng(String(position.coords.longitude)); }, () => setError('تعذر تحديد الموقع الحالي.'))}>استخدام موقعي الحالي</button><label style={labelStyle}>خط العرض<input style={inputStyle} inputMode="decimal" value={lat} onChange={(event) => setLat(event.target.value)} /></label><label style={labelStyle}>خط الطول<input style={inputStyle} inputMode="decimal" value={lng} onChange={(event) => setLng(event.target.value)} /></label>{error && <p style={errorStyle}>{error}</p>}<button style={primaryButtonStyle} disabled={!lat || !lng} onClick={async () => { try { await updateBeneficiaryLocation(mission.beneficiaryId, { lat: Number(lat), lng: Number(lng), locationSource: 'MANUAL' }); await done(); } catch (caught) { setError(readError(caught)); } }}>حفظ الموقع</button></Dialog>; }

function SignatureInput({ onChange, setError }: { onChange: (file: File | null) => void; setError: (message: string) => void }) { const canvas = useRef<HTMLCanvasElement>(null); const drawing = useRef(false); function point(event: React.PointerEvent<HTMLCanvasElement>) { const element = canvas.current!; const rect = element.getBoundingClientRect(); return { x: (event.clientX - rect.left) * element.width / rect.width, y: (event.clientY - rect.top) * element.height / rect.height }; } return <label style={labelStyle}>توقيع المستلم الإلكتروني<canvas ref={canvas} className="signature-canvas" width={640} height={220} onPointerDown={(event) => { drawing.current = true; const p = point(event); const ctx = canvas.current!.getContext('2d')!; ctx.beginPath(); ctx.moveTo(p.x, p.y); event.currentTarget.setPointerCapture(event.pointerId); }} onPointerMove={(event) => { if (!drawing.current) return; const p = point(event); const ctx = canvas.current!.getContext('2d')!; ctx.lineWidth = 4; ctx.lineCap = 'round'; ctx.strokeStyle = '#24181c'; ctx.lineTo(p.x, p.y); ctx.stroke(); }} onPointerUp={() => { drawing.current = false; canvas.current?.toBlob((blob) => onChange(blob ? new File([blob], 'recipient-signature.png', { type: 'image/png' }) : null), 'image/png'); }} /><div className="button-row"><button type="button" style={secondaryButtonStyle} onClick={() => { canvas.current?.getContext('2d')?.clearRect(0, 0, 640, 220); onChange(null); }}>مسح التوقيع</button><span style={mutedStyle}>أو ارفع صورة توقيع آمنة:</span><input type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => onChange(validateImage(event.target.files?.[0], setError))} /></div></label>; }
function Dialog({ title, close, children }: { title: string; close: () => void; children: React.ReactNode }) { return <div style={modalOverlayStyle} role="dialog" aria-modal="true"><div style={{ ...modalStyle, maxWidth: 560, display: 'grid', gap: 14, maxHeight: '92vh', overflow: 'auto' }}><div className="delegate-card-top"><h2>{title}</h2><button style={secondaryButtonStyle} onClick={close}>إغلاق</button></div>{children}</div></div>; }
function Action({ label, run, primary }: { label: string; run: () => void | Promise<void>; primary?: boolean }) { return <button style={primary ? primaryButtonStyle : secondaryButtonStyle} onClick={() => void run()}>{label}</button>; }
function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) { return <button className={active ? 'active' : ''} aria-current={active ? 'page' : undefined} onClick={onClick}>{children}</button>; }
function Empty({ text }: { text: string }) { return <div style={cardStyle}><p style={mutedStyle}>{text}</p></div>; }
type ModalProps = { mission: DeliveryMissionSummary; close: () => void; done: () => Promise<void> };
function hasCoordinates(mission: DeliveryMissionSummary) { return mission.beneficiary.latitude != null && mission.beneficiary.longitude != null; }
function isTodayOrReady(value: string | null) { if (!value) return true; return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Riyadh' }).format(new Date(value)) === new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Riyadh' }).format(new Date()); }
async function loadEveryPageForStatus(status: DeliveryStatus) { const first = await listDeliveries({ status, page: 1, pageSize: 100 }); const rows = [...first.items]; for (let page = 2; page <= first.totalPages; page += 1) rows.push(...(await listDeliveries({ status, page, pageSize: 100 })).items); return rows; }
async function viewProof(mission: DeliveryMissionSummary, setError: (message: string) => void) { try { const detail = await getDelivery(mission.id); const attempt = detail.attempts.find((item) => item.hasProof); if (!attempt) throw new Error('لا توجد صورة إثبات لهذه المهمة.'); const { url } = await getDeliveryProofUrl(attempt.id); window.open(url, '_blank', 'noopener,noreferrer'); } catch (error) { setError(readError(error)); } }
function readError(error: unknown) { return error instanceof Error ? error.message : 'تعذر تنفيذ العملية.'; }
function validateImage(file: File | undefined, setError: (message: string) => void) { if (!file) return null; if (file.size > 6 * 1024 * 1024) { setError('حجم الصورة يتجاوز 6 ميجابايت.'); return null; } if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) { setError('صيغة الصورة غير مدعومة.'); return null; } setError(''); return file; }
