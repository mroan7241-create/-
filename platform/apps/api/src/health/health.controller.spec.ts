import { Test, TestingModule } from '@nestjs/testing';
import { jest } from '@jest/globals';
import { HealthController } from './health.controller';
import { prisma } from '@alzad/db';

describe('HealthController', () => {
  let controller: HealthController;

  beforeEach(async () => {
    jest.restoreAllMocks();
    jest.spyOn(prisma, '$queryRaw');
    const module: TestingModule = await Test.createTestingModule({
      controllers: [HealthController],
    }).compile();
    controller = module.get<HealthController>(HealthController);
  });

  it('يعيد status=ok عندما ينجح استعلام PostgreSQL', async () => {
    const queryRawMock = prisma.$queryRaw as unknown as { mockResolvedValueOnce(value: unknown): void };
    queryRawMock.mockResolvedValueOnce([{ '?column?': 1 }]);
    const result = await controller.check();
    expect(result.status).toBe('ok');
    expect(result.checks.postgres).toBe('ok');
    expect(result.checks.api).toBe('ok');
  });

  it('يرمي ServiceUnavailableException عندما يفشل اتصال PostgreSQL', async () => {
    const queryRawMock = prisma.$queryRaw as unknown as { mockRejectedValueOnce(error: unknown): void };
    queryRawMock.mockRejectedValueOnce(new Error('connection refused'));
    await expect(controller.check()).rejects.toThrow();
  });
});
