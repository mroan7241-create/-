import { Controller, Get, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { AccountRole } from '@alzad/db';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthContext } from '../auth/auth.types';
import { NotificationsService } from './notifications.service';

@Controller('notifications')
export class NotificationsController {
  constructor(private readonly service: NotificationsService) {}

  @Get()
  @Roles(AccountRole.ADMIN, AccountRole.ASSOCIATION, AccountRole.DELEGATE)
  list(@CurrentUser() ctx: AuthContext) { return this.service.list(ctx); }

  @Get('outbox')
  @Roles(AccountRole.ADMIN)
  outbox() { return this.service.monitorOutbox(); }

  @Post(':id/read')
  @Roles(AccountRole.ADMIN, AccountRole.ASSOCIATION, AccountRole.DELEGATE)
  read(@CurrentUser() ctx: AuthContext, @Param('id', ParseUUIDPipe) id: string) { return this.service.markRead(ctx, id); }

  @Post('process')
  @Roles(AccountRole.ADMIN)
  process() { return this.service.runWorker(); }
}
