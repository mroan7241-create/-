import { Module } from '@nestjs/common';
import { ReceiptsController } from './receipts.controller';
import { ReceiptsService } from './receipts.service';
import { FilesModule } from '../files/files.module';
import { AllocationModule } from '../allocation/allocation.module';

/**
 * محاضر استلام دفعات الأجهزة — NODE-4. `PublicCodeService`/`IdempotencyService`
 * تُحقَن من `CommonModule` العام (لا تُعاد إعلانها هنا — راجع تعليق
 * NODE-3 في common/common.module.ts لسبب عدم تكرار مزوّدات عديمة الحالة
 * في providers محلية).
 */
@Module({
  imports: [FilesModule, AllocationModule],
  controllers: [ReceiptsController],
  providers: [ReceiptsService],
})
export class ReceiptsModule {}
