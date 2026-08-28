import { Body, Controller, Get, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { AccountRole } from '@alzad/db';
import { Roles } from '../auth/decorators/roles.decorator'; import { CurrentUser } from '../auth/decorators/current-user.decorator'; import type { AuthContext } from '../auth/auth.types';
import { ParticipationsService } from './participations.service';
import { AgreementTransitionDto, CoordinatorChangeDto, CoordinatorDecisionDto, CreateAgreementDto, OperationDto } from './dto/participation.dto';
@Controller('participations')
export class ParticipationsController {
  constructor(private readonly service: ParticipationsService) {}
  @Get() @Roles(AccountRole.ADMIN, AccountRole.ASSOCIATION) list(@CurrentUser() ctx: AuthContext) { return this.service.list(ctx); }
  @Post(':id/agreements') @Roles(AccountRole.ADMIN) createAgreement(@CurrentUser() ctx: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: CreateAgreementDto) { return this.service.createAgreement(ctx, id, dto); }
  @Post('agreements/:id/transition') @Roles(AccountRole.ADMIN) transition(@CurrentUser() ctx: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: AgreementTransitionDto) { return this.service.transitionAgreement(ctx, id, dto.status, dto.signerName, dto.opId); }
  @Post(':id/setup-complete') @Roles(AccountRole.ADMIN) setup(@CurrentUser() ctx: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: OperationDto) { return this.service.completeSetup(ctx, id, dto.opId); }
  @Post(':id/activate') @Roles(AccountRole.ADMIN) activate(@CurrentUser() ctx: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: OperationDto) { return this.service.activate(ctx, id, dto.opId); }
  @Post(':id/coordinator-change') @Roles(AccountRole.ADMIN, AccountRole.ASSOCIATION) coordinator(@CurrentUser() ctx: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: CoordinatorChangeDto) { return this.service.requestCoordinatorChange(ctx, id, dto); }
  @Post('coordinator-changes/:id/decision') @Roles(AccountRole.ADMIN) decide(@CurrentUser() ctx: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: CoordinatorDecisionDto) { return this.service.decideCoordinatorChange(ctx, id, dto.decision, dto.notes); }
}
