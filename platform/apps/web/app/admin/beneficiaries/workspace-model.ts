import type { InformationItem, WorkspaceRow } from "../../lib/beneficiary-workspace";

export const FAMILY_BUCKETS = [
  ["ALL", "جميع الأسر", "families"],
  ["REVIEW", "مراجعة الأهلية", "review"],
  ["NEEDS", "مراجعة الأجهزة", "pendingNeeds"],
  ["INFORMATION", "بانتظار الجمعية", "information"],
  ["REPLIED", "ردود جديدة", "replied"],
  ["APPROVED", "أسر مقبولة", "approved"],
  ["REJECTED", "أسر مرفوضة", "rejected"],
] as const;

// Preserve the original metric contract, including explicit zero values.
export const BASELINE_METRIC_KEYS = [
  "families", "review", "pendingNeeds", "information", "replied", "approved", "rejected", "incomplete",
  "requested", "approvedDevices", "rejectedDevices", "pendingDevices",
  "allocatedDevices", "reservedDevices", "withDelegate", "deliveredDevices",
  ...[1, 2, 3].map(n => `requestedFamilies[${n}]`),
  ...[1, 2, 3].map(n => `approvedFamilies[${n}]`),
  ...["REFRIGERATOR", "OVEN", "WASHING_MACHINE"].flatMap(t => ["requested", "approved"].map(k => `devices.${t}.${k}`)),
] as const;

export function incompleteFields(row: WorkspaceRow & {threeDeviceReason?: string | null}): InformationItem[] {
  const result: InformationItem[] = [];
  if (row.income === null) result.push({ field: "income", kind: "MISSING", reason: "استكمال دخل المستفيد" });
  if (!row.city?.trim()) result.push({ field: "city", kind: "MISSING", reason: "استكمال مدينة المستفيد" });
  if (!row.district?.trim()) result.push({field:"district",kind:"MISSING",reason:"استكمال حي المستفيد"});
  if (!row.familyCount || row.familyCount < 1) result.push({ field: "familyCount", kind: "MISSING", reason: "استكمال عدد أفراد الأسرة" });
  if ("threeDeviceReason" in row && row.needs.length === 3 && !row.threeDeviceReason?.trim()) result.push({field:"threeDeviceReason",kind:"MISSING",reason:"توضيح مبرر طلب ثلاثة أجهزة"});
  return result;
}

export function retainedVisibleSelection(selected: Set<string>, rows: WorkspaceRow[]) {
  const visible = new Set(rows.map(row => row.id));
  const result = new Set([...selected].filter(id => visible.has(id)));
  return result.size === selected.size ? selected : result;
}

export function bulkCounts(rows: WorkspaceRow[], selected: Set<string>) {
  const targets = rows.filter(row => selected.has(row.id));
  return { families: targets.length, pendingNeeds: targets.reduce((sum, row) => sum + row.needs.filter(n => n.decisionStatus === "PENDING").length, 0) };
}
