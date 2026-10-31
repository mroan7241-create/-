"use client";
import { useEffect, useState } from "react";
import {
  apiFetch,
  getReferenceData,
  newOpId,
  type ReferenceData,
} from "../../lib/api";
import {
  displayValue,
  INFORMATION_FIELDS,
  type InformationRequest,
} from "../../lib/beneficiary-workspace";
import { useOperationKey } from "../../lib/use-operation-key";
import { useDialogFocus } from "../../lib/use-dialog-focus";
import s from "../../admin/beneficiaries/workspace.module.css";

export function BeneficiaryInformationInbox() {
  const [requests, setRequests] = useState<InformationRequest[]>([]),
    [error, setError] = useState(""),
    [opened, setOpened] = useState<InformationRequest | null>(null),
    [revision, setRevision] = useState(0);
  useEffect(() => {
    const abort = new AbortController();
    void apiFetch<InformationRequest[]>("/beneficiary-workspace/information", {
      signal: abort.signal,
    })
      .then(setRequests)
      .catch((e) => {
        if (!abort.signal.aborted)
          setError(
            e instanceof Error ? e.message : "تعذر تحميل طلبات الاستكمال",
          );
      });
    return () => abort.abort();
  }, [revision]);
  if (!requests.length && !error) return null;
  return (
    <div className={s.workspace}>
      <section className={s.section}>
        <h3>طلبات استكمال بيانات المستفيدين</h3>
        {error && <p className={s.error}>{error}</p>}
        {requests.map((r) => (
          <div key={r.id} className={s.breakdownRow}>
            <strong>{r.beneficiary?.name}</strong>
            <span>
              {r.status === "OPEN"
                ? "مطلوب الرد"
                : "وصل ردكم — بانتظار مراجعة جمعية الزاد"}
            </span>
            {r.status === "OPEN" && (
              <button className={s.secondary} onClick={() => setOpened(r)}>
                استكمال البيانات
              </button>
            )}
          </div>
        ))}
      </section>
      {opened && (
        <ReplyForm
          request={opened}
          onClose={() => setOpened(null)}
          onDone={() => {
            setOpened(null);
            setRevision((v) => v + 1);
          }}
        />
      )}
    </div>
  );
}
function ReplyForm({
  request: r,
  onClose,
  onDone,
}: {
  request: InformationRequest;
  onClose: () => void;
  onDone: () => void;
}) {
  const [values, setValues] = useState<Record<string, unknown>>({
      ...r.sourceSnapshot,
    }),
    [note, setNote] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [references, setReferences] = useState<ReferenceData | null>(null);
  useEffect(() => {
    void getReferenceData()
      .then(setReferences)
      .catch(() =>
        setError("تعذر تحميل المدن والحالات المعتمدة؛ أعد فتح النموذج."),
      );
  }, []);
  const operationKey = useOperationKey();
  const focus = useDialogFocus(onClose, busy);
  async function submit() {
    setBusy(true);
    setError("");
    try {
      const parsed = Object.fromEntries(
        r.items.map((i) => [
          i.field,
          i.field === "income" || i.field === "familyCount"
            ? values[i.field] === null || values[i.field] === ""
              ? null
              : Number(values[i.field])
            : values[i.field],
        ]),
      );
      await apiFetch(`/beneficiary-workspace/information/${r.id}/reply`, {
        method: "POST",
        body: JSON.stringify({
          opId: operationKey({ version: r.updatedAt, values: parsed, note }),
          version: r.updatedAt,
          values: parsed,
          note,
        }),
      });
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : "تعذر إرسال الرد");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className={s.dialogOverlay}>
      <section ref={focus} className={s.dialog} role="dialog" aria-modal="true">
        <h2>استكمال بيانات {r.beneficiary?.name}</h2>
        {r.message && <p>{r.message}</p>}
        <p className={s.help}>
          يُراجع الرد من جمعية الزاد قبل تعديل البيانات الأصلية. لا يلزم إضافة
          المستفيد مرة أخرى.
        </p>
        {r.items.map((i) => (
          <div className={s.section} key={i.field}>
            <label>
              {INFORMATION_FIELDS[i.field]}
              <p className={s.help}>
                {i.reason} · القيمة الحالية:{" "}
                {displayValue(r.sourceSnapshot[i.field])}
              </p>
              {i.field === "socialSecurity" ? (
                <select
                  value={
                    values[i.field] === true
                      ? "true"
                      : values[i.field] === false
                        ? "false"
                        : ""
                  }
                  onChange={(e) =>
                    setValues((v) => ({
                      ...v,
                      [i.field]:
                        e.target.value === ""
                          ? null
                          : e.target.value === "true",
                    }))
                  }
                >
                  <option value="">اختيار</option>
                  <option value="true">نعم</option>
                  <option value="false">لا</option>
                </select>
              ) : i.field === "city" || i.field === "maritalStatus" ? (
                <select
                  value={String(values[i.field] ?? "")}
                  onChange={(e) =>
                    setValues((v) => ({ ...v, [i.field]: e.target.value }))
                  }
                >
                  <option value="">اختيار</option>
                  {(i.field === "city"
                    ? references?.citiesByRegion[r.beneficiary?.region ?? ""]
                    : references?.socialStatuses
                  )?.map((v) => (
                    <option key={v}>{v}</option>
                  ))}
                </select>
              ) : (
                <input
                  aria-label={INFORMATION_FIELDS[i.field]}
                  type={
                    i.field === "income" || i.field === "familyCount"
                      ? "number"
                      : "text"
                  }
                  min={0}
                  step={i.field === "income" ? "0.01" : "1"}
                  maxLength={i.field === "threeDeviceReason" ? 1000 : 200}
                  value={String(values[i.field] ?? "")}
                  onChange={(e) =>
                    setValues((v) => ({ ...v, [i.field]: e.target.value }))
                  }
                />
              )}
            </label>
          </div>
        ))}
        <label>
          توضيح إضافي (اختياري)
          <textarea
            value={note}
            maxLength={1000}
            onChange={(e) => setNote(e.target.value)}
          />
        </label>
        {error && <p className={s.error}>{error}</p>}
        <div className={s.actions}>
          <button
            className={s.button}
            disabled={busy}
            onClick={() => void submit()}
          >
            {busy ? "جارٍ الإرسال…" : "إرسال الرد للمراجعة"}
          </button>
          <button className={s.secondary} disabled={busy} onClick={onClose}>
            إلغاء
          </button>
        </div>
      </section>
    </div>
  );
}
