import { Module } from '@nestjs/common';
import { DamageCasesController, InventoryController } from './inventory.controller';
import { InventoryService } from './inventory.service';

/**
 * مخزون الأجهزة — NODE-4، قراءة فقط (`listDeviceUnits`/`getDeviceUnitDetail`).
 * الإنشاء عبر `ReceiptsModule` حصرًا بعد تأكيد محضر استلام ناجح.
 */
@Module({
  controllers: [InventoryController, DamageCasesController],
  providers: [InventoryService],
})
export class InventoryModule {}
