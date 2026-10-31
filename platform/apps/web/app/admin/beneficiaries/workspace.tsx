"use client";
import { useCallback, useEffect, useRef, useState } from "react";
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
    [detailLoading, setDetailLoading] = useState(false);
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
        if (generation === listGeneration.current) setData(value);
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
    void apiFetch<WorkspaceOverview>(
      `/beneficiary-workspace/overview?${cohortQuery}`,
      { signal: abort.signal },
    )
      .then((value) => {
        if (!abort.signal.aborted) setOverview(value);
      })
      .catch((e) => {
        if (!abort.signal.aborted) setError(message(e));
      });
    return () => abort.abort();
  }, [user, cohortQuery, revision]);
  useEffect(() => () => detailRequest.current?.abort(), []);
  const open = useCallback(async (id: string) => {
    detailRequest.current?.abort();
    const abort = new AbortController();
    detailRequest.current = abort;
    setDetailLoading(true);
    setError("");
    try {
      const value = await apiFetch<WorkspaceDetail>(
        `/beneficiary-workspace/${id}`,
        { signal: abort.signal },
      );
      if (!abort.signal.aborted) setDetail(value);
    } catch (e) {
      if (!abort.signal.aborted) setError(message(e));
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
    stats = overview?.totals;
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
  async function saveReview(payload: ReviewPayload, next: boolean) {
    if (!detail) return;
    await apiFetch(`/beneficiary-workspace/${detail.id}/review`, {
      method: "POST",
      body: JSON.stringify(payload),
    });
    const nextQuery = new URLSearchParams(listQuery);
    if (bucket !== "ALL") nextQuery.set("bucket", bucket);
    const nextRow = next
      ? await apiFetch<{ id: string | null }>(
          `/beneficiary-workspace/${detail.id}/next?${nextQuery}`,
        )
      : null;
    setNotice("حُفظت المراجعة. اعتماد الاحتياج لا يعني تخصيص جهاز من المخزون.");
    refresh();
    if (next && nextRow?.id) await open(nextRow.id);
    else if (next) {
      setDetail(null);
      setNotice(
        "حُفظت المراجعة. انتهت الأسر المتاحة للمراجعة في نطاق هذه الجمعية؛ اختر جمعية أو فرزًا آخر.",
      );
    } else await open(detail.id);
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
        <header className={s.header}>
          <div>
            <h1>المستفيدون واحتياجاتهم</h1>
            <p>مراجعة واضحة للأسرة، وقرار مستقل لكل جهاز.</p>
          </div>
          <button className={s.secondary} onClick={() => setPlanning(true)}>
            تخطيط الأجهزة
          </button>
        </header>
        <div className={s.toolbar}>
          <label>
            المنطقة
            <select
              value={region}
              onChange={(e) => {
                setRegion(e.target.value);
                setAssociation("");
                resetFilters();
              }}
            >
              <option value="">جميع المناطق</option>
              {overview?.regions.map((v) => (
                <option key={v}>{v}</option>
              ))}
            </select>
          </label>
          <label>
            بحث
            <input
              type="search"
              placeholder="اسم المستفيد، رقمه أو المدينة"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  setSearch(searchInput.trim());
                  setPage(1);
                }
              }}
            />
          </label>
          <label>
            المدينة
            <select
              value={city}
              onChange={(e) => {
                setCity(e.target.value);
                setPage(1);
              }}
            >
              <option value="">جميع المدن</option>
              {overview?.cities.map((v) => (
                <option key={v}>{v}</option>
              ))}
            </select>
          </label>
          <label>
            الجهاز
            <select
              value={deviceType}
              onChange={(e) => {
                setDevice(e.target.value);
                setPage(1);
              }}
            >
              <option value="">جميع الأجهزة</option>
              {DEVICE_TYPES.map((v) => (
                <option key={v} value={v}>
                  {DEVICE_TYPE_LABELS[v]}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>الأولوية</span>
            <span>
              <input
                type="checkbox"
                checked={topTen}
                onChange={(e) => {
                  setTopTen(e.target.checked);
                  setPage(1);
                }}
              />{" "}
              أول 10 في كل جمعية
            </span>
          </label>
          <details>
            <summary>خيارات العرض</summary>
            <label>
              <span>
                <input
                  type="checkbox"
                  checked={includeDemo}
                  onChange={(e) => {
                    setIncludeDemo(e.target.checked);
                    setPage(1);
                  }}
                />{" "}
                إظهار جمعية تجربة
              </span>
            </label>
            <button
              className={s.secondary}
              onClick={() => {
                setRegion("");
                setAssociation("");
                resetFilters();
              }}
            >
              إعادة ضبط الفرز
            </button>
          </details>
        </div>
        {overview?.readOnly && (
          <div className={s.notice}>
            وضع القراءة فقط مفعّل مؤقتًا؛ الحفظ والإرسال متوقفان.
          </div>
        )}
        {needStatus && (
          <button className={s.secondary} onClick={() => setNeedStatus("")}>
            إلغاء فرز حالة الأجهزة
          </button>
        )}
        {error && (
          <div className={s.error} role="alert">
            {error}
          </div>
        )}
        {notice && (
          <div className={s.notice} role="status">
            {notice}
          </div>
        )}
        <div className={s.cards}>
          {[
            ["ALL", "الأسر المرفوعة", stats?.families],
            ["REVIEW", "مراجعة الأسرة", stats?.review],
            ["NEEDS", "مراجعة الأجهزة", stats?.pendingNeeds],
            ["INFORMATION", "بانتظار الجمعية", stats?.information],
            ["REPLIED", "ردود وصلت", stats?.replied],
            ["APPROVED", "أسر معتمدة", stats?.approved],
            ["REJECTED", "أسر مرفوضة", stats?.rejected],
          ].map(([key, label, count]) => (
            <button
              key={key}
              className={`${s.card} ${bucket === key ? s.active : ""}`}
              onClick={() => chooseBucket(String(key))}
            >
              <strong>{count ?? "—"}</strong>
              {label}
            </button>
          ))}
        </div>
        <div className={s.layout}>
          <aside className={s.associations}>
            <h2>الجمعيات</h2>
            <button
              className={`${s.association} ${!associationId ? s.active : ""}`}
              onClick={() => chooseAssociation("")}
            >
              جميع الجمعيات
            </button>
            {overview?.associations.map((a) => (
              <button
                key={a.id}
                className={`${s.association} ${associationId === a.id ? s.active : ""}`}
                onClick={() => chooseAssociation(a.id)}
              >
                <strong>{a.name}</strong>
                <small>
                  {a.region} · {a.stats.families} أسرة · {a.stats.requested}{" "}
                  جهاز مطلوب
                </small>
              </button>
            ))}
          </aside>
          <section className={s.main} aria-label="مراجعة الأسر">
            <div className={s.breakdown}>
              <h2>
                {overview?.associations.find((a) => a.id === associationId)
                  ?.name ?? "قراءة الاحتياجات"}
              </h2>
              <div className={s.breakdownRow}>
                <span>الأجهزة:</span>
                <button
                  className={s.chip}
                  onClick={() => {
                    setNeedStatus("");
                    setRequested("");
                    setApproved("");
                    setBucket("ALL");
                    setPage(1);
                  }}
                >
                  {stats?.requested ?? "—"} مطلوبة
                </button>
                <button
                  className={s.chip}
                  onClick={() => {
                    setNeedStatus("APPROVED");
                    setPage(1);
                  }}
                >
                  {stats?.approvedDevices ?? "—"} معتمدة
                </button>
                <button
                  className={s.chip}
                  onClick={() => {
                    setNeedStatus("REJECTED");
                    setPage(1);
                  }}
                >
                  {stats?.rejectedDevices ?? "—"} مرفوضة
                </button>
                <button
                  className={s.chip}
                  onClick={() => {
                    setNeedStatus("PENDING");
                    setPage(1);
                  }}
                >
                  {stats?.pendingDevices ?? "—"} تنتظر القرار
                </button>
              </div>
              <div className={s.breakdownRow}>
                <button
                  className={s.chip}
                  onClick={() => {
                    setNeedStatus("ALLOCATED");
                    setPage(1);
                  }}
                >
                  {stats?.allocatedDevices ?? "—"} مخصصة إجمالًا
                </button>
                <span className={s.chip}>
                  {stats?.reservedDevices ?? "—"} محجوزة بالمستودع
                </span>
                <button
                  className={s.chip}
                  onClick={() => {
                    setNeedStatus("WITH_DELEGATE");
                    setPage(1);
                  }}
                >
                  {stats?.withDelegate ?? "—"} مع المندوب
                </button>
                <button
                  className={s.chip}
                  onClick={() => {
                    setNeedStatus("DELIVERED");
                    setPage(1);
                  }}
                >
                  {stats?.deliveredDevices ?? "—"} مسلمة
                </button>
                <span className={s.help}>
                  حالات فرعية من المخصص؛ لا تُجمع معه.
                </span>
              </div>
              <div className={s.breakdownRow}>
                <span>الأسر حسب عدد الأجهزة المطلوبة:</span>
                {[1, 2, 3].map((n) => (
                  <button
                    key={n}
                    className={`${s.chip} ${requestedCount === String(n) ? s.active : ""}`}
                    onClick={() => {
                      setRequested(
                        requestedCount === String(n) ? "" : String(n),
                      );
                      setApproved("");
                      setPage(1);
                    }}
                  >
                    <strong>{stats?.requestedFamilies[n] ?? "—"}</strong>
                    {n === 1 ? "جهاز واحد" : n === 2 ? "جهازان" : "ثلاثة أجهزة"}
                  </button>
                ))}
              </div>
              <div className={s.breakdownRow}>
                <span>الأسر حسب عدد الأجهزة المعتمدة:</span>
                {[1, 2, 3].map((n) => (
                  <button
                    key={n}
                    className={`${s.chip} ${approvedCount === String(n) ? s.active : ""}`}
                    onClick={() => {
                      setApproved(approvedCount === String(n) ? "" : String(n));
                      setRequested("");
                      setPage(1);
                    }}
                  >
                    <strong>{stats?.approvedFamilies[n] ?? "—"}</strong>
                    {n === 1 ? "جهاز واحد" : n === 2 ? "جهازان" : "ثلاثة أجهزة"}
                  </button>
                ))}
                <button
                  className={s.chip}
                  onClick={() => chooseBucket("INCOMPLETE")}
                >
                  {stats?.incomplete ?? "—"} بيانات ناقصة
                </button>
              </div>
              <div className={s.breakdownRow}>
                {DEVICE_TYPES.map((type) => (
                  <button
                    key={type}
                    className={`${s.chip} ${deviceType === type ? s.active : ""}`}
                    onClick={() => {
                      setDevice(deviceType === type ? "" : type);
                      setPage(1);
                    }}
                  >
                    {DEVICE_TYPE_LABELS[type]}:{" "}
                    {stats?.devices[type]?.requested ?? "—"} مطلوبة /{" "}
                    {stats?.devices[type]?.approved ?? "—"} معتمدة
                  </button>
                ))}
              </div>
              <p className={s.help}>
                الأرقام تخص نطاق العرض المحدد. الأولوية داخل كل جمعية، وليست
                مقارنة بين الجمعيات.{" "}
                {overview?.excludedDemo ? "جمعية تجربة مستثناة." : ""}
              </p>
            </div>
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
                          onClick={() => void open(b.id)}
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
        </div>
        {detailLoading && <div className={s.notice}>جارٍ فتح ملف الأسرة…</div>}
        {detail && (
          <FamilyPanel
            key={`${detail.id}:${detail.updatedAt}:${detail.informationRequests.map((r) => r.updatedAt).join()}`}
            detail={detail}
            canManage={canManage}
            onClose={() => {
              detailRequest.current?.abort();
              setDetail(null);
            }}
            onSave={saveReview}
            onInformation={() =>
              setInfoTargets([{ id: detail.id, version: detail.updatedAt }])
            }
            onRefresh={async () => {
              refresh();
              await open(detail.id);
            }}
          />
        )}
        {infoTargets && (
          <InformationDialog
            targets={infoTargets}
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
              if (detail) await open(detail.id);
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
          <div className={s.dialogOverlay}>
            <section className={s.dialog} role="dialog" aria-modal="true">
              <h2>مراجعة {selected.size} أسرة</h2>
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
            </section>
          </div>
        )}
      </div>
    </AppShell>
  );
}
