import { jest } from '@jest/globals';
import { ParticipationStatus, Prisma } from '@alzad/db';
import { lockParticipationForOperationalWrite } from './participation-write-lock.util';

describe('participation operational transaction lock', () => {
  function fixture(status?: ParticipationStatus) {
    const query = jest.fn<(sql: TemplateStringsArray, ...values: unknown[]) => Promise<unknown>>().mockResolvedValue(status ? [{ status }] : []);
    return { query, tx: { $queryRaw: query } as unknown as Prisma.TransactionClient };
  }

  it.each([ParticipationStatus.READY_TO_CLOSE, ParticipationStatus.CLOSURE_SUBMITTED, ParticipationStatus.CLOSED])('rejects a new mutation in %s', async (status) => {
    const { tx } = fixture(status);
    await expect(lockParticipationForOperationalWrite(tx, 'association-id')).rejects.toMatchObject({ code: 'PARTICIPATION_CLOSURE_IN_PROGRESS' });
    await expect(lockParticipationForOperationalWrite(tx, 'association-id', { skipFrozen: true })).resolves.toBe(false);
  });

  it.each(Object.values(ParticipationStatus).filter((status) => ![ParticipationStatus.READY_TO_CLOSE, ParticipationStatus.CLOSURE_SUBMITTED, ParticipationStatus.CLOSED].some((frozen) => frozen === status)))('does not introduce another status restriction for %s', async (status) => {
    const { tx } = fixture(status);
    await expect(lockParticipationForOperationalWrite(tx, 'association-id')).resolves.toBe(true);
  });

  it('preserves legacy associations without a participation and uses a shared row lock', async () => {
    const { tx, query } = fixture();
    await expect(lockParticipationForOperationalWrite(tx, 'association-id')).resolves.toBe(true);
    const sql = Array.from(query.mock.calls[0][0] as unknown as string[]).join('?');
    expect(sql).toContain('FOR SHARE');
    expect(sql).toContain('association_id');
    expect(query.mock.calls[0].slice(1)).toEqual(['association-id']);
  });
});
