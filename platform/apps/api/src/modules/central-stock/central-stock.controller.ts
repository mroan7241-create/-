import { Body, Controller, Get, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { AccountRole } from '@alzad/db';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthContext } from '../auth/auth.types';
import { CentralStockService } from './central-stock.service';
import { RecordCentralReceiptDto, SetCentralContractDto } from './central-stock.dto';

@ApiTags('central-stock')
@Controller('central-stock')
@Roles(AccountRole.ADMIN)
export class CentralStockController {
  constructor(private readonly stock: CentralStockService) {}

  @Get()
  summary() { return this.stock.summary(); }

  @Post('contract')
  setContracted(@CurrentUser() ctx: AuthContext, @Body() dto: SetCentralContractDto) {
    return this.stock.setContracted(ctx, dto.deviceType, dto.contractedQty, dto.opId);
  }

  @Post('receipts')
  recordReceipt(@CurrentUser() ctx: AuthContext, @Body() dto: RecordCentralReceiptDto) {
    return this.stock.recordReceipt(ctx, dto.deviceType, dto.quantity, dto.reference, dto.opId);
  }
}
