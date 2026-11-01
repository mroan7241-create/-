"use client";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import {
  apiFetch,
  newOpId,
  DEVICE_TYPE_LABELS,
  DEVICE_TYPES,
  BENEFICIARY_REVIEW_STATUS_LABELS,
  type Paginated,
} from "../../lib/api";
import { useRoleGuard } from "../../lib/use-role-guard";
import { canAdmin } from "../../lib/admin-access";
import { AppShell } from "../../components/AppShell";
import { initialQueryParam } from "../../lib/query";
import { useOperationKey } from "../../lib/use-operation-key";
import type {
  ReviewPayload,
  WorkspaceDetail,
  WorkspaceOverview,
  WorkspaceRow,
} from "../../lib/beneficiary-workspace";
import {
  FamilyPanel,
  InformationDialog,
  PlanningDialog,
} from "./workspace-panels";
import { useDialogFocus } from "../../lib/use-dialog-focus";
import { WorkspaceSummary, WorkspaceReviewTabs } from "./workspace-summary";
import { WorkspaceSelector } from "./workspace-selector";
import { FAMILY_BUCKETS, incompleteFields, retainedVisibleSelection, bulkCounts } from "./workspace-model";
import s from "./workspace.module.css";
const message = (e: unknown) =>
  e instanceof Error ? e.message : "تعذر إتمام العملية";
const money = (n: number | null) =>
  n === null ? "غير متوفر" : `${n.toLocaleString("ar-SA")} ريال`;

export default function BeneficiaryWorkspace() {
  const { user, loading: guardLoading } = useRoleGuard(["ADMIN"]);
  const [data, setData] = useState<Paginated<WorkspaceRow> | null>(null),
    [overview, setOverview] = useState<WorkspaceOverview | null>(null);
  const canManage =
    !!user &&
    canAdmin(user, "beneficiaries.manage") &&
    overview?.readOnly !== true;
  const [region, setRegion] = useState(""),
    [associationId, setAssociation] = useState(
      () => initialQueryParam("associationId") || "",
    );
  const [searchInput, setSearchInput] = useState(""),
    [search, setSearch] = useState(""),
    [city, setCity] = useState(""),
    [bucket, setBucket] = useState("ALL");
  const [needStatus, setNeedStatus] = useState(""),
    [deviceType, setDevice] = useState(""),
    [requestedCount, setRequested] = useState(""),
    [approvedCount, setApproved] = useState(""),
    [topTen, setTopTen] = useState(false),
    [includeDemo, setIncludeDemo] = useState(false),
    [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [revision, setRevision] = useState(0);
  const [selected, setSelected] = useState<Set<string>>(new Set()),
    [detail, setDetail] = useState<WorkspaceDetail | null>(null),
    [detailLoading, setDetailLoading] = useState(false),
    [opening, setOpening] = useState<WorkspaceRow | null>(null),
    [openingId, setOpeningId] = useState<string | null>(null),
    [detailDirty, setDetailDirty] = useState(false),
    [detailError, setDetailError] = useState(""),
    [overviewLoading, setOverviewLoading] = useState(false),
    [overviewScope, setOverviewScope] = useState<string | null>(null),
    [overviewRegion, setOverviewRegion] = useState<string | null>(null),
    [overviewError, setOverviewError] = useState(""),
    [nextRetry, setNextRetry] = useState<{ id: string; query: string } | null>(null);
  const [infoTargets, setInfoTargets] = useState<
      { id: string; version: string }[] | null
    >(null),
    [planning, setPlanning] = useState(false);
  const [bulkAction, setBulkAction] = useState<"APPROVED" | "REJECTED" | null>(
      null,
    ),
    [bulkReason, setBulkReason] = useState(""),
    [busy, setBusy] = useState(false);
  const detailRequest = useRef<AbortController | null>(null),
    listGeneration = useRef(0);
  const operationKey = useOperationKey();
  const query = new URLSearchParams();
  if (region) query.set("region", region);
  if (associationId) query.set("associationId", associationId);
  if (search) query.set("search", search);
  if (city) query.set("city", city);
  if (deviceType) query.set("deviceType", deviceType);
  if (topTen) query.set("topTen", "true");
  if (includeDemo) query.set("includeDemo", "true");
  const cohortQuery = query.toString();
  if (needStatus) query.set("needStatus", needStatus);
  if (bucket !== "ALL") query.set("bucket", bucket);
  if (requestedCount) query.set("requestedCount", requestedCount);
  if (approvedCount) query.set("approvedCount", approvedCount);
  query.set("page", String(page));
  query.set("pageSize", associationId ? "50" : "25");
  const listQuery = query.toString();
  useEffect(() => {
    const timer = setTimeout(() => {
      setSearch(searchInput.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchInput]);
  useEffect(() => {
    setSelected(new Set());
    setBulkAction(null);
  }, [listQuery]);
  useEffect(() => {
    if (!user) return;
    const abort = new AbortController(),
      generation = ++listGeneration.current;
    setLoading(true);
    setError("");
    void apiFetch<Paginated<WorkspaceRow>>(
      `/beneficiary-workspace?${listQuery}`,
      { signal: abort.signal },
    )
      .then((value) => {
        if (generation === listGeneration.current && !abort.signal.aborted) {
          setData(value);
          setSelected(prev => retainedVisibleSelection(prev, value.items));
        }
      })
      .catch((e) => {
        if (!abort.signal.aborted) setError(message(e));
      })
      .finally(() => {
        if (generation === listGeneration.current) setLoading(false);
      });
    return () => abort.abort();
  }, [user, listQuery, revision]);
  useEffect(() => {
    if (!user) return;
    const abort = new AbortController();
    setOverviewLoading(true);
    setOverviewError("");
    void apiFetch<WorkspaceOverview>(
      `/beneficiary-workspace/overview?${cohortQuery}`,
      { signal: abort.signal },
    )
      .then((value) => {
        if (!abort.signal.aborted) { setOverview(value); setOverviewScope(cohortQuery); setOverviewRegion(region); }
      })
      .catch((e) => {
        if (!abort.signal.aborted) setOverviewError(message(e));
      }).finally(() => { if (!abort.signal.aborted) setOverviewLoading(false); });
    return () => abort.abort();
  }, [user, cohortQuery, region, revision]);
  useEffect(() => () => detailRequest.current?.abort(), []);
  useEffect(() => {
    if (!detailDirty) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [detailDirty]);
  const open = useCallback(async (id: string, row?: WorkspaceRow) => {
    detailRequest.current?.abort();
    const abort = new AbortController();
    detailRequest.current = abort;
    setOpening(row ?? null);
    setOpeningId(id);
    setDetailDirty(false);
    setDetail(null);
    setDetailLoading(true);
    setDetailError("");
    try {
      const value = await apiFetch<WorkspaceDetail>(`/beneficiary-workspace/${id}`, { signal: abort.signal });
      if (!abort.signal.aborted && value.id === id) { setDetail(value); setOpening(null); setOpeningId(null); }
    } catch (e) {
      if (!abort.signal.aborted) setDetailError(message(e));
    } finally {
      if (!abort.signal.aborted) setDetailLoading(false);
    }
  }, []);
  function resetFilters() {
    setNeedStatus("");
    setCity("");
    setDevice("");
    setRequested("");
    setApproved("");
    setTopTen(false);
    setBucket("ALL");
    setSearchInput("");
    setSearch("");
    setPage(1);
  }
  function chooseAssociation(id: string) {
    setAssociation(id);
    resetFilters();
  }
  function chooseBucket(value: string) {
    setBucket(value);
    setPage(1);
  }
  function refresh() {
    setRevision((v) => v + 1);
  }
  const rows = data?.items ?? [],
    stats = overviewScope === cohortQuery ? overview?.totals : undefined;
  const selectables = rows.filter(
    (b) =>
      b.reviewStatus !== "REJECTED" &&
      !b.informationRequests.length &&
      (b.reviewStatus === "UNDER_REVIEW" ||
        b.needs.some((n) => n.decisionStatus === "PENDING")),
  );
  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }
  async function retryNext(id: string, queryString: string) {
    try {
      const result = await apiFetch<{id: string | null}>(`/beneficiary-workspace/${id}/next?${queryString}`);
      setNextRetry(null);
      if (result.id) await open(result.id, rows.find(row => row.id === result.id));
      else setNotice("حُفظت المراجعة. انتهت الأسر المتاحة داخل الجمعية والفرز الحاليين.");
    } catch (e) {
      setNextRetry({id, query: queryString});
      setNotice("حُفظت المراجعة. تعذر فتح التالي؛ يمكنك إعادة جلبه دون تكرار الحفظ.");
      setError(message(e));
    }
  }
  async function saveReview(payload: ReviewPayload, next: boolean) {
    if (!detail) return;
    const current = detail;
    const nextQuery = new URLSearchParams(listQuery);
    const result = await apiFetch<{nextId?: string | null; nextLookupFailed?: boolean}>(`/beneficiary-workspace/${current.id}/review`, {
      method: "POST",
      body: JSON.stringify({...payload, ...(next ? {nextQuery: Object.fromEntries(nextQuery)} : {})}),
    });
    setNotice("حُفظت المراجعة. قبول الاحتياج لا يعني تخصيص جهاز من المخزون.");
    setNextRetry(null);
    setSelected(prev => { const ids = new Set(prev); ids.delete(current.id); return ids; });
    setDetail(null);
    setDetailDirty(false);
    refresh();
    // Navigation failure must never turn a successful decision into a retryable save.
    if (!next) { await open(current.id, current); return; }
    if (result.nextLookupFailed) {
      setNextRetry({id: current.id, query: nextQuery.toString()});
      setNotice("حُفظت المراجعة. تعذر تحديد التالي؛ أعد جلب التالي فقط.");
    } else if (typeof result.nextId === "string") await open(result.nextId, rows.find(row => row.id === result.nextId));
    else if (result.nextId === null) setNotice("حُفظت المراجعة. انتهت الأسر المتاحة داخل الجمعية والفرز الحاليين.");
    else await retryNext(current.id, nextQuery.toString());
  }
  async function runBulk() {
    if (!bulkAction) return;
    setBusy(true);
    setError("");
    try {
      const items = rows
        .filter((b) => selected.has(b.id))
        .map((b) => {
          const intent = {
            id: b.id,
            version: b.updatedAt,
            ...(b.reviewStatus === "UNDER_REVIEW"
              ? { familyDecision: bulkAction }
              : {}),
            reason: bulkReason,
            needs: b.needs
              .filter((n) => n.decisionStatus === "PENDING")
              .map((n) => ({
                needId: n.id,
                decision: bulkAction,
                reason: bulkReason,
              })),
          };
          return { ...intent, opId: operationKey(intent) };
        });
      const result = await apiFetch<{
        results: { id: string; ok: boolean; error?: { message: string } }[];
      }>("/beneficiary-workspace/bulk-review", {
        method: "POST",
        body: JSON.stringify({ items }),
      });
      const failures = result.results.filter((r) => !r.ok);
      setSelected(new Set(failures.map((r) => r.id)));
      setBulkAction(null);
      setNotice(
        `نجح حفظ ${result.results.length - failures.length} من ${result.results.length}.`,
      );
      if (failures.length)
        setError(
          failures
            .map(
              (f) =>
                `${rows.find((b) => b.id === f.id)?.name ?? f.id}: ${f.error?.message}`,
            )
            .join(" — "),
        );
      refresh();
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  if (guardLoading || !user) return <p>جارٍ التحقق من الدخول…</p>;
  return (
    <AppShell user={user}>
      <div className={s.workspace}>
        <header className={s.header}><div><h1>المستفيدون واحتياجاتهم</h1><p>مراجعة الأسرة وقرار كل جهاز، في مكان واحد.</p></div><button className={s.secondary} onClick={() => setPlanning(true)}>تخطيط الأجهزة</button></header>
        <div className={s.navigationV2}>
          <label className={s.visuallyLabeledV2}><span>المنطقة</span><select aria-label="المنطقة" value={region} onChange={e => {setRegion(e.target.value);setAssociation("");resetFilters();}}><option value="">جميع المناطق</option>{overview?.regions.map(v => <option key={v}>{v}</option>)}</select></label>
          <WorkspaceSelector overview={overviewRegion === region ? overview : null} associationId={associationId} onChoose={chooseAssociation} loading={overviewLoading}/>
          <details className={s.displayOptionsV2}><summary>خيارات العرض</summary><div><label><input type="checkbox" checked={includeDemo} onChange={e => {setIncludeDemo(e.target.checked);setPage(1);}}/> إظهار جمعية تجربة</label><button className={s.close} onClick={() => {setRegion("");setAssociation("");resetFilters();}}>إعادة ضبط الفرز</button></div></details>
        </div>
        {overview?.readOnly && <div className={s.notice}>وضع القراءة فقط مفعّل مؤقتًا؛ الحفظ والإرسال متوقفان.</div>}
        {error && <div className={s.error} role="alert">{error}</div>}
        {notice && <div className={s.notice} role="status">{notice} {nextRetry && <button className={s.close} onClick={() => void retryNext(nextRetry.id,nextRetry.query)}>فتح التالي دون إعادة الحفظ</button>}</div>}
        {overviewError && <div className={s.error} role="alert">تعذر تحديث المؤشرات. {overviewError} {stats ? "المعروض آخر بيانات ناجحة." : "الأعداد غير متاحة حاليًا."}<button className={s.close} onClick={refresh}>إعادة المحاولة</button></div>}
        <div className={s.contextV2}><h2>{overview?.associations.find(a => a.id === associationId)?.name ?? (associationId ? "الجمعية المحددة" : region || "جميع الجمعيات")}</h2><p>المؤشرات لنطاق المنطقة والجمعية والمدينة والبحث والأولوية ونوع الجهاز. {overviewLoading ? "جارٍ التحديث…" : ""}</p></div>
        <WorkspaceSummary stats={stats} bucket={bucket} onBucket={chooseBucket} onNeed={value => {setNeedStatus(value);setRequested("");setApproved("");setBucket("ALL");setPage(1);}} onType={(type,status) => {setDevice(type);setNeedStatus(status);setRequested("");setApproved("");setBucket("ALL");setPage(1);}} onCount={(kind,value) => {setRequested(kind === "requested" ? (requestedCount === value ? "" : value) : "");setApproved(kind === "approved" ? (approvedCount === value ? "" : value) : "");setBucket("ALL");setNeedStatus("");setPage(1);}}/>
        <section className={s.main} aria-label="مراجعة الأسر">
          <div className={s.tableControlsV2}>
            <input type="search" aria-label="بحث عن مستفيد" placeholder="بحث باسم المستفيد أو رقمه…" value={searchInput} onChange={e => setSearchInput(e.target.value)} onKeyDown={e => {if(e.key === "Enter"){setSearch(searchInput.trim());setPage(1);}}}/>
            <select aria-label="مدينة المستفيد" value={city} onChange={e => {setCity(e.target.value);setPage(1);}}><option value="">جميع المدن</option>{overview?.cities.map(v => <option key={v}>{v}</option>)}</select>
            <select aria-label="نوع الجهاز" value={deviceType} onChange={e => {setDevice(e.target.value);setPage(1);}}><option value="">جميع الأجهزة</option>{DEVICE_TYPES.map(v => <option key={v} value={v}>{DEVICE_TYPE_LABELS[v]}</option>)}</select>
            <label><input type="checkbox" checked={topTen} onChange={e => {setTopTen(e.target.checked);setPage(1);}}/> أول 10 في كل جمعية</label>
          </div>
          <WorkspaceReviewTabs stats={stats} bucket={bucket} onBucket={chooseBucket}/>
          {(bucket !== "ALL" || needStatus || requestedCount || approvedCount || deviceType || city || search || topTen || includeDemo) && <div className={s.filterChipsV2} aria-label="الفرز النشط">
            {bucket !== "ALL" && <button className={s.chip} onClick={() => chooseBucket("ALL")}>{bucket === "INCOMPLETE" ? "بيانات ناقصة" : FAMILY_BUCKETS.find(row => row[0] === bucket)?.[1]} ×</button>}
            {needStatus && <button className={s.chip} onClick={() => {setNeedStatus("");setPage(1);}}>{({APPROVED:"أجهزة مقبولة",REJECTED:"أجهزة مرفوضة",PENDING:"أجهزة معلقة",ALLOCATED:"أجهزة مخصصة",WITH_DELEGATE:"مع المندوب",DELIVERED:"تم تسليمه"} as Record<string,string>)[needStatus]} ×</button>}
            {requestedCount && <button className={s.chip} onClick={() => {setRequested("");setPage(1);}}>الأسر بحسب المطلوب: {requestedCount} ×</button>}
            {approvedCount && <button className={s.chip} onClick={() => {setApproved("");setPage(1);}}>الأسر بحسب المقبول: {approvedCount} ×</button>}
            {deviceType && <button className={s.chip} onClick={() => {setDevice("");setPage(1);}}>{DEVICE_TYPE_LABELS[deviceType as keyof typeof DEVICE_TYPE_LABELS]} ×</button>}
            {city && <button className={s.chip} onClick={() => {setCity("");setPage(1);}}>{city} ×</button>}
            {search && <button className={s.chip} onClick={() => {setSearchInput("");setSearch("");setPage(1);}}>البحث: {search} ×</button>}
            {topTen && <button className={s.chip} onClick={() => {setTopTen(false);setPage(1);}}>أول 10 ×</button>}
            {includeDemo && <button className={s.chip} onClick={() => {setIncludeDemo(false);setPage(1);}}>تشمل جمعية تجربة ×</button>}
            <button className={s.close} onClick={resetFilters}>إلغاء فرز الأسر</button>
          </div>}
            {selected.size > 0 && canManage && (
              <div className={s.bulk}>
                <strong>{selected.size} أسرة محددة</strong>
                <button
                  className={s.button}
                  onClick={() => {
                    setBulkReason("");
                    setBulkAction("APPROVED");
                  }}
                >
                  اعتماد الأسرة والأجهزة المعلقة
                </button>
                <button
                  className={s.secondary}
                  onClick={() => {
                    setBulkReason("");
                    setBulkAction("REJECTED");
                  }}
                >
                  رفض المحدد
                </button>
                <button
                  className={s.secondary}
                  onClick={() =>
                    setInfoTargets(
                      rows
                        .filter((b) => selected.has(b.id))
                        .map((b) => ({ id: b.id, version: b.updatedAt })),
                    )
                  }
                >
                  طلب استكمال
                </button>
                <button
                  className={s.close}
                  onClick={() => setSelected(new Set())}
                >
                  إلغاء التحديد
                </button>
              </div>
            )}
            <div className={s.tableWrap} aria-busy={loading}>
              <table className={s.table}>
                <thead>
                  <tr>
                    <th>
                      {canManage && (
                        <input
                          aria-label="تحديد الصفحة"
                          type="checkbox"
                          disabled={loading || busy}
                          checked={
                            selectables.length > 0 &&
                            selectables.every((b) => selected.has(b.id))
                          }
                          onChange={() =>
                            setSelected(
                              selected.size
                                ? new Set()
                                : new Set(selectables.map((b) => b.id)),
                            )
                          }
                        />
                      )}
                    </th>
                    <th>الأولوية</th>
                    <th>المستفيد والجمعية</th>
                    <th>المدينة</th>
                    <th>الأسرة / الدخل</th>
                    <th>الأجهزة المطلوبة</th>
                    <th>الحالة</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((b) => (
                    <tr key={b.id}>
                      <td>
                        {canManage &&
                          selectables.some((v) => v.id === b.id) && (
                            <input
                              aria-label={`تحديد ${b.name}`}
                              type="checkbox"
                              disabled={loading || busy}
                              checked={selected.has(b.id)}
                              onChange={() => toggle(b.id)}
                            />
                          )}
                      </td>
                      <td className={s.count}>{b.needPriority ?? "—"}</td>
                      <td>
                        <button
                          className={s.name}
                          disabled={loading || busy}
                          onClick={() => void open(b.id, b)}
                        >
                          {b.name}
                        </button>
                        <small>{b.association.name}</small>
                        <small>{b.publicCode}</small>
                      </td>
                      <td>
                        {b.city}
                        <small>{b.district ?? "الحي غير متوفر"}</small>
                      </td>
                      <td>
                        {b.familyCount} أفراد
                        <small className={b.income === null ? s.missing : ""}>
                          {money(b.income)}
                        </small>
                      </td>
                      <td>
                        <div className={s.needs}>
                          {b.needs.map((n) => (
                            <span
                              key={n.id}
                              className={`${s.need} ${n.decisionStatus === "APPROVED" ? s.good : n.decisionStatus === "REJECTED" ? s.bad : s.pending}`}
                            >
                              {DEVICE_TYPE_LABELS[n.deviceType]}
                            </span>
                          ))}
                        </div>
                      </td>
                      <td>
                        <span
                          className={`${s.status} ${b.reviewStatus === "APPROVED" ? s.good : b.reviewStatus === "REJECTED" ? s.bad : s.pending}`}
                        >
                          {BENEFICIARY_REVIEW_STATUS_LABELS[b.reviewStatus]}
                        </span>
                        {b.informationRequests[0] && (
                          <small>
                            {b.informationRequests[0].status === "SUBMITTED"
                              ? "وصل رد الجمعية"
                              : "بانتظار الاستكمال"}
                          </small>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!rows.length && !loading && (
                <div className={s.empty}>لا توجد أسر تطابق هذا الفرز.</div>
              )}
            </div>
            <div className={s.legend}>
              <span>● المعتمد بالأخضر</span>
              <span>● المرفوض بالأحمر</span>
              <span>● المعلق بالأصفر</span>
              {loading && <span>جارٍ التحميل…</span>}
            </div>
            <div className={s.pagination}>
              <span>
                {data?.total ?? 0} أسرة · صفحة {page} من {data?.totalPages || 1}
              </span>
              <div>
                <button
                  className={s.secondary}
                  disabled={page === 1 || loading}
                  onClick={() => setPage((p) => p - 1)}
                >
                  السابق
                </button>{" "}
                <button
                  className={s.secondary}
                  disabled={page >= (data?.totalPages ?? 1) || loading}
                  onClick={() => setPage((p) => p + 1)}
                >
                  التالي
                </button>
              </div>
            </div>
          </section>
        {(openingId || detailLoading || detailError) && !detail && <OpeningFamilyPanel row={opening} loading={detailLoading} error={detailError} onClose={() => {detailRequest.current?.abort();setOpening(null);setOpeningId(null);setDetailLoading(false);setDetailError("");}} onRetry={() => {if(openingId) void open(openingId,opening ?? undefined);}}/>}
        {detail && (
          <FamilyPanel
            key={`${detail.id}:${detail.updatedAt}:${detail.informationRequests.map((r) => r.updatedAt).join()}`}
            detail={detail}
            canManage={canManage && !detailLoading}
            suspended={!!infoTargets}
            onDirtyChange={setDetailDirty}
            onClose={() => {
              detailRequest.current?.abort();
              setDetail(null);
              setDetailDirty(false);
              setDetailError("");
            }}
            onSave={saveReview}
            onInformation={() =>
              setInfoTargets([{ id: detail.id, version: detail.updatedAt }])
            }
            onRefresh={async () => {
              refresh();
              await open(detail.id, detail);
            }}
          />
        )}
        {infoTargets && (
          <InformationDialog
            targets={infoTargets}
            initialItems={infoTargets.length === 1 && detail?.id === infoTargets[0].id ? incompleteFields(detail) : []}
            reviewDraftPending={detailDirty && !!detail && infoTargets.some(target => target.id === detail.id)}
            recipients={(overview?.associations ?? [])
              .filter((a) =>
                infoTargets.some(
                  (t) =>
                    rows.find((b) => b.id === t.id)?.associationId === a.id ||
                    (detail?.id === t.id && detail.associationId === a.id),
                ),
              )
              .map((a) => ({ name: a.name, email: a.email }))}
            onClose={() => setInfoTargets(null)}
            onDone={async () => {
              setInfoTargets(null);
              setSelected(new Set());
              setNotice(
                "حُفظت طلبات الاستكمال، وأُدرج بريد ملخص واحد لكل جمعية في طابور الإرسال. لا يعني ذلك تأكيد وصوله.",
              );
              refresh();
              if (detail) await open(detail.id, detail);
            }}
          />
        )}
        {planning && (
          <PlanningDialog
            overview={overview}
            canSave={
              canAdmin(user, "allocation.manage") && overview?.readOnly !== true
            }
            onClose={() => setPlanning(false)}
          />
        )}
        {bulkAction && (
          <BulkReviewModal busy={busy} onClose={() => setBulkAction(null)}>
              <h2>مراجعة {bulkCounts(rows,selected).families} أسرة</h2>
              <p>{bulkCounts(rows,selected).pendingNeeds} احتياجًا معلقًا ضمن الأسر المحددة من الصفحة المعروضة فقط.</p>
              <details open>
                <summary>الأسر والقرارات التي سيجري حفظها</summary>
                <table className={s.comparison}>
                  <thead>
                    <tr>
                      <th>الأسرة</th>
                      <th>قرار الأسرة</th>
                      <th>الأجهزة المعلقة</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows
                      .filter((b) => selected.has(b.id))
                      .map((b) => (
                        <tr key={b.id}>
                          <td>
                            {b.name}
                            <small>{b.association.name}</small>
                          </td>
                          <td>
                            {b.reviewStatus === "UNDER_REVIEW"
                              ? bulkAction === "APPROVED"
                                ? "قبول"
                                : "رفض"
                              : "يبقى الاعتماد السابق"}
                          </td>
                          <td>
                            {b.needs
                              .filter((n) => n.decisionStatus === "PENDING")
                              .map(
                                (n) =>
                                  `${DEVICE_TYPE_LABELS[n.deviceType]}: ${bulkAction === "APPROVED" ? "قبول" : "رفض"}`,
                              )
                              .join("، ") || "لا يوجد قرار جهاز جديد"}
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </details>
              <p>
                {bulkAction === "APPROVED"
                  ? "سيُعتمد المستفيد غير المحسوم وتُعتمد أجهزته المعلقة. لن تُخصص أجهزة من المخزون."
                  : "سيُرفض المستفيد غير المحسوم مع أجهزته المعلقة. للأسرة المعتمدة: تُرفض أجهزتها المعلقة فقط وتبقى الأسرة معتمدة."}
              </p>
              {bulkAction === "REJECTED" && (
                <label>
                  سبب الرفض
                  <textarea
                    value={bulkReason}
                    onChange={(e) => setBulkReason(e.target.value)}
                    maxLength={1000}
                  />
                </label>
              )}
              <div className={s.actions}>
                <button
                  className={s.button}
                  disabled={
                    busy || (bulkAction === "REJECTED" && !bulkReason.trim())
                  }
                  onClick={() => void runBulk()}
                >
                  {busy ? "جارٍ الحفظ…" : "تأكيد الحفظ"}
                </button>
                <button
                  className={s.secondary}
                  disabled={busy}
                  onClick={() => setBulkAction(null)}
                >
                  إلغاء
                </button>
              </div>
          </BulkReviewModal>
        )}
      </div>
    </AppShell>
  );
}

function BulkReviewModal({children,busy,onClose}:{children:ReactNode;busy:boolean;onClose:()=>void}) {
  const focus=useDialogFocus(onClose,busy);
  return <div className={s.dialogOverlay}><section ref={focus} className={s.dialog} role="dialog" aria-modal="true" aria-label="معاينة مراجعة الأسر المحددة">{children}</section></div>;
}

function OpeningFamilyPanel({row,loading,error,onClose,onRetry}:{row:WorkspaceRow|null;loading:boolean;error:string;onClose:()=>void;onRetry:()=>void}) {
  const focus=useDialogFocus(onClose);
  return <div className={s.overlay}><section ref={focus} className={s.panel} role="dialog" aria-modal="true" aria-label={row ? `فتح ملف ${row.name}` : "فتح ملف الأسرة"} aria-busy={loading}>
    <header className={s.panelHeader}><div><h2>{row?.name ?? "ملف الأسرة"}</h2><p>{row?.association.name}</p></div><button className={s.close} onClick={onClose}>إغلاق</button></header>
    {row && <dl className={s.fields}><div><dt>المدينة</dt><dd>{row.city}</dd></div><div><dt>أفراد الأسرة</dt><dd>{row.familyCount}</dd></div><div><dt>الدخل</dt><dd>{money(row.income)}</dd></div></dl>}
    {loading ? <p className={s.notice} role="status">جارٍ تحميل التفاصيل الحديثة؛ تبقى القرارات معطلة حتى اكتمال التحقق.</p> : <div className={s.error} role="alert">{error || "تعذر تحميل الملف"}<button className={s.close} onClick={onRetry}>إعادة تحميل التفاصيل</button></div>}
    <footer className={s.actions}><button className={s.button} disabled>حفظ والتالي</button><button className={s.secondary} disabled>حفظ</button></footer>
  </section></div>;
}
