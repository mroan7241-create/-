'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  APPLICATION_STATUS_LABELS,
  ApiClientError,
  apiFetch,
  startApplicationProcessing,
  type ApplicationStatus,
  type ApplicationSummary,
  type Paginated,
} from '../../lib/api';
import { useRoleGuard } from '../../lib/use-role-guard';
import { canAdmin } from '../../lib/admin-access';
import { AppShell } from '../../components/AppShell';
import { SelectionBoard } from '../selection/page';
import { WorkflowHub } from '../../components/WorkflowHub';
import styles from './applications.module.css';
import { ApplicationDetail, eligibilityLabel, selectionLabel } from './application-detail';
import { initialQueryParam } from '../../lib/query';
import {
  cardStyle,
  errorStyle,
  inputStyle,
  labelStyle,
  ltrStyle,
  mutedStyle,
  primaryButtonStyle,
  secondaryButtonStyle,
  statusBadgeStyle,
  tableStyle,
  tdStyle,
  thStyle,
} from '../../lib/ui';

const PAGE_SIZE = 25;
type WorkspaceSection = 'review' | 'selection' | 'files' | 'activation' | 'settings';
const WORKSPACE_SECTIONS: Array<{ key: WorkspaceSection; title: string; description: string }> = [
  { key: 'review', title: 'المراجعة والأهلية', description: 'طلبات جديدة، استكمال، واجتياز' },
  { key: 'selection', title: 'التقييم والاختيار', description: 'درجات، أساسية، واحتياطية' },
  { key: 'activation', title: 'الميثاق والتفعيل', description: 'الاتفاقية، التجهيز، والدخول' },
  { key: 'files', title: 'ملفات الطلبات', description: 'بحث وتفاصيل كل جمعية' },
  { key: 'settings', title: 'موعد التقديم', description: 'التحكم في فترة الاستقبال' },
];

export default function AdminApplicationsPage() {
  const { user, loading: guardLoading } = useRoleGuard(['ADMIN']);

  const [data, setData] = useState<Paginated<ApplicationSummary> | null>(null);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState(() => initialQueryParam('search') || '');
  const [searchInput, setSearchInput] = useState(() => initialQueryParam('search') || '');
  const [status, setStatus] = useState<'' | ApplicationStatus>(() => (initialQueryParam('status') as ApplicationStatus) || '');
  const [listError, setListError] = useState<string | null>(null);
  const [selected, setSelected] = useState<ApplicationSummary | null>(null);
  const [workflow, setWorkflow] = useState('');
  const [checked, setChecked] = useState<string[]>([]);
  const [actionMessage, setActionMessage] = useState('');
  const [processing, setProcessing] = useState(false);
  const loadSequence = useRef(0);
  const invalidateReads = useCallback(() => { loadSequence.current++; }, []);
  const [activeSection, setActiveSection] = useState<WorkspaceSection>(() => {
    const requested = initialQueryParam('view');
    return WORKSPACE_SECTIONS.some(({ key }) => key === requested) ? requested as WorkspaceSection : initialQueryParam('status') ? 'files' : 'review';
  });
  const visibleSections = WORKSPACE_SECTIONS.filter((section) => canAdmin(user, section.key === 'activation' ? 'participations.read' : section.key === 'settings' ? 'settings.manage' : 'applications.read'));
  const currentSection = visibleSections.some(({ key }) => key === activeSection) ? activeSection : visibleSections[0]?.key;
  const canReadApplications = canAdmin(user, 'applications.read');
  const accessKey = JSON.stringify([user?.id, user?.adminApplicationScope, user?.adminPermissions, user?.adminFullAccess]);

  const load = useCallback(async () => {
    const sequence = ++loadSequence.current;
    setListError(null);
    const params = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE) });
    if (search) params.set('search', search);
    if (status) params.set('status', status);
    if (workflow) params.set('workflow', workflow);
    try {
      const result = await apiFetch<Paginated<ApplicationSummary> & { counts?: Record<string, number> }>(`/association-applications?${params.toString()}`);
      if (sequence === loadSequence.current) setData(result);
      return sequence === loadSequence.current;
    } catch (err) {
      if (sequence === loadSequence.current) setListError(err instanceof ApiClientError ? err.message : 'تعذّر تحميل قائمة الطلبات.');
      return false;
    }
  }, [page, search, status, workflow]);

  useEffect(() => {
    if (canReadApplications && currentSection === 'files') void load();
    return invalidateReads;
  }, [canReadApplications, accessKey, load, currentSection, invalidateReads]);

  useEffect(() => { setData(null); setSelected(null); setChecked([]); }, [accessKey]);

  useEffect(() => { setChecked([]); }, [page, search, status, workflow, currentSection]);

  useEffect(() => {
    if (!initialQueryParam('search') || !data?.items.length) return;
    const match = data.items.find((item) => item.publicCode === search);
    if (match) setSelected(match);
  }, [data, search]);

  async function startCheckedProcessing() {
    if (processing || !checked.length || checked.length > 250) return;
    if (!window.confirm(`بدء مراجعة ${checked.length} طلبًا؟ هذا لا يعتمد الأهلية أو التقييم.`)) return;
    setProcessing(true); setActionMessage('');
    try {
      const result = await startApplicationProcessing(checked);
      const message = `تم بدء معالجة ${result.started} طلب، وسبق بدء ${result.alreadyStarted}.`;
      setActionMessage(message); setChecked([]);
      if (!await load()) setActionMessage(`${message} تعذّر تحديث العرض؛ لا تُعد تنفيذ الإجراء. حدّث القائمة.`);
    } catch (reason) { setActionMessage(reason instanceof Error ? reason.message : 'تعذر بدء المعالجة.'); }
    finally { setProcessing(false); }
  }

  if (guardLoading || !user) return null;

  return (
    <AppShell user={user}>
      <header className={styles.hero}>
        <span className={styles.eyebrow}>إدارة انضمام الجمعيات</span>
        <h1>من الطلب إلى التفعيل</h1>
        <p>راجع الأهلية، اختر الجمعيات الأساسية، ثم تابع الميثاق والتفعيل في مكان واحد.</p>
      </header>
      <nav className={styles.sections} aria-label="مراحل انضمام الجمعيات">
        {visibleSections.map((section) => <button
          key={section.key}
          type="button"
          className={`${styles.sectionButton} ${currentSection === section.key ? styles.sectionActive : ''}`}
          aria-current={currentSection === section.key ? 'step' : undefined}
          onClick={() => setActiveSection(section.key)}
        ><span className={styles.number} aria-hidden="true">{WORKSPACE_SECTIONS.indexOf(section) < 3 ? WORKSPACE_SECTIONS.indexOf(section) + 1 : section.key === 'files' ? '⌕' : '⚙'}</span><span><strong>{section.title}</strong><small>{section.description}</small></span></button>)}
      </nav>
      {(currentSection === 'review' || currentSection === 'selection') && <section aria-label={currentSection === 'review' ? 'المراجعة والأهلية' : 'التقييم والاختيار'}><SelectionBoard user={user} mode={currentSection} /></section>}
      {currentSection === 'activation' && <section aria-label="الميثاق والتفعيل"><WorkflowHub user={user} sectionKeys={['participations']} /></section>}
      {currentSection === 'settings' && <section aria-label="موعد التقديم"><SelectionBoard user={user} mode="settings" /></section>}
      {currentSection === 'files' && <section aria-label="ملفات الطلبات">
      <h2>تفاصيل الطلبات والبحث</h2>
      <div className="button-row" style={{ marginBottom: 16 }}>{[['','الكل'],['new','جديدة'],['processing','قيد المعالجة'],['missing','بانتظار الاستكمال']].map(([key,label]) => <button key={key} type="button" style={workflow === key ? primaryButtonStyle : secondaryButtonStyle} onClick={() => { setWorkflow(key); setPage(1); }}>{label}{data && 'counts' in data ? ` (${(data as Paginated<ApplicationSummary> & { counts?: Record<string, number> }).counts?.[key || 'all'] ?? 0})` : ''}</button>)}</div>
      {actionMessage && <p role="status" style={actionMessage.startsWith('تم') ? { color: 'var(--success)' } : errorStyle}>{actionMessage}</p>}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          setPage(1);
          setSearch(searchInput.trim());
        }}
        style={{ ...cardStyle, display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: 16 }}
      >
        <label style={{ ...labelStyle, flex: '1 1 240px' }}>
          بحث (اسم/رقم الطلب/بريد/مسؤول/ترخيص)
          <input value={searchInput} onChange={(e) => setSearchInput(e.target.value)} style={inputStyle} />
        </label>
        <label style={{ ...labelStyle, flex: '0 1 200px' }}>
          الحالة
          <select
            value={status}
            onChange={(e) => {
              setPage(1);
              setStatus(e.target.value as '' | ApplicationStatus);
            }}
            style={inputStyle}
          >
            <option value="">الكل</option>
            {(Object.keys(APPLICATION_STATUS_LABELS) as ApplicationStatus[]).map((key) => (
              <option key={key} value={key}>
                {APPLICATION_STATUS_LABELS[key]}
              </option>
            ))}
          </select>
        </label>
        <button type="submit" style={primaryButtonStyle}>
          بحث
        </button>
      </form>

      {listError && (
        <p role="alert" style={errorStyle}>
          {listError}
        </p>
      )}

      <div style={{ ...cardStyle, padding: 0, overflowX: 'auto' }}>
        <table style={tableStyle}>
          <thead>
            <tr>
              <th style={thStyle}>اسم الجمعية</th>
              <th style={thStyle}>رقم الطلب</th>
              <th style={thStyle}>الحالة</th>
              <th style={thStyle}>الأهلية</th>
              <th style={thStyle}>الاختيار</th>
              <th style={thStyle}>التفعيل</th>
              <th style={thStyle}>مؤشّر الإجابات</th>
              <th style={thStyle}>تاريخ التقديم</th>
              <th style={thStyle} />
            </tr>
          </thead>
          <tbody>
            {data?.items.length === 0 && (
              <tr>
                <td style={{ ...tdStyle, textAlign: 'center' }} colSpan={9}>
                  لا توجد طلبات مطابقة.
                </td>
              </tr>
            )}
            {data?.items.map((row) => (
              <tr key={row.id} onClick={() => setSelected(row)} style={{ cursor: 'pointer' }}>
                <td style={tdStyle}>{canAdmin(user, 'applications.review') && row.status === 'UNDER_REVIEW' && row.eligibilityStatus === 'PENDING' && !row.processingStartedAt && <input type="checkbox" aria-label={`تحديد ${row.name}`} disabled={processing} checked={checked.includes(row.id)} onClick={(event) => event.stopPropagation()} onChange={(event) => setChecked((old) => event.target.checked ? [...new Set([...old, row.id])] : old.filter((id) => id !== row.id))} />} {row.name}</td>
                <td style={{ ...tdStyle, ...ltrStyle }}>{row.publicCode}</td>
                <td style={tdStyle}>
                  <span style={statusBadgeStyle(row.status === 'ACCEPTED' ? 'good' : row.status === 'REJECTED' ? 'bad' : 'neutral')}>
                    {APPLICATION_STATUS_LABELS[row.status]}
                  </span>
                </td>
                <td style={tdStyle}>{eligibilityLabel(row.eligibilityStatus)}</td>
                <td style={tdStyle}>{selectionLabel(row.selectionList)}</td>
                <td style={tdStyle}>{row.resultingAssociationId ? 'مفعّلة' : 'غير مفعّلة'}</td>
                <td style={{ ...tdStyle, ...ltrStyle }}>{row.scoreLabel}</td>
                <td style={tdStyle}>{new Date(row.submittedAt).toLocaleDateString('ar-SA')}</td>
                <td style={tdStyle}>
                  <button type="button" style={secondaryButtonStyle} onClick={() => setSelected(row)}>
                    عرض
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {canAdmin(user, 'applications.review') && <div className="button-row" style={{ marginTop: 12 }}><button type="button" style={primaryButtonStyle} disabled={processing || !checked.length || checked.length > 250} onClick={() => void startCheckedProcessing()}>بدء معالجة المحدد ({checked.length})</button></div>}

      {data && (
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginTop: 16, flexWrap: 'wrap' }}>
          <button type="button" style={secondaryButtonStyle} disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
            السابق
          </button>
          <span style={mutedStyle}>
            صفحة {data.page} من {data.totalPages} — {data.total} طلبًا
          </span>
          <button
            type="button"
            style={secondaryButtonStyle}
            disabled={page >= data.totalPages}
            onClick={() => setPage((p) => p + 1)}
          >
            التالي
          </button>
        </div>
      )}

      {selected && (
        <ApplicationDetail
          user={user}
          application={selected}
          onClose={() => setSelected(null)}
        />
      )}
      </section>}
    </AppShell>
  );
}
