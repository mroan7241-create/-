import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { prisma } from '@alzad/db';
import { Public } from '../common/decorators/public.decorator';
import { emailReadiness } from '../config/email.config';

interface HealthResponse {
  status: 'ok' | 'degraded';
  timestamp: string;
  checks: {
    api: 'ok';
    postgres: 'ok' | 'error';
    email: 'ok' | 'development-only' | 'error';
  };
}

@ApiTags('health')
@Controller('health')
export class HealthController {
  @Public()
  @Get()
  @ApiOperation({ summary: 'يتحقق من صحة الـAPI واتصال PostgreSQL' })
  async check(): Promise<HealthResponse> {
    let postgres: 'ok' | 'error' = 'ok';
    try {
      await prisma.$queryRaw`SELECT 1`;
    } catch {
      postgres = 'error';
    }

    const email = emailReadiness();
    const response: HealthResponse = {
      status: postgres === 'ok' && email !== 'error' ? 'ok' : 'degraded',
      timestamp: new Date().toISOString(),
      checks: { api: 'ok', postgres, email },
    };

    if (postgres === 'error' || email === 'error') {
      throw new ServiceUnavailableException(response);
    }
    return response;
  }
}
