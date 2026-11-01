import "reflect-metadata";
import { jest } from "@jest/globals";
import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import { AccountRole, prisma } from "@alzad/db";
import { BeneficiaryWorkspaceService } from "./beneficiary-workspace.service";
import { workspaceIntake } from "./beneficiary-workspace.aggregate";
import { WorkspaceReviewDto, WorkspaceBulkDto } from "./dto/beneficiary-workspace.dto";
import type { IdempotencyService } from "../../common/idempotency.service";
import type { AuthContext } from "../auth/auth.types";

const admin = {
  accountId: "01950000-0000-7000-8000-000000000001", role: AccountRole.ADMIN,
  sessionId: "session", associationId: null, mustChangePassword: false,
  adminFullAccess: true,
} as AuthContext;
const id = "01950000-0000-7000-8000-000000000002";
const associationId = "01950000-0000-7000-8000-000000000003";
const version = new Date("2026-11-01T00:00:00.000Z");
const input = { opId: "review-once", version: version.toISOString(), familyDecision: "APPROVED" as const, needs: [] };

function fixture() {
  const row = {
    id, associationId, updatedAt: version, archivedAt: null,
    income: 0, city: "بريدة", district: "حي المستفيد", needPriority: 1,
    latitude: null, longitude: null, reviewStatus: "UNDER_REVIEW",
    submittedDeviceTypes: ["OVEN"], needs: [], informationRequests: [],
  };
  const tx = {
    $queryRaw: jest.fn(async () => []),
    account: { findUnique: jest.fn(async () => ({ role: "ADMIN", status: "ACTIVE", archivedAt: null, adminFullAccess: true, adminApplicationScope: null })) },
    beneficiary: { findUnique: jest.fn(async () => row), update: jest.fn(async () => ({ id, updatedAt: new Date(version.getTime() + 1) })) },
    beneficiaryNeed: { update: jest.fn(async () => ({})) },
    auditLog: { create: jest.fn(async () => ({})) },
  };
  const idempotency = {
    claim: jest.fn<() => Promise<unknown>>().mockResolvedValue({ claimed: true }),
    complete: jest.fn<() => Promise<unknown>>().mockResolvedValue(undefined),
  };
  jest.spyOn(prisma, "$transaction").mockImplementation(async (callback) => {
    if (typeof callback !== "function") throw new Error("Expected interactive transaction");
    return callback(tx as never);
  });
  return { row, tx, idempotency, service: new BeneficiaryWorkspaceService(idempotency as unknown as IdempotencyService) };
}

afterEach(() => jest.restoreAllMocks());

describe("beneficiary workspace lightweight detail and lazy history", () => {
  it("returns fresh decision data and active requests without reading history or outbox", async () => {
    const { service, row } = fixture();
    const find = jest.spyOn(prisma.beneficiary, "findFirst").mockResolvedValue({ ...row, informationRequests: [{ id: "open", status: "OPEN" }] } as never);
    const history = jest.spyOn(prisma.auditLog, "findMany").mockRejectedValue(new Error("History must not load"));
    const mail = jest.spyOn(prisma.outboxEvent, "findMany").mockRejectedValue(new Error("Outbox must not load"));
    const result = await service.detail(admin, id);
    expect(result).toMatchObject({ id, income: 0, updatedAt: version, informationRequests: [{ id: "open" }], events: [], historyLoaded: false });
    expect(find.mock.calls[0][0]).toMatchObject({ include: { informationRequests: { where: { status: { in: ["OPEN", "SUBMITTED"] } } } } });
    expect(history).not.toHaveBeenCalled();
    expect(mail).not.toHaveBeenCalled();
  });

  it("authorizes history before reading any audit or email data", async () => {
    const { service } = fixture();
    const find = jest.spyOn(prisma.beneficiary, "findFirst").mockResolvedValue(null);
    const history = jest.spyOn(prisma.auditLog, "findMany").mockResolvedValue([]);
    const requests = jest.spyOn(prisma.beneficiaryInformationRequest, "findMany").mockResolvedValue([]);
    const scoped = { ...admin, adminFullAccess: false, adminApplicationScope: { regionCodes: ["0002"] } } as AuthContext;
    await expect(service.history(scoped, id)).rejects.toMatchObject({ code: "BENEFICIARY_NOT_FOUND" });
    expect(JSON.stringify(find.mock.calls[0][0])).toContain("0002");
    expect(history).not.toHaveBeenCalled();
    expect(requests).not.toHaveBeenCalled();
  });

  it("returns bounded history with a version and avoids outbox reads when no email exists", async () => {
    const { service } = fixture();
    jest.spyOn(prisma.beneficiary, "findFirst").mockResolvedValue({ id, updatedAt: version } as never);
    const requests = jest.spyOn(prisma.beneficiaryInformationRequest, "findMany").mockResolvedValue([{ id: "closed", status: "RESOLVED", emailEventId: null }] as never);
    const history = jest.spyOn(prisma.auditLog, "findMany").mockResolvedValue([{ id: "event" }] as never);
    const mail = jest.spyOn(prisma.outboxEvent, "findMany").mockRejectedValue(new Error("Unexpected mail read"));
    expect(await service.history(admin, id)).toMatchObject({ id, version: version.toISOString(), events: [{ id: "event" }], informationRequests: [{ id: "closed", emailStatus: "NOT_QUEUED" }] });
    expect(requests.mock.calls[0][0]).toMatchObject({ where: { beneficiaryId: id }, take: 20 });
    expect(history.mock.calls[0][0]).toMatchObject({ where: { entityId: id }, take: 30 });
    expect(mail).not.toHaveBeenCalled();
  });
});

describe("post-commit save and next", () => {
  it("preserves the old response when nextQuery is absent", async () => {
    const { service, tx } = fixture();
    const next = jest.spyOn(service, "next");
    expect(await service.review(admin, id, input)).toEqual({ id, version: new Date(version.getTime() + 1).toISOString(), familyStatus: "APPROVED", allocationTriggered: false });
    expect(tx.beneficiary.update).toHaveBeenCalledTimes(1);
    expect(next).not.toHaveBeenCalled();
  });

  it("computes next after commit and excludes navigation from the idempotent decision", async () => {
    const { service, idempotency, tx } = fixture();
    const next = jest.spyOn(service, "next").mockImplementation(async () => {
      expect(idempotency.complete).toHaveBeenCalledTimes(1);
      return { id: "next-family" };
    });
    const q = { requestedCount: "1", bucket: "REVIEW" };
    const result = await service.review(admin, id, { ...input, nextQuery: q });
    expect(result).toMatchObject({ nextId: "next-family", nextLookupFailed: false });
    expect(next).toHaveBeenCalledWith(admin, id, q);
    expect((idempotency.claim.mock.calls as unknown[][])[0][4]).toEqual({ id, ...input });
    expect((idempotency.complete.mock.calls as unknown[][])[0][4]).not.toHaveProperty("nextId");
    expect(tx.auditLog.create).toHaveBeenCalledTimes(1);
  });

  it("does not report a successfully saved review as failed if next lookup fails", async () => {
    const { service, tx, idempotency } = fixture();
    jest.spyOn(service, "next").mockRejectedValue(new Error("Transient lookup failure"));
    expect(await service.review(admin, id, { ...input, nextQuery: {} })).toMatchObject({ familyStatus: "APPROVED", nextId: null, nextLookupFailed: true });
    expect(tx.beneficiary.update).toHaveBeenCalledTimes(1);
    expect(idempotency.complete).toHaveBeenCalledTimes(1);
  });

  it("replays the saved decision but recomputes navigation without writes or stale detail", async () => {
    const { service, tx, idempotency } = fixture();
    const saved = { id, version: version.toISOString(), familyStatus: "APPROVED", allocationTriggered: false };
    idempotency.claim.mockResolvedValue({ claimed: false, existingResponse: saved });
    const next = jest.spyOn(service, "next").mockResolvedValueOnce({ id: "first" }).mockResolvedValueOnce({ id: null });
    expect(await service.review(admin, id, { ...input, nextQuery: {} })).toEqual({ ...saved, nextId: "first", nextLookupFailed: false });
    expect(await service.review(admin, id, { ...input, nextQuery: {} })).toEqual({ ...saved, nextId: null, nextLookupFailed: false });
    expect(next).toHaveBeenCalledTimes(2);
    expect(tx.beneficiary.update).not.toHaveBeenCalled();
    expect(tx.auditLog.create).not.toHaveBeenCalled();
  });

  it("never does a next lookup when saving itself fails", async () => {
    const { service, row } = fixture();
    row.income = null as never;
    const next = jest.spyOn(service, "next");
    await expect(service.review(admin, id, { ...input, nextQuery: {} })).rejects.toMatchObject({ code: "BENEFICIARY_INCOMPLETE" });
    expect(next).not.toHaveBeenCalled();
  });

  it("keeps next within the current association and preserves household filters", async () => {
    const { service } = fixture();
    const find = jest.spyOn(prisma.beneficiary, "findFirst")
      .mockResolvedValueOnce({ associationId, needPriority: 7 } as never)
      .mockResolvedValueOnce(null);
    const foreignId = "01950000-0000-7000-8000-000000000099";
    expect(await service.next(admin, id, { associationId: foreignId, city: "بريدة", search: "اسم", deviceType: "OVEN", topTen: "true" })).toEqual({ id: null });
    const lookup = find.mock.calls[1][0]!;
    const serialized = JSON.stringify(lookup);
    expect(serialized).toContain(associationId);
    expect(serialized).not.toContain(foreignId);
    expect(lookup).toMatchObject({ where: { AND: expect.arrayContaining([
      expect.objectContaining({ city: "بريدة", needPriority: { gte: 1, lte: 10 }, needs: { some: { deviceType: "OVEN" } } }),
      expect.objectContaining({ reviewStatus: { not: "REJECTED" }, informationRequests: { none: { status: { in: ["OPEN", "SUBMITTED"] } } } }),
    ]) } });
  });

  it("does not scan other families if the current family is unavailable", async () => {
    const { service } = fixture();
    const find = jest.spyOn(prisma.beneficiary, "findFirst").mockResolvedValue(null);
    await expect(service.next(admin, id, {})).rejects.toMatchObject({ code: "BENEFICIARY_NOT_FOUND" });
    expect(find).toHaveBeenCalledTimes(1);
  });

  it("validates nested next query and does not expose navigation in bulk decisions", async () => {
    const good = plainToInstance(WorkspaceReviewDto, { ...input, nextQuery: { bucket: "REVIEW", requestedCount: "3" } });
    expect(await validate(good, { whitelist: true, forbidNonWhitelisted: true })).toEqual([]);
    const bad = plainToInstance(WorkspaceReviewDto, { ...input, nextQuery: { includeSecrets: true, requestedCount: "999" } });
    expect((await validate(bad, { whitelist: true, forbidNonWhitelisted: true })).length).toBeGreaterThan(0);
    const bulk = plainToInstance(WorkspaceBulkDto, { items: [{ id, ...input, nextQuery: {} }] });
    expect((await validate(bulk, { whitelist: true, forbidNonWhitelisted: true })).length).toBeGreaterThan(0);
  });
});

describe("independent operational intake", () => {
  it("uses each real limit and never frees capacity by subtracting rejected households", () => {
    const associations = [0, 1, 2, 3].map((index) => ({ id: String(index), publicCode: String(index), name: `جمعية ${index}`, region: "القصيم", beneficiaryLimit: [50, 80, 50, 20][index] }));
    const result = workspaceIntake(associations, [{ associationId: "1", count: 50 }, { associationId: "2", count: 50 }, { associationId: "3", count: 25 }]);
    expect(result).toMatchObject({ total: 4, started: 3, notStarted: 1, partial: 1, reachedLimit: 2, families: 125, capacity: 200, remaining: 80 });
    expect(result.associations[1]).toMatchObject({ beneficiaryLimit: 80, uploadedCount: 50, remaining: 30, complete: false });
    expect(result.associations[3]).toMatchObject({ uploadedCount: 25, remaining: 0, complete: true });
  });

  it("scopes intake by region/authorization only; excludes demo, archived and non-operational associations", async () => {
    const { service } = fixture();
    const find = jest.spyOn(prisma.association, "findMany").mockResolvedValue([{ id: associationId, publicCode: "ASC-1", name: "جمعية", region: "القصيم", beneficiaryLimit: 80, _count: { beneficiaries: 50 } }] as never);
    jest.spyOn(prisma, "$queryRaw").mockResolvedValue([]);
    jest.spyOn(prisma.beneficiary, "findMany").mockResolvedValue([]);
    jest.spyOn(prisma.deviceAllocation, "findMany").mockResolvedValue([]);
    const counts = jest.spyOn(prisma.beneficiary, "groupBy").mockRejectedValue(new Error("No second intake round trip"));
    const ctx = { ...admin, adminFullAccess: false, adminApplicationScope: { regionCodes: ["0001"] } } as AuthContext;
    const result = await service.overview(ctx, { associationId: id, region: "القصيم", search: "hidden-search", city: "hidden-city", topTen: "true", includeDemo: "true", deviceType: "OVEN", bucket: "REJECTED" });
    expect(result.intake).toMatchObject({ total: 1, partial: 1, reachedLimit: 0 });
    const query = find.mock.calls[1][0]!;
    expect(query).toMatchObject({ where: { AND: [ { archivedAt: null }, { status: "ACTIVE", participation: { is: { status: { in: ["ACTIVE", "EXECUTING"] }, activatedAt: { not: null }, activationAnomaly: false } } } ] } });
    const serialized = JSON.stringify(query);
    for (const forbidden of [id, "hidden-search", "hidden-city", "topTen", "OVEN", "REJECTED"]) expect(serialized).not.toContain(forbidden);
    expect(serialized).toContain("0001");
    expect(serialized).toContain("القصيم");
    expect(serialized).toContain("APP-000328");
    expect(serialized).toContain("NOT");
    expect(query).toMatchObject({ select: { _count: { select: { beneficiaries: { where: { archivedAt: null } } } } } });
    expect(counts).not.toHaveBeenCalled();
  });
});
