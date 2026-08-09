import { Global, Module } from '@nestjs/common';
import { AuditController } from './audit.controller';
import { AuditService } from './audit.service';

/**
 * Global: AuditService يُستخدَم من AuthModule وأي module آخر يسجّل
 * حركة تدقيق — لا داعي لاستيراد AuditModule صراحة في كل مكان.
 */
@Global()
@Module({
  controllers: [AuditController],
  providers: [AuditService],
  exports: [AuditService],
})
export class AuditModule {}
