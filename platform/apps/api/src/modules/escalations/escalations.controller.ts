import { Body, Controller, Get, Param, ParseUUIDPipe, Post } from '@nestjs/common'; import { AccountRole } from '@alzad/db'; import { Roles } from '../auth/decorators/roles.decorator'; import { CurrentUser } from '../auth/decorators/current-user.decorator'; import type { AuthContext } from '../auth/auth.types'; import { EscalationsService } from './escalations.service'; import { EscalationDecisionDto, OpenEscalationDto } from './escalations.dto';
@Controller('escalations') export class EscalationsController { constructor(private readonly service: EscalationsService) {}
  @Get() @Roles(AccountRole.ADMIN, AccountRole.ASSOCIATION) list(@CurrentUser() ctx: AuthContext) { return this.service.list(ctx); }
  @Post() @Roles(AccountRole.ADMIN, AccountRole.ASSOCIATION) create(@CurrentUser() ctx: AuthContext, @Body() dto: OpenEscalationDto) { return this.service.create(ctx, dto); }
  @Post(':id/decision') @Roles(AccountRole.ADMIN) decide(@CurrentUser() ctx: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: EscalationDecisionDto) { return this.service.decide(ctx, id, dto); }
}
