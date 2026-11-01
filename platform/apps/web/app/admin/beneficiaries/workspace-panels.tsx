"use client";
import { useEffect, useRef, useState } from "react";
import {
  apiFetch,
  newOpId,
  DEVICE_TYPE_LABELS,
  DEVICE_TYPES,
  BENEFICIARY_REVIEW_STATUS_LABELS,
} from "../../lib/api";
import {
  INFORMATION_FIELDS,
  MAIL_STATUS_LABELS,
  displayValue,
  type InformationField,
  type InformationItem,
  type InformationRequest,
  type PlanningLimits,
  type ReviewPayload,
  type Simulation,
  type WorkspaceDetail,
  type WorkspaceHistory,
  type WorkspaceOverview,
} from "../../lib/beneficiary-workspace";
import { useOperationKey } from "../../lib/use-operation-key";
import { useDialogFocus } from "../../lib/use-dialog-focus";
import s from "./workspace.module.css";
const message = (e: unknown) =>
  e instanceof Error ? e.message : "تعذر إتمام العملية";
const money = (n: number | null) =>
  n === null ? "غير متوفر" : `${n.toLocaleString("ar-SA")} ريال`;
const actions: Record<string, string> = {
  BENEFICIARY_WORKSPACE_REVIEWED: "حُفظت مراجعة الأسرة واحتياجاتها",
  BENEFICIARY_INFORMATION_REQUESTED: "طُلب استكمال أو التحقق من البيانات",
  BENEFICIARY_INFORMATION_REPLIED: "وصل رد الجمعية",
  BENEFICIARY_INFORMATION_ACCEPTED: "اعتُمد رد الجمعية وحُدّثت البيانات",
  BENEFICIARY_INFORMATION_CANCELLED: "أُغلق طلب الاستكمال دون تطبيق الرد",
};

// Suspend the visible scope without unmounting the review draft or running two traps.
function useFamilyFocus(onClose: () => void, busy: boolean, enabled: boolean) {
  const ref = useRef<HTMLElement | null>(null);
  const state = useRef({ onClose, busy });
  useEffect(() => { state.current = { onClose, busy }; }, [onClose, busy]);
  useEffect(() => {
    const root = ref.current;
    if (!enabled || !root) return;
    const previous = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const elements = () => Array.from(root.querySelectorAll<HTMLElement>(
      'button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),a[href],[tabindex="0"]',
    )).filter((el) => el.getClientRects().length > 0);
    elements()[0]?.focus();
    function key(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        if (!state.current.busy) state.current.onClose();
      }
      if (event.key !== "Tab") return;
      const list = elements(), first = list[0], last = list.at(-1);
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault(); last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault(); first?.focus();
      }
    }
    root.addEventListener("keydown", key);
    return () => {
      root.removeEventListener("keydown", key);
      document.body.style.overflow = overflow;
      if (previous?.isConnected && previous.getClientRects().length) previous.focus();
    };
  }, [enabled]);
  return ref;
}

export function FamilyPanel({
  detail: b,
  canManage,
  onClose,
  onSave,
  onInformation,
  onRefresh,
  suspended = false,
  onDirtyChange,
}: {
  detail: WorkspaceDetail;
  canManage: boolean;
  onClose: () => void;
  onSave: (p: ReviewPayload, next: boolean) => Promise<void>;
  onInformation: () => void;
  onRefresh: () => Promise<void>;
  suspended?: boolean;
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const [family, setFamily] = useState<"APPROVED" | "REJECTED">(
    b.reviewStatus === "REJECTED" ? "REJECTED" : "APPROVED",
  );
  const [decisions, setDecisions] = useState<Record<string, string>>(() =>
      Object.fromEntries(
        b.needs
          .filter((n) => n.decisionStatus === "PENDING")
          .map((n) => [n.id, "APPROVED"]),
      ),
    ),
    [reasons, setReasons] = useState<Record<string, string>>({}),
    [reason, setReason] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [tab, setTab] = useState("review");
  const draft = JSON.stringify({ family, decisions, reasons, reason });
  const [savedDraft, setSavedDraft] = useState(draft);
  const dirty = draft !== savedDraft;
  const dirtyRef = useRef(dirty);
  const [closing, setClosing] = useState(false);
  const closeGuard = useRef<HTMLDivElement | null>(null);
  const guardReturnFocus = useRef<HTMLElement | null>(null);
  const [history, setHistory] = useState<WorkspaceHistory | null>(null);
  const [historyBusy, setHistoryBusy] = useState(false);
  const [historyError, setHistoryError] = useState("");
  const [historyAttempt, setHistoryAttempt] = useState(0);
  function requestClose() {
    if (busy || suspended) return;
    if (closing) setClosing(false);
    else if (dirty) {
      guardReturnFocus.current = document.activeElement as HTMLElement | null;
      setClosing(true);
    }
    else onClose();
  }
  const focus = useFamilyFocus(requestClose, busy, !suspended);
  useEffect(() => {
    dirtyRef.current = dirty;
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);
  useEffect(() => {
    if (closing && !suspended) closeGuard.current?.querySelector<HTMLButtonElement>("button")?.focus();
    else if (!suspended && guardReturnFocus.current?.isConnected) {
      guardReturnFocus.current.focus();
      guardReturnFocus.current = null;
    }
  }, [closing, suspended]);
  useEffect(() => {
    if (tab !== "history" || suspended) return;
    if (history?.id === b.id && history.version === b.updatedAt) return;
    const controller = new AbortController();
    setHistoryBusy(true);
    setHistoryError("");
    void apiFetch<WorkspaceHistory>(`/beneficiary-workspace/${encodeURIComponent(b.id)}/history`, {
      signal: controller.signal,
    }).then((result) => {
      if (controller.signal.aborted) return;
      if (result.id !== b.id || result.version !== b.updatedAt) {
        setHistoryError("تغيّر الملف أثناء تحميل السجل. حدّث الملف ثم راجع السجل.");
        return;
      }
      setHistory(result);
    }).catch((e: unknown) => {
      if (!controller.signal.aborted) setHistoryError(message(e));
    }).finally(() => {
      if (!controller.signal.aborted) setHistoryBusy(false);
    });
    return () => controller.abort();
  }, [b.id, b.updatedAt, tab, suspended, history, historyAttempt]);
  const loadedHistory = history?.id === b.id && history.version === b.updatedAt ? history : null;
  const historyRequests = loadedHistory
    ? [
        ...b.informationRequests.map((current) => {
          const loaded = loadedHistory.informationRequests.find((r) => r.id === current.id);
          if (!loaded) return current;
          return loaded.updatedAt >= current.updatedAt
            ? loaded
            : { ...current, emailStatus: loaded.emailStatus ?? current.emailStatus };
        }),
        ...loadedHistory.informationRequests.filter((r) => !b.informationRequests.some((current) => current.id === r.id)),
      ]
    : b.informationRequests;
  async function refreshInformation() {
    if (dirtyRef.current) return;
    setHistory(null);
    setHistoryAttempt((attempt) => attempt + 1);
    await onRefresh();
  }
  const active = b.informationRequests.find((r) =>
    ["OPEN", "SUBMITTED"].includes(r.status),
  );
  const operationKey = useOperationKey();
  async function save(next: boolean, closeAfterSave = false) {
    if (busy || suspended || !canManage || active) return;
    setBusy(true);
    setError("");
    try {
      const intent = {
        version: b.updatedAt,
        ...(b.reviewStatus === "UNDER_REVIEW"
          ? { familyDecision: family }
          : {}),
        reason,
        needs:
          family === "REJECTED"
            ? []
            : b.needs
                .filter(
                  (n) =>
                    n.decisionStatus === "PENDING" &&
                    decisions[n.id] !== "PENDING",
                )
                .map((n) => ({
                  needId: n.id,
                  decision: decisions[n.id] as "APPROVED" | "REJECTED",
                  reason: reasons[n.id],
                })),
      };
      await onSave({ ...intent, opId: operationKey(intent) }, next);
      setSavedDraft(draft);
      setClosing(false);
      if (closeAfterSave) onClose();
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className={s.overlay} hidden={suspended} style={suspended ? { display: "none" } : undefined} aria-hidden={suspended || undefined}>
      <section
        ref={focus}
        className={s.panel}
        role={suspended ? undefined : "dialog"}
        aria-modal={suspended ? undefined : true}
        aria-label={`ملف ${b.name}`}
      >
        <header className={s.panelHeader}>
          <div>
            <h2>{b.name}</h2>
            <p>
              {b.association.name} · الأولوية {b.needPriority ?? "غير محددة"} ·{" "}
              {b.publicCode}
            </p>
          </div>
          <button disabled={busy} className={s.close} onClick={requestClose}>
            إغلاق
          </button>
        </header>
        {closing && (
          <div className={s.panelV2Guard} ref={closeGuard}>
            <h3>لديك تغييرات لم تُحفظ</h3>
            <p>هل تريد حفظ القرارات قبل إغلاق ملف الأسرة؟</p>
            {error && <p className={s.error} role="alert">{error}</p>}
            <div className={s.panelV2GuardActions}>
              <button className={s.secondary} disabled={busy} onClick={() => setClosing(false)}>متابعة التحرير</button>
              <button className={s.button} disabled={busy || !canManage || !!active} onClick={() => void save(false, true)}>{busy ? "جارٍ الحفظ…" : "حفظ وإغلاق"}</button>
              <button className={s.secondary} disabled={busy} onClick={() => { onDirtyChange?.(false); onClose(); }}>تجاهل التغييرات وإغلاق</button>
            </div>
          </div>
        )}
        <div hidden={closing} className={s.panelV2Content}>
        <div className={s.breakdownRow}>
          <button
            className={`${s.chip} ${tab === "review" ? s.active : ""}`}
            onClick={() => setTab("review")}
          >
            البيانات والقرارات
          </button>
          <button
            className={`${s.chip} ${tab === "history" ? s.active : ""}`}
            onClick={() => setTab("history")}
          >
            السجل والاستكمال
          </button>
        </div>
        {error && (
          <div className={s.error} role="alert">
            {error}{" "}
            <button className={s.close} disabled={dirty || busy} onClick={() => void onRefresh()}>
              تحديث الملف
            </button>
            {dirty && <span> احتفظ بتغييراتك أو أغلق الملف قبل إعادة تحميله.</span>}
          </div>
        )}
        {tab === "review" ? (
          <>
            <section className={s.section}>
              <h3>بيانات الأسرة</h3>
              <dl className={s.fields}>
                {[
                  ["الدخل", money(b.income)],
                  ["الضمان الاجتماعي", b.socialSecurity ? "نعم" : "لا"],
                  ["عدد أفراد الأسرة", b.familyCount],
                  ["الحالة الاجتماعية", b.maritalStatus],
                  ["المنطقة", b.region],
                  ["المدينة", b.city],
                  ["الحي", b.district],
                  ["الجوال", b.phone],
                  ["جوال إضافي", b.secondaryPhone],
                ].map(([key, value]) => (
                  <div key={key}>
                    <dt>{key}</dt>
                    <dd
                      className={
                        key === "الدخل" && b.income === null ? s.missing : ""
                      }
                    >
                      {displayValue(value)}
                    </dd>
                  </div>
                ))}
              </dl>
              {b.notes && <p>ملاحظات: {b.notes}</p>}
              {b.threeDeviceReason && (
                <p>
                  <strong>مبرر ثلاثة أجهزة:</strong> {b.threeDeviceReason}
                </p>
              )}
              <p className={s.help}>
                الموقع الدقيق:{" "}
                {b.latitude === null || b.longitude === null
                  ? "غير مرفق — اختياري"
                  : `${b.latitude}, ${b.longitude}`}
              </p>
            </section>
            {active && (
              <div className={s.notice}>
                {active.status === "SUBMITTED"
                  ? "وصل رد الجمعية. راجع المقارنة في السجل قبل اتخاذ القرار."
                  : "بانتظار رد الجمعية؛ لم يُحفظ قرار جديد."}
                <button className={s.close} onClick={() => setTab("history")}>
                  عرض الاستكمال
                </button>
              </div>
            )}
            <section className={s.section}>
              <h3>1. أهلية الأسرة</h3>
              {b.reviewStatus === "UNDER_REVIEW" ? (
                <>
                  <label>
                    القرار{" "}
                    <select
                      disabled={!canManage || !!active || busy}
                      value={family}
                      onChange={(e) =>
                        setFamily(e.target.value as "APPROVED" | "REJECTED")
                      }
                    >
                      <option value="APPROVED">قبول الأسرة</option>
                      <option value="REJECTED">رفض الأسرة</option>
                    </select>
                  </label>
                  {family === "REJECTED" && (
                    <textarea
                      placeholder="سبب رفض الأسرة"
                      value={reason}
                      onChange={(e) => setReason(e.target.value)}
                      maxLength={1000}
                    />
                  )}
                  <p className={s.help}>
                    الاختيار المبدئي قبول؛ لن يُحفظ إلا عند الضغط على زر الحفظ.
                  </p>
                </>
              ) : (
                <strong>
                  {BENEFICIARY_REVIEW_STATUS_LABELS[b.reviewStatus]}
                </strong>
              )}
            </section>
            <section className={s.section}>
              <h3>2. الأجهزة المطلوبة</h3>
              <p className={s.help}>
                يمكن حفظ أهلية الأسرة وحدها باختيار «لاحقًا» للأجهزة. اعتماد
                الجهاز يثبت الاحتياج فقط.
              </p>
              {b.needs.map((n) => (
                <div className={s.decisionRow} key={n.id}>
                  <strong>{DEVICE_TYPE_LABELS[n.deviceType]}</strong>
                  {n.decisionStatus === "PENDING" &&
                  b.reviewStatus !== "REJECTED" ? (
                    <select
                      aria-label={`قرار ${DEVICE_TYPE_LABELS[n.deviceType]}`}
                      disabled={
                        !canManage || !!active || busy || family === "REJECTED"
                      }
                      value={decisions[n.id] ?? "PENDING"}
                      onChange={(e) =>
                        setDecisions((v) => ({ ...v, [n.id]: e.target.value }))
                      }
                    >
                      <option value="APPROVED">قبول الاحتياج</option>
                      <option value="REJECTED">رفض الاحتياج</option>
                      <option value="PENDING">لاحقًا</option>
                    </select>
                  ) : (
                    <span
                      className={`${s.status} ${n.decisionStatus === "APPROVED" ? s.good : s.bad}`}
                    >
                      {n.decisionStatus === "APPROVED" ? "معتمد" : "مرفوض"}
                    </span>
                  )}
                  {decisions[n.id] === "REJECTED" &&
                    family !== "REJECTED" &&
                    n.decisionStatus === "PENDING" && (
                      <input
                        placeholder="سبب رفض الجهاز"
                        maxLength={1000}
                        value={reasons[n.id] ?? ""}
                        onChange={(e) =>
                          setReasons((v) => ({ ...v, [n.id]: e.target.value }))
                        }
                      />
                    )}{" "}
                  {n.rejectReason && <p className={s.help}>{n.rejectReason}</p>}
                </div>
              ))}
            </section>
          </>
        ) : (
          <>
            {historyBusy && <p className={s.help} role="status">جارٍ تحميل السجل…</p>}
            {historyError && <div className={s.error} role="alert">{historyError} <button className={s.close} onClick={() => setHistoryAttempt((attempt) => attempt + 1)}>إعادة المحاولة</button> <button className={s.close} disabled={dirty || busy} onClick={() => void onRefresh()}>تحديث الملف</button>{dirty && <span> أغلق الملف مع حفظ التغييرات أو تجاهلها قبل إعادة تحميله.</span>}</div>}
            {dirty && (
              <div className={s.notice} role="status">
                لديك تعديلات على القرارات لم تُحفظ. احفظها أو تجاهلها قبل اعتماد رد الجمعية أو إغلاق طلب الاستكمال؛ يمكنك الاطلاع على السجل الآن.
              </div>
            )}
            {historyRequests.map((r) => (
              <InformationReview
                key={r.id}
                request={r}
                canManage={canManage && !dirty}
                onDone={refreshInformation}
              />
            ))}
            <section className={s.section}>
              <h3>سجل الإجراءات</h3>
              <ul className={s.timeline}>
                {(loadedHistory?.events ?? []).map((e) => (
                  <li key={e.id}>
                    {actions[e.action] ?? "تحديث بيانات الأسرة"}
                    <small>
                      {new Date(e.createdAt).toLocaleString("ar-SA")}
                    </small>
                  </li>
                ))}
              </ul>
              {loadedHistory && !loadedHistory.events.length && (
                <p className={s.help}>لا توجد إجراءات مسجلة لهذا الملف بعد.</p>
              )}
            </section>
          </>
        )}
        {canManage && (
          <footer className={s.actions}>
            {b.reviewStatus !== "REJECTED" && !active && (
              <>
                <button
                  className={s.button}
                  disabled={busy}
                  onClick={() => void save(true)}
                >
                  {busy ? "جارٍ الحفظ…" : "حفظ والتالي"}
                </button>
                <button
                  className={s.secondary}
                  disabled={busy}
                  onClick={() => void save(false)}
                >
                  حفظ
                </button>
                <button
                  className={s.secondary}
                  disabled={busy}
                  onClick={onInformation}
                >
                  طلب استكمال / تحقق
                </button>
              </>
            )}
            <button className={s.secondary} disabled={busy} onClick={requestClose}>
              إغلاق
            </button>
          </footer>
        )}
        </div>
      </section>
    </div>
  );
}

export function InformationDialog({
  targets,
  recipients,
  initialItems = [],
  reviewDraftPending = false,
  onClose,
  onDone,
}: {
  targets: { id: string; version: string }[];
  recipients: { name: string; email: string | null }[];
  initialItems?: InformationItem[];
  reviewDraftPending?: boolean;
  onClose: () => void;
  onDone: () => Promise<void>;
}) {
  const [items, setItems] = useState<
      Partial<Record<InformationField, InformationItem>>
    >(() => Object.fromEntries(initialItems.map((item) => [item.field, { ...item }]))),
    [intro, setIntro] = useState(
      "يرجى مراجعة البيانات المحددة والرد من صفحة المستفيدين.",
    ),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const operationKey = useOperationKey();
  const [due, setDue] = useState("");
  const focus = useDialogFocus(onClose, busy);
  async function send() {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const intent = {
        targets,
        items: Object.values(items),
        message: intro,
        ...(due
          ? { dueAt: new Date(due + "T23:59:59+03:00").toISOString() }
          : {}),
      };
      await apiFetch("/beneficiary-workspace/information", {
        method: "POST",
        body: JSON.stringify({ ...intent, opId: operationKey(intent) }),
      });
      await onDone();
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className={s.dialogOverlay}>
      <section ref={focus} className={s.dialog} role="dialog" aria-modal="true">
        <h2>طلب استكمال / تحقق — {targets.length} أسرة</h2>
        {reviewDraftPending && (
          <div className={s.error} role="status">
            إرسال طلب الاستكمال يوقف المراجعة ويلغي تعديلات القرارات غير المحفوظة. اختر «إلغاء» للعودة إلى مسودة القرار والاحتفاظ بها.
          </div>
        )}
        <div className={s.notice}>
          {recipients.map((r) => (
            <p key={r.name}>
              {r.name}:{" "}
              <span dir="ltr">{r.email ?? "بريد رسمي غير متوفر"}</span>
            </p>
          ))}
        </div>
        <p className={s.help}>
          حدد الحقول وسبب الطلب. يُحفظ الرد على الأسرة نفسها للمراجعة، ويُرسل
          بريد ملخص واحد لكل جمعية إلى بريدها الرسمي.
        </p>
        <div className={s.requestFields}>
          {Object.entries(INFORMATION_FIELDS).map(([field, label]) => {
            const key = field as InformationField,
              item = items[key];
            return (
              <div className={s.requestField} key={key}>
                <label>
                  <input
                    type="checkbox"
                    checked={!!item}
                    onChange={(e) =>
                      setItems((v) => {
                        const next = { ...v };
                        if (e.target.checked)
                          next[key] = {
                            field: key,
                            kind: "MISSING",
                            reason: "",
                          };
                        else delete next[key];
                        return next;
                      })
                    }
                  />
                  {label}
                </label>
                {item && (
                  <>
                    <select
                      value={item.kind}
                      onChange={(e) =>
                        setItems((v) => ({
                          ...v,
                          [key]: {
                            ...item,
                            kind: e.target.value as "MISSING" | "VERIFY",
                          },
                        }))
                      }
                    >
                      <option value="MISSING">بيانات ناقصة</option>
                      <option value="VERIFY">التحقق من القيمة</option>
                    </select>
                    <input
                      type="text"
                      maxLength={500}
                      placeholder="سبب الطلب — يظهر للجمعية داخل حسابها"
                      value={item.reason}
                      onChange={(e) =>
                        setItems((v) => ({
                          ...v,
                          [key]: { ...item, reason: e.target.value },
                        }))
                      }
                    />
                  </>
                )}
              </div>
            );
          })}
        </div>
        <label>
          مهلة الرد (اختياري)
          <input
            type="date"
            value={due}
            onChange={(e) => setDue(e.target.value)}
          />
        </label>
        <label>
          ملاحظة للجمعية داخل المنصة
          <textarea
            value={intro}
            maxLength={2000}
            onChange={(e) => setIntro(e.target.value)}
          />
        </label>
        <p className={s.help}>
          البريد: «لديكم طلبات استكمال أو تحقق من بيانات المستفيدين. يرجى الدخول
          إلى حساب الجمعية…». تفاصيل الأسر وقيم الدخل تظهر في المنصة فقط.
        </p>
        {error && <div className={s.error}>{error}</div>}
        <div className={s.actions}>
          <button
            className={s.button}
            disabled={
              busy ||
              !recipients.length ||
              recipients.some((r) => !r.email) ||
              !Object.values(items).length ||
              Object.values(items).some((i) => !i?.reason.trim())
            }
            onClick={() => void send()}
          >
            {busy ? "جارٍ الحفظ…" : reviewDraftPending ? "إرسال الاستكمال وتجاهل مسودة القرار" : "حفظ الطلب وإرسال الإشعار"}
          </button>
          <button className={s.secondary} disabled={busy} onClick={onClose}>
            إلغاء
          </button>
        </div>
      </section>
    </div>
  );
}

function InformationReview({
  request: r,
  canManage,
  onDone,
}: {
  request: InformationRequest;
  canManage: boolean;
  onDone: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false),
    [note, setNote] = useState(""),
    [error, setError] = useState(""),
    [cancel, setCancel] = useState(false);
  const operationKey = useOperationKey();
  async function resolve(accept: boolean) {
    setBusy(true);
    setError("");
    try {
      const intent = { version: r.updatedAt, accept, note };
      await apiFetch(`/beneficiary-workspace/information/${r.id}/resolve`, {
        method: "POST",
        body: JSON.stringify({ ...intent, opId: operationKey(intent) }),
      });
      await onDone();
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className={s.section}>
      <h3>
        طلب استكمال —{" "}
        {r.status === "OPEN"
          ? "بانتظار الجمعية"
          : r.status === "SUBMITTED"
            ? "وصل الرد"
            : r.status === "CLOSED"
              ? "اعتُمد الرد"
              : "مغلق دون تطبيق"}
      </h3>
      <p className={s.help}>
        البريد: {MAIL_STATUS_LABELS[r.emailStatus ?? "NOT_QUEUED"]}
      </p>
      {r.dueAt && (
        <p className={s.help}>
          المهلة: {new Date(r.dueAt).toLocaleDateString("ar-SA")}
        </p>
      )}
      {r.message && <p>{r.message}</p>}
      <table className={s.comparison}>
        <thead>
          <tr>
            <th>البند</th>
            <th>القيمة السابقة</th>
            <th>رد الجمعية</th>
          </tr>
        </thead>
        <tbody>
          {r.items.map((i) => (
            <tr key={i.field}>
              <td>
                {INFORMATION_FIELDS[i.field]}
                <small>{i.reason}</small>
              </td>
              <td>{displayValue(r.sourceSnapshot[i.field])}</td>
              <td>{displayValue(r.response?.[i.field])}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {r.responseNote && <p>توضيح الجمعية: {r.responseNote}</p>}
      {error && <div className={s.error}>{error}</div>}
      {canManage && ["OPEN", "SUBMITTED"].includes(r.status) && (
        <>
          <div className={s.actions}>
            {r.status === "SUBMITTED" && (
              <button
                className={s.button}
                disabled={busy}
                onClick={() => void resolve(true)}
              >
                اعتماد الرد وتحديث البيانات
              </button>
            )}
            <button
              className={s.secondary}
              disabled={busy}
              onClick={() => setCancel((v) => !v)}
            >
              إغلاق دون تطبيق
            </button>
          </div>
          {cancel && (
            <>
              <input
                placeholder="سبب الإغلاق"
                value={note}
                maxLength={1000}
                onChange={(e) => setNote(e.target.value)}
              />
              <button
                className={s.secondary}
                disabled={busy || !note.trim()}
                onClick={() => void resolve(false)}
              >
                تأكيد الإغلاق
              </button>
            </>
          )}
        </>
      )}
    </section>
  );
}

export function PlanningDialog({
  overview,
  canSave,
  onClose,
}: {
  overview: WorkspaceOverview | null;
  canSave: boolean;
  onClose: () => void;
}) {
  const [plan, setPlan] = useState<{
      limits: PlanningLimits;
      version: string;
    } | null>(null),
    [simulation, setSimulation] = useState<Simulation | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  useEffect(() => {
    const abort = new AbortController();
    void apiFetch<{ limits: PlanningLimits; version: string }>(
      "/beneficiary-workspace/planning",
      { signal: abort.signal },
    )
      .then(setPlan)
      .catch((e) => {
        if (!abort.signal.aborted) setError(message(e));
      });
    return () => abort.abort();
  }, []);
  const focus = useDialogFocus(onClose, busy);
  function change(
    kind: "regions" | "associations" | "devices",
    key: string,
    value: string,
  ) {
    if (!plan) return;
    const map = { ...plan.limits[kind] };
    if (value === "") delete map[key];
    else map[key] = Number(value);
    setPlan({ ...plan, limits: { ...plan.limits, [kind]: map } });
    setSimulation(null);
  }
  async function simulate() {
    if (!plan) return;
    setBusy(true);
    setError("");
    try {
      setSimulation(
        await apiFetch<Simulation>("/beneficiary-workspace/planning/simulate", {
          method: "POST",
          body: JSON.stringify({ limits: plan.limits }),
        }),
      );
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  const operationKey = useOperationKey();
  async function save() {
    if (!plan || !simulation) return;
    setBusy(true);
    setError("");
    try {
      setPlan(
        await apiFetch("/beneficiary-workspace/planning", {
          method: "PUT",
          body: JSON.stringify({ ...plan, opId: operationKey(plan) }),
        }),
      );
      setNotice("حُفظت حصص التخطيط فقط. لم تُخصص أجهزة ولم تتغير القرارات.");
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className={s.dialogOverlay}>
      <section ref={focus} className={s.dialog} role="dialog" aria-modal="true">
        <h2>تخطيط الأجهزة</h2>
        <p className={s.help}>
          محاكاة للأجهزة المعتمدة غير المخصصة. الخانة الفارغة تعني عدم فرض حد
          إضافي؛ الصفر يمنع التخصيص في المحاكاة. حفظ الخطة لا ينقل أجهزة ولا
          يرفض مستفيدًا.
        </p>
        {error && <div className={s.error}>{error}</div>}
        {notice && <div className={s.notice}>{notice}</div>}
        {plan ? (
          <>
            <div className={s.planGrid}>
              <label htmlFor="total-devices">إجمالي الأجهزة</label>
              <input
                id="total-devices"
                type="number"
                min={0}
                value={plan.limits.total}
                onChange={(e) => {
                  setPlan({
                    ...plan,
                    limits: { ...plan.limits, total: Number(e.target.value) },
                  });
                  setSimulation(null);
                }}
              />
            </div>
            <label>
              <input
                type="checkbox"
                checked={plan.limits.allowPartial === true}
                onChange={(e) => {
                  setPlan({
                    ...plan,
                    limits: { ...plan.limits, allowPartial: e.target.checked },
                  });
                  setSimulation(null);
                }}
              />{" "}
              اقتراح الأجهزة المتاحة للأسرة ولو لم تكتمل أجهزتها
            </label>
            <h3>حسب المنطقة</h3>
            <div className={s.planGrid}>
              {overview?.regions.map((v) => (
                <div style={{ display: "contents" }} key={v}>
                  <label htmlFor={`region-${v}`}>{v}</label>
                  <input
                    id={`region-${v}`}
                    type="number"
                    min={0}
                    placeholder="دون حد"
                    value={plan.limits.regions[v] ?? ""}
                    onChange={(e) => change("regions", v, e.target.value)}
                  />
                </div>
              ))}
            </div>
            <details>
              <summary>حصص الجمعيات</summary>
              <div className={s.planGrid}>
                {overview?.associations.map((a) => (
                  <div key={a.id} style={{ display: "contents" }}>
                    <label htmlFor={`assoc-${a.id}`}>{a.name}</label>
                    <input
                      id={`assoc-${a.id}`}
                      type="number"
                      min={0}
                      placeholder="دون حد"
                      value={plan.limits.associations[a.id] ?? ""}
                      onChange={(e) =>
                        change("associations", a.id, e.target.value)
                      }
                    />
                  </div>
                ))}
              </div>
            </details>
            <h3>حسب نوع الجهاز</h3>
            <div className={s.planGrid}>
              {DEVICE_TYPES.map((v) => (
                <div key={v} style={{ display: "contents" }}>
                  <label htmlFor={`device-${v}`}>{DEVICE_TYPE_LABELS[v]}</label>
                  <input
                    id={`device-${v}`}
                    type="number"
                    min={0}
                    placeholder="دون حد"
                    value={plan.limits.devices[v] ?? ""}
                    onChange={(e) => change("devices", v, e.target.value)}
                  />
                </div>
              ))}
            </div>
            {simulation && (
              <div className={s.notice}>
                المقترح: {simulation.selected.length} أسرة /{" "}
                {simulation.used.total} جهاز جديد. المخصص سابقًا:{" "}
                {simulation.existingAllocated}. ينتظر توفر الحصص:{" "}
                {simulation.waiting.length} أسرة.
                <p className={s.help}>{simulation.policy}</p>
                <details>
                  <summary>تفاصيل المحاكاة</summary>
                  <table className={s.comparison}>
                    <thead>
                      <tr>
                        <th>الأسرة / الجمعية</th>
                        <th>مقترح</th>
                        <th>انتظار الحصة</th>
                      </tr>
                    </thead>
                    <tbody>
                      {simulation.proposals.map((p) => (
                        <tr key={p.id}>
                          <td>
                            {p.name}
                            <small>
                              {p.associationName} · الأولوية{" "}
                              {p.priority ?? "غير محددة"}
                            </small>
                          </td>
                          <td>
                            {p.selected
                              .map(
                                (v) =>
                                  DEVICE_TYPE_LABELS[
                                    v as keyof typeof DEVICE_TYPE_LABELS
                                  ],
                              )
                              .join("، ") || "—"}
                          </td>
                          <td>
                            {p.waiting
                              .map(
                                (v) =>
                                  DEVICE_TYPE_LABELS[
                                    v as keyof typeof DEVICE_TYPE_LABELS
                                  ],
                              )
                              .join("، ") || "—"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </details>
              </div>
            )}
            <div className={s.actions}>
              <button
                className={s.button}
                disabled={busy}
                onClick={() => void simulate()}
              >
                {busy ? "جارٍ المعالجة…" : "معاينة التوزيع"}
              </button>
              {canSave && (
                <button
                  className={s.secondary}
                  disabled={busy || !simulation}
                  onClick={() => void save()}
                >
                  حفظ حصص التخطيط
                </button>
              )}
              <button className={s.secondary} disabled={busy} onClick={onClose}>
                إغلاق
              </button>
            </div>
          </>
        ) : (
          <p>جارٍ تحميل الخطة…</p>
        )}
      </section>
    </div>
  );
}
