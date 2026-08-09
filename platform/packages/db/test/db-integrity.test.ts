/**
 * NODE-0.1 — اختبارات تكامل حقيقية ضد PostgreSQL فعلي (لا mocks).
 * تتطلب DATABASE_URL صالحًا يشير لقاعدة بيانات مُطبَّق عليها migration
 * الأولى (`prisma migrate deploy`) — تُشغَّل هذه الاختبارات في CI ضد
 * خدمة PostgreSQL حقيقية (راجع .github/workflows/platform-ci.yml)، أو
 * محليًا بعد `docker compose up -d postgres` + `migrate:deploy`.
 *
 * تغطي بالضبط الحالات الاثنتي عشرة المطلوبة في Patch NODE-0.1، بالإضافة
 * إلى تحقّق مباشر من إزالة الربط المزدوج على DeviceUnit.
 */
import { PrismaClient, Prisma } from '../generated/client';

const prisma = new PrismaClient();

function suffix(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

async function makeAssociation(tag: string) {
  const s = suffix();
  return prisma.association.create({
    data: {
      publicCode: `ASC-${tag}-${s}`,
      name: `جمعية اختبار ${tag} ${s}`,
      category: 'جمعية خيرية',
      region: 'الرياض',
      city: 'الرياض',
      phones: ['0500000000'],
    },
  });
}

async function makeBeneficiary(associationId: string, tag: string) {
  const s = suffix();
  return prisma.beneficiary.create({
    data: {
      publicCode: `BEN-${tag}-${s}`,
      associationId,
      name: `مستفيد ${tag} ${s}`,
      region: 'الرياض',
      city: 'الرياض',
      phone: `05${s}`.slice(0, 10),
      familyCount: 2,
      maritalStatus: 'أرملة',
    },
  });
}

async function makeBeneficiaryNeed(beneficiaryId: string, associationId: string, tag: string) {
  const s = suffix();
  return prisma.beneficiaryNeed.create({
    data: {
      publicCode: `NED-${tag}-${s}`,
      beneficiaryId,
      associationId,
      deviceType: 'REFRIGERATOR',
    },
  });
}

async function makeDeviceUnit(associationId: string, tag: string, overrides: Partial<Prisma.DeviceUnitUncheckedCreateInput> = {}) {
  const s = suffix();
  return prisma.deviceUnit.create({
    data: {
      publicCode: `DEV-${tag}-${s}`,
      associationId,
      deviceType: 'REFRIGERATOR',
      currentLocationType: 'WAREHOUSE',
      currentLocationRef: null,
      ...overrides,
    },
  });
}

afterAll(async () => {
  await prisma.$disconnect();
});

describe('NODE-0.1 — Source of Truth الوحيد للتخصيص', () => {
  it('11) DeviceUnit لا يملك أي حقل beneficiaryNeedId/beneficiaryNeed (لا ربط مزدوج)', () => {
    const deviceUnitModel = Prisma.dmmf.datamodel.models.find(m => m.name === 'DeviceUnit');
    expect(deviceUnitModel).toBeDefined();
    const fieldNames = (deviceUnitModel?.fields ?? []).map(f => f.name);
    expect(fieldNames).not.toContain('beneficiaryNeedId');
    expect(fieldNames).not.toContain('beneficiaryNeed');
    expect(fieldNames).not.toContain('beneficiaryId');
  });
});

describe('NODE-0.1 — Tenant / Association Integrity (composite FKs)', () => {
  it('1) BeneficiaryNeed عبر الجمعيات (cross-association) يُرفض', async () => {
    const assocA = await makeAssociation('A1');
    const assocB = await makeAssociation('B1');
    const beneficiaryOfA = await makeBeneficiary(assocA.id, 'A1');

    await expect(
      prisma.beneficiaryNeed.create({
        data: {
          publicCode: `NED-XT-${suffix()}`,
          beneficiaryId: beneficiaryOfA.id,
          associationId: assocB.id, // تعمّد: association_id لا يطابق association_id الفعلي للمستفيد
          deviceType: 'OVEN',
        },
      }),
    ).rejects.toThrow();
  });

  it('2) DeviceAllocation عبر الجمعيات يُرفض (device/need/beneficiary من جمعية أخرى)', async () => {
    const assocA = await makeAssociation('A2');
    const assocB = await makeAssociation('B2');
    const beneficiaryOfA = await makeBeneficiary(assocA.id, 'A2');
    const needOfA = await makeBeneficiaryNeed(beneficiaryOfA.id, assocA.id, 'A2');
    const deviceOfA = await makeDeviceUnit(assocA.id, 'A2');

    // association_id مزوَّر لا يطابق association_id الفعلي للجهاز/الاحتياج/المستفيد
    await expect(
      prisma.deviceAllocation.create({
        data: {
          deviceId: deviceOfA.id,
          beneficiaryNeedId: needOfA.id,
          beneficiaryId: beneficiaryOfA.id,
          associationId: assocB.id,
        },
      }),
    ).rejects.toThrow();
  });

  it('3) DeliveryMission عبر الجمعيات يُرفض', async () => {
    const assocA = await makeAssociation('A3');
    const assocB = await makeAssociation('B3');
    const beneficiaryOfA = await makeBeneficiary(assocA.id, 'A3');

    await expect(
      prisma.deliveryMission.create({
        data: {
          publicCode: `MIS-XT-${suffix()}`,
          beneficiaryId: beneficiaryOfA.id,
          associationId: assocB.id,
        },
      }),
    ).rejects.toThrow();
  });

  it('4) DeviceMovement عبر الجمعيات يُرفض', async () => {
    const assocA = await makeAssociation('A4');
    const assocB = await makeAssociation('B4');
    const deviceOfA = await makeDeviceUnit(assocA.id, 'A4');

    await expect(
      prisma.deviceMovement.create({
        data: {
          deviceId: deviceOfA.id,
          associationId: assocB.id,
          toLocationType: 'WAREHOUSE',
          reason: 'اختبار عزل الجمعيات',
        },
      }),
    ).rejects.toThrow();
  });

  it('يقبل الإدراج الصحيح عندما association_id متطابق فعليًا (تأكيد أن القيد لا يرفض الحالة السليمة)', async () => {
    const assocA = await makeAssociation('OK');
    const beneficiaryOfA = await makeBeneficiary(assocA.id, 'OK');
    const needOfA = await makeBeneficiaryNeed(beneficiaryOfA.id, assocA.id, 'OK');
    const deviceOfA = await makeDeviceUnit(assocA.id, 'OK');

    await expect(
      prisma.deviceAllocation.create({
        data: {
          deviceId: deviceOfA.id,
          beneficiaryNeedId: needOfA.id,
          beneficiaryId: beneficiaryOfA.id,
          associationId: assocA.id,
        },
      }),
    ).resolves.toBeDefined();

    await expect(
      prisma.deliveryMission.create({
        data: { publicCode: `MIS-OK-${suffix()}`, beneficiaryId: beneficiaryOfA.id, associationId: assocA.id },
      }),
    ).resolves.toBeDefined();

    await expect(
      prisma.deviceMovement.create({
        data: { deviceId: deviceOfA.id, associationId: assocA.id, toLocationType: 'WAREHOUSE', reason: 'تحقّق سليم' },
      }),
    ).resolves.toBeDefined();
  });
});

describe('NODE-0.1 — Reference Values uniqueness', () => {
  it('5) تكرار جذر (parentId IS NULL) بنفس (type, value) يُرفض', async () => {
    const s = suffix();
    await prisma.referenceValue.create({ data: { type: 'REGION', value: `منطقة-${s}` } });
    await expect(
      prisma.referenceValue.create({ data: { type: 'REGION', value: `منطقة-${s}` } }),
    ).rejects.toThrow();
  });

  it('6) تكرار child بنفس (type, value) تحت نفس parent يُرفض', async () => {
    const s = suffix();
    const parent = await prisma.referenceValue.create({ data: { type: 'REGION', value: `منطقة-أب-${s}` } });
    await prisma.referenceValue.create({ data: { type: 'CITY', value: `مدينة-${s}`, parentId: parent.id } });
    await expect(
      prisma.referenceValue.create({ data: { type: 'CITY', value: `مدينة-${s}`, parentId: parent.id } }),
    ).rejects.toThrow();
  });

  it('نفس child (نفس type/value) تحت أبوين مختلفين مسموح (متوافق مع النموذج الهرمي)', async () => {
    const s = suffix();
    const parent1 = await prisma.referenceValue.create({ data: { type: 'REGION', value: `منطقة-أب1-${s}` } });
    const parent2 = await prisma.referenceValue.create({ data: { type: 'REGION', value: `منطقة-أب2-${s}` } });
    await expect(
      prisma.referenceValue.create({ data: { type: 'CITY', value: `مدينة-مشتركة-${s}`, parentId: parent1.id } }),
    ).resolves.toBeDefined();
    await expect(
      prisma.referenceValue.create({ data: { type: 'CITY', value: `مدينة-مشتركة-${s}`, parentId: parent2.id } }),
    ).resolves.toBeDefined();
  });
});

describe('NODE-0.1 — Active DeviceAllocation uniqueness', () => {
  it('7) تخصيص ACTIVE ثانٍ لنفس الجهاز يُرفض', async () => {
    const assoc = await makeAssociation('AL7');
    const beneficiary = await makeBeneficiary(assoc.id, 'AL7');
    const need1 = await makeBeneficiaryNeed(beneficiary.id, assoc.id, 'AL7a');
    const beneficiary2 = await makeBeneficiary(assoc.id, 'AL7b');
    const need2 = await prisma.beneficiaryNeed.create({
      data: { publicCode: `NED-AL7b-${suffix()}`, beneficiaryId: beneficiary2.id, associationId: assoc.id, deviceType: 'OVEN' },
    });
    const device = await makeDeviceUnit(assoc.id, 'AL7');

    await prisma.deviceAllocation.create({
      data: { deviceId: device.id, beneficiaryNeedId: need1.id, beneficiaryId: beneficiary.id, associationId: assoc.id },
    });

    await expect(
      prisma.deviceAllocation.create({
        data: { deviceId: device.id, beneficiaryNeedId: need2.id, beneficiaryId: beneficiary2.id, associationId: assoc.id },
      }),
    ).rejects.toThrow();
  });

  it('8) تخصيص ACTIVE ثانٍ لنفس الاحتياج (بجهاز مختلف) يُرفض', async () => {
    const assoc = await makeAssociation('AL8');
    const beneficiary = await makeBeneficiary(assoc.id, 'AL8');
    const need = await makeBeneficiaryNeed(beneficiary.id, assoc.id, 'AL8');
    const device1 = await makeDeviceUnit(assoc.id, 'AL8a');
    const device2 = await makeDeviceUnit(assoc.id, 'AL8b');

    await prisma.deviceAllocation.create({
      data: { deviceId: device1.id, beneficiaryNeedId: need.id, beneficiaryId: beneficiary.id, associationId: assoc.id },
    });

    await expect(
      prisma.deviceAllocation.create({
        data: { deviceId: device2.id, beneficiaryNeedId: need.id, beneficiaryId: beneficiary.id, associationId: assoc.id },
      }),
    ).rejects.toThrow();
  });

  it('تخصيص RELEASED لا يمنع تخصيصًا ACTIVE جديدًا لنفس الجهاز (الفهرس جزئي على ACTIVE فقط)', async () => {
    const assoc = await makeAssociation('AL9');
    const beneficiary = await makeBeneficiary(assoc.id, 'AL9');
    const need1 = await makeBeneficiaryNeed(beneficiary.id, assoc.id, 'AL9a');
    const beneficiary2 = await makeBeneficiary(assoc.id, 'AL9b');
    const need2 = await prisma.beneficiaryNeed.create({
      data: { publicCode: `NED-AL9b-${suffix()}`, beneficiaryId: beneficiary2.id, associationId: assoc.id, deviceType: 'OVEN' },
    });
    const device = await makeDeviceUnit(assoc.id, 'AL9');

    const first = await prisma.deviceAllocation.create({
      data: { deviceId: device.id, beneficiaryNeedId: need1.id, beneficiaryId: beneficiary.id, associationId: assoc.id },
    });
    await prisma.deviceAllocation.update({ where: { id: first.id }, data: { status: 'RELEASED', releasedAt: new Date() } });

    await expect(
      prisma.deviceAllocation.create({
        data: { deviceId: device.id, beneficiaryNeedId: need2.id, beneficiaryId: beneficiary2.id, associationId: assoc.id },
      }),
    ).resolves.toBeDefined();
  });
});

describe('NODE-0.1 — Device Type integrity (enum فقط، لا نص حر للسجلات الجديدة)', () => {
  it('9) ReceiptItem.device_type محصور بالـenum — قيمة خارج DeviceType تُرفض من DB', async () => {
    const assoc = await makeAssociation('RI9');
    const receiptBatch = await prisma.receiptBatch.create({
      data: {
        publicCode: `RCB-${suffix()}`,
        associationId: assoc.id,
        supplierName: 'مورد اختبار',
        createdById: (await prisma.account.create({
          data: { publicCode: `MND-${suffix()}`, name: 'مدير اختبار', role: 'ADMIN' },
        })).id,
      },
    });

    await expect(
      prisma.$executeRaw`INSERT INTO receipt_items (id, public_code, receipt_batch_id, device_type, sent_qty, created_at, updated_at)
        VALUES (uuidv7(), ${'RCI-' + suffix()}, ${receiptBatch.id}::uuid, 'NOT_A_REAL_DEVICE_TYPE', 1, now(), now())`,
    ).rejects.toThrow();
  });

  it('10) DeviceUnit.device_type محصور بالـenum — قيمة خارج DeviceType تُرفض من DB', async () => {
    const assoc = await makeAssociation('DU10');

    await expect(
      prisma.$executeRaw`INSERT INTO device_units (id, public_code, association_id, device_type, current_location_type, created_at, updated_at)
        VALUES (uuidv7(), ${'DEV-' + suffix()}, ${assoc.id}::uuid, 'NOT_A_REAL_DEVICE_TYPE', 'WAREHOUSE', now(), now())`,
    ).rejects.toThrow();
  });

  it('device_type وlegacy_device_type_text كلاهما NULL معًا يُرفض (على الأقل أحدهما مطلوب)', async () => {
    const assoc = await makeAssociation('DU10b');
    await expect(
      prisma.deviceUnit.create({
        data: {
          publicCode: `DEV-${suffix()}`,
          associationId: assoc.id,
          currentLocationType: 'WAREHOUSE',
          // deviceType وlegacyDeviceTypeText كلاهما غير محدَّدين (NULL)
        },
      }),
    ).rejects.toThrow();
  });
});

describe('NODE-0.1 — Device location integrity', () => {
  it('12) WAREHOUSE بمرجع موقع غير فارغ يُرفض (الموقع معروف من association_id نفسه، لا مرجع إضافي)', async () => {
    const assoc = await makeAssociation('LOC12a');
    const someAccount = await prisma.account.create({ data: { publicCode: `MND-${suffix()}`, name: 'حساب اختبار', role: 'ADMIN' } });

    await expect(
      makeDeviceUnit(assoc.id, 'LOC12a', { currentLocationType: 'WAREHOUSE', currentLocationRef: someAccount.id }),
    ).rejects.toThrow();
  });

  it('12) DELEGATE بلا مرجع (currentLocationRef فارغ) يُرفض', async () => {
    const assoc = await makeAssociation('LOC12b');
    await expect(
      makeDeviceUnit(assoc.id, 'LOC12b', { currentLocationType: 'DELEGATE', currentLocationRef: null }),
    ).rejects.toThrow();
  });

  it('12) BENEFICIARY بلا مرجع يُرفض', async () => {
    const assoc = await makeAssociation('LOC12c');
    await expect(
      makeDeviceUnit(assoc.id, 'LOC12c', { currentLocationType: 'BENEFICIARY', currentLocationRef: null }),
    ).rejects.toThrow();
  });

  it('12) DAMAGED_HOLDING بمرجع غير فارغ يُرفض', async () => {
    const assoc = await makeAssociation('LOC12d');
    const someAccount = await prisma.account.create({ data: { publicCode: `MND-${suffix()}`, name: 'حساب اختبار', role: 'ADMIN' } });
    await expect(
      makeDeviceUnit(assoc.id, 'LOC12d', { currentLocationType: 'DAMAGED_HOLDING', currentLocationRef: someAccount.id }),
    ).rejects.toThrow();
  });

  it('DELEGATE/BENEFICIARY بمرجع صالح، وWAREHOUSE/DAMAGED_HOLDING بلا مرجع — الحالات السليمة تُقبَل', async () => {
    const assoc = await makeAssociation('LOC12ok');
    const beneficiary = await makeBeneficiary(assoc.id, 'LOC12ok');
    const delegateAccount = await prisma.account.create({
      data: { publicCode: `MND-${suffix()}`, name: 'مندوب اختبار', role: 'DELEGATE', associationId: assoc.id },
    });

    await expect(makeDeviceUnit(assoc.id, 'LOC12ok-wh', { currentLocationType: 'WAREHOUSE', currentLocationRef: null })).resolves.toBeDefined();
    await expect(makeDeviceUnit(assoc.id, 'LOC12ok-dh', { currentLocationType: 'DAMAGED_HOLDING', currentLocationRef: null })).resolves.toBeDefined();
    await expect(makeDeviceUnit(assoc.id, 'LOC12ok-dl', { currentLocationType: 'DELEGATE', currentLocationRef: delegateAccount.id })).resolves.toBeDefined();
    await expect(makeDeviceUnit(assoc.id, 'LOC12ok-bn', { currentLocationType: 'BENEFICIARY', currentLocationRef: beneficiary.id })).resolves.toBeDefined();
  });
});
