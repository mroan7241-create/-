import { ApiError } from "../../common/api-error";

export const INFORMATION_FIELDS = {
  income: "دخل المستفيد",
  socialSecurity: "الاستفادة من الضمان الاجتماعي",
  name: "اسم المستفيد",
  city: "مدينة المستفيد",
  district: "حي المستفيد",
  phone: "جوال المستفيد",
  familyCount: "عدد أفراد الأسرة",
  maritalStatus: "الحالة الاجتماعية",
  threeDeviceReason: "مبرر طلب ثلاثة أجهزة",
} as const;
export type InformationField = keyof typeof INFORMATION_FIELDS;
export type InformationItem = {
  field: InformationField;
  kind: "MISSING" | "VERIFY";
  reason: string;
};
export function parseInformationItems(value: unknown): InformationItem[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 9)
    throw new ApiError(
      "INFORMATION_ITEMS_INVALID",
      "حدد الحقول المطلوب استكمالها أو التحقق منها",
      400,
    );
  const seen = new Set<string>();
  return value.map((item) => {
    if (
      !item ||
      typeof item !== "object" ||
      !Object.hasOwn(INFORMATION_FIELDS, item.field) ||
      !["MISSING", "VERIFY"].includes(item.kind) ||
      typeof item.reason !== "string" ||
      !item.reason.trim() ||
      item.reason.length > 500 ||
      seen.has(item.field)
    )
      throw new ApiError(
        "INFORMATION_ITEMS_INVALID",
        "الحقول وأسباب طلب الاستكمال غير صالحة أو مكررة",
        400,
      );
    seen.add(item.field);
    return {
      field: item.field as InformationField,
      kind: item.kind,
      reason: item.reason.trim(),
    };
  });
}
export function parseInformationResponse(
  items: InformationItem[],
  value: unknown,
): Record<string, string | number | boolean> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new ApiError(
      "INFORMATION_RESPONSE_INVALID",
      "أدخل قيم الحقول المطلوبة",
      400,
    );
  const data = value as Record<string, unknown>,
    keys = items.map((item) => item.field);
  if (
    Object.keys(data).some((key) => !keys.includes(key as InformationField)) ||
    keys.some((key) => !Object.hasOwn(data, key))
  )
    throw new ApiError(
      "INFORMATION_RESPONSE_INVALID",
      "يقتصر الرد على الحقول المطلوبة كاملة",
      400,
    );
  const result: Record<string, string | number | boolean> = {};
  for (const key of keys) {
    const v = data[key];
    if (key === "income") {
      if (
        typeof v !== "number" ||
        !Number.isFinite(v) ||
        v < 0 ||
        v > 1_000_000 ||
        Math.abs(Math.round(v * 100) - v * 100) > 0.000001
      )
        throw new ApiError(
          "INFORMATION_RESPONSE_INVALID",
          "دخل المستفيد رقم صحيح أو بمنزلتين عشريتين، والصفر مقبول",
          400,
        );
      result[key] = v;
    } else if (key === "socialSecurity") {
      if (typeof v !== "boolean")
        throw new ApiError(
          "INFORMATION_RESPONSE_INVALID",
          "اختر نعم أو لا للضمان الاجتماعي",
          400,
        );
      result[key] = v;
    } else if (key === "familyCount") {
      if (!Number.isInteger(v) || Number(v) < 1 || Number(v) > 99)
        throw new ApiError(
          "INFORMATION_RESPONSE_INVALID",
          "عدد أفراد الأسرة من 1 إلى 99",
          400,
        );
      result[key] = Number(v);
    } else {
      if (
        typeof v !== "string" ||
        !v.trim() ||
        v.length > (key === "threeDeviceReason" ? 1000 : 200)
      )
        throw new ApiError(
          "INFORMATION_RESPONSE_INVALID",
          `أدخل ${INFORMATION_FIELDS[key]}`,
          400,
        );
      const text = v.trim();
      if (key === "phone" && !/^(?:05\d{8}|\+?9665\d{8})$/.test(text))
        throw new ApiError(
          "INFORMATION_RESPONSE_INVALID",
          "رقم الجوال السعودي غير صحيح",
          400,
        );
      result[key] = key === "phone" ? text.replace(/^\+?966/, "0") : text;
    }
  }
  return result;
}
export function assertFreshVersion(actual: Date, expected: string) {
  if (actual.toISOString() !== expected)
    throw new ApiError(
      "BENEFICIARY_VERSION_CONFLICT",
      "تغيرت البيانات منذ فتحها؛ أعد تحميلها قبل الحفظ",
      409,
    );
}

export type PlanningFamily = {
  id: string;
  associationId: string;
  region: string;
  needPriority: number | null;
  devices: string[];
};
export type PlanningLimits = {
  total: number;
  regions: Record<string, number>;
  associations: Record<string, number>;
  devices: Record<string, number>;
  allowPartial?: boolean;
};
/** Stable, within-association priorities. Simulation cannot change stock or decisions. */
export function simulateBeneficiaries(
  families: PlanningFamily[],
  limits: PlanningLimits,
) {
  const used = {
    total: 0,
    regions: {} as Record<string, number>,
    associations: {} as Record<string, number>,
    devices: {} as Record<string, number>,
  };
  const selected: { id: string; devices: string[] }[] = [],
    waiting: { id: string; devices: string[] }[] = [];
  // Round-robin at each declared priority, rather than treating association ranks as a single global score.
  const sorted = [...families].sort(
    (a, b) =>
      (a.needPriority ?? Number.MAX_SAFE_INTEGER) -
        (b.needPriority ?? Number.MAX_SAFE_INTEGER) ||
      a.associationId.localeCompare(b.associationId) ||
      a.id.localeCompare(b.id),
  );
  for (const row of sorted) {
    const accepted: string[] = [],
      deferred: string[] = [];
    if (
      !limits.allowPartial &&
      (used.total + row.devices.length > limits.total ||
        (used.regions[row.region] ?? 0) + row.devices.length >
          (limits.regions[row.region] ?? limits.total) ||
        (used.associations[row.associationId] ?? 0) + row.devices.length >
          (limits.associations[row.associationId] ?? limits.total) ||
        row.devices.some(
          (device) =>
            (used.devices[device] ?? 0) >=
            (limits.devices[device] ?? limits.total),
        ))
    ) {
      if (row.devices.length)
        waiting.push({ id: row.id, devices: [...row.devices] });
      continue;
    }
    for (const device of [...row.devices].sort()) {
      if (
        used.total >= limits.total ||
        (used.regions[row.region] ?? 0) >=
          (limits.regions[row.region] ?? limits.total) ||
        (used.associations[row.associationId] ?? 0) >=
          (limits.associations[row.associationId] ?? limits.total) ||
        (used.devices[device] ?? 0) >= (limits.devices[device] ?? limits.total)
      ) {
        deferred.push(device);
        continue;
      }
      accepted.push(device);
      used.total++;
      used.regions[row.region] = (used.regions[row.region] ?? 0) + 1;
      used.associations[row.associationId] =
        (used.associations[row.associationId] ?? 0) + 1;
      used.devices[device] = (used.devices[device] ?? 0) + 1;
    }
    if (accepted.length) selected.push({ id: row.id, devices: accepted });
    if (deferred.length) waiting.push({ id: row.id, devices: deferred });
  }
  return { selected, waiting, used };
}
