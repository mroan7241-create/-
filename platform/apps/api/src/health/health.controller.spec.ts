import { Test, TestingModule } from '@nestjs/testing';
import { HealthController } from './health.controller';
import { prisma } from '@alzad/db';

jest.mock('@alzad/db', () => ({
  prisma: {
    $queryRaw: jest.fn(),
  },
}));

describe('HealthController', () => {
  let controller: HealthController;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      controllers: [HealthController],
    }).compile();
    controller = module.get<HealthController>(HealthController);
  });

  it('يعيد status=ok عندما ينجح استعلام PostgreSQL', async () => {
    (prisma.$queryRaw as jest.Mock).mockResolvedValueOnce([{ '?column?': 1 }]);
    const result = await controller.check();
    expect(result.status).toBe('ok');
    expect(result.checks.postgres).toBe('ok');
    expect(result.checks.api).toBe('ok');
  });

  it('يرمي ServiceUnavailableException عندما يفشل اتصال PostgreSQL', async () => {
    (prisma.$queryRaw as jest.Mock).mockRejectedValueOnce(new Error('connection refused'));
    await expect(controller.check()).rejects.toThrow();
  });
});
