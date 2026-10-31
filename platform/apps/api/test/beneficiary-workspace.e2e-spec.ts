import request from "supertest";
import { randomBytes, randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import { writeFileSync } from "node:fs";
import { prisma, DeviceType, seedReferenceData } from "@alzad/db";
import { createTestApp } from "./utils/bootstrap";
import { cleanAuthState, seedTestFixtures, hashSecret } from "./utils/fixtures";
import { loginAs } from "./utils/node2-fixtures";
import {
  cleanNode3State,
  createBeneficiary,
  newOpId,
  seedNode3Fixtures,
} from "./utils/node3-fixtures";
import {
  decryptEmailDelivery,
  type EmailDeliveryPayload,
} from "../src/modules/auth/email/email.service";
import { NotificationsService } from "../src/modules/notifications/notifications.service";

jest.setTimeout(120000);
describe("Beneficiary workspace — independent review and safe information loop", () => {
  let app: Awaited<ReturnType<typeof createTestApp>>["app"],
    fakeEmail: Awaited<ReturnType<typeof createTestApp>>["fakeEmail"];
  let fx: Awaited<ReturnType<typeof seedNode3Fixtures>>,
    admin: string,
    association: string,
    other: string;
  let family: { id: string; needIds: string[]; deviceTypes: string[] },
    second: typeof family;
  const http = () => request(app.getHttpServer()),
    url = "/api/v1/beneficiary-workspace";
  const get = async (id: string) => {
    const r = await http().get(`${url}/${id}`).set("Cookie", admin);
    expect(r.status).toBe(200);
    return r.body;
  };
  beforeAll(async () => {
    process.env.EMAIL_DELIVERY_ENCRYPTION_KEY =
      randomBytes(32).toString("base64");
    ({ app, fakeEmail } = await createTestApp());
    await seedReferenceData(prisma);
    const base = await seedTestFixtures();
    fx = await seedNode3Fixtures();
    await cleanNode3State();
    await cleanAuthState();
    await prisma.association.updateMany({
      where: { id: { in: [fx.associationAId, fx.associationBId] } },
      data: { email: "workspace-test@example.org" },
    });
    admin = await loginAs(app, base.adminEmail, base.adminPassword);
    association = await loginAs(app, fx.assocAEmail, fx.assocAPassword);
    other = await loginAs(app, fx.assocBEmail, fx.assocBPassword);
    family = await createBeneficiary(app, association, {
      needPriority: 1,
      deviceTypes: [
        DeviceType.REFRIGERATOR,
        DeviceType.OVEN,
        DeviceType.WASHING_MACHINE,
      ],
      threeDeviceReason: "اختبار الأسرة لا تملك أجهزة صالحة",
    });
    second = await createBeneficiary(app, association, {
      needPriority: 2,
      income: 0,
      socialSecurity: false,
    });
  });
  afterAll(async () => {
    if (app) {
      await cleanNode3State();
      await prisma.association.deleteMany({
        where: { publicCode: { startsWith: "E2E-PERF-" } },
      });
      await app.close();
    }
    await prisma.$disconnect();
  });
  it("shows association, real financial fields and independently reconciled counters", async () => {
    const r = await http()
      .get(`${url}/overview?associationId=${fx.associationAId}`)
      .set("Cookie", admin);
    expect(r.status).toBe(200);
    expect(r.body.totals).toMatchObject({
      families: 2,
      requested: 4,
      approvedDevices: 0,
      requestedFamilies: [0, 1, 0, 1],
    });
    const list = await http()
      .get(`${url}?associationId=${fx.associationAId}&requestedCount=3`)
      .set("Cookie", admin);
    expect(list.status).toBe(200);
    expect(list.body.total).toBe(1);
    expect(list.body.items[0].association.name).toContain("NODE3E2E");
    expect(await get(second.id)).toMatchObject({
      income: 0,
      socialSecurity: false,
    });
    expect((await http().get(url).set("Cookie", association)).status).toBe(403);
  });
  it("accepts family alone, then independent partial device decisions without allocation", async () => {
    const before = await prisma.outboxEvent.count({
        where: { type: "ALLOCATION_RETRY_DUE" },
      }),
      b = await get(family.id);
    const payload = {
      opId: newOpId(),
      version: b.updatedAt,
      familyDecision: "APPROVED",
      needs: [],
    };
    const r = await http()
      .post(`${url}/${b.id}/review`)
      .set("Cookie", admin)
      .send(payload);
    expect(r.status).toBe(201);
    expect(r.body.allocationTriggered).toBe(false);
    const replay = await http()
      .post(`${url}/${b.id}/review`)
      .set("Cookie", admin)
      .send(payload);
    expect(replay.status).toBe(201);
    expect(replay.body).toEqual(r.body);
    const d = await get(family.id);
    expect(d.reviewStatus).toBe("APPROVED");
    expect(d.needs.every((n: any) => n.decisionStatus === "PENDING")).toBe(
      true,
    );
    const review = await http()
      .post(`${url}/${d.id}/review`)
      .set("Cookie", admin)
      .send({
        opId: newOpId(),
        version: d.updatedAt,
        needs: [
          { needId: d.needs[0].id, decision: "APPROVED" },
          {
            needId: d.needs[1].id,
            decision: "REJECTED",
            reason: "لا يطابق الاحتياج",
          },
        ],
      });
    expect(review.status).toBe(201);
    const final = await get(family.id);
    expect(final.needs.map((n: any) => n.decisionStatus).sort()).toEqual([
      "APPROVED",
      "PENDING",
      "REJECTED",
    ]);
    expect(
      await prisma.outboxEvent.count({
        where: { type: "ALLOCATION_RETRY_DUE" },
      }),
    ).toBe(before);
    const stale = await http()
      .post(`${url}/${d.id}/review`)
      .set("Cookie", admin)
      .send({ opId: newOpId(), version: d.updatedAt, needs: [] });
    expect(stale.status).toBe(409);
  });
  it("preserves null income and rejects approval until confirmed; zero remains valid", async () => {
    await prisma.beneficiary.update({
      where: { id: second.id },
      data: { income: null },
    });
    const b = await get(second.id);
    expect(b.income).toBeNull();
    expect(
      (await http().get(`/api/v1/beneficiaries/${b.id}`).set("Cookie", admin))
        .body.income,
    ).toBeNull();
    const r = await http()
      .post(`${url}/${b.id}/review`)
      .set("Cookie", admin)
      .send({
        opId: newOpId(),
        version: b.updatedAt,
        familyDecision: "APPROVED",
        needs: [],
      });
    expect(r.status).toBe(400);
    expect(r.body.error.code).toBe("BENEFICIARY_INCOMPLETE");
  });
  let requestId: string, batchPayload: any;
  it("creates two independent requests but one encrypted email, with replay protection and no real sending", async () => {
    const a = await get(family.id),
      b = await get(second.id);
    batchPayload = {
      opId: newOpId(),
      targets: [
        { id: a.id, version: a.updatedAt },
        { id: b.id, version: b.updatedAt },
      ],
      items: [
        {
          field: "income",
          kind: "VERIFY",
          reason: "الرجاء التحقق من الدخل الشهري",
        },
        {
          field: "socialSecurity",
          kind: "VERIFY",
          reason: "تأكيد الاستفادة من الضمان",
        },
      ],
      message: "توضيح داخل المنصة فقط",
    };
    const r = await http()
      .post(`${url}/information`)
      .set("Cookie", admin)
      .send(batchPayload);
    expect(r.status).toBe(201);
    expect(r.body.emailCount).toBe(1);
    expect(r.body.requestIds).toHaveLength(2);
    requestId = r.body.requestIds.find((id: string) => id)!;
    const stored = await prisma.beneficiaryInformationRequest.findFirstOrThrow({
      where: { id: { in: r.body.requestIds }, beneficiaryId: second.id },
    });
    requestId = stored.id;
    const event = await prisma.outboxEvent.findUniqueOrThrow({
        where: { id: r.body.eventIds[0] },
      }),
      mail = decryptEmailDelivery(
        event.id,
        event.payload as unknown as EmailDeliveryPayload,
      );
    expect(mail.context.type).toBe("beneficiary-information");
    expect(mail.params.to).toBe("workspace-test@example.org");
    expect((mail.params as any).body).not.toContain("الدخل الشهري");
    expect((mail.params as any).body).not.toContain("،\n");
    expect(fakeEmail.lastSecurityAlert).toBeNull();
    expect(
      (
        await http()
          .post(`${url}/information`)
          .set("Cookie", admin)
          .send(batchPayload)
      ).body,
    ).toEqual(r.body);
    const conflict = await http()
      .post(`${url}/information`)
      .set("Cookie", admin)
      .send({ ...batchPayload, opId: newOpId() });
    expect(conflict.status).toBe(409);
  });
  it("isolates information replies, rejects extra fields and preserves original data until admin acceptance", async () => {
    expect(
      (await http().get(`${url}/information`).set("Cookie", other)).body,
    ).toEqual([]);
    const inbox = await http()
      .get(`${url}/information`)
      .set("Cookie", association);
    expect(inbox.status).toBe(200);
    const r = inbox.body.find((r: any) => r.id === requestId);
    expect(r.message).toBe(batchPayload.message);
    expect(
      (
        await http()
          .post(`${url}/information/${requestId}/reply`)
          .set("Cookie", other)
          .send({
            opId: newOpId(),
            version: r.updatedAt,
            values: { income: 0, socialSecurity: false },
          })
      ).status,
    ).toBe(404);
    expect(
      (
        await http()
          .post(`${url}/information/${requestId}/reply`)
          .set("Cookie", association)
          .send({
            opId: newOpId(),
            version: r.updatedAt,
            values: {
              income: 0,
              socialSecurity: false,
              name: "تغيير غير مسموح",
            },
          })
      ).status,
    ).toBe(400);
    const reply = await http()
      .post(`${url}/information/${requestId}/reply`)
      .set("Cookie", association)
      .send({
        opId: newOpId(),
        version: r.updatedAt,
        values: { income: 0, socialSecurity: false },
        note: "لا يوجد دخل",
      });
    expect(reply.status).toBe(201);
    expect((await get(second.id)).income).toBeNull();
    const accepted = await http()
      .post(`${url}/information/${requestId}/resolve`)
      .set("Cookie", admin)
      .send({ opId: newOpId(), version: reply.body.updatedAt, accept: true });
    expect(accepted.status).toBe(201);
    expect(await get(second.id)).toMatchObject({
      income: 0,
      socialSecurity: false,
    });
    expect(
      await prisma.beneficiary.count({
        where: { associationId: fx.associationAId },
      }),
    ).toBe(2);
  });
  it("blocks legacy review while information is pending, cancels without changing data, and suppresses stale mail", async () => {
    const r = (await get(family.id)).informationRequests.find(
      (r: any) => r.status === "OPEN",
    );
    const old = await http()
      .post(`/api/v1/beneficiaries/${family.id}/review`)
      .set("Cookie", admin)
      .send({
        opId: newOpId(),
        beneficiaryDecision: "APPROVED",
        needDecisions: [],
      });
    expect(old.status).toBe(409);
    expect(old.body.error.code).toBe("BENEFICIARY_INFORMATION_PENDING");
    const cancel = await http()
      .post(`${url}/information/${r.id}/resolve`)
      .set("Cookie", admin)
      .send({
        opId: newOpId(),
        version: r.updatedAt,
        accept: false,
        note: "إغلاق اختباري",
      });
    expect(cancel.status).toBe(201);
    const event = await prisma.outboxEvent.findUniqueOrThrow({
      where: { id: r.emailEventId },
    });
    const delivery = decryptEmailDelivery(
      event.id,
      event.payload as unknown as EmailDeliveryPayload,
    );
    await expect(
      (app.get(NotificationsService) as any).validateEmailState(
        prisma,
        delivery,
        event.id,
      ),
    ).rejects.toThrow("MAIL_STATE_INVALID");
    expect(fakeEmail.lastSecurityAlert).toBeNull();
  });
  it("uses per-item versions in bulk, saves good rows and does not repeat successful decisions", async () => {
    const a = await get(family.id),
      b = await get(second.id);
    const res = await http()
      .post(`${url}/bulk-review`)
      .set("Cookie", admin)
      .send({
        items: [
          {
            id: a.id,
            version: "2020-01-01T00:00:00.000Z",
            opId: newOpId(),
            needs: [],
          },
          {
            id: b.id,
            version: b.updatedAt,
            opId: newOpId(),
            familyDecision: "APPROVED",
            needs: [],
          },
        ],
      });
    expect(res.status).toBe(201);
    expect(res.body.results.map((r: any) => r.ok)).toEqual([false, true]);
    expect(res.body.results[0].error.code).toBe("BENEFICIARY_VERSION_CONFLICT");
  });
  it("simulates under an overall cap without writing allocation or decisions", async () => {
    const before = await prisma.deviceAllocation.count(),
      r = await http()
        .post(`${url}/planning/simulate`)
        .set("Cookie", admin)
        .send({
          limits: { total: 0, regions: {}, associations: {}, devices: {} },
        });
    expect(r.status).toBe(201);
    expect(r.body.used.total).toBe(0);
    expect(r.body.simulationOnly).toBe(true);
    expect(await prisma.deviceAllocation.count()).toBe(before);
    const plan = await http().get(`${url}/planning`).set("Cookie", admin);
    expect(plan.status).toBe(200);
    const save = await http()
      .put(`${url}/planning`)
      .set("Cookie", admin)
      .send({
        limits: { total: 1000, regions: {}, associations: {}, devices: {} },
        version: plan.body.version,
        opId: newOpId(),
      });
    expect(save.status).toBe(200);
  });
  it("delivers a neutral information notice through the existing fake outbox transport and exposes its accepted status", async () => {
    const b = await get(second.id),
      r = await http()
        .post(`${url}/information`)
        .set("Cookie", admin)
        .send({
          opId: newOpId(),
          targets: [{ id: b.id, version: b.updatedAt }],
          items: [
            { field: "income", kind: "VERIFY", reason: "تأكيد مصدر الدخل" },
          ],
        });
    expect(r.status).toBe(201);
    await app.get(NotificationsService).processOutbox();
    expect(fakeEmail.lastSecurityAlert).toMatchObject({
      to: "workspace-test@example.org",
      subject: "استكمال بيانات المستفيدين — مشروع الأجهزة الكهربائية",
    });
    expect(fakeEmail.lastSecurityAlert!.body).not.toContain("تأكيد مصدر الدخل");
    const d = await get(second.id),
      info = d.informationRequests.find(
        (q: any) => q.id === r.body.requestIds[0],
      );
    expect(info.emailStatus).toBe("SMTP_ACCEPTED");
    expect(
      (
        await http()
          .get(`${url}/${family.id}/next?requestedCount=1`)
          .set("Cookie", admin)
      ).body.id,
    ).toBeNull();
    expect(
      (
        await http()
          .post(`${url}/information/${info.id}/resolve`)
          .set("Cookie", admin)
          .send({
            opId: newOpId(),
            version: info.updatedAt,
            accept: false,
            note: "انتهاء اختبار الإرسال",
          })
      ).status,
    ).toBe(201);
  });
  it("rejects writes in safe read-only fallback", async () => {
    process.env.BENEFICIARY_WORKSPACE_READ_ONLY = "true";
    try {
      const b = await get(second.id);
      expect(
        (
          await http()
            .post(`${url}/${b.id}/review`)
            .set("Cookie", admin)
            .send({ opId: newOpId(), version: b.updatedAt, needs: [] })
        ).status,
      ).toBe(503);
    } finally {
      delete process.env.BENEFICIARY_WORKSPACE_READ_ONLY;
    }
  });
  it("allows only one winner when two reviewers submit the same version", async () => {
    const b = await get(family.id),
      need = b.needs.find((n: any) => n.decisionStatus === "PENDING");
    const responses = await Promise.all(
      [1, 2].map(() =>
        http()
          .post(`${url}/${b.id}/review`)
          .set("Cookie", admin)
          .send({
            opId: newOpId(),
            version: b.updatedAt,
            needs: [{ needId: need.id, decision: "APPROVED" }],
          }),
      ),
    );
    expect(responses.map((r) => r.status).sort()).toEqual([201, 409]);
  });
  it('applies a region cap consistently with association grouping even for a historical mismatched household region', async()=>{
    await prisma.beneficiary.update({where:{id:family.id},data:{region:'القصيم'}});
    try{const result=await http().post(`${url}/planning/simulate`).set('Cookie',admin).send({limits:{total:1000,regions:{الرياض:0},associations:{},devices:{}}});expect(result.status).toBe(201);expect(result.body.used.total).toBe(0);}finally{await prisma.beneficiary.update({where:{id:family.id},data:{region:'الرياض'}});}
  });
  it("never moves save-and-next into a different association and keeps query filters", async () => {
    const response = await http()
      .get(`${url}/${family.id}/next?requestedCount=1`)
      .set("Cookie", admin);
    expect(response.status).toBe(200);
    expect(response.body.id).toBe(second.id);
    expect(
      (
        await http()
          .get(`${url}/${family.id}/next?requestedCount=3`)
          .set("Cookie", admin)
      ).body.id,
    ).toBeNull();
    const metadata = await prisma.$queryRaw<
      { rls: boolean; anonymous: boolean; authenticated: boolean }[]
    >`SELECT c.relrowsecurity rls,has_table_privilege('anon','beneficiary_information_requests','SELECT') anonymous,has_table_privilege('authenticated','beneficiary_information_requests','SELECT') authenticated FROM pg_class c WHERE c.oid='beneficiary_information_requests'::regclass`;
    expect(metadata[0]).toEqual({
      rls: true,
      anonymous: false,
      authenticated: false,
    });
  });
  it("enforces a restricted admin region on lists, counters, direct detail, writes and legacy detail", async () => {
    const actor = await prisma.account.create({
      data: {
        publicCode: "E2E-WORK-STAFF",
        name: "موظف نطاق اختبار",
        email: "workspace-staff@example.org",
        role: "ADMIN",
        adminFullAccess: false,
        adminPermissions: ["beneficiaries.read", "beneficiaries.manage"],
        adminApplicationScope: { regionCodes: ["0002"] },
      },
    });
    await prisma.authCredential.create({
      data: {
        accountId: actor.id,
        type: "EMAIL_PASSWORD",
        identifier: actor.email!,
        secretHash: await hashSecret("WorkspaceTestPass123!"),
      },
    });
    try {
      const cookie = await loginAs(app, actor.email!, "WorkspaceTestPass123!");
      expect((await http().get(url).set("Cookie", cookie)).body.total).toBe(0);
      expect(
        (await http().get(`${url}/overview`).set("Cookie", cookie)).body.totals
          .families,
      ).toBe(0);
      expect(
        (await http().get(`${url}/${family.id}`).set("Cookie", cookie)).status,
      ).toBe(404);
      expect(
        (
          await http()
            .get(`/api/v1/beneficiaries/${family.id}`)
            .set("Cookie", cookie)
        ).status,
      ).toBe(404);
      const b = await get(second.id);
      expect(
        (
          await http()
            .post(`${url}/${b.id}/review`)
            .set("Cookie", cookie)
            .send({ opId: newOpId(), version: b.updatedAt, needs: [] })
        ).status,
      ).toBe(403);
      await prisma.account.update({
        where: { id: actor.id },
        data: { adminPermissions: [] },
      });
      expect((await http().get(url).set("Cookie", cookie)).status).toBe(403);
    } finally {
      await prisma.idempotencyKey.deleteMany({
        where: { accountId: actor.id },
      });
      await prisma.auditLog.deleteMany({ where: { actorAccountId: actor.id } });
      await prisma.authSession.deleteMany({ where: { accountId: actor.id } });
      await prisma.authCredential.deleteMany({
        where: { accountId: actor.id },
      });
      await prisma.account.delete({ where: { id: actor.id } });
    }
  });
  it("measures equal local conditions with 50 and 1200 families / 3600 needs", async () => {
    await cleanNode3State();
    const associationIds: string[] = [],
      beneficiaryIds: string[] = [];
    for (let a = 0; a < 24; a++) {
      const assoc = await prisma.association.create({
        data: {
          publicCode: `E2E-PERF-${a}`,
          name: `اختبار أداء ${a}`,
          email: 'performance@example.org',
          category: "جمعية خيرية",
          region: "الرياض",
          city: "الرياض",
          status: "ACTIVE",
        },
      });
      associationIds.push(assoc.id);
      const families = Array.from({ length: 50 }, (_, i) => ({
        id: randomUUID(),
        publicCode: `E2E-PERF-B-${a}-${i}`,
        associationId: assoc.id,
        name: `أسرة وهمية ${a}-${i}`,
        region: "الرياض",
        city: "الرياض",
        district: "حي اختبار",
        phone: `05${String(a * 50 + i).padStart(8, "0")}`,
        familyCount: 5,
        socialSecurity: false,
        maritalStatus: "أرملة",
        income: 0,
        needPriority: i + 1,
        threeDeviceReason: "اختبار أداء وهمي",
      }));
      await prisma.beneficiary.createMany({ data: families });
      beneficiaryIds.push(...families.map((b) => b.id));
      await prisma.beneficiaryNeed.createMany({
        data: families.flatMap((b, i) =>
          Object.values(DeviceType).map((deviceType, n) => ({
            publicCode: `E2E-PERF-N-${a}-${i}-${n}`,
            beneficiaryId: b.id,
            associationId: assoc.id,
            deviceType,
          })),
        ),
      });
    }
    const measurements: any[] = [];
    try {
      for (const count of [50, 1200]) {
        const scope = count === 50 ? `associationId=${associationIds[0]}&` : "";
        for (const endpoint of [
          `/api/v1/beneficiaries?${scope}pageSize=25`,
          `${url}?${scope}pageSize=25`,
          `${url}/overview?${scope}`,
        ]) {
          const samples: number[] = [],
            sizes: number[] = [];
          for (let i = 0; i < 9; i++) {
            const start = performance.now(),
              r = await http().get(endpoint).set("Cookie", admin);
            expect(r.status).toBe(200);
            const duration = performance.now() - start;
            if (i > 1) {
              samples.push(duration);
              sizes.push(Buffer.byteLength(JSON.stringify(r.body)));
            }
          }
          samples.sort((a, b) => a - b);
          measurements.push({
            families: count,
            endpoint,
            medianMs: Math.round(samples[3]),
            p95Ms: Math.round(samples[6]),
            bytes: Math.max(...sizes),
          });
        }
      }
      const overview = await http().get(`${url}/overview`).set("Cookie", admin);
      expect(overview.body.totals).toMatchObject({
        families: 1200,
        requested: 3600,
        requestedFamilies: [0, 0, 0, 1200],
      });
      const reviewPage=await http().get(`${url}?associationId=${associationIds[1]}&pageSize=50`).set('Cookie',admin),reviewStarted=performance.now();
      const reviewed=await http().post(`${url}/bulk-review`).set('Cookie',admin).send({items:reviewPage.body.items.map((b:any)=>({id:b.id,version:b.updatedAt,opId:newOpId(),familyDecision:'APPROVED',needs:b.needs.map((n:any)=>({needId:n.id,decision:'APPROVED'}))}))});
      expect(reviewed.status).toBe(201);expect(reviewed.body.results.filter((r:any)=>r.ok)).toHaveLength(50);
      expect(await prisma.beneficiaryNeed.count({where:{associationId:associationIds[1],decisionStatus:'APPROVED'}})).toBe(150);
      measurements.push({families:50,endpoint:'bulk-review-50-families-150-needs-no-allocation',durationMs:Math.round(performance.now()-reviewStarted)});
      const page = await http()
        .get(`${url}?associationId=${associationIds[0]}&pageSize=50`)
        .set("Cookie", admin);
      const batchStarted = performance.now();
      const batch = await http()
        .post(`${url}/information`)
        .set("Cookie", admin)
        .send({
          opId: newOpId(),
          targets: page.body.items.map((b: any) => ({
            id: b.id,
            version: b.updatedAt,
          })),
          items: [
            {
              field: "income",
              kind: "VERIFY",
              reason: "اختبار أداء الاستكمال فقط",
            },
          ],
        });
      expect(batch.status).toBe(201);
      expect(batch.body.requestIds).toHaveLength(50);
      expect(batch.body.emailCount).toBe(1);
      measurements.push({
        families: 50,
        endpoint: "information-request-batch-50-one-email",
        durationMs: Math.round(performance.now() - batchStarted),
      });
      if (process.env.BENEFICIARY_PERF_OUTPUT)
        writeFileSync(
          process.env.BENEFICIARY_PERF_OUTPUT,
          JSON.stringify(
            {
              environment:
                "isolated-local-postgres; warm same process; HTTP supertest; no production timing claim",
              measurements,
            },
            null,
            2,
          ),
        );
      console.log("BENEFICIARY_WORKSPACE_PERF", JSON.stringify(measurements));
    } finally {
      await prisma.beneficiaryInformationRequest.deleteMany({
        where: { associationId: { in: associationIds } },
      });
      await prisma.auditLog.deleteMany({
        where: { associationId: { in: associationIds } },
      });
      await prisma.beneficiaryNeed.deleteMany({
        where: { beneficiaryId: { in: beneficiaryIds } },
      });
      await prisma.beneficiary.deleteMany({
        where: { id: { in: beneficiaryIds } },
      });
      await prisma.association.deleteMany({
        where: { id: { in: associationIds } },
      });
    }
  });
});
