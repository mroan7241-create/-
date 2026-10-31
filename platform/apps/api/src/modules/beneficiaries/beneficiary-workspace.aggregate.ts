import { Prisma, prisma } from "@alzad/db";
import type { WorkspaceQueryDto } from "./dto/beneficiary-workspace.dto";

export interface AggregateRow {
  associationId: string;
  families: number;
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
  requested1: number;
  requested2: number;
  requested3: number;
  approved0: number;
  approved1: number;
  approved2: number;
  approved3: number;
  fridge: number;
  fridgeApproved: number;
  fridgeRejected: number;
  fridgePending: number;
  oven: number;
  ovenApproved: number;
  ovenRejected: number;
  ovenPending: number;
  washer: number;
  washerApproved: number;
  washerRejected: number;
  washerPending: number;
}
const filter = (ids: string[], q: WorkspaceQueryDto) => Prisma.sql`
 b.archived_at IS NULL AND b.association_id IN (${Prisma.join(ids.map((id) => Prisma.sql`${id}::uuid`))})
 ${q.search?.trim() ? Prisma.sql`AND (b.name ILIKE ${"%" + q.search.trim() + "%"} OR b.public_code ILIKE ${"%" + q.search.trim() + "%"} OR b.phone ILIKE ${"%" + q.search.trim() + "%"} OR b.city ILIKE ${"%" + q.search.trim() + "%"})` : Prisma.empty}
 ${q.city ? Prisma.sql`AND b.city=${q.city}` : Prisma.empty}
 ${q.topTen === "true" ? Prisma.sql`AND b.need_priority BETWEEN 1 AND 10` : Prisma.empty}
 ${q.deviceType ? Prisma.sql`AND EXISTS(SELECT 1 FROM beneficiary_needs dn WHERE dn.beneficiary_id=b.id AND dn.device_type::text=${q.deviceType})` : Prisma.empty}`;

/** One bounded read returns row data, device decisions and total; no per-row network/database round trips. */
export async function listWorkspaceRows(ids: string[], q: WorkspaceQueryDto) {
  const page = q.page ?? 1,
    pageSize = Math.min(q.pageSize ?? 25, 50);
  if (!ids.length)
    return { items: [], total: 0, page, pageSize, totalPages: 0 };
  const where = Prisma.sql`${filter(ids, q)}
    ${q.bucket === "REVIEW" ? Prisma.sql`AND b.review_status='UNDER_REVIEW'` : q.bucket === "APPROVED" || q.bucket === "REJECTED" ? Prisma.sql`AND b.review_status::text=${q.bucket}` : q.bucket === "NEEDS" ? Prisma.sql`AND b.review_status='APPROVED' AND EXISTS(SELECT 1 FROM beneficiary_needs dn WHERE dn.beneficiary_id=b.id AND dn.decision_status='PENDING')` : q.bucket === "INFORMATION" || q.bucket === "REPLIED" ? Prisma.sql`AND EXISTS(SELECT 1 FROM beneficiary_information_requests ir WHERE ir.beneficiary_id=b.id AND ir.status=${q.bucket === "REPLIED" ? "SUBMITTED" : "OPEN"})` : q.bucket === "INCOMPLETE" ? Prisma.sql`AND (b.income IS NULL OR b.city='' OR COALESCE(b.district,'')='' OR b.need_priority IS NULL)` : Prisma.empty}
    ${q.requestedCount ? Prisma.sql`AND (SELECT COUNT(*) FROM beneficiary_needs dn WHERE dn.beneficiary_id=b.id)=${Number(q.requestedCount)}` : Prisma.empty}
    ${q.approvedCount ? Prisma.sql`AND (SELECT COUNT(*) FROM beneficiary_needs dn WHERE dn.beneficiary_id=b.id AND dn.decision_status='APPROVED')=${Number(q.approvedCount)}` : Prisma.empty}
    ${q.needStatus ? Prisma.sql`AND EXISTS(SELECT 1 FROM beneficiary_needs dn WHERE dn.beneficiary_id=b.id ${q.deviceType ? Prisma.sql`AND dn.device_type::text=${q.deviceType}` : Prisma.empty} ${["PENDING", "APPROVED", "REJECTED"].includes(q.needStatus) ? Prisma.sql`AND dn.decision_status::text=${q.needStatus}` : Prisma.sql`AND EXISTS(SELECT 1 FROM device_allocations da JOIN device_units du ON du.id=da.device_id WHERE da.beneficiary_need_id=dn.id AND da.status='ACTIVE' ${q.needStatus === "ALLOCATED" ? Prisma.empty : Prisma.sql`AND du.status::text=${q.needStatus}`})`})` : Prisma.empty}`;
  const rows = await prisma.$queryRaw<
    Array<Record<string, unknown> & { _total: number }>
  >(Prisma.sql`
    SELECT b.id::text,b.public_code AS "publicCode",b.name,b.association_id::text AS "associationId",b.region,b.city,b.district,b.phone,b.income::float8 AS income,b.family_count AS "familyCount",b.social_security AS "socialSecurity",b.need_priority AS "needPriority",b.review_status AS "reviewStatus",b.updated_at AS "updatedAt",
      jsonb_build_object('name',a.name,'region',a.region,'publicCode',a.public_code) AS association,
      COALESCE((SELECT jsonb_agg(jsonb_build_object('id',dn.id,'deviceType',dn.device_type,'decisionStatus',dn.decision_status) ORDER BY dn.device_type) FROM beneficiary_needs dn WHERE dn.beneficiary_id=b.id),'[]'::jsonb) AS needs,
      COALESCE((SELECT jsonb_agg(jsonb_build_object('id',ir.id,'status',ir.status)) FROM beneficiary_information_requests ir WHERE ir.beneficiary_id=b.id AND ir.status IN ('OPEN','SUBMITTED')),'[]'::jsonb) AS "informationRequests",COUNT(*) OVER()::int AS _total
    FROM beneficiaries b JOIN associations a ON a.id=b.association_id WHERE ${where}
    ORDER BY b.need_priority ASC NULLS LAST,b.association_id,b.id OFFSET ${(page - 1) * pageSize} LIMIT ${pageSize}
  `);
  const total =
    rows[0]?._total ??
    (
      await prisma.$queryRaw<{ total: number }[]>(
        Prisma.sql`SELECT COUNT(*)::int total FROM beneficiaries b WHERE ${where}`,
      )
    )[0]?.total ??
    0;
  return {
    items: rows.map(({ _total, ...row }) => row),
    total,
    page,
    pageSize,
    totalPages: Math.ceil(total / pageSize),
  };
}

/** PostgreSQL returns only aggregate numbers; no household financial values or nested rows leave the database. */
export async function aggregateWorkspace(
  ids: string[],
  q: WorkspaceQueryDto,
): Promise<AggregateRow[]> {
  if (!ids.length) return [];
  return prisma.$queryRaw<AggregateRow[]>(Prisma.sql`
    WITH cohort AS (
      SELECT b.id,b.association_id,b.review_status,
        (b.income IS NULL OR b.city='' OR COALESCE(b.district,'')='' OR b.need_priority IS NULL) incomplete,
        COUNT(n.id)::int requested,COUNT(n.id) FILTER(WHERE n.decision_status='APPROVED')::int approved,
        COUNT(n.id) FILTER(WHERE n.decision_status='REJECTED')::int rejected,
        COUNT(n.id) FILTER(WHERE n.decision_status='PENDING')::int pending,
        COUNT(n.id) FILTER(WHERE n.device_type='REFRIGERATOR')::int fridge,
        COUNT(n.id) FILTER(WHERE n.device_type='REFRIGERATOR' AND n.decision_status='APPROVED')::int fa,
        COUNT(n.id) FILTER(WHERE n.device_type='REFRIGERATOR' AND n.decision_status='REJECTED')::int fr,
        COUNT(n.id) FILTER(WHERE n.device_type='REFRIGERATOR' AND n.decision_status='PENDING')::int fp,
        COUNT(n.id) FILTER(WHERE n.device_type='OVEN')::int oven,
        COUNT(n.id) FILTER(WHERE n.device_type='OVEN' AND n.decision_status='APPROVED')::int oa,
        COUNT(n.id) FILTER(WHERE n.device_type='OVEN' AND n.decision_status='REJECTED')::int orej,
        COUNT(n.id) FILTER(WHERE n.device_type='OVEN' AND n.decision_status='PENDING')::int op,
        COUNT(n.id) FILTER(WHERE n.device_type='WASHING_MACHINE')::int washer,
        COUNT(n.id) FILTER(WHERE n.device_type='WASHING_MACHINE' AND n.decision_status='APPROVED')::int wa,
        COUNT(n.id) FILTER(WHERE n.device_type='WASHING_MACHINE' AND n.decision_status='REJECTED')::int wr,
        COUNT(n.id) FILTER(WHERE n.device_type='WASHING_MACHINE' AND n.decision_status='PENDING')::int wp,
        EXISTS(SELECT 1 FROM beneficiary_information_requests ir WHERE ir.beneficiary_id=b.id AND ir.status='OPEN') info,
        EXISTS(SELECT 1 FROM beneficiary_information_requests ir WHERE ir.beneficiary_id=b.id AND ir.status='SUBMITTED') replied
      FROM beneficiaries b LEFT JOIN beneficiary_needs n ON n.beneficiary_id=b.id WHERE ${filter(ids, q)}
      GROUP BY b.id
    )
    SELECT association_id::text AS "associationId",COUNT(*)::int families,COALESCE(SUM(requested),0)::int requested,
      COALESCE(SUM(approved),0)::int "approvedDevices",COALESCE(SUM(rejected),0)::int "rejectedDevices",COALESCE(SUM(pending),0)::int "pendingDevices",
      COUNT(*) FILTER(WHERE review_status='UNDER_REVIEW')::int review,COUNT(*) FILTER(WHERE review_status='APPROVED')::int approved,COUNT(*) FILTER(WHERE review_status='REJECTED')::int rejected,
      COUNT(*) FILTER(WHERE review_status='APPROVED' AND pending>0)::int "pendingNeeds",
      COUNT(*) FILTER(WHERE info)::int information,COUNT(*) FILTER(WHERE replied)::int replied,COUNT(*) FILTER(WHERE incomplete)::int incomplete,
      COUNT(*) FILTER(WHERE requested=1)::int "requested1",COUNT(*) FILTER(WHERE requested=2)::int "requested2",COUNT(*) FILTER(WHERE requested=3)::int "requested3",
      COUNT(*) FILTER(WHERE approved=0)::int "approved0",COUNT(*) FILTER(WHERE approved=1)::int "approved1",COUNT(*) FILTER(WHERE approved=2)::int "approved2",COUNT(*) FILTER(WHERE approved=3)::int "approved3",
      SUM(fridge)::int fridge,SUM(fa)::int "fridgeApproved",SUM(fr)::int "fridgeRejected",SUM(fp)::int "fridgePending",
      SUM(oven)::int oven,SUM(oa)::int "ovenApproved",SUM(orej)::int "ovenRejected",SUM(op)::int "ovenPending",
      SUM(washer)::int washer,SUM(wa)::int "washerApproved",SUM(wr)::int "washerRejected",SUM(wp)::int "washerPending"
    FROM cohort GROUP BY association_id
  `);
}
export async function filterCountIds(
  ids: string[],
  q: WorkspaceQueryDto,
): Promise<string[]> {
  if (!ids.length) return [];
  const rows = await prisma.$queryRaw<{ id: string }[]>(Prisma.sql`
    SELECT b.id::text id FROM beneficiaries b LEFT JOIN beneficiary_needs n ON n.beneficiary_id=b.id
    WHERE ${filter(ids, q)} GROUP BY b.id
    HAVING true ${q.requestedCount ? Prisma.sql`AND COUNT(n.id)=${Number(q.requestedCount)}` : Prisma.empty}
      ${q.approvedCount ? Prisma.sql`AND COUNT(n.id) FILTER(WHERE n.decision_status='APPROVED')=${Number(q.approvedCount)}` : Prisma.empty}
  `);
  return rows.map((row) => row.id);
}
export function workspaceStats(rows: AggregateRow[]) {
  const sum = (key: keyof AggregateRow) =>
    rows.reduce((total, row) => total + Number(row[key] ?? 0), 0);
  return {
    families: sum("families"),
    requested: sum("requested"),
    approvedDevices: sum("approvedDevices"),
    rejectedDevices: sum("rejectedDevices"),
    pendingDevices: sum("pendingDevices"),
    review: sum("review"),
    approved: sum("approved"),
    rejected: sum("rejected"),
    pendingNeeds: sum("pendingNeeds"),
    information: sum("information"),
    replied: sum("replied"),
    incomplete: sum("incomplete"),
    requestedFamilies: [
      0,
      sum("requested1"),
      sum("requested2"),
      sum("requested3"),
    ],
    approvedFamilies: [
      sum("approved0"),
      sum("approved1"),
      sum("approved2"),
      sum("approved3"),
    ],
    devices: {
      REFRIGERATOR: {
        requested: sum("fridge"),
        approved: sum("fridgeApproved"),
        rejected: sum("fridgeRejected"),
        pending: sum("fridgePending"),
      },
      OVEN: {
        requested: sum("oven"),
        approved: sum("ovenApproved"),
        rejected: sum("ovenRejected"),
        pending: sum("ovenPending"),
      },
      WASHING_MACHINE: {
        requested: sum("washer"),
        approved: sum("washerApproved"),
        rejected: sum("washerRejected"),
        pending: sum("washerPending"),
      },
    },
  };
}
