import request from 'supertest';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import { DeviceType, prisma } from '@alzad/db';
import { AppModule } from '../src/app.module';
import { HttpExceptionFilter } from '../src/common/http-exception.filter';
import { EmailService } from '../src/modules/auth/email/email.service';
import { FakeEmailService } from '../src/modules/auth/email/fake-email.service';
import { assertE2eNotTargetingProduction } from './utils/production-target.guard';
import { seedTestFixtures } from './utils/fixtures';
import { loginAs, uniqueSuffix } from './utils/node2-fixtures';

describe('central Zaad stock — real HTTP and isolated PostgreSQL', () => {
  let app: INestApplication;
  let adminCookie: string;
  let associationCookie: string;
  let associationId: string;
  const orderIds: string[] = [];
  const reference = `E2E-central-${uniqueSuffix()}`;
  const op = () => `central-${uniqueSuffix()}`;

  beforeAll(async () => {
    assertE2eNotTargetingProduction();
    // Isolated E2E database only: remove leftovers from a previously aborted
    // run of this dedicated device type before exercising exact balances.
    await prisma.centralStockDispatch.deleteMany({ where: { deviceType: DeviceType.OVEN } });
    await prisma.centralStockReceipt.deleteMany({ where: { deviceType: DeviceType.OVEN } });
    await prisma.centralStockBalance.deleteMany({ where: { deviceType: DeviceType.OVEN } });
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(EmailService).useClass(FakeEmailService).compile();
    app = moduleRef.createNestApplication();
    app.use(cookieParser());
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();
    const fixture = await seedTestFixtures();
    associationId = fixture.activeAssociationId;
    adminCookie = await loginAs(app, fixture.adminEmail, fixture.adminPassword);
    associationCookie = await loginAs(app, fixture.assocEmail, fixture.assocPassword);
  }, 60000);

  afterAll(async () => {
    assertE2eNotTargetingProduction();
    const shipments = await prisma.shipment.findMany({ where: { purchaseOrderId: { in: orderIds } }, select: { id: true } });
    const shipmentIds = shipments.map((item) => item.id);
    await prisma.centralStockDispatch.deleteMany({ where: { shipmentId: { in: shipmentIds } } });
    await prisma.shipmentItem.deleteMany({ where: { shipmentId: { in: shipmentIds } } });
    await prisma.shipment.deleteMany({ where: { id: { in: shipmentIds } } });
    await prisma.purchaseOrderItem.deleteMany({ where: { purchaseOrderId: { in: orderIds } } });
    await prisma.purchaseOrder.deleteMany({ where: { id: { in: orderIds } } });
    await prisma.centralStockReceipt.deleteMany({ where: { reference } });
    await prisma.centralStockBalance.deleteMany({ where: { deviceType: DeviceType.OVEN } });
    await app?.close();
  });

  it('enforces admin-only contract/receipt, fixed availability, idempotency and safe cancellation', async () => {
    const http = () => request(app.getHttpServer());
    expect((await http().get('/api/v1/central-stock').set('Cookie', associationCookie)).status).toBe(403);
    const contract = { deviceType: DeviceType.OVEN, contractedQty: 3, opId: op() };
    expect((await http().post('/api/v1/central-stock/contract').set('Cookie', associationCookie).send(contract)).status).toBe(403);
    expect((await http().post('/api/v1/central-stock/contract').set('Cookie', adminCookie).send(contract)).status).toBe(201);
    const receipt = { deviceType: DeviceType.OVEN, quantity: 3, reference, opId: op() };
    expect((await http().post('/api/v1/central-stock/receipts').set('Cookie', adminCookie).send(receipt)).status).toBe(201);
    expect((await http().post('/api/v1/central-stock/receipts').set('Cookie', adminCookie).send(receipt)).status).toBe(201);
    expect((await http().post('/api/v1/central-stock/receipts').set('Cookie', adminCookie).send({ ...receipt, opId: op() })).status).toBe(409);

    const newOrder = async (qty: number) => {
      const created = await http().post('/api/v1/procurement/orders').set('Cookie', adminCookie).send({
        associationId, orderNumber: op(), supplierName: 'مورد اختبار',
        items: [{ deviceType: DeviceType.OVEN, approvedQty: qty }], opId: op(),
      });
      expect(created.status).toBe(201);
      orderIds.push(created.body.id as string);
      expect((await http().post(`/api/v1/procurement/orders/${created.body.id}/transition`).set('Cookie', adminCookie).send({ status: 'APPROVED', opId: op() })).status).toBe(201);
      return (await prisma.purchaseOrderItem.findFirstOrThrow({ where: { purchaseOrderId: created.body.id } })).id;
    };
    const firstItem = await newOrder(3);
    const firstShipment = await http().post('/api/v1/procurement/shipments').set('Cookie', adminCookie).send({
      purchaseOrderId: orderIds[0], route: 'SUPPLIER_TO_ORGANIZATION', items: [{ purchaseOrderItemId: firstItem, shippedQty: 3 }], opId: op(),
    });
    expect(firstShipment.status).toBe(201);
    const secondItem = await newOrder(1);
    const blocked = await http().post('/api/v1/procurement/shipments').set('Cookie', adminCookie).send({
      purchaseOrderId: orderIds[1], route: 'SUPPLIER_TO_ORGANIZATION', items: [{ purchaseOrderItemId: secondItem, shippedQty: 1 }], opId: op(),
    });
    expect(blocked.status).toBe(409);
    expect(blocked.body.error.code).toBe('CENTRAL_STOCK_INSUFFICIENT');
    const cancelOpId = op();
    const cancel = () => http().post(`/api/v1/procurement/shipments/${firstShipment.body.id}/transition`).set('Cookie', adminCookie).send({ status: 'CANCELLED', opId: cancelOpId });
    expect((await cancel()).status).toBe(201);
    expect((await cancel()).status).toBe(201);
    const replacement = await http().post('/api/v1/procurement/shipments').set('Cookie', adminCookie).send({
      purchaseOrderId: orderIds[1], route: 'SUPPLIER_TO_ORGANIZATION', items: [{ purchaseOrderItemId: secondItem, shippedQty: 1 }], opId: op(),
    });
    expect(replacement.status).toBe(201);
    const summary = await http().get('/api/v1/central-stock').set('Cookie', adminCookie);
    expect(summary.status).toBe(200);
    expect(summary.body.balances.find((row: { deviceType: DeviceType }) => row.deviceType === DeviceType.OVEN)).toMatchObject({
      contractedQty: 3, receivedQty: 3, distributedQty: 1, availableQty: 2,
    });
  });
});
