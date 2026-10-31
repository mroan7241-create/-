import {
  parseInformationItems,
  parseInformationResponse,
  simulateBeneficiaries,
  assertFreshVersion,
} from "./beneficiary-workspace.rules";

describe("beneficiary review rules", () => {
  it("distinguishes zero income and false social security from missing input", () => {
    const fields = parseInformationItems([
      { field: "income", kind: "VERIFY", reason: "تأكيد الدخل" },
      { field: "socialSecurity", kind: "VERIFY", reason: "تأكيد الضمان" },
    ]);
    expect(
      parseInformationResponse(fields, { income: 0, socialSecurity: false }),
    ).toEqual({ income: 0, socialSecurity: false });
    expect(() =>
      parseInformationResponse(fields, { income: null, socialSecurity: false }),
    ).toThrow();
    expect(() => parseInformationResponse(fields, { income: 0 })).toThrow();
    expect(() =>
      parseInformationResponse(fields, {
        income: 0,
        socialSecurity: false,
        name: "حقل لم يطلب",
      }),
    ).toThrow();
    expect(
      parseInformationResponse(fields, { income: 0.29, socialSecurity: true })
        .income,
    ).toBe(0.29);
    expect(() =>
      parseInformationResponse(fields, { income: 0.291, socialSecurity: true }),
    ).toThrow();
  });
  it("rejects repeated or unknown field keys and requires an explanation", () => {
    expect(() =>
      parseInformationItems([{ field: "income", kind: "VERIFY", reason: "" }]),
    ).toThrow();
    expect(() =>
      parseInformationItems([
        { field: "role", kind: "VERIFY", reason: "غير مسموح" },
      ]),
    ).toThrow();
    expect(() =>
      parseInformationItems([
        { field: "income", kind: "VERIFY", reason: "أ" },
        { field: "income", kind: "MISSING", reason: "ب" },
      ]),
    ).toThrow();
  });
  it("rejects stale versions instead of silently overwriting", () => {
    expect(() =>
      assertFreshVersion(
        new Date("2026-10-31T00:00:01Z"),
        "2026-10-31T00:00:00.000Z",
      ),
    ).toThrow();
  });
  it("caps overall, region, association and type without changing submitted families", () => {
    const families = [
      {
        id: "a",
        associationId: "a",
        region: "r",
        needPriority: 1,
        devices: ["OVEN", "REFRIGERATOR"],
      },
      {
        id: "b",
        associationId: "b",
        region: "r",
        needPriority: 1,
        devices: ["OVEN"],
      },
      {
        id: "c",
        associationId: "a",
        region: "r",
        needPriority: 2,
        devices: ["OVEN"],
      },
    ];
    const copy = JSON.stringify(families),
      result = simulateBeneficiaries(families, {
        total: 2,
        regions: { r: 2 },
        associations: { a: 1, b: 1 },
        devices: { OVEN: 1 },
        allowPartial: true,
      });
    expect(result.used.total).toBeLessThanOrEqual(2);
    expect(result.used.associations.a).toBeLessThanOrEqual(1);
    expect(result.used.devices.OVEN).toBe(1);
    expect(JSON.stringify(families)).toBe(copy);
  });
  it("does not partially propose a household unless explicitly selected", () => {
    const families = [
      {
        id: "a",
        associationId: "a",
        region: "r",
        needPriority: 1,
        devices: ["OVEN", "REFRIGERATOR"],
      },
    ];
    expect(
      simulateBeneficiaries(families, {
        total: 1,
        regions: {},
        associations: {},
        devices: {},
      }).selected,
    ).toHaveLength(0);
    expect(
      simulateBeneficiaries(families, {
        total: 1,
        regions: {},
        associations: {},
        devices: {},
        allowPartial: true,
      }).selected[0].devices,
    ).toHaveLength(1);
  });
});
