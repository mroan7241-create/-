"use client";
import { DEVICE_TYPE_LABELS, DEVICE_TYPES } from "../../lib/api";
import type { WorkspaceStats } from "../../lib/beneficiary-workspace";
import { FAMILY_BUCKETS } from "./workspace-model";
import s from "./workspace.module.css";

export function WorkspaceSummary({ stats, bucket, onBucket, onNeed, onType, onCount }: {
  stats: WorkspaceStats | undefined; bucket: string;
  onBucket: (key: string) => void; onNeed: (status: string) => void;
  onType: (type: string, status: string) => void;
  onCount: (kind: "requested" | "approved", value: string) => void;
}) {
  function metric(key: keyof WorkspaceStats, label: string, action: () => void, tone = "") {
    const value = stats?.[key];
    return <button key={key} className={`${s.metricV2} ${tone}`} onClick={action}><strong data-metric={key}>{typeof value === "number" ? value : "—"}</strong><span>{label}</span></button>;
  }
  const decisionMetrics = [
    ["requested", "أجهزة مطلوبة", ""], ["approvedDevices", "أجهزة مقبولة", "APPROVED"],
    ["rejectedDevices", "أجهزة مرفوضة", "REJECTED"], ["pendingDevices", "بانتظار القرار", "PENDING"],
  ] as const;
  return <div className={s.summaryV2}>
    <details className={s.stripV2}><summary><b>الأسر وقراراتها</b><span>المرفوعة، المقبولة، المرفوضة، الاستكمال والردود</span></summary><div className={s.stripBodyV2}>
      <div className={s.metricsV2}>{FAMILY_BUCKETS.map(([key, label, stat]) => metric(stat, label, () => onBucket(key), key === "APPROVED" ? s.metricGoodV2 : key === "REJECTED" ? s.metricBadV2 : ""))}{metric("incomplete", "بياناتها ناقصة", () => onBucket("INCOMPLETE"))}</div>
      <p className={s.help}>بيانات ناقصة قد تتداخل مع حالة الأسرة؛ اضغط على العدد لعرض الأسر المعنية.</p>
    </div></details>
    <details className={s.stripV2}><summary><b>الأجهزة والاحتياجات</b><span>القرارات، أنواع الأجهزة، وعدد الأجهزة لكل أسرة</span></summary><div className={s.stripBodyV2}>
      <div className={s.metricsV2}>{decisionMetrics.map(([key, label, state]) => metric(key, label, () => onNeed(state), state === "APPROVED" ? s.metricGoodV2 : state === "REJECTED" ? s.metricBadV2 : ""))}</div>
      <div className={s.deviceGridV2}><section><h3>الأجهزة بحسب النوع <small>— عدد الأجهزة</small></h3><div className={s.statScrollV2}><table className={s.statTableV2}><thead><tr><th>النوع</th><th>مطلوب</th><th>مقبول</th><th>مرفوض</th><th>معلق</th></tr></thead><tbody>{DEVICE_TYPES.map(type => <tr key={type}><th>{DEVICE_TYPE_LABELS[type]}</th>{(["requested", "approved", "rejected", "pending"] as const).map((state, i) => <td key={state}><button data-metric={`devices.${type}.${state}`} aria-label={`${DEVICE_TYPE_LABELS[type]} — ${["مطلوب", "مقبول", "مرفوض", "معلق"][i]}`} onClick={() => onType(type, state === "requested" ? "" : state.toUpperCase())}>{stats?.devices[type]?.[state] ?? "—"}</button></td>)}</tr>)}</tbody></table></div></section>
      <section><h3>عدد الأجهزة لكل أسرة <small>— عدد الأسر</small></h3><div className={s.statScrollV2}><table className={s.statTableV2}><thead><tr><th>الاحتياج</th><th>جهاز واحد</th><th>جهازان</th><th>ثلاثة أجهزة</th></tr></thead><tbody>{(["requested", "approved"] as const).map(kind => <tr key={kind}><th>{kind === "requested" ? "طلبت" : "قُبل لها"}</th>{[1, 2, 3].map(n => <td key={n}><button data-metric={`${kind}Families[${n}]`} aria-label={`${kind === "requested" ? "أسر طلبت" : "أسر قُبل لها"} ${n} أجهزة`} onClick={() => onCount(kind, String(n))}>{stats?.[kind === "requested" ? "requestedFamilies" : "approvedFamilies"][n] ?? "—"}</button></td>)}</tr>)}</tbody></table></div></section></div>
    </div></details>
    <details className={s.stripV2}><summary><b>التخصيص والتسليم</b><span>المخصص، المحجوز بالمستودع، مع المندوب، والمسلّم</span></summary><div className={s.stripBodyV2}><div className={s.metricsV2}>
      {metric("allocatedDevices", "مخصص إجمالًا", () => onNeed("ALLOCATED"))}
      <div className={s.metricV2}><strong data-metric="reservedDevices">{stats?.reservedDevices ?? "—"}</strong><span>محجوز في المستودع</span></div>
      {metric("withDelegate", "مع المندوب", () => onNeed("WITH_DELEGATE"))}{metric("deliveredDevices", "تم تسليمه", () => onNeed("DELIVERED"))}
    </div><p className={s.help}>قبول الاحتياج لا يعني تخصيص جهاز. حالات التنفيذ أجزاء من المخصص ولا تُجمع إليه.</p></div></details>
  </div>;
}

export function WorkspaceReviewTabs({stats,bucket,onBucket}:{stats:WorkspaceStats|undefined;bucket:string;onBucket:(key:string)=>void}) {
  return <div className={s.reviewTabsV2} aria-label="حالة مراجعة الأسر">{FAMILY_BUCKETS.map(([key,label,stat]) => <button key={key} aria-pressed={bucket === key} className={bucket === key ? s.selectedTabV2 : ""} onClick={() => onBucket(key)}>{label}<strong>{stats?.[stat] ?? "—"}</strong></button>)}</div>;
}
