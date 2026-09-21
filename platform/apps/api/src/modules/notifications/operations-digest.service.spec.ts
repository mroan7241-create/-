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

  it('does nothing outside 06:00 Asia/Riyadh', async () => {
    const email = new DigestEmailStub();
    const service = new OperationsDigestService(email as unknown as EmailService);
    const create = jest.spyOn(prisma.systemSetting, 'create');
    await expect(service.runDue(new Date('2026-09-20T02:59:00.000Z'))).resolves.toEqual({ skipped: 'outside daily digest window' });
    expect(create).not.toHaveBeenCalled();
    expect(email.sent).toHaveLength(0);
  });

  it('sends one event-backed digest with the required idempotency key', async () => {
    const email = new DigestEmailStub();
    const service = new OperationsDigestService(email as unknown as EmailService);
    jest.spyOn(prisma.systemSetting, 'create').mockResolvedValue({} as never);
    jest.spyOn(prisma.systemSetting, 'findUnique')
      .mockResolvedValueOnce({ key: 'operations.digest.lastSuccessfulAt', value: '2026-09-19T03:00:00.000Z', updatedAt: new Date() })
      .mockResolvedValueOnce({ key: 'operations.backup.lastSuccessful', value: { backupId: 'test' }, updatedAt: new Date() });
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
  });
});
