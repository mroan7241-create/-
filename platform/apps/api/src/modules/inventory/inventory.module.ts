import { Module } from '@nestjs/common';
import { InventoryController } from './inventory.controller';
import { InventoryService } from './inventory.service';

/**
 * مخزون الأجهزة — NODE-4، قراءة فقط (`listDeviceUnits`/`getDeviceUnitDetail`).
 * الإنشاء عبر `ReceiptsModule` حصرًا بعد تأكيد محضر استلام ناجح.
 */
@Module({
  controllers: [InventoryController],
  providers: [InventoryService],
})
export class InventoryModule {}
