import type { DeviceType, BeneficiaryReviewStatus } from "./api";
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
export interface WorkspaceNeed {
  id: string;
  deviceType: DeviceType;
  decisionStatus: "PENDING" | "APPROVED" | "REJECTED";
  rejectReason?: string | null;
  fulfillmentStatus?: string | null;
}
export interface InformationRequest {
  id: string;
  beneficiaryId: string;
  status: string;
  items: InformationItem[];
  sourceSnapshot: Record<string, unknown>;
  response: Record<string, unknown> | null;
  responseNote: string | null;
  message?: string | null;
  emailStatus?: string;
  dueAt?: string | null;
  createdAt: string;
  updatedAt: string;
  beneficiary?: {
    id: string;
    name: string;
    publicCode: string;
    region: string;
  };
}
export interface WorkspaceRow {
  id: string;
  publicCode: string;
  name: string;
  associationId: string;
  association: {
    name: string;
    region: string;
    publicCode: string;
    email?: string | null;
  };
  region: string;
  city: string;
  district: string | null;
  phone: string;
  income: number | null;
  familyCount: number;
  socialSecurity: boolean;
  needPriority: number | null;
  reviewStatus: BeneficiaryReviewStatus;
  updatedAt: string;
  needs: WorkspaceNeed[];
  informationRequests: InformationRequest[];
}
export interface WorkspaceDetail extends WorkspaceRow {
  maritalStatus: string;
  threeDeviceReason: string | null;
  notes: string | null;
  address: string;
  secondaryPhone: string | null;
  latitude: number | null;
  longitude: number | null;
  submittedDeviceTypes: DeviceType[];
  events: {
    id: string;
    action: string;
    createdAt: string;
    metadata: unknown;
  }[];
}
export interface WorkspaceStats {
  families: number;
  allocatedDevices: number;
  reservedDevices: number;
  withDelegate: number;
  deliveredDevices: number;
  requested: number;
  approvedDevices: number;
  rejectedDevices: number;
  pendingDevices: number;
  review: number;
  approved: number;
  rejected: number;
  pendingNeeds: number;
  information: number;
  replied: number;
  incomplete: number;
  requestedFamilies: number[];
  approvedFamilies: number[];
  devices: Record<
    string,
    { requested: number; approved: number; rejected: number; pending: number }
  >;
}
export interface WorkspaceOverview {
  totals: WorkspaceStats;
  associations: {
    id: string;
    publicCode: string;
    name: string;
    region: string;
    city: string;
    email: string | null;
    beneficiaryLimit: number;
    stats: WorkspaceStats;
  }[];
  regions: string[];
  cities: string[];
  excludedDemo: boolean;
  readOnly?: boolean;
}
export type ReviewPayload = {
  opId: string;
  version: string;
  familyDecision?: "APPROVED" | "REJECTED";
  reason?: string;
  needs: {
    needId: string;
    decision: "APPROVED" | "REJECTED";
    reason?: string;
  }[];
};
export type PlanningLimits = {
  total: number;
  regions: Record<string, number>;
  associations: Record<string, number>;
  devices: Record<string, number>;
  allowPartial?: boolean;
};
export interface Simulation {
  selected: { id: string; devices: string[] }[];
  waiting: { id: string; devices: string[] }[];
  used: {
    total: number;
    regions: Record<string, number>;
    associations: Record<string, number>;
    devices: Record<string, number>;
  };
  simulationOnly: true;
  policy: string;
  existingAllocated: number;
  remainingCapacity: number;
  proposals: {
    id: string;
    name: string;
    associationName: string;
    priority: number | null;
    selected: string[];
    waiting: string[];
  }[];
}
export function displayValue(value: unknown): string {
  return value === null || value === undefined || value === ""
    ? "غير متوفر"
    : typeof value === "boolean"
      ? value
        ? "نعم"
        : "لا"
      : String(value);
}
export const MAIL_STATUS_LABELS: Record<string, string> = {
  QUEUED: "بانتظار الإرسال",
  SENDING: "جارٍ الإرسال",
  SMTP_ACCEPTED: "قبله خادم البريد — وصوله للصندوق غير مؤكد",
  UNCERTAIN: "نتيجة الإرسال غير مؤكدة — لا تعِد الإرسال قبل التحقق",
  FAILED: "تعذر الإرسال",
  NOT_QUEUED: "لا يوجد إشعار مسجل",
};
