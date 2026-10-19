import { Controller, Get, Header, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { AccountRole } from '@alzad/db';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthContext } from '../auth/auth.types';
import { AbanmiExploreDto } from './dto/abanmi-explore.dto';
import { AbanmiReaderService } from './abanmi-reader.service';

@Controller('reports/abanmi')
@Roles(AccountRole.ABANMI)
export class AbanmiReaderController {
  constructor(private readonly reader: AbanmiReaderService) {}
  @Get('explore') @Header('Cache-Control', 'private, no-store')
  explore(@CurrentUser() ctx: AuthContext, @Query() query: AbanmiExploreDto) { return this.reader.explore(ctx, query); }
  @Get('records/:kind/:id') @Header('Cache-Control', 'private, no-store')
  record(@CurrentUser() ctx: AuthContext, @Param('kind') kind: string, @Param('id', ParseUUIDPipe) id: string) { return this.reader.record(ctx, kind, id); }
  @Get('activities') @Header('Cache-Control', 'private, no-store')
  activities(@CurrentUser() ctx: AuthContext) { return this.reader.activities(ctx); }
  @Get('activity-evidence/:id') @Header('Cache-Control', 'private, no-store')
  evidence(@CurrentUser() ctx: AuthContext, @Param('id', ParseUUIDPipe) id: string) { return this.reader.evidence(ctx, id); }
  @Get('delivery-evidence/:id/:kind') @Header('Cache-Control', 'private, no-store')
  deliveryEvidence(@CurrentUser() ctx: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Param('kind') kind: string) { return this.reader.deliveryEvidence(ctx, id, kind); }
}
