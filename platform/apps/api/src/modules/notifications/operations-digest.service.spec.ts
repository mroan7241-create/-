import { prisma } from '@alzad/db';
import { jest } from '@jest/globals';
import { EmailService, type OperationalDigestEmailParams } from '../auth/email/email.service';
import { OperationsDigestService } from './operations-digest.service';

class DigestEmailStub implements Pick<EmailService, 'sendOperationalDigest'> {
  sent: OperationalDigestEmailParams[] = [];
  async sendOperationalDigest(params: OperationalDigestEmailParams) { this.sent.push(params); }
}

describe('OperationsDigestService', () => {
  afterEach(() => jest.restoreAllMocks());

  it('still attempts the daily branch after a failed completion scan, then reports the original failure', async () => {
    const service = new OperationsDigestService({} as EmailService);
    const failure = new Error('completion scan unavailable');
    const order: string[] = [];
    jest.spyOn(service, 'runCompletionDue').mockImplementation(async () => { order.push('completion'); throw failure; });
    jest.spyOn(service, 'runDue').mockImplementation(async () => { order.push('daily'); return { skipped: 'outside daily digest window' }; });
    await expect(service.runScheduled()).rejects.toBe(failure);
    expect(order).toEqual(['completion', 'daily']);
  });

  it('reports both failures without retrying either branch in the same pass', async () => {
    const service = new OperationsDigestService({} as EmailService);
    const completionError = new Error('completion failed');
    const dailyError = new Error('daily failed');
    const completion = jest.spyOn(service, 'runCompletionDue').mockRejectedValue(completionError);
    const daily = jest.spyOn(service, 'runDue').mockRejectedValue(dailyError);
    await expect(service.runScheduled()).rejects.toMatchObject({ errors: [completionError, dailyError] });
    expect(completion).toHaveBeenCalledTimes(1);
    expect(daily).toHaveBeenCalledTimes(1);
  });

  it('preserves successful results and passes the same timestamp to both branches', async () => {
    const service = new OperationsDigestService({} as EmailService);
    const now = new Date('2026-09-20T03:15:00Z');
    const completion = jest.spyOn(service, 'runCompletionDue').mockResolvedValue({ scanned: 0, sent: 0 });
    const daily = jest.spyOn(service, 'runDue').mockResolvedValue({ skipped: 'already sent or in progress' });
    await expect(service.runScheduled(now)).resolves.toEqual({ completion: { scanned: 0, sent: 0 }, daily: { skipped: 'already sent or in progress' } });
    expect(completion).toHaveBeenCalledWith(now);
    expect(daily).toHaveBeenCalledWith(now);
  });

  it('does nothing outside 06:00 Asia/Riyadh', async () => {
    const email = new DigestEmailStub();
    const service = new OperationsDigestService(email as unknown as EmailService);
    const create = jest.spyOn(prisma.systemSetting, 'createMany');
    await expect(service.runDue(new Date('2026-09-20T02:59:00.000Z'))).resolves.toEqual({ skipped: 'outside daily digest window' });
    expect(create).not.toHaveBeenCalled();
    expect(email.sent).toHaveLength(0);
  });

  it('sends one event-backed digest with the required idempotency key', async () => {
    const email = new DigestEmailStub();
    const service = new OperationsDigestService(email as unknown as EmailService);
    jest.spyOn(prisma.systemSetting, 'createMany').mockResolvedValue({ count: 1 });
    jest.spyOn(prisma.systemSetting, 'findUnique')
      .mockResolvedValueOnce({ key: 'operations.digest.lastSuccessfulAt', value: '2026-09-19T03:00:00.000Z', updatedAt: new Date() });
    jest.spyOn(prisma.associationApplication, 'count').mockResolvedValue(3);
    jest.spyOn(prisma.auditLog, 'groupBy').mockResolvedValue([{ action: 'APPLICATION_EVALUATED', _count: { _all: 2 } }] as never);
    jest.spyOn(prisma.outboxEvent, 'count').mockResolvedValue(0);
    jest.spyOn(prisma, '$queryRaw').mockResolvedValue([{ ok: 1 }]);
    jest.spyOn(prisma.systemSetting, 'update').mockResolvedValue({} as never);
    jest.spyOn(prisma.systemSetting, 'upsert').mockResolvedValue({} as never);
    jest.spyOn(prisma.auditLog, 'create').mockResolvedValue({} as never);
    jest.spyOn(prisma, '$transaction').mockResolvedValue([] as never);

    await expect(service.runDue(new Date('2026-09-20T03:15:00.000Z'))).resolves.toEqual({
      ok: true,
      key: 'DAILY_PLATFORM_DIGEST:2026-09-20:Asia/Riyadh',
    });
    expect(email.sent).toHaveLength(1);
    expect(email.sent[0]?.text).toContain('طلبات جديدة: 3');
    expect(email.sent[0]?.text).toContain('APPLICATION_EVALUATED: 2');
    expect(email.sent[0]?.text).toContain('النسخ الاحتياطي: غير مثبت آليًا');
  });

  it.each(['SENT', 'PROCESSING'])('skips %s markers without errors or sending again', async (status) => {
    const email = new DigestEmailStub();
    const service = new OperationsDigestService(email as unknown as EmailService);
    const create = jest.spyOn(prisma.systemSetting, 'create');
    const insert = jest.spyOn(prisma.systemSetting, 'createMany').mockResolvedValue({ count: 0 });
    jest.spyOn(prisma.systemSetting, 'findUnique').mockResolvedValue({ value: { status, attempts: 1 } } as never);
    await expect(service.runDue(new Date('2026-09-20T03:15:00Z'))).resolves.toMatchObject({ skipped: 'already sent or in progress' });
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({ skipDuplicates: true }));
    expect(create).not.toHaveBeenCalled();
    expect(email.sent).toHaveLength(0);
  });

  it('does not send when another worker wins the failed-marker retry', async () => {
    const email = new DigestEmailStub();
    const service = new OperationsDigestService(email as unknown as EmailService);
    jest.spyOn(prisma.systemSetting, 'createMany').mockResolvedValue({ count: 0 });
    jest.spyOn(prisma.systemSetting, 'findUnique').mockResolvedValue({ value: { status: 'FAILED', attempts: 2 } } as never);
    const update = jest.spyOn(prisma.systemSetting, 'updateMany').mockResolvedValue({ count: 0 });
    await expect(service.runDue(new Date('2026-09-20T03:15:00Z'))).resolves.toMatchObject({ skipped: 'already sent or in progress' });
    expect(update).toHaveBeenCalledWith({ where: { key: 'DAILY_PLATFORM_DIGEST:2026-09-20:Asia/Riyadh', value: { equals: { status: 'FAILED', attempts: 2 } } }, data: { value: { status: 'PROCESSING', attempts: 3 } } });
    expect(email.sent).toHaveLength(0);
  });

  it('preserves the retry ceiling and propagates genuine database failures', async () => {
    const email = new DigestEmailStub();
    const service = new OperationsDigestService(email as unknown as EmailService);
    const insert = jest.spyOn(prisma.systemSetting, 'createMany').mockResolvedValue({ count: 0 });
    jest.spyOn(prisma.systemSetting, 'findUnique').mockResolvedValue({ value: { status: 'FAILED', attempts: 5 } } as never);
    const update = jest.spyOn(prisma.systemSetting, 'updateMany');
    await expect(service.runDue(new Date('2026-09-20T03:15:00Z'))).resolves.toMatchObject({ skipped: 'already sent or in progress' });
    expect(update).not.toHaveBeenCalled();
    insert.mockRejectedValueOnce(new Error('database unavailable'));
    await expect(service.runDue(new Date('2026-09-20T03:15:00Z'))).rejects.toThrow('database unavailable');
    expect(email.sent).toHaveLength(0);
  });
});
