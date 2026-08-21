import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { AccountRole } from '@alzad/db';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthContext } from '../auth/auth.types';
import { AutoAllocationService } from './auto-allocation.service';
import { RunAllocationDto } from './dto/allocation.dto';

/**
 * التخصيص التلقائي — NODE-0: حدود الوحدة فقط، بلا نقل Business Logic كامل بعد.
 * راجع platform/docs/FEATURE_PARITY.md لحالة الترحيل التفصيلية لكل
 * endpoint من هذه الوحدة.
 */
@ApiTags('allocation')
@Controller('allocation')
export class AllocationController {
  constructor(private readonly allocation: AutoAllocationService) {}

  @Get('_module-status')
  @ApiOperation({ summary: 'حالة تأسيس الوحدة (NODE-0 فقط — ليست endpoint أعمال حقيقية)' })
  moduleStatus() {
    return {
      module: 'AllocationModule',
      descriptionAr: 'التخصيص التلقائي',
      parityStatus: 'FOUNDATION_READY',
    };
  }

  @Get('baskets')
  @Roles(AccountRole.ADMIN, AccountRole.ASSOCIATION)
  @ApiOperation({ summary: 'جاهزية سلال التخصيص ونتائجها الفعلية، معزولة بالجمعية' })
  async baskets(@CurrentUser() ctx: AuthContext, @Query('associationId') associationId?: string) {
    return this.allocation.getBaskets(ctx, associationId);
  }

  @Post('run')
  @Roles(AccountRole.ADMIN)
  @ApiOperation({ summary: 'تشغيل أو إعادة محاولة محرك التخصيص القائم لجمعية واحدة' })
  async run(@CurrentUser() ctx: AuthContext, @Body() dto: RunAllocationDto) {
    return this.allocation.runForAssociation(ctx, dto.associationId, dto.opId);
  }
}
