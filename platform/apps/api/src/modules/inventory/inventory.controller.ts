import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { AccountRole } from '@alzad/db';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthContext } from '../auth/auth.types';
import { InventoryService } from './inventory.service';
import { ListDeviceUnitsQueryDto, MarkDeviceDamagedDto, UpdateDeviceUnitDto } from './dto/inventory.dto';

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

  @Patch(':id')
  @Roles(AccountRole.ADMIN)
  @ApiOperation({ summary: 'DEV-005/006 (نطاق مصغَّر) — تصحيح نوع/مواصفة جهاز لا يزال بالمستودع فقط — ADMIN فقط' })
  async update(@CurrentUser() ctx: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateDeviceUnitDto) {
    return this.inventory.updateDeviceUnit(ctx, id, dto);
  }

  @Post(':id/mark-damaged')
  @Roles(AccountRole.ADMIN)
  @ApiOperation({ summary: 'وَسم جهاز بالمستودع تالفًا — ADMIN فقط' })
  async markDamaged(@CurrentUser() ctx: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: MarkDeviceDamagedDto) {
    return this.inventory.markDeviceDamaged(ctx, id, dto);
  }
}
