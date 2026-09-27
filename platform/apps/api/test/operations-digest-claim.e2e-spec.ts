import { randomUUID } from 'node:crypto';
import { prisma } from '@alzad/db';
import { OperationsDigestService } from '../src/modules/notifications/operations-digest.service';
import { FakeEmailService } from '../src/modules/auth/email/fake-email.service';
import { assertE2eNotTargetingProduction } from './utils/production-target.guard';

// jest-e2e setup verifies the connected database canary before this file is imported.
describe('Operational digest atomic claims (isolated PostgreSQL)', () => {
  const keys: string[] = [];
  const service = new OperationsDigestService(new FakeEmailService());
  const claim = (key: string) => (service as unknown as { claim(key: string): Promise<boolean> }).claim(key);
  const key = () => { const value = `DIGEST-CLAIM-E2E:${randomUUID()}`; keys.push(value); return value; };

  afterAll(async () => {
    assertE2eNotTargetingProduction();
    try {
      await prisma.systemSetting.deleteMany({ where: { key: { in: keys } } });
    } finally {
      await prisma.$disconnect();
    }
  });

  it('has one winner for concurrent initial claims without duplicate-key exceptions', async () => {
    const id = key();
    const outcomes = await Promise.all(Array.from({ length: 12 }, () => claim(id)));
    expect(outcomes.filter(Boolean)).toHaveLength(1);
    expect((await prisma.systemSetting.findUniqueOrThrow({ where: { key: id } })).value).toEqual({ status: 'PROCESSING', attempts: 1 });
  });

  it('has one winner for concurrent failed-marker retries and never reclaims SENT', async () => {
    const id = key();
    await prisma.systemSetting.create({ data: { key: id, value: { status: 'FAILED', attempts: 2 } } });
    const outcomes = await Promise.all(Array.from({ length: 12 }, () => claim(id)));
    expect(outcomes.filter(Boolean)).toHaveLength(1);
    expect((await prisma.systemSetting.findUniqueOrThrow({ where: { key: id } })).value).toEqual({ status: 'PROCESSING', attempts: 3 });
    await prisma.systemSetting.update({ where: { key: id }, data: { value: { status: 'SENT', attempts: 3 } } });
    expect(await claim(id)).toBe(false);
  });
});
