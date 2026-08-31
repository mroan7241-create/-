'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { CurrentUser, DeliveryStatus, DeviceType, WorkflowRecord } from '../lib/api';
import {
  DELIVERY_STATUS_LABELS,
  activateParticipation, apiFetch, completeParticipationSetup, confirmPhysicalReturn, createAgreement,
  createPurchaseOrder, createShipment, decideDelivery, decideEscalation, generateOrganizationClosure,
  listDeliveries, listEscalations, listNotifications, listOutboxFailures, listParticipations, listProcurement, listSystemSettings, markNotificationRead,
  generateProjectClosure, getProjectClosure, openEscalation, promoteReserve, reopenOrganizationClosure, requestCoordinatorChange, setBeneficiaryList,
  transitionAgreement, transitionOrganizationClosure, transitionPurchaseOrder, transitionShipment,
  saveSystemSetting, transitionProjectClosure, updateOrganizationClosure,
} from '../lib/api';
import { cardStyle, errorStyle, inputStyle, labelStyle, primaryButtonStyle, secondaryButtonStyle, successStyle } from '../lib/ui';

type Section = { key: string; title: string; rows: WorkflowRecord[]; error?: string };
export type WorkflowSectionKey = 'participations' | 'deliveries' | 'procurement' | 'escalations' | 'notifications' | 'beneficiaries' | 'outbox' | 'project-closure';
type FormKind = 'agreement' | 'sign-org' | 'sign-zaad' | 'coordinator' | 'closure' | 'reopen' | 'return-good' | 'return-damaged' | 'escalation' | 'escalation-decision' | 'list-main' | 'list-reserve' | 'promote' | 'purchase-order' | 'shipment' | 'donor-feedback';
type OpenForm = { kind: FormKind; row?: WorkflowRecord };

export function WorkflowHub({ user, sectionKeys }: { user: CurrentUser; sectionKeys?: WorkflowSectionKey[] }) {
  const [sections, setSections] = useState<Section[]>([]);
  const [form, setForm] = useState<OpenForm | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [credential, setCredential] = useState<{ email: string; password: string } | null>(null);
  const sectionKeySignature = sectionKeys?.join('|') ?? '';

  const load = useCallback(async () => {
    let jobs: Array<[WorkflowSectionKey, string, Promise<unknown>]> = [
      ['participations', 'المشاركات والاتفاقيات', listParticipations()],
      ['deliveries', 'اعتمادات التسليم والإرجاع', listDeliveries({ pageSize: 100 })],
      ['procurement', 'أوامر الشراء والشحنات', listProcurement()],
      ['escalations', 'التصعيدات', listEscalations()],
      ['notifications', 'الإشعارات', listNotifications()],
      ['beneficiaries', 'قوائم المستفيدين', apiFetch('/beneficiaries?page=1&pageSize=100')],
    ];
    if (user.role === 'ADMIN') jobs.push(['outbox', 'مراقبة أحداث الأتمتة المتعثرة', listOutboxFailures()]);
    if (user.role === 'ADMIN') jobs.push(['project-closure', 'التقرير الختامي للمشروع', getProjectClosure().then((report) => report ? [report] : [])]);
    if (sectionKeySignature) {
      const requestedKeys = sectionKeySignature.split('|') as WorkflowSectionKey[];
      jobs = jobs.filter(([key]) => requestedKeys.includes(key));
    }
    const settled = await Promise.allSettled(jobs.map((job) => job[2]));
    setSections(settled.map((result, index) => {
      const [key, title] = jobs[index];
      if (result.status === 'rejected') return { key, title, rows: [], error: readError(result.reason) };
      const body = result.value as { items?: WorkflowRecord[] };
      return { key, title, rows: Array.isArray(body) ? body : body.items ?? [] };
    }));
  }, [user.role, sectionKeySignature]);
  useEffect(() => { void load(); }, [load]);

  async function act(action: () => Promise<unknown>, success = 'تم تنفيذ العملية وتحديث البيانات.', credentialEmail = '') {
    setBusy(true); setMessage('');
    try {
      const result = await action() as { temporaryPassword?: string | null; accountId?: string } | undefined;
      if (result?.temporaryPassword) {
        setCredential({ email: credentialEmail, password: result.temporaryPassword });
      }
      setMessage(success); setForm(null); await load();
    } catch (error) { setMessage(readError(error)); }
    finally { setBusy(false); }
  }

  const associationOptions = useMemo(() => (sections.find((section) => section.key === 'participations')?.rows ?? []).flatMap((row) => {
    const association = row.association as WorkflowRecord | null | undefined;
    return association?.id ? [{ id: String(association.id), label: String(association.name ?? association.publicCode) }] : [];
  }), [sections]);

  return <div className="workflow-hub">
    {message && <p role="status" style={message.startsWith('تم') ? successStyle : errorStyle}>{message}</p>}
    {credential && <section style={{ ...cardStyle, border: '2px solid #d46a2e' }}><h2>بيانات الدخول المؤقتة — تُعرض مرة واحدة</h2><p>البريد: <b dir="ltr">{credential.email}</b></p><p>كلمة المرور المؤقتة: <b dir="ltr">{credential.password}</b></p><button style={secondaryButtonStyle} onClick={() => setCredential(null)}>فهمت وحفظت البيانات بأمان</button></section>}
    <div className="workflow-toolbar">
      {user.role === 'ADMIN' && sectionKeys?.includes('procurement') && <button style={primaryButtonStyle} onClick={() => setForm({ kind: 'purchase-order' })}>إنشاء أمر شراء</button>}
      {user.role === 'ADMIN' && sectionKeys?.includes('project-closure') && <button style={secondaryButtonStyle} onClick={() => void act(() => generateProjectClosure(), 'تم توليد التقرير الختامي من البيانات المغلقة.')}>توليد تقرير المشروع</button>}
      {sectionKeys?.includes('escalations') && <button style={secondaryButtonStyle} onClick={() => setForm({ kind: 'escalation' })}>فتح تصعيد تشغيلي</button>}
    </div>
    {user.role === 'ADMIN' && sectionKeys?.includes('escalations') && <BusinessCalendarSettings busy={busy} act={act} />}
    {form && <OperationalForm form={form} user={user} associations={associationOptions} busy={busy} close={() => setForm(null)} act={act} />}
    {sections.map((section) => <section key={section.key} style={cardStyle}><h2>{section.title}</h2>{section.error ? <p style={errorStyle}>{section.error}</p> : section.rows.length === 0 ? <p>لا توجد عناصر تحتاج إجراء.</p> : section.rows.map((row) => <OperationalRow key={row.id} user={user} section={section.key} row={row} busy={busy} setForm={setForm} act={act} />)}</section>)}
  </div>;
}

function BusinessCalendarSettings({ busy, act }: { busy: boolean; act: (action: () => Promise<unknown>, success?: string) => Promise<void> }) {
  const [workingDays, setWorkingDays] = useState('');
  const [holidays, setHolidays] = useState('');
  useEffect(() => { void listSystemSettings().then((body) => {
    const items = (body as unknown as { items?: Array<{ key: string; value: unknown }> }).items ?? [];
    const days = items.find((item) => item.key === 'calendar.workingDays')?.value;
    const dates = items.find((item) => item.key === 'calendar.holidays')?.value;
    if (Array.isArray(days)) setWorkingDays(days.join(','));
    if (Array.isArray(dates)) setHolidays(dates.join('\n'));
  }).catch(() => undefined); }, []);
  return <section style={cardStyle}><h2>تقويم أيام العمل وSLA</h2><p>القاعدة المعتمدة ثابتة: تنبيه الجمعية بعد يوم عمل، ثم تصعيد زاد بعد يوم عمل إضافي. لا توجد قائمة عطل مفترضة.</p>
    <div className="form-grid"><label style={labelStyle}>أيام العمل (0=الأحد … 6=السبت)<input style={inputStyle} placeholder="مثال: 0,1,2,3,4" value={workingDays} onChange={(event) => setWorkingDays(event.target.value)} /></label><label style={labelStyle}>العطل المعتمدة — تاريخ في كل سطر<textarea style={{ ...inputStyle, minHeight: 90 }} placeholder="YYYY-MM-DD" value={holidays} onChange={(event) => setHolidays(event.target.value)} /></label></div>
    {(!workingDays.trim()) && <p style={errorStyle}>BUSINESS CONFIG REQUIRED: أيام العمل لم تُعتمد بعد.</p>}
    <button style={primaryButtonStyle} disabled={busy || !workingDays.trim()} onClick={() => void act(async () => { const days = [...new Set(workingDays.split(',').map((value) => Number(value.trim())).filter((value) => Number.isInteger(value)))]; const dates = holidays.split(/\r?\n|,/).map((value) => value.trim()).filter(Boolean); await saveSystemSetting('calendar.workingDays', days); await saveSystemSetting('calendar.holidays', dates); }, 'تم حفظ تقويم أيام العمل دون اختراع عطل.')}>حفظ التقويم</button>
  </section>;
}

function OperationalRow({ user, section, row, busy, setForm, act }: { user: CurrentUser; section: string; row: WorkflowRecord; busy: boolean; setForm: (form: OpenForm) => void; act: (action: () => Promise<unknown>, success?: string, credentialEmail?: string) => Promise<void> }) {
  const publicLabel = String(row.publicCode ?? row.orderNumber ?? row.title ?? row.name ?? 'سجل تشغيلي');
  const status = String(row.status ?? row.listType ?? '');
  const buttons: React.ReactNode[] = [];
  const button = (label: string, action: () => Promise<unknown>) => buttons.push(<button key={label} style={secondaryButtonStyle} disabled={busy} onClick={() => void act(action)}>{label}</button>);
  const formButton = (label: string, kind: FormKind) => buttons.push(<button key={label} style={secondaryButtonStyle} disabled={busy} onClick={() => setForm({ kind, row })}>{label}</button>);

  if (section === 'participations') {
    const agreement = (row.agreements as WorkflowRecord[] | undefined)?.[0];
    const closure = row.closureReport as WorkflowRecord | undefined;
    if (user.role === 'ADMIN') {
      if (!agreement) formButton('إنشاء اتفاقية', 'agreement');
      if (agreement?.status === 'DRAFT') button('إرسال الاتفاقية', () => transitionAgreement(agreement.id, 'SENT'));
      if (agreement?.status === 'SENT') formButton('تسجيل توقيع الجمعية', 'sign-org');
      if (agreement?.status === 'SIGNED_BY_ORG') formButton('تسجيل توقيع زاد', 'sign-zaad');
      button('إكمال التجهيز', () => completeParticipationSetup(row.id));
      const application = row.application as WorkflowRecord | undefined;
      buttons.push(<button key="activate" style={primaryButtonStyle} disabled={busy} onClick={() => void act(() => activateParticipation(row.id), 'تم تفعيل الجمعية وعرض بيانات الدخول المؤقتة مرة واحدة.', String(application?.email ?? ''))}>تفعيل الجمعية</button>);
      if (closure?.status === 'SUBMITTED') button('بدء مراجعة الإغلاق', () => transitionOrganizationClosure(closure.id, 'UNDER_REVIEW'));
      if (closure?.status === 'UNDER_REVIEW') button('اعتماد تقرير الجمعية', () => transitionOrganizationClosure(closure.id, 'APPROVED'));
      if (closure?.status === 'APPROVED') button('إغلاق المشاركة', () => transitionOrganizationClosure(closure.id, 'CLOSED'));
      if (closure?.status === 'CLOSED') formButton('إعادة فتح موثقة', 'reopen');
    } else {
      formButton('طلب تغيير المنسق', 'coordinator');
      button('فحص جاهزية الإغلاق', () => apiFetch(`/reports/closure/readiness/${row.id}`));
      if (!closure) button('إنشاء تقرير الإغلاق', () => generateOrganizationClosure(row.id));
      if (closure && ['GENERATED', 'REOPENED'].includes(String(closure.status))) { formButton('تحرير التقرير النوعي', 'closure'); button('إرسال التقرير', () => transitionOrganizationClosure(closure.id, 'SUBMITTED')); }
    }
  }
  if (section === 'deliveries' && status === 'PENDING_DELIVERY_APPROVAL') {
    if (user.role === 'ADMIN') button('اعتماد زاد النهائي', () => decideDelivery(row.id, 'zaad', 'APPROVED'));
    else button('اعتماد الجمعية', () => decideDelivery(row.id, 'association', 'APPROVED'));
  }
  if (section === 'deliveries' && status === 'PENDING_RETURN_APPROVAL' && user.role === 'ASSOCIATION') { formButton('تأكيد عودة سليمة', 'return-good'); formButton('تأكيد عودة تالفة', 'return-damaged'); }
  if (section === 'escalations' && user.role === 'ADMIN' && ['OPEN', 'NEEDS_INFO'].includes(status)) formButton('قرار زاد', 'escalation-decision');
  if (section === 'notifications' && !row.readAt) button('تعليم كمقروء', () => markNotificationRead(row.id));
  if (section === 'beneficiaries' && user.role === 'ADMIN') { formButton('إدراج MAIN', 'list-main'); formButton('إدراج RESERVE', 'list-reserve'); if (row.listType === 'RESERVE') formButton('ترقية احتياطي', 'promote'); }
  if (section === 'procurement' && user.role === 'ADMIN') {
    if (status === 'DRAFT') { button('اعتماد أمر الشراء', () => transitionPurchaseOrder(row.id, 'APPROVED')); button('إلغاء', () => transitionPurchaseOrder(row.id, 'CANCELLED')); }
    if (['APPROVED', 'PARTIALLY_DELIVERED'].includes(status)) formButton('إنشاء شحنة', 'shipment');
    const shipments = row.shipments as WorkflowRecord[] | undefined;
    shipments?.forEach((shipment) => { if (shipment.status === 'PLANNED') button(`إرسال الشحنة ${String(shipment.publicCode)}`, () => transitionShipment(shipment.id, 'DISPATCHED')); });
  }
  if (section === 'project-closure' && user.role === 'ADMIN') {
    if (status === 'GENERATED') button('بدء المراجعة الداخلية', () => transitionProjectClosure('UNDER_INTERNAL_REVIEW'));
    if (status === 'UNDER_INTERNAL_REVIEW') button('اعتماد داخلي', () => transitionProjectClosure('APPROVED_INTERNAL'));
    if (status === 'APPROVED_INTERNAL') button('إرسال للداعم', () => transitionProjectClosure('SUBMITTED_TO_DONOR'));
    if (['SUBMITTED_TO_DONOR', 'RESUBMITTED'].includes(status)) { formButton('تسجيل ملاحظات الداعم', 'donor-feedback'); button('تسجيل اعتماد الداعم', () => transitionProjectClosure('DONOR_APPROVED')); }
    if (status === 'DONOR_FEEDBACK') button('إعادة الإرسال', () => transitionProjectClosure('RESUBMITTED'));
    if (status === 'DONOR_APPROVED') button('إغلاق المشروع', () => transitionProjectClosure('PROJECT_CLOSED'));
  }
  return <article className="workflow-row"><div><strong>{publicLabel}</strong><p>{humanStatus(status)}</p></div><div className="button-row">{buttons}</div></article>;
}

function OperationalForm({ form, user, associations, busy, close, act }: { form: OpenForm; user: CurrentUser; associations: Array<{ id: string; label: string }>; busy: boolean; close: () => void; act: (action: () => Promise<unknown>, success?: string, credentialEmail?: string) => Promise<void> }) {
  const [fields, setFields] = useState<Record<string, string>>({ version: '1', deviceType: 'REFRIGERATOR', quantity: '1', severity: 'MEDIUM', decision: 'APPROVED', associationId: associations[0]?.id ?? '' });
  const row = form.row; const agreement = (row?.agreements as WorkflowRecord[] | undefined)?.[0]; const closure = row?.closureReport as WorkflowRecord | undefined;
  const field = (name: string, label: string, options?: string[]) => <label style={labelStyle}>{label}{options ? <select style={inputStyle} value={fields[name] ?? ''} onChange={(event) => setFields({ ...fields, [name]: event.target.value })}>{options.map((option) => <option key={option} value={option}>{humanStatus(option)}</option>)}</select> : <input style={inputStyle} value={fields[name] ?? ''} onChange={(event) => setFields({ ...fields, [name]: event.target.value })} />}</label>;
  let title = 'إجراء تشغيلي'; let content: React.ReactNode = null; let submit: (() => Promise<unknown>) | null = null;
  if (form.kind === 'agreement') { title = 'إنشاء مسودة اتفاقية'; content = <>{field('version', 'رقم النسخة')}{field('templateVersion', 'نسخة القالب')}{field('reference', 'مرجع الاتفاقية')}</>; submit = () => createAgreement(row!.id, Number(fields.version), fields.templateVersion); }
  if (form.kind === 'sign-org' || form.kind === 'sign-zaad') { title = 'توثيق التوقيع'; content = field('signer', 'اسم الموقّع'); submit = () => transitionAgreement(agreement!.id, form.kind === 'sign-org' ? 'SIGNED_BY_ORG' : 'SIGNED', fields.signer); }
  if (form.kind === 'coordinator') { title = 'طلب تغيير المنسق الرسمي'; content = <>{field('name', 'اسم المنسق')}{field('phone', 'الجوال')}{field('email', 'البريد')}{field('title', 'الصفة')}{field('reason', 'سبب التغيير')}</>; submit = () => requestCoordinatorChange(row!.id, { proposedName: fields.name, proposedPhone: fields.phone, proposedEmail: fields.email, proposedTitle: fields.title, reason: fields.reason }); }
  if (form.kind === 'closure') { title = 'المحتوى النوعي للتقرير'; content = <>{field('challenges', 'أبرز التحديات')}{field('lessonsLearned', 'الدروس المستفادة')}{field('recommendations', 'التوصيات')}{field('finalNotes', 'ملاحظات ختامية')}</>; submit = () => updateOrganizationClosure(closure!.id, fields); }
  if (form.kind === 'reopen') { title = 'إعادة فتح مشاركة مغلقة'; content = field('reason', 'السبب الإلزامي'); submit = () => reopenOrganizationClosure(closure!.id, fields.reason); }
  if (form.kind === 'return-good' || form.kind === 'return-damaged') { title = 'تأكيد الاستلام الفعلي'; content = field('notes', 'ملاحظات الحالة والاستلام'); submit = () => confirmPhysicalReturn(row!.id, form.kind === 'return-good' ? 'GOOD' : 'DAMAGED', fields.notes); }
  if (form.kind === 'escalation') { title = 'فتح تصعيد تشغيلي'; content = <>{user.role === 'ADMIN' && <label style={labelStyle}>الجمعية<select style={inputStyle} value={fields.associationId} onChange={(event) => setFields({ ...fields, associationId: event.target.value })}>{associations.map((association) => <option key={association.id} value={association.id}>{association.label}</option>)}</select></label>}{field('category', 'فئة التصعيد')}{field('severity', 'الخطورة', ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'])}{field('description', 'الوصف')}{field('requestedAction', 'الإجراء المطلوب')}</>; submit = () => openEscalation({ associationId: user.role === 'ADMIN' ? fields.associationId : undefined, category: fields.category, severity: fields.severity as 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL', description: fields.description, requestedAction: fields.requestedAction }); }
  if (form.kind === 'escalation-decision') { title = 'قرار زاد في التصعيد'; content = <>{field('decision', 'القرار', ['NEEDS_INFO', 'APPROVED', 'REJECTED', 'RESOLVED'])}{field('resolution', 'سبب القرار / المطلوب')}</>; submit = () => decideEscalation(row!.id, fields.decision as 'NEEDS_INFO' | 'APPROVED' | 'REJECTED' | 'RESOLVED', fields.resolution); }
  if (['list-main', 'list-reserve', 'promote'].includes(form.kind)) { title = 'قرار قائمة المستفيدين'; content = <>{form.kind !== 'promote' && field('rank', 'الترتيب')}{field('reason', 'سبب القرار')}</>; submit = () => form.kind === 'promote' ? promoteReserve(row!.id, fields.reason) : setBeneficiaryList(row!.id, form.kind === 'list-main' ? 'MAIN' : 'RESERVE', Number(fields.rank), fields.reason); }
  if (form.kind === 'purchase-order') { title = 'إنشاء أمر شراء'; content = <><label style={labelStyle}>الجمعية<select style={inputStyle} value={fields.associationId} onChange={(event) => setFields({ ...fields, associationId: event.target.value })}>{associations.map((association) => <option key={association.id} value={association.id}>{association.label}</option>)}</select></label>{field('orderNumber', 'رقم أمر الشراء')}{field('supplierName', 'المورد')}{field('deviceType', 'نوع الجهاز', ['REFRIGERATOR', 'OVEN', 'WASHING_MACHINE'])}{field('quantity', 'الكمية المعتمدة')}{field('spec', 'المواصفة')}</>; submit = () => createPurchaseOrder({ associationId: fields.associationId, orderNumber: fields.orderNumber, supplierName: fields.supplierName, items: [{ deviceType: fields.deviceType as DeviceType, approvedQty: Number(fields.quantity), spec: fields.spec }] }); }
  if (form.kind === 'shipment') { const items = row!.items as WorkflowRecord[]; title = 'إنشاء شحنة جزئية أو كاملة'; content = <>{field('location', 'الموقع / نقطة التسليم')}{field('scheduledAt', 'الموعد بصيغة ISO')}{items.map((item) => field(`qty-${item.id}`, `كمية ${humanStatus(String(item.deviceType))} (المعتمد ${String(item.approvedQty)})`))}</>; submit = () => createShipment({ purchaseOrderId: row!.id, route: 'SUPPLIER_TO_ASSOCIATION', location: fields.location, scheduledAt: fields.scheduledAt || undefined, items: items.map((item) => ({ purchaseOrderItemId: item.id, shippedQty: Number(fields[`qty-${item.id}`] ?? 0) })).filter((item) => item.shippedQty > 0) }); }
  if (form.kind === 'donor-feedback') { title = 'ملاحظات الداعم'; content = field('feedback', 'الملاحظات الواردة من الداعم'); submit = () => transitionProjectClosure('DONOR_FEEDBACK', fields.feedback); }
  return <section style={{ ...cardStyle, border: '2px solid #8a1538' }}><div className="workflow-row"><h2>{title}</h2><button style={secondaryButtonStyle} onClick={close}>إلغاء</button></div><div className="form-grid">{content}</div><button style={primaryButtonStyle} disabled={busy || !submit} onClick={() => submit && void act(submit)}>حفظ وتنفيذ</button></section>;
}

function humanStatus(value: string) {
  if (value in DELIVERY_STATUS_LABELS) return DELIVERY_STATUS_LABELS[value as DeliveryStatus];
  const labels: Record<string, string> = {
    DRAFT: 'مسودة', SENT: 'مرسلة', SIGNED_BY_ORG: 'وقعتها الجمعية', SIGNED: 'موقعة بالكامل',
    ACTIVE: 'نشطة', APPROVED_AWAITING_SETUP: 'بانتظار التجهيز', OPEN: 'مفتوح', NEEDS_INFO: 'يحتاج معلومات',
    APPROVED: 'معتمد', REJECTED: 'مرفوض', RESOLVED: 'محلول', MAIN: 'أساسي', RESERVE: 'احتياطي',
    REFRIGERATOR: 'ثلاجة', OVEN: 'فرن', WASHING_MACHINE: 'غسالة', LOW: 'منخفضة', MEDIUM: 'متوسطة',
    HIGH: 'عالية', CRITICAL: 'حرجة', GENERATED: 'تم توليد التقرير الختامي',
    UNDER_INTERNAL_REVIEW: 'قيد المراجعة الداخلية', APPROVED_INTERNAL: 'معتمد داخليًا',
    SUBMITTED_TO_DONOR: 'أُرسل للداعم', DONOR_FEEDBACK: 'وردت ملاحظات الداعم', RESUBMITTED: 'أُعيد إرساله للداعم',
    DONOR_APPROVED: 'معتمد من الداعم', PROJECT_CLOSED: 'المشروع مغلق',
  };
  return labels[value] ?? value.replaceAll('_', ' ');
}
function readError(error: unknown) { return error instanceof Error ? error.message : 'تعذر تنفيذ العملية.'; }
