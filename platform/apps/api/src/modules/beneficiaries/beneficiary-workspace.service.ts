import { Injectable, Logger } from "@nestjs/common";
import { AccountRole, Prisma, prisma, type DeviceType } from "@alzad/db";
import { randomUUID } from "node:crypto";
import { isEmail } from "class-validator";
import { classifyPriorities } from "./beneficiary-priority.rules";
import { ApiError } from "../../common/api-error";
import { IdempotencyService } from "../../common/idempotency.service";
import { lockParticipationForOperationalWrite } from "../../common/participation-write-lock.util";
import type { AuthContext } from "../auth/auth.types";
import {
  adminApplicationRegionCodes,
  adminAssociationScopeWhere,
  assertAdminAssociationScope,
  lockAdminApplicationScope,
} from "../auth/admin-route-permissions";
import { enqueueEmail } from "../auth/email/email.service";
import {
  assertFreshVersion,
  INFORMATION_FIELDS,
  parseInformationItems,
  parseInformationResponse,
  simulateBeneficiaries,
  type InformationItem,
  type PlanningLimits,
} from "./beneficiary-workspace.rules";
import type {
  WorkspaceQueryDto,
  WorkspaceReviewDto,
  WorkspaceBulkItemDto,
  InformationCreateDto,
  InformationReplyDto,
  InformationResolveDto,
  PlanningDto,
} from "./dto/beneficiary-workspace.dto";
import {
  aggregateWorkspace,
  filterCountIds,
  listWorkspaceRows,
  workspaceStats,
  workspaceIntake,
} from "./beneficiary-workspace.aggregate";

const ACTIVE_REQUEST = ["OPEN", "SUBMITTED"];
const PLAN_KEY = "beneficiaries.planning.v1";
const demoWhere: Prisma.AssociationWhereInput = {
  OR: [
    { publicCode: "ASC-000009" },
    { name: "جمعية تجربة" },
    {
      participation: {
        is: { application: { is: { publicCode: "APP-000328" } } },
      },
    },
  ],
};
const missing = () =>
  new ApiError("BENEFICIARY_NOT_FOUND", "المستفيد غير متاح لهذا الحساب", 404);
const snapshot = (b: Record<string, unknown>, items: InformationItem[]) =>
  Object.fromEntries(
    items.map((i) => [
      i.field,
      b[i.field] == null
        ? null
        : i.field === "income"
          ? Number(b[i.field])
          : b[i.field],
    ]),
  );

@Injectable()
export class BeneficiaryWorkspaceService {
  private readonly logger = new Logger(BeneficiaryWorkspaceService.name);
  constructor(private readonly idempotency: IdempotencyService) {}
  private assertWritable() {
    if (process.env.BENEFICIARY_WORKSPACE_READ_ONLY === "true")
      throw new ApiError(
        "BENEFICIARY_WORKSPACE_READ_ONLY",
        "المراجعة متاحة للقراءة مؤقتًا؛ لم تُحفظ أي تغييرات",
        503,
      );
  }
  private async withMailStatus<T extends { emailEventId: string | null }>(
    requests: T[],
  ) {
    if (!requests.some((request) => request.emailEventId))
      return requests.map((request) => ({ ...request, emailStatus: "NOT_QUEUED" }));
    const events = await prisma.outboxEvent.findMany({
      where: {
        id: {
          in: [
            ...new Set(
              requests.flatMap((r) => (r.emailEventId ? [r.emailEventId] : [])),
            ),
          ],
        },
      },
      select: { id: true, status: true, lastError: true, payload: true },
    });
    return requests.map((r) => {
      const e = events.find((e) => e.id === r.emailEventId),
        phase = (e?.payload as { phase?: string } | null)?.phase;
      return {
        ...r,
        emailStatus: !e
          ? "NOT_QUEUED"
          : e.status === "PROCESSED"
            ? "SMTP_ACCEPTED"
            : phase === "SMTP_STARTED"
              ? "UNCERTAIN"
              : e.status === "FAILED"
                ? "FAILED"
                : e.status === "PROCESSING"
                  ? "SENDING"
                  : "QUEUED",
      };
    });
  }

  private associationWhere(
    ctx: AuthContext,
    q: WorkspaceQueryDto = {},
  ): Prisma.AssociationWhereInput {
    return {
      AND: [
        ctx.role === AccountRole.ASSOCIATION
          ? { id: ctx.associationId ?? "00000000-0000-0000-0000-000000000000" }
          : adminAssociationScopeWhere(ctx),
        ...(q.includeDemo === "true" ? [] : [{ NOT: demoWhere }]),
        ...(q.associationId ? [{ id: q.associationId }] : []),
        ...(q.region ? [{ region: q.region }] : []),
      ],
      archivedAt: null,
    };
  }
  private baseWhere(
    ctx: AuthContext,
    q: WorkspaceQueryDto = {},
  ): Prisma.BeneficiaryWhereInput {
    const where: Prisma.BeneficiaryWhereInput = {
      archivedAt: null,
      association: { is: this.associationWhere(ctx, q) },
    };
    if (q.search?.trim())
      where.OR = ["name", "publicCode", "phone", "city"].map((key) => ({
        [key]: { contains: q.search!.trim(), mode: "insensitive" },
      }));
    if (q.city) where.city = q.city;
    if (q.topTen === "true") where.needPriority = { gte: 1, lte: 10 };
    const need: Prisma.BeneficiaryNeedWhereInput = {};
    if (q.deviceType) need.deviceType = q.deviceType as DeviceType;
    if (
      q.needStatus &&
      ["PENDING", "APPROVED", "REJECTED"].includes(q.needStatus)
    )
      need.decisionStatus = q.needStatus as "PENDING" | "APPROVED" | "REJECTED";
    if (
      q.needStatus &&
      ["ALLOCATED", "WITH_DELEGATE", "DELIVERED"].includes(q.needStatus)
    )
      need.allocations = {
        some: {
          status: "ACTIVE",
          ...(q.needStatus === "ALLOCATED"
            ? {}
            : {
                device: {
                  status: q.needStatus as "WITH_DELEGATE" | "DELIVERED",
                },
              }),
        },
      };
    if (Object.keys(need).length) where.needs = { some: need };
    return where;
  }
  private bucketWhere(bucket?: string): Prisma.BeneficiaryWhereInput {
    if (bucket === "REVIEW") return { reviewStatus: "UNDER_REVIEW" };
    if (bucket === "NEEDS")
      return {
        reviewStatus: "APPROVED",
        needs: { some: { decisionStatus: "PENDING" } },
      };
    if (bucket === "APPROVED" || bucket === "REJECTED")
      return { reviewStatus: bucket };
    if (bucket === "INFORMATION" || bucket === "REPLIED")
      return {
        informationRequests: {
          some: { status: bucket === "REPLIED" ? "SUBMITTED" : "OPEN" },
        },
      };
    if (bucket === "INCOMPLETE")
      return {
        OR: [
          { income: null },
          { district: null },
          { district: "" },
          { city: "" },
          { needPriority: null },
        ],
      };
    return {};
  }
  async list(ctx: AuthContext, q: WorkspaceQueryDto) {
    const associations = await prisma.association.findMany({
      where: this.associationWhere(ctx, q),
      select: { id: true },
    });
    return listWorkspaceRows(
      associations.map((a) => a.id),
      q,
    );
  }
  async priorities(ctx: AuthContext, q: WorkspaceQueryDto) {
      if (!q.associationId) throw new ApiError("PRIORITY_ASSOCIATION_REQUIRED", "اختر جمعية لعرض تقدير الحاجة", 400);
      const association = await prisma.association.findFirst({ where: this.associationWhere(ctx, {associationId:q.associationId}), select:{id:true} });
      if (!association) throw missing();
      // Separate read endpoint: analysis never blocks the household list or loads on every search.
      const cohort = await prisma.beneficiary.findMany({
        where: { archivedAt: null, associationId: q.associationId, association: { is: this.associationWhere(ctx) } },
        take: 5001,
        select: { id: true, associationId: true, income: true, familyCount: true, needPriority: true, socialSecurity: true,
          updatedAt: true, threeDeviceReason: true, notes: true, maritalStatus: true },
      });
      if (cohort.length > 5000) throw new ApiError("PRIORITY_COHORT_LIMIT", "عدد الأسر يتجاوز حد التحليل؛ لم يُحسب ترتيب جزئي", 400);
      const priorities = classifyPriorities(cohort.map(row => ({ ...row, income: row.income === null ? null : Number(row.income), updatedAt: row.updatedAt.toISOString() })));
      return { associationId:q.associationId, computedAt:new Date().toISOString(), summary:priorities.summaries[q.associationId]??{total:0,classified:0,unclassified:0,high:0,medium:0,low:0,median:null,highLimit:null,mediumLimit:null}, policy:priorities.policy, recommendations:Object.fromEntries(priorities.recommendations) };
  }
  async overview(ctx: AuthContext, q: WorkspaceQueryDto) {
    const allowed = await prisma.association.findMany({
      where: this.associationWhere(ctx, {
        ...q,
        associationId: undefined,
        region: undefined,
      }),
      select: {
        id: true,
        publicCode: true,
        name: true,
        region: true,
        city: true,
        beneficiaryLimit: true,
        email: true,
      },
      orderBy: [{ region: "asc" }, { name: "asc" }],
    });
    const associations = allowed.filter(
      (a) => !q.region || a.region === q.region,
    );
    const [aggregates, cities, allocationCounts, intake] = await Promise.all([
      aggregateWorkspace(
        associations.map((a) => a.id),
        q,
      ),
      prisma.beneficiary.findMany({
        where: this.baseWhere(ctx, { ...q, city: undefined }),
        distinct: ["city"],
        select: { city: true },
        orderBy: { city: "asc" },
      }),
      prisma.deviceAllocation.findMany({
        where: {
          status: "ACTIVE",
          beneficiary: {
            AND: [this.baseWhere(ctx, { ...q, associationId: undefined })],
          },
        },
        select: { associationId: true, device: { select: { status: true } } },
      }),
      this.intake(ctx, q),
    ]);
    const stockStats = (id?: string) => {
      const rows = allocationCounts.filter(
        (a) => !id || a.associationId === id,
      );
      return {
        allocatedDevices: rows.length,
        reservedDevices: rows.filter((a) => a.device.status === "ALLOCATED")
          .length,
        withDelegate: rows.filter((a) => a.device.status === "WITH_DELEGATE")
          .length,
        deliveredDevices: rows.filter((a) => a.device.status === "DELIVERED")
          .length,
      };
    };
    return {
      totals: {
        ...workspaceStats(
          aggregates.filter(
            (a) => !q.associationId || a.associationId === q.associationId,
          ),
        ),
        ...stockStats(q.associationId),
      },
      associations: associations.map((a) => ({
        ...a,
        stats: {
          ...workspaceStats(
            aggregates.filter((row) => row.associationId === a.id),
          ),
          ...stockStats(a.id),
        },
      })),
      cities: cities.map((b) => b.city),
      regions: [...new Set(allowed.map((a) => a.region))].sort(),
      excludedDemo: q.includeDemo !== "true",
      readOnly: process.env.BENEFICIARY_WORKSPACE_READ_ONLY === "true",
      intake,
    };
  }
  private async intake(ctx: AuthContext, q: WorkspaceQueryDto) {
    // Intake is an operational denominator, never a count of the current household search.
    // Demo/archived/non-operational associations stay excluded even in a demo review view.
    const associations = await prisma.association.findMany({
      where: {
        AND: [
          this.associationWhere(ctx, { region: q.region }),
          {
            status: "ACTIVE",
            participation: {
              is: {
                status: { in: ["ACTIVE", "EXECUTING"] },
                activatedAt: { not: null },
                activationAnomaly: false,
              },
            },
          },
        ],
      },
      select: {
        id: true, publicCode: true, name: true, region: true, beneficiaryLimit: true,
        _count: { select: { beneficiaries: { where: { archivedAt: null } } } },
      },
      orderBy: [{ region: "asc" }, { name: "asc" }],
    });
    return workspaceIntake(
      associations.map(({ _count, ...association }) => association),
      associations.map((row) => ({ associationId: row.id, count: row._count.beneficiaries })),
    );
  }
  async detail(ctx: AuthContext, id: string) {
    const row = await prisma.beneficiary.findFirst({
      where: {
        id,
        archivedAt: null,
        association: { is: this.associationWhere(ctx, { includeDemo: "true" }) },
      },
      include: {
        association: {
          select: {
            id: true,
            name: true,
            email: true,
            region: true,
            publicCode: true,
          },
        },
        needs: true,
        informationRequests: {
          where: { status: { in: ACTIVE_REQUEST } },
          orderBy: { createdAt: "desc" },
        },
      },
    });
    if (!row) throw missing();
    return {
      ...row,
      income: row.income === null ? null : Number(row.income),
      latitude: row.latitude === null ? null : Number(row.latitude),
      longitude: row.longitude === null ? null : Number(row.longitude),
      events: [],
      historyLoaded: false,
      informationFields: INFORMATION_FIELDS,
    };
  }
  async history(ctx: AuthContext, id: string) {
    // Authorize the family before reading history or delivery metadata.
    const row = await prisma.beneficiary.findFirst({
      where: {
        id, archivedAt: null,
        association: { is: this.associationWhere(ctx, { includeDemo: "true" }) },
      },
      select: { id: true, updatedAt: true },
    });
    if (!row) throw missing();
    const [requests, events] = await Promise.all([
      prisma.beneficiaryInformationRequest.findMany({
        where: { beneficiaryId: id }, orderBy: { createdAt: "desc" }, take: 20,
      }),
      ctx.role === AccountRole.ADMIN
        ? prisma.auditLog.findMany({
            where: { entityType: "beneficiaries", entityId: id },
            select: { id: true, action: true, createdAt: true, metadata: true },
            orderBy: { createdAt: "desc" },
            take: 30,
          })
        : Promise.resolve([]),
    ]);
    return {
      id: row.id,
      version: row.updatedAt.toISOString(),
      informationRequests: await this.withMailStatus(requests),
      events,
    };
  }
  async next(ctx: AuthContext, id: string, q: WorkspaceQueryDto) {
    const current = await prisma.beneficiary.findFirst({
      where: {
        id,
        archivedAt: null,
        association: { is: adminAssociationScopeWhere(ctx) },
      },
      select: { associationId: true, needPriority: true },
    });
    if (!current) throw missing();
    const after: Prisma.BeneficiaryWhereInput =
      current.needPriority === null
        ? { needPriority: null, id: { gt: id } }
        : {
            OR: [
              { needPriority: { gt: current.needPriority } },
              { needPriority: null },
              { needPriority: current.needPriority, id: { gt: id } },
            ],
          };
    const ids =
      q.requestedCount || q.approvedCount
        ? await filterCountIds([current.associationId], q)
        : null;
    const row = await prisma.beneficiary.findFirst({
      where: {
        AND: [
          this.baseWhere(ctx, { ...q, associationId: current.associationId }),
          this.bucketWhere(q.bucket),
          after,
          ...(ids ? [{ id: { in: ids } }] : []),
          {
            reviewStatus: { not: "REJECTED" },
            informationRequests: { none: { status: { in: ACTIVE_REQUEST } } },
            OR: [
              { reviewStatus: "UNDER_REVIEW" },
              { needs: { some: { decisionStatus: "PENDING" } } },
            ],
          },
        ],
      },
      select: { id: true },
      orderBy: [
        { needPriority: { sort: "asc", nulls: "last" } },
        { id: "asc" },
      ],
    });
    return { id: row?.id ?? null };
  }
  private async lockFamily(
    tx: Prisma.TransactionClient,
    ctx: AuthContext,
    id: string,
  ) {
    const fresh = await lockAdminApplicationScope(tx, ctx);
    const family = await tx.beneficiary.findUnique({
      where: { id },
      select: { associationId: true },
    });
    if (!family) throw missing();
    if (
      ctx.role === AccountRole.ASSOCIATION &&
      family.associationId !== ctx.associationId
    )
      throw missing();
    await assertAdminAssociationScope(fresh, family.associationId, tx);
    await lockParticipationForOperationalWrite(tx, family.associationId);
    await tx.$queryRaw`SELECT id FROM beneficiaries WHERE id=${id}::uuid FOR UPDATE`;
    const row = await tx.beneficiary.findUnique({
      where: { id },
      include: {
        needs: true,
        informationRequests: { where: { status: { in: ACTIVE_REQUEST } } },
        association: { select: { name: true, email: true } },
      },
    });
    if (!row || row.archivedAt) throw missing();
    return row;
  }
  async review(ctx: AuthContext, id: string, input: WorkspaceReviewDto) {
    this.assertWritable();
    const { nextQuery, ...decision } = input;
    const saved = await prisma.$transaction(async (tx) => {
      const b = await this.lockFamily(tx, ctx, id),
        scope = `beneficiary-workspace-review:${id}`;
      const claim = await this.idempotency.claim(
        tx,
        ctx.accountId,
        scope,
        input.opId,
        { id, ...decision },
      );
      if (!claim.claimed) return claim.existingResponse;
      assertFreshVersion(b.updatedAt, input.version);
      if (b.informationRequests.length)
        throw new ApiError(
          "BENEFICIARY_INFORMATION_PENDING",
          "أغلق طلب الاستكمال أو راجع الرد قبل حفظ القرار",
          409,
        );
      if (b.reviewStatus === "REJECTED")
        throw new ApiError(
          "BENEFICIARY_ALREADY_REVIEWED",
          "رفض الأسرة نهائي؛ لا يمكن تغييره من هذه الشاشة",
          409,
        );
      if (!input.familyDecision && !input.needs.length)
        throw new ApiError(
          "BENEFICIARY_NO_DECISION",
          "حدد قرار الأسرة أو قرار احتياج واحد على الأقل",
          400,
        );
      const finalFamily = input.familyDecision ?? b.reviewStatus;
      if (b.reviewStatus === "APPROVED" && input.familyDecision === "REJECTED")
        throw new ApiError(
          "BENEFICIARY_ALREADY_REVIEWED",
          "لا يمكن رفض أسرة معتمدة من مسار المراجعة",
          409,
        );
      if (
        finalFamily === "UNDER_REVIEW" &&
        input.needs.some((n) => n.decision === "APPROVED")
      )
        throw new ApiError(
          "BENEFICIARY_FAMILY_REQUIRED",
          "اعتمد أهلية الأسرة أولًا أو مع اعتماد احتياجاتها",
          400,
        );
      if (
        finalFamily === "APPROVED" &&
        (b.income === null ||
          !b.city ||
          !b.district ||
          b.needPriority === null ||
          (b.needs.length === 3 && !b.threeDeviceReason?.trim()))
      )
        throw new ApiError(
          "BENEFICIARY_INCOMPLETE",
          "توجد بيانات أساسية ناقصة؛ اطلب استكمالها قبل الاعتماد",
          400,
        );
      if (input.familyDecision === "REJECTED" && !input.reason?.trim())
        throw new ApiError(
          "BENEFICIARY_REASON_REQUIRED",
          "سبب رفض الأسرة مطلوب",
          400,
        );
      const decisions =
        input.familyDecision === "REJECTED"
          ? b.needs
              .filter((n) => n.decisionStatus === "PENDING")
              .map((n) => ({
                needId: n.id,
                decision: "REJECTED" as const,
                reason: input.reason,
              }))
          : input.needs;
      if (new Set(decisions.map((n) => n.needId)).size !== decisions.length)
        throw new ApiError(
          "BENEFICIARY_DUPLICATE_DECISION",
          "قرار جهاز مكرر",
          400,
        );
      for (const d of decisions) {
        const n = b.needs.find((n) => n.id === d.needId);
        if (!n || n.decisionStatus !== "PENDING")
          throw new ApiError(
            "BENEFICIARY_NEED_CONFLICT",
            "الاحتياج غير متاح للمراجعة؛ حدّث البيانات",
            409,
          );
        if (d.decision === "REJECTED" && !d.reason?.trim())
          throw new ApiError(
            "BENEFICIARY_REASON_REQUIRED",
            "سبب رفض الجهاز مطلوب",
            400,
          );
      }
      const now = new Date();
      for (const d of decisions)
        await tx.beneficiaryNeed.update({
          where: { id: d.needId },
          data: {
            decisionStatus: d.decision,
            rejectReason: d.decision === "REJECTED" ? d.reason!.trim() : null,
            reviewedById: ctx.accountId,
            reviewedAt: now,
            fulfillmentStatus:
              d.decision === "APPROVED" ? "APPROVED_ENTITLEMENT" : null,
          },
        });
      const updated = await tx.beneficiary.update({
        where: { id },
        data: {
          ...(input.familyDecision
            ? {
                reviewStatus: input.familyDecision,
                beneficiaryRejectReason:
                  input.familyDecision === "REJECTED"
                    ? input.reason!.trim()
                    : null,
                reviewedById: ctx.accountId,
                reviewedAt: now,
              }
            : {}),
          updatedAt: now,
          ...(!b.submittedDeviceTypes.length
            ? { submittedDeviceTypes: b.needs.map((n) => n.deviceType) }
            : {}),
        },
        select: { id: true, updatedAt: true },
      });
      await tx.auditLog.create({
        data: {
          actorAccountId: ctx.accountId,
          associationId: b.associationId,
          action: "BENEFICIARY_WORKSPACE_REVIEWED",
          entityType: "beneficiaries",
          entityId: id,
          metadata: {
            familyBefore: b.reviewStatus,
            familyAfter: finalFamily,
            needs: decisions.map((d) => ({
              needId: d.needId,
              decision: d.decision,
              reason: d.reason ?? null,
            })),
            allocationTriggered: false,
          },
        },
      });
      const result = {
        id,
        version: updated.updatedAt.toISOString(),
        familyStatus: finalFamily,
        allocationTriggered: false,
      };
      await this.idempotency.complete(
        tx,
        ctx.accountId,
        scope,
        input.opId,
        result,
      );
      return result;
    });
    if (!nextQuery) return saved;
    try {
      // Navigation is recomputed on replay, after commit; never store stale household details.
      const next = await this.next(ctx, id, nextQuery);
      return { ...(saved as object), nextId: next.id, nextLookupFailed: false };
    } catch (error) {
      this.logger.warn(
        `Saved review; next lookup failed (${error instanceof ApiError ? error.code : "INTERNAL_ERROR"})`,
      );
      return { ...(saved as object), nextId: null, nextLookupFailed: true };
    }
  }
  async bulk(ctx: AuthContext, items: WorkspaceBulkItemDto[]) {
    if (new Set(items.map((i) => i.id)).size !== items.length)
      throw new ApiError("BENEFICIARY_DUPLICATE", "تكرر مستفيد في الدفعة", 400);
    const results = [];
    for (const item of items) {
      try {
        results.push({
          id: item.id,
          ok: true,
          result: await this.review(ctx, item.id, item),
        });
      } catch (e) {
        results.push({
          id: item.id,
          ok: false,
          error:
            e instanceof ApiError
              ? { code: e.code, message: e.message }
              : {
                  code: "BENEFICIARY_TRANSACTION_FAILED",
                  message:
                    "تعذر حفظ هذه الأسرة؛ حدّث بياناتها وأعد محاولة العناصر المتعثرة فقط",
                },
        });
      }
    }
    return { results };
  }
  async requestInformation(ctx: AuthContext, input: InformationCreateDto) {
    this.assertWritable();
    if (input.dueAt && new Date(input.dueAt) <= new Date())
      throw new ApiError(
        "INFORMATION_DUE_INVALID",
        "المهلة يجب أن تكون في المستقبل",
        400,
      );
    const items = parseInformationItems(input.items);
    if (new Set(input.targets.map((t) => t.id)).size !== input.targets.length)
      throw new ApiError("BENEFICIARY_DUPLICATE", "تكرر مستفيد في الدفعة", 400);
    return prisma.$transaction(
      async (tx) => {
        // All producer locks use association -> beneficiary -> request ordering; worker only locks association.
        const targets = await tx.beneficiary.findMany({
          where: { id: { in: input.targets.map((t) => t.id) } },
          select: { id: true, associationId: true },
        });
        if (targets.length !== input.targets.length) throw missing();
        const fresh = await lockAdminApplicationScope(tx, ctx);
        for (const associationId of [
          ...new Set(targets.map((t) => t.associationId)),
        ].sort()) {
          await assertAdminAssociationScope(fresh, associationId, tx);
          await lockParticipationForOperationalWrite(tx, associationId);
        }
        const scope = "beneficiary-information-batch",
          claim = await this.idempotency.claim(
            tx,
            ctx.accountId,
            scope,
            input.opId,
            input,
          );
        if (!claim.claimed) return claim.existingResponse;
        const batchId = randomUUID(),
          groups = new Map<
            string,
            { email: string; name: string; ids: string[] }
          >(),
          requestIds: string[] = [];
        await tx.$queryRaw(
          Prisma.sql`SELECT id FROM beneficiaries WHERE id IN (${Prisma.join(input.targets.map((t) => Prisma.sql`${t.id}::uuid`))}) ORDER BY id FOR UPDATE`,
        );
        const families = await tx.beneficiary.findMany({
          where: { id: { in: input.targets.map((t) => t.id) } },
          include: {
            association: true,
            informationRequests: { where: { status: { in: ACTIVE_REQUEST } } },
          },
        });
        const byId = new Map(families.map((b) => [b.id, b]));
        const pendingRequests: Prisma.BeneficiaryInformationRequestCreateManyInput[] =
            [],
          pendingAudit: Prisma.AuditLogCreateManyInput[] = [];
        for (const target of [...input.targets].sort((a, b) =>
          a.id.localeCompare(b.id),
        )) {
          const b = byId.get(target.id);
          if (!b || b.archivedAt) throw missing();
          assertFreshVersion(b.updatedAt, target.version);
          if (b.informationRequests.length || b.reviewStatus === "REJECTED")
            throw new ApiError(
              "BENEFICIARY_INFORMATION_CONFLICT",
              "أحد المستفيدين لديه طلب استكمال مفتوح أو قرار رفض نهائي",
              409,
            );
          if (!b.association.email || !isEmail(b.association.email))
            throw new ApiError(
              "ASSOCIATION_EMAIL_REQUIRED",
              "بريد الجمعية الرسمي غير صالح؛ لم يُرسل أي طلب من هذه الدفعة",
              400,
            );
          const requestId = randomUUID();
          pendingRequests.push({
            id: requestId,
            beneficiaryId: b.id,
            associationId: b.associationId,
            batchId,
            items: items as unknown as Prisma.InputJsonValue,
            message: input.message?.trim() || null,
            dueAt: input.dueAt ? new Date(input.dueAt) : null,
            sourceSnapshot: snapshot(b, items) as Prisma.InputJsonValue,
            sourceUpdatedAt: b.updatedAt,
            requestedById: ctx.accountId,
          });
          requestIds.push(requestId);
          const group = groups.get(b.associationId) ?? {
            email: b.association.email.trim().toLowerCase(),
            name: b.association.name,
            ids: [],
          };
          group.ids.push(requestId);
          groups.set(b.associationId, group);
          pendingAudit.push({
            actorAccountId: ctx.accountId,
            associationId: b.associationId,
            action: "BENEFICIARY_INFORMATION_REQUESTED",
            entityType: "beneficiaries",
            entityId: b.id,
            metadata: {
              requestId,
              fields: items.map((i) => i.field),
              message: input.message ?? null,
            },
          });
        }
        await tx.beneficiaryInformationRequest.createMany({
          data: pendingRequests,
        });
        await tx.auditLog.createMany({ data: pendingAudit });
        const events = [];
        for (const [associationId, group] of groups) {
          const url = `${(process.env.PUBLIC_WEB_URL ?? "http://localhost:3000").replace(/\/$/, "")}/association/beneficiaries?information=1`;
          // Sensitive field values/reasons stay inside the authenticated portal; an editable introductory note is in-portal only.
          const mail = await enqueueEmail(
            tx,
            "NOTICE",
            {
              to: group.email,
              name: group.name,
              subject: "استكمال بيانات المستفيدين — مشروع الأجهزة الكهربائية",
              body: `السلام عليكم ورحمة الله وبركاته\nشركاؤنا في ${group.name}\nلديكم ${group.ids.length} طلب استكمال أو تحقق من بيانات المستفيدين. يرجى الدخول إلى حساب الجمعية، ومراجعة الحقول المحددة والرد من صفحة المستفيدين.\nبارك الله في جهودكم، وكتب أجركم\nجمعية الزاد`,
              action: { label: "مراجعة طلبات الاستكمال", url },
            },
            {
              type: "beneficiary-information",
              associationId,
              requestIds: group.ids,
              batchId,
            },
          );
          events.push(mail.eventId);
          await tx.beneficiaryInformationRequest.updateMany({
            where: { id: { in: group.ids } },
            data: { emailEventId: mail.eventId },
          });
        }
        const result = {
          requestIds,
          batchId,
          emailQueued: true,
          emailCount: groups.size,
          eventIds: events,
        };
        await this.idempotency.complete(
          tx,
          ctx.accountId,
          scope,
          input.opId,
          result,
        );
        return result;
      },
      { timeout: 20_000 },
    );
  }
  async informationInbox(ctx: AuthContext) {
    return this.withMailStatus(
      await prisma.beneficiaryInformationRequest.findMany({
        where: {
          status: { in: ACTIVE_REQUEST },
          beneficiary: {
            association: {
              is:
                ctx.role === AccountRole.ASSOCIATION
                  ? { id: ctx.associationId ?? "" }
                  : adminAssociationScopeWhere(ctx),
            },
            archivedAt: null,
          },
        },
        include: {
          beneficiary: {
            select: { id: true, publicCode: true, name: true, region: true },
          },
        },
        orderBy: { createdAt: "asc" },
        take: 100,
      }),
    );
  }
  async reply(ctx: AuthContext, id: string, input: InformationReplyDto) {
    this.assertWritable();
    return prisma.$transaction(async (tx) => {
      const request = await tx.beneficiaryInformationRequest.findUnique({
        where: { id },
      });
      if (!request || request.associationId !== ctx.associationId)
        throw missing();
      const b = await this.lockFamily(tx, ctx, request.beneficiaryId);
      await tx.$queryRaw`SELECT id FROM beneficiary_information_requests WHERE id=${id}::uuid FOR UPDATE`;
      const r = await tx.beneficiaryInformationRequest.findUniqueOrThrow({
          where: { id },
        }),
        scope = `beneficiary-information-reply:${id}`;
      const claim = await this.idempotency.claim(
        tx,
        ctx.accountId,
        scope,
        input.opId,
        input,
      );
      if (!claim.claimed) return claim.existingResponse;
      assertFreshVersion(r.updatedAt, input.version);
      if (r.status !== "OPEN")
        throw new ApiError(
          "INFORMATION_STATE_CONFLICT",
          "تم إرسال الرد سابقًا",
          409,
        );
      const values = parseInformationResponse(
        r.items as InformationItem[],
        input.values,
      );
      await this.validateReferences(
        tx,
        b.region,
        values,
        b.id,
        b.associationId,
      );
      const result = await tx.beneficiaryInformationRequest.update({
        where: { id },
        data: {
          response: values,
          responseNote: input.note?.trim() || null,
          status: "SUBMITTED",
          submittedAt: new Date(),
        },
        select: { id: true, status: true, updatedAt: true },
      });
      await tx.auditLog.create({
        data: {
          actorAccountId: ctx.accountId,
          associationId: b.associationId,
          action: "BENEFICIARY_INFORMATION_REPLIED",
          entityType: "beneficiaries",
          entityId: b.id,
          metadata: { requestId: id },
        },
      });
      await this.idempotency.complete(
        tx,
        ctx.accountId,
        scope,
        input.opId,
        result,
      );
      return result;
    });
  }
  private async validateReferences(
    tx: Prisma.TransactionClient,
    region: string,
    values: Record<string, string | number | boolean>,
    id: string,
    associationId: string,
  ) {
    if (values.city) {
      const city = await tx.referenceValue.findFirst({
        where: {
          type: "CITY",
          value: String(values.city),
          active: true,
          parent: { value: region, type: "REGION", active: true },
        },
      });
      if (!city)
        throw new ApiError(
          "INFORMATION_CITY_INVALID",
          "اختر مدينة معتمدة ضمن منطقة المستفيد",
          400,
        );
    }
    if (
      values.maritalStatus &&
      !(await tx.referenceValue.findFirst({
        where: {
          type: "SOCIAL_STATUS",
          value: String(values.maritalStatus),
          active: true,
        },
      }))
    )
      throw new ApiError(
        "INFORMATION_STATUS_INVALID",
        "اختر حالة اجتماعية معتمدة",
        400,
      );
    if (
      values.phone &&
      (await tx.beneficiary.findFirst({
        where: {
          associationId,
          phone: String(values.phone),
          archivedAt: null,
          id: { not: id },
        },
      }))
    )
      throw new ApiError(
        "BENEFICIARY_PHONE_DUPLICATE",
        "الجوال مسجل لمستفيد آخر في الجمعية",
        409,
      );
  }
  async resolve(ctx: AuthContext, id: string, input: InformationResolveDto) {
    this.assertWritable();
    return prisma.$transaction(async (tx) => {
      const request = await tx.beneficiaryInformationRequest.findUnique({
        where: { id },
      });
      if (!request) throw missing();
      const b = await this.lockFamily(tx, ctx, request.beneficiaryId);
      await tx.$queryRaw`SELECT id FROM beneficiary_information_requests WHERE id=${id}::uuid FOR UPDATE`;
      const r = await tx.beneficiaryInformationRequest.findUniqueOrThrow({
          where: { id },
        }),
        scope = `beneficiary-information-resolve:${id}`;
      const claim = await this.idempotency.claim(
        tx,
        ctx.accountId,
        scope,
        input.opId,
        input,
      );
      if (!claim.claimed) return claim.existingResponse;
      assertFreshVersion(r.updatedAt, input.version);
      if (
        !ACTIVE_REQUEST.includes(r.status) ||
        (input.accept && r.status !== "SUBMITTED")
      )
        throw new ApiError(
          "INFORMATION_STATE_CONFLICT",
          "حالة طلب الاستكمال تغيرت",
          409,
        );
      if (input.accept) {
        assertFreshVersion(b.updatedAt, r.sourceUpdatedAt.toISOString());
        const values = parseInformationResponse(
          r.items as InformationItem[],
          r.response,
        );
        await this.validateReferences(
          tx,
          b.region,
          values,
          b.id,
          b.associationId,
        );
        await tx.beneficiary.update({
          where: { id: b.id },
          data: values as Prisma.BeneficiaryUpdateInput,
        });
      } else if (!input.note?.trim())
        throw new ApiError(
          "INFORMATION_NOTE_REQUIRED",
          "اذكر سبب إغلاق طلب الاستكمال دون تطبيق الرد",
          400,
        );
      const result = await tx.beneficiaryInformationRequest.update({
        where: { id },
        data: {
          status: input.accept ? "CLOSED" : "CANCELLED",
          resolvedAt: new Date(),
          resolvedById: ctx.accountId,
        },
        select: { id: true, status: true },
      });
      await tx.auditLog.create({
        data: {
          actorAccountId: ctx.accountId,
          associationId: b.associationId,
          action: input.accept
            ? "BENEFICIARY_INFORMATION_ACCEPTED"
            : "BENEFICIARY_INFORMATION_CANCELLED",
          entityType: "beneficiaries",
          entityId: b.id,
          metadata: {
            requestId: id,
            note: input.note ?? null,
            fields: (r.items as InformationItem[]).map((i) => i.field),
          },
        },
      });
      await this.idempotency.complete(
        tx,
        ctx.accountId,
        scope,
        input.opId,
        result,
      );
      return result;
    });
  }
  private limits(value: Record<string, unknown>): PlanningLimits {
    const total = value.total;
    if (
      typeof total !== "number" ||
      !Number.isInteger(total) ||
      total < 0 ||
      total > 1_000_000
    )
      throw new ApiError(
        "PLANNING_LIMITS_INVALID",
        "العدد الإجمالي للأجهزة غير صحيح",
        400,
      );
    const result: PlanningLimits = {
      total,
      regions: {},
      associations: {},
      devices: {},
    };
    if (
      value.allowPartial !== undefined &&
      typeof value.allowPartial !== "boolean"
    )
      throw new ApiError(
        "PLANNING_LIMITS_INVALID",
        "سياسة اكتمال أجهزة الأسرة غير صحيحة",
        400,
      );
    result.allowPartial = value.allowPartial === true;
    for (const key of ["regions", "associations", "devices"] as const) {
      const map = value[key];
      if (
        !map ||
        typeof map !== "object" ||
        Array.isArray(map) ||
        Object.keys(map).length > 1000
      )
        throw new ApiError(
          "PLANNING_LIMITS_INVALID",
          "حدود التخطيط غير صالحة",
          400,
        );
      for (const [id, n] of Object.entries(map)) {
        if (typeof n !== "number" || !Number.isInteger(n) || n < 0 || n > total)
          throw new ApiError(
            "PLANNING_LIMITS_INVALID",
            "حصة الأجهزة يجب ألا تتجاوز الإجمالي",
            400,
          );
        result[key][id] = n;
      }
    }
    return result;
  }
  private async planKeys(ctx: AuthContext, limits: PlanningLimits) {
    const associations = await prisma.association.findMany({
      where: this.associationWhere(ctx),
      select: { id: true, region: true },
    });
    if (
      Object.keys(limits.associations).some(
        (id) => !associations.some((a) => a.id === id),
      ) ||
      Object.keys(limits.regions).some(
        (region) => !associations.some((a) => a.region === region),
      ) ||
      Object.keys(limits.devices).some(
        (type) => !["REFRIGERATOR", "OVEN", "WASHING_MACHINE"].includes(type),
      )
    )
      throw new ApiError(
        "PLANNING_SCOPE_FORBIDDEN",
        "تتضمن الخطة جمعية أو منطقة أو نوع جهاز غير متاح ضمن نطاقك",
        403,
      );
  }
  async planning(ctx: AuthContext) {
    const setting = await prisma.systemSetting.findUnique({
        where: { key: PLAN_KEY },
      }),
      limits = setting
        ? this.limits(setting.value as Record<string, unknown>)
        : {
            total: 1000,
            regions: {},
            associations: {},
            devices: {},
            allowPartial: false,
          };
    if (adminApplicationRegionCodes(ctx) !== null) {
      const allowed = await prisma.association.findMany({
        where: this.associationWhere(ctx),
        select: { id: true, region: true },
      });
      limits.associations = Object.fromEntries(
        Object.entries(limits.associations).filter(([id]) =>
          allowed.some((a) => a.id === id),
        ),
      );
      limits.regions = Object.fromEntries(
        Object.entries(limits.regions).filter(([name]) =>
          allowed.some((a) => a.region === name),
        ),
      );
    }
    return { limits, version: setting?.updatedAt.toISOString() ?? "initial" };
  }
  async simulate(ctx: AuthContext, input: PlanningDto) {
    const limits = this.limits(input.limits);
    await this.planKeys(ctx, limits);
    const [rows, allocated] = await prisma.$transaction(
      [
        prisma.beneficiary.findMany({
          where: { ...this.baseWhere(ctx), reviewStatus: "APPROVED" },
          select: {
            id: true,
            name: true,
            associationId: true,
            association: { select: { name: true, region: true } },
            region: true,
            needPriority: true,
            needs: {
              where: {
                decisionStatus: "APPROVED",
                allocations: { none: { status: "ACTIVE" } },
              },
              select: { deviceType: true },
            },
          },
        }),
        prisma.deviceAllocation.findMany({
          where: { status: "ACTIVE", association: { is: { NOT: demoWhere } } },
          select: {
            associationId: true,
            association: { select: { region: true } },
            beneficiaryNeed: { select: { deviceType: true } },
          },
        }),
      ],
      { isolationLevel: "RepeatableRead" },
    );
    const existing = {
      total: allocated.length,
      regions: {} as Record<string, number>,
      associations: {} as Record<string, number>,
      devices: {} as Record<string, number>,
    };
    for (const a of allocated) {
      existing.regions[a.association.region] =
        (existing.regions[a.association.region] ?? 0) + 1;
      existing.associations[a.associationId] =
        (existing.associations[a.associationId] ?? 0) + 1;
      existing.devices[a.beneficiaryNeed.deviceType] =
        (existing.devices[a.beneficiaryNeed.deviceType] ?? 0) + 1;
    }
    const available: PlanningLimits = {
      total: Math.max(0, limits.total - existing.total),
      regions: {},
      associations: {},
      devices: {},
      allowPartial: limits.allowPartial,
    };
    for (const key of ["regions", "associations", "devices"] as const)
      for (const [id, n] of Object.entries(limits[key]))
        available[key][id] = Math.max(0, n - (existing[key][id] ?? 0));
    const result = simulateBeneficiaries(
      rows.map((b) => ({ ...b, region: b.association.region, devices: b.needs.map((n) => n.deviceType) })),
      available,
    );
    return {
      ...result,
      proposals: rows
        .filter((b) => b.needs.length)
        .map((b) => ({
          id: b.id,
          name: b.name,
          associationName: b.association.name,
          priority: b.needPriority,
          selected: result.selected.find((r) => r.id === b.id)?.devices ?? [],
          waiting: result.waiting.find((r) => r.id === b.id)?.devices ?? [],
        })),
      existingAllocated: existing.total,
      remainingCapacity: available.total,
      simulationOnly: true,
      policy: `الأولوية داخل كل جمعية؛ عند التعادل ترتيب ثابت للجمعيات. ${limits.allowPartial ? "اقتراح المتاح ولو جزئيًا" : "انتظار اكتمال الأجهزة المعتمدة للأسرة"}. يُخصم المخصص النشط من الحصص؛ لا نقل للمخزون ولا تغيير للقرارات.`,
    };
  }
  async savePlanning(ctx: AuthContext, input: PlanningDto) {
    this.assertWritable();
    const limits = this.limits(input.limits);
    if (!input.opId)
      throw new ApiError(
        "PLANNING_OPERATION_REQUIRED",
        "معرف عملية الحفظ مطلوب",
        400,
      );
    await this.planKeys(ctx, limits);
    return prisma.$transaction(async (tx) => {
      const fresh = await lockAdminApplicationScope(tx, ctx);
      if (adminApplicationRegionCodes(fresh) !== null)
        throw new ApiError(
          "PLANNING_SCOPE_FORBIDDEN",
          "حفظ حصص المشروع متاح للإدارة العامة فقط",
          403,
        );
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${PLAN_KEY}))::text`;
      const claim = await this.idempotency.claim(
        tx,
        ctx.accountId,
        PLAN_KEY,
        input.opId!,
        input,
      );
      if (!claim.claimed) return claim.existingResponse;
      const setting = await tx.systemSetting.findUnique({
        where: { key: PLAN_KEY },
      });
      if ((setting?.updatedAt.toISOString() ?? "initial") !== input.version)
        throw new ApiError(
          "PLANNING_VERSION_CONFLICT",
          "تغيرت حصص التخطيط؛ أعد تحميلها",
          409,
        );
      const result = await tx.systemSetting.upsert({
        where: { key: PLAN_KEY },
        create: {
          key: PLAN_KEY,
          value: limits as unknown as Prisma.InputJsonValue,
        },
        update: { value: limits as unknown as Prisma.InputJsonValue },
      });
      await tx.auditLog.create({
        data: {
          actorAccountId: ctx.accountId,
          action: "BENEFICIARY_PLANNING_SAVED",
          entityType: "system_settings",
          entityId: result.key,
          metadata: { simulationOnly: true },
        },
      });
      const response = {
        limits: result.value,
        version: result.updatedAt.toISOString(),
        simulationOnly: true,
      };
      await this.idempotency.complete(
        tx,
        ctx.accountId,
        PLAN_KEY,
        input.opId!,
        response,
      );
      return response;
    });
  }
}
