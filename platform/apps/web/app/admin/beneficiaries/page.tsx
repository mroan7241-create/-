'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ApiClientError,
  apiFetch,
  BENEFICIARY_REVIEW_STATUS_LABELS,
  DEVICE_TYPE_LABELS,
  NEED_DECISION_STATUS_LABELS,
  newOpId,
  type BeneficiaryDetail,
  type BeneficiaryReviewStatus,
  type BeneficiarySummary,
  type BulkReviewResponse,
  type Paginated,
} from '../../lib/api';
import { useRoleGuard } from '../../lib/use-role-guard';
import { AppShell } from '../../components/AppShell';
import { initialQueryParam } from '../../lib/query';
import { BulkImportButton } from '../../lib/beneficiary-import';
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
  tableStyle,
  tdStyle,
  thStyle,
} from '../../lib/ui';

const PAGE_SIZE = 25;

function statusTone(status: BeneficiaryReviewStatus): 'neutral' | 'good' | 'bad' {
  if (status === 'APPROVED') return 'good';
  if (status === 'REJECTED') return 'bad';
  return 'neutral';
}

/**
 * شاشة مراجعة المستفيدين (ADMIN) — **جدول** لا بطاقات، مطابقةً لِ
 * `Index.html::renderBeneficiaries` التي تستخدم `beneficiariesTable(items)`
 * لدور ADMIN حصرًا (Phase 3.2A القسم 1)، مع شريط اعتماد بالجملة
 * (`beneficiaryBulkReviewBar`). الترقيم والبحث والترتيب كلها خادمية.
 */
export default function AdminBeneficiariesPage() {
  const { user, loading: guardLoading } = useRoleGuard(['ADMIN']);

  const [data, setData] = useState<Paginated<BeneficiarySummary> | null>(null);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [reviewStatus, setReviewStatus] = useState<'' | BeneficiaryReviewStatus>(() => (initialQueryParam('reviewStatus') as BeneficiaryReviewStatus) || '');
  const [sortBy, setSortBy] = useState<'' | 'name' | 'city' | 'createdAt'>('');
  const [loading, setLoading] = useState(false);
  const [listError, setListError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [detail, setDetail] = useState<BeneficiaryDetail | null>(null);
  const [bulkResult, setBulkResult] = useState<BulkReviewResponse | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setListError(null);
    const params = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE) });
    if (search) params.set('search', search);
    if (reviewStatus) params.set('reviewStatus', reviewStatus);
    if (sortBy) params.set('sortBy', sortBy);
    try {
      setData(await apiFetch<Paginated<BeneficiarySummary>>(`/beneficiaries?${params.toString()}`));
    } catch (err) {
      setListError(err instanceof ApiClientError ? err.message : 'تعذّر تحميل قائمة المستفيدين.');
    } finally {
      setLoading(false);
    }
  }, [page, search, reviewStatus, sortBy]);

  useEffect(() => {
    if (user) void load();
  }, [user, load]);

  // التحديد يقتصر دائمًا على المستفيدين تحت المراجعة — الباقي غير قابل للبتّ أصلًا.
  const selectableIds = useMemo(
    () => (data?.items ?? []).filter((b) => b.reviewStatus === 'UNDER_REVIEW').map((b) => b.id),
    [data],
  );

  function toggleOne(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    setSelected((prev) => (prev.size === selectableIds.length ? new Set() : new Set(selectableIds)));
  }

  async function openDetail(id: string) {
    setListError(null);
    try {
      setDetail(await apiFetch<BeneficiaryDetail>(`/beneficiaries/${id}`));
    } catch (err) {
      setListError(err instanceof ApiClientError ? err.message : 'تعذّر تحميل تفاصيل المستفيد.');
    }
  }

  /** اعتماد بالجملة: كل المعلَّق يُعتمد لكل مستفيد محدَّد. الرفض بالجملة يتطلب سببًا موحَّدًا. */
  async function runBulk(decision: 'APPROVED' | 'REJECTED') {
    const ids = [...selected];
    if (ids.length === 0) return;

    let reason = '';
    if (decision === 'REJECTED') {
      reason = window.prompt(`سبب رفض ${ids.length} مستفيد (إلزامي — يُسجَّل على المستفيد وكل احتياجاته):`) ?? '';
      if (!reason.trim()) return;
    } else if (!window.confirm(`اعتماد ${ids.length} مستفيد مع اعتماد كل احتياجاتهم المعلَّقة؟`)) {
      return;
    }

    setBusy(true);
    setListError(null);
    setBulkResult(null);
    try {
      // لاعتماد جماعي نحتاج قرار كل احتياج معلَّق صراحةً (قاعدة الخادم:
      // لا اعتماد مستفيد دون البتّ في كل احتياجاته المعلَّقة).
      const items = await Promise.all(
        ids.map(async (id) => {
          const base = { beneficiaryId: id, opId: newOpId() };
          if (decision === 'REJECTED') {
            return { ...base, beneficiaryDecision: 'REJECTED' as const, beneficiaryRejectReason: reason.trim() };
          }
          const row = await apiFetch<BeneficiaryDetail>(`/beneficiaries/${id}`);
          return {
            ...base,
            beneficiaryDecision: 'APPROVED' as const,
            needDecisions: row.needs
              .filter((n) => n.decisionStatus === 'PENDING')
              .map((n) => ({ needId: n.id, decision: 'APPROVED' as const })),
          };
        }),
      );

      const res = await apiFetch<BulkReviewResponse>('/beneficiaries/bulk-review', {
        method: 'POST',
        body: JSON.stringify({ items }),
      });
      setBulkResult(res);
      setSelected(new Set());
      await load();
    } catch (err) {
      setListError(err instanceof ApiClientError ? err.message : 'تعذّرت المراجعة بالجملة.');
    } finally {
      setBusy(false);
    }
  }

  if (guardLoading || !user) return null;

  return (
    <AppShell user={user}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h1 style={{ color: 'var(--zad-800)', marginBottom: 4 }}>مراجعة المستفيدين</h1>
          <p style={mutedStyle}>
            اعتماد المستفيد يستلزم اعتماد احتياج واحد على الأقل، ورفضه يغلق كل احتياجاته المعلَّقة بنفس السبب. القرار
            نهائي ولا يُعاد فتحه.
          </p>
        </div>
        <BulkImportButton isAdmin={true} onImported={() => void load()} />
      </div>

      {/* شريط الأدوات — بحث/تصفية/ترتيب خادمية بالكامل */}
      <div style={{ ...cardStyle, marginTop: 16, display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <label style={{ ...labelStyle, flex: '1 1 240px' }}>
          بحث
          <input
            style={inputStyle}
            value={searchInput}
            placeholder="ابحث بالاسم أو الرقم أو الجوال أو المنطقة/المدينة…"
            onChange={(e) => setSearchInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                setPage(1);
                setSearch(searchInput.trim());
              }
            }}
          />
        </label>
        <label style={{ ...labelStyle, flex: '0 1 180px' }}>
          الحالة
          <select
            style={inputStyle}
            value={reviewStatus}
            onChange={(e) => {
              setPage(1);
              setReviewStatus(e.target.value as '' | BeneficiaryReviewStatus);
            }}
          >
            <option value="">كل الحالات</option>
            {(Object.keys(BENEFICIARY_REVIEW_STATUS_LABELS) as BeneficiaryReviewStatus[]).map((s) => (
              <option key={s} value={s}>
                {BENEFICIARY_REVIEW_STATUS_LABELS[s]}
              </option>
            ))}
          </select>
        </label>
        <label style={{ ...labelStyle, flex: '0 1 180px' }}>
          الترتيب
          <select
            style={inputStyle}
            value={sortBy}
            onChange={(e) => {
              setPage(1);
              setSortBy(e.target.value as '' | 'name' | 'city' | 'createdAt');
            }}
          >
            <option value="">الأحدث أولًا</option>
            <option value="name">الاسم</option>
            <option value="city">المدينة</option>
            <option value="createdAt">تاريخ الإضافة</option>
          </select>
        </label>
        <button
          type="button"
          style={secondaryButtonStyle}
          onClick={() => {
            setPage(1);
            setSearch(searchInput.trim());
          }}
        >
          تطبيق
        </button>
      </div>

      {listError && <p style={{ ...errorStyle, marginTop: 12 }}>{listError}</p>}
      {notice && <p style={{ ...successStyle, marginTop: 12 }}>{notice}</p>}

      {/* شريط الاعتماد بالجملة */}
      {selected.size > 0 && (
        <div
          style={{
            ...cardStyle,
            marginTop: 12,
            display: 'flex',
            gap: 12,
            alignItems: 'center',
            flexWrap: 'wrap',
            borderColor: 'var(--gold-400)',
            background: 'var(--gold-100)',
          }}
        >
          <strong>{selected.size} مستفيد محدَّد</strong>
          <button type="button" style={primaryButtonStyle} disabled={busy} onClick={() => void runBulk('APPROVED')}>
            اعتماد الكل
          </button>
          <button type="button" style={secondaryButtonStyle} disabled={busy} onClick={() => void runBulk('REJECTED')}>
            رفض الكل
          </button>
          <button type="button" style={secondaryButtonStyle} onClick={() => setSelected(new Set())}>
            إلغاء التحديد
          </button>
        </div>
      )}

      {/* نتائج الدفعة — كل عنصر فاشل يُعرض صراحة، لا يُخفيه نجاح غيره */}
      {bulkResult && (
        <div style={{ ...cardStyle, marginTop: 12 }}>
          <p style={successStyle}>نجح {bulkResult.success.length} عنصر.</p>
          {bulkResult.failed.length > 0 && (
            <>
              <p style={{ ...errorStyle, marginTop: 8 }}>فشل {bulkResult.failed.length} عنصر:</p>
              <ul style={{ margin: '6px 0 0', paddingInlineStart: 20 }}>
                {bulkResult.failed.map((f) => (
                  <li key={f.beneficiaryId} style={{ fontSize: 13 }}>
                    <code>{f.beneficiaryId.slice(0, 8)}…</code> — {f.error}
                  </li>
                ))}
              </ul>
            </>
          )}
          <button type="button" style={{ ...secondaryButtonStyle, marginTop: 10 }} onClick={() => setBulkResult(null)}>
            إغلاق
          </button>
        </div>
      )}

      {/* الجدول */}
      <div style={{ ...cardStyle, marginTop: 16, padding: 0, overflowX: 'auto' }}>
        {loading && <p style={{ ...mutedStyle, padding: 16 }}>جارِ التحميل…</p>}
        {!loading && data && data.items.length === 0 && (
          <p style={{ ...mutedStyle, padding: 16 }}>لا يوجد مستفيدون مطابقون.</p>
        )}
        {!loading && data && data.items.length > 0 && (
          <table style={tableStyle}>
            <thead>
              <tr>
                <th style={thStyle}>
                  <input
                    type="checkbox"
                    aria-label="تحديد الكل"
                    checked={selectableIds.length > 0 && selected.size === selectableIds.length}
                    disabled={selectableIds.length === 0}
                    onChange={toggleAll}
                  />
                </th>
                <th style={thStyle}>الرقم</th>
                <th style={thStyle}>الاسم</th>
                <th style={thStyle}>المدينة</th>
                <th style={thStyle}>الجوال</th>
                <th style={thStyle}>الاحتياجات</th>
                <th style={thStyle}>حالة المراجعة</th>
                <th style={thStyle}>إجراء</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((row) => (
                <tr key={row.id}>
                  <td style={tdStyle}>
                    <input
                      type="checkbox"
                      aria-label={`تحديد ${row.name}`}
                      checked={selected.has(row.id)}
                      disabled={row.reviewStatus !== 'UNDER_REVIEW'}
                      onChange={() => toggleOne(row.id)}
                    />
                  </td>
                  <td style={tdStyle}>{row.publicCode}</td>
                  <td style={tdStyle}>{row.name}</td>
                  <td style={tdStyle}>{row.city}</td>
                  <td style={tdStyle}>{row.phone}</td>
                  <td style={tdStyle}>
                    {row.needsTotal} (معلَّق {row.needsPending} / معتمد {row.needsApproved} / مرفوض {row.needsRejected})
                  </td>
                  <td style={tdStyle}>
                    <span style={statusBadgeStyle(statusTone(row.reviewStatus))}>
                      {BENEFICIARY_REVIEW_STATUS_LABELS[row.reviewStatus]}
                    </span>
                  </td>
                  <td style={tdStyle}>
                    <button type="button" style={secondaryButtonStyle} onClick={() => void openDetail(row.id)}>
                      {row.reviewStatus === 'UNDER_REVIEW' ? 'مراجعة' : 'عرض'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* ترقيم خادمي */}
      {data && data.totalPages > 1 && (
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginTop: 12 }}>
          <button type="button" style={secondaryButtonStyle} disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
            السابق
          </button>
          <span style={mutedStyle}>
            صفحة {data.page} من {data.totalPages} — {data.total} سجلًا
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

      {detail && (
        <ReviewModal
          detail={detail}
          onClose={() => setDetail(null)}
          onDone={async (message) => {
            setDetail(null);
            setNotice(message);
            await load();
          }}
        />
      )}
    </AppShell>
  );
}

/** نافذة المراجعة الفردية — قرار المستفيد + قرار كل احتياج معلَّق معًا. */
function ReviewModal({
  detail,
  onClose,
  onDone,
}: {
  detail: BeneficiaryDetail;
  onClose: () => void;
  onDone: (message: string) => Promise<void>;
}) {
  const pending = detail.needs.filter((n) => n.decisionStatus === 'PENDING');
  const decided = detail.reviewStatus !== 'UNDER_REVIEW';

  const [decisions, setDecisions] = useState<Record<string, 'APPROVED' | 'REJECTED'>>(
    Object.fromEntries(pending.map((n) => [n.id, 'APPROVED' as const])),
  );
  const [needReasons, setNeedReasons] = useState<Record<string, string>>({});
  const [rejectReason, setRejectReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(beneficiaryDecision: 'APPROVED' | 'REJECTED') {
    setError(null);
    if (beneficiaryDecision === 'REJECTED' && !rejectReason.trim()) {
      setError('سبب رفض المستفيد إلزامي.');
      return;
    }
    setBusy(true);
    try {
      await apiFetch(`/beneficiaries/${detail.id}/review`, {
        method: 'POST',
        body: JSON.stringify({
          beneficiaryDecision,
          ...(beneficiaryDecision === 'REJECTED' ? { beneficiaryRejectReason: rejectReason.trim() } : {}),
          needDecisions: pending.map((n) => ({
            needId: n.id,
            decision: beneficiaryDecision === 'REJECTED' ? 'REJECTED' : decisions[n.id],
            ...(needReasons[n.id]?.trim() ? { rejectReason: needReasons[n.id].trim() } : {}),
          })),
          opId: newOpId(),
        }),
      });
      await onDone(beneficiaryDecision === 'APPROVED' ? 'تم اعتماد المستفيد.' : 'تم رفض المستفيد وإغلاق احتياجاته.');
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : 'تعذّر حفظ قرار المراجعة.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={modalOverlayStyle} role="dialog" aria-modal="true">
      <div style={modalStyle}>
        <h2 style={{ marginTop: 0, color: 'var(--zad-800)' }}>
          {detail.name} <span style={mutedStyle}>({detail.publicCode})</span>
        </h2>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 8, fontSize: 14 }}>
          <div>المنطقة/المدينة: {detail.region} — {detail.city}</div>
          <div>الحي: {detail.district ?? '—'}</div>
          <div>الجوال: {detail.phone}</div>
          <div>عدد الأفراد: {detail.familyCount}</div>
          <div>الحالة الاجتماعية: {detail.socialStatus}</div>
          <div>ضمان اجتماعي: {detail.socialSecurity ? 'نعم' : 'لا'}</div>
          <div style={{ gridColumn: '1 / -1' }}>العنوان: {detail.address}</div>
          <div style={{ gridColumn: '1 / -1', display: 'flex', alignItems: 'center', gap: 10 }}>
            الموقع: {detail.locationConfirmed ? 'مؤكَّد' : 'بانتظار تحديد الموقع'}
            {detail.lat != null && detail.lng != null && (
              <a
                href={`https://www.google.com/maps?q=${detail.lat},${detail.lng}`}
                target="_blank"
                rel="noopener noreferrer"
                style={{ ...secondaryButtonStyle, textDecoration: 'none', display: 'inline-block', padding: '4px 10px', fontSize: 13 }}
              >
                فتح في خرائط Google
              </a>
            )}
          </div>
        </div>

        <h3 style={{ marginBottom: 6 }}>الاحتياجات</h3>
        <table style={tableStyle}>
          <thead>
            <tr>
              <th style={thStyle}>النوع</th>
              <th style={thStyle}>الحالة</th>
              <th style={thStyle}>القرار</th>
            </tr>
          </thead>
          <tbody>
            {detail.needs.map((need) => (
              <tr key={need.id}>
                <td style={tdStyle}>{DEVICE_TYPE_LABELS[need.deviceType] ?? need.deviceType}</td>
                <td style={tdStyle}>
                  <span
                    style={statusBadgeStyle(
                      need.decisionStatus === 'APPROVED' ? 'good' : need.decisionStatus === 'REJECTED' ? 'bad' : 'neutral',
                    )}
                  >
                    {NEED_DECISION_STATUS_LABELS[need.decisionStatus]}
                  </span>
                  {need.rejectReason && <div style={mutedStyle}>{need.rejectReason}</div>}
                </td>
                <td style={tdStyle}>
                  {need.decisionStatus !== 'PENDING' || decided ? (
                    <span style={mutedStyle}>—</span>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                      <select
                        style={inputStyle}
                        value={decisions[need.id] ?? 'APPROVED'}
                        onChange={(e) =>
                          setDecisions((prev) => ({ ...prev, [need.id]: e.target.value as 'APPROVED' | 'REJECTED' }))
                        }
                      >
                        <option value="APPROVED">اعتماد</option>
                        <option value="REJECTED">رفض</option>
                      </select>
                      {decisions[need.id] === 'REJECTED' && (
                        <input
                          style={inputStyle}
                          placeholder="سبب رفض الاحتياج (اختياري)"
                          value={needReasons[need.id] ?? ''}
                          onChange={(e) => setNeedReasons((prev) => ({ ...prev, [need.id]: e.target.value }))}
                        />
                      )}
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {decided ? (
          <p style={{ ...mutedStyle, marginTop: 16 }}>
            سبق البتّ نهائيًا في هذا المستفيد ({BENEFICIARY_REVIEW_STATUS_LABELS[detail.reviewStatus]})
            {detail.beneficiaryRejectReason ? ` — السبب: ${detail.beneficiaryRejectReason}` : ''}. لا يمكن إعادة فتح القرار.
          </p>
        ) : (
          <>
            <label style={{ ...labelStyle, marginTop: 16 }}>
              سبب رفض المستفيد (إلزامي عند الرفض فقط)
              <input style={inputStyle} value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} maxLength={500} />
            </label>
            {error && <p style={{ ...errorStyle, marginTop: 10 }}>{error}</p>}
            <div style={{ display: 'flex', gap: 10, marginTop: 16, flexWrap: 'wrap' }}>
              <button type="button" style={primaryButtonStyle} disabled={busy} onClick={() => void submit('APPROVED')}>
                اعتماد المستفيد
              </button>
              <button type="button" style={secondaryButtonStyle} disabled={busy} onClick={() => void submit('REJECTED')}>
                رفض المستفيد
              </button>
              <button type="button" style={secondaryButtonStyle} onClick={onClose}>
                إغلاق
              </button>
            </div>
          </>
        )}

        {decided && (
          <button type="button" style={{ ...secondaryButtonStyle, marginTop: 16 }} onClick={onClose}>
            إغلاق
          </button>
        )}
      </div>
    </div>
  );
}
