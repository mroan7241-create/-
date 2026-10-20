import { jest } from '@jest/globals';
import { AccountRole, prisma, type Prisma } from '@alzad/db';
import { readApplicationFileIndex, assertCompleteIndex, APPLICATION_INDEX_LIMIT } from './application-file-index';
import type { AuthContext } from '../auth/auth.types';

describe('complete file metadata projection', () => {
  const owner = { role: AccountRole.ADMIN, adminFullAccess: true } as AuthContext;
  afterEach(() => jest.restoreAllMocks());
  it('extracts only sectors and list fields without exporting the dossier', async () => {
    const query = jest.spyOn(prisma, '$queryRaw').mockResolvedValue([
      { id: 'a', publicCode: 'APP-1', sector: 'قديم', sectorValues: ['التعليم', null, 'التعليم'], sectorOther: ' خدمة ', yesCount: 3 },
      { id: 'b', sector: 'التعليم،التنمية', sectorValues: null, sectorOther: null, yesCount: 0 },
    ]);
    const result = await readApplicationFileIndex(owner);
    expect(result[0].sectorValues).toEqual(['التعليم', 'خدمة']);
    expect(result[1].sectorValues).toEqual(['التعليم', 'التنمية']);
    expect(result[0]).not.toHaveProperty('v2Payload');
    expect(result[0]).not.toHaveProperty('sectorOther');
    const sql = query.mock.calls[0][0] as Prisma.Sql;
    expect(sql.sql).toContain("#> '{organization,sectors}'");
    expect(sql.sql).not.toContain('a.*');
    expect(sql.values).toContain(APPLICATION_INDEX_LIMIT + 1);
  });
  it('binds regional scope as SQL parameters and fails closed on malformed scope', async () => {
    const query = jest.spyOn(prisma, '$queryRaw').mockResolvedValue([]);
    const code = "0001'); SELECT 'not SQL";
    // The scope helper rejects this malformed persisted scope before it can expand access.
    await readApplicationFileIndex({ ...owner, adminFullAccess: false, adminApplicationScope: { regionCodes: [code] } } as AuthContext);
    expect((query.mock.calls[0][0] as Prisma.Sql).sql).toContain('WHERE FALSE');
    await readApplicationFileIndex({ ...owner, adminFullAccess: false, adminApplicationScope: { regionCodes: ['0001'] } } as AuthContext);
    const scoped = query.mock.calls[1][0] as Prisma.Sql;
    expect(scoped.sql).toContain('a.region_official_code IN (?)');
    expect(scoped.values).toContain('0001');
    expect(scoped.sql).not.toContain('0001');
  });
  it('never silently drops applications at the bounded snapshot limit', () => {
    expect(() => assertCompleteIndex(new Array(APPLICATION_INDEX_LIMIT))).not.toThrow();
    expect(() => assertCompleteIndex(new Array(APPLICATION_INDEX_LIMIT + 1))).toThrow('تجاوز الفهرس');
  });
});
