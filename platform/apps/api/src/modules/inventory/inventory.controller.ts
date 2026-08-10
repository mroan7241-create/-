import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { AccountRole } from '@alzad/db';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthContext } from '../auth/auth.types';
import { InventoryService } from './inventory.service';
import { ListDeviceUnitsQueryDto } from './dto/inventory.dto';

@ApiTags('inventory')
@Controller('inventory/devices')
export class InventoryController {
  constructor(private readonly inventory: InventoryService) {}

  @Get()
  @Roles(AccountRole.ADMIN, AccountRole.ASSOCIATION)
  @ApiOperation({ summary: 'قائمة أجهزة المخزون — ترقيم خادمي، ADMIN يرى الكل (اختياريًا مصفّاة)، ASSOCIATION جمعيتها فقط' })
  async list(@CurrentUser() ctx: AuthContext, @Query() query: ListDeviceUnitsQueryDto) {
    return this.inventory.listDeviceUnits(ctx, {
      page: query.page,
      pageSize: query.pageSize,
      associationId: query.associationId,
      deviceType: query.deviceType,
      status: query.status,
    });
  }

  @Get(':id')
  @Roles(AccountRole.ADMIN, AccountRole.ASSOCIATION)
  @ApiOperation({ summary: 'تفاصيل جهاز واحد — تكافؤ getDeviceDetail القديمة' })
  async detail(@CurrentUser() ctx: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.inventory.getDeviceUnitDetail(ctx, id);
  }
}
