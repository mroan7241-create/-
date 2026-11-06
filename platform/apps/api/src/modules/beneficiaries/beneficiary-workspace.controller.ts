import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
} from "@nestjs/common";
import { AccountRole } from "@alzad/db";
import { Roles } from "../auth/decorators/roles.decorator";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import type { AuthContext } from "../auth/auth.types";
import { BeneficiaryWorkspaceService } from "./beneficiary-workspace.service";
import {
  InformationCreateDto,
  InformationReplyDto,
  InformationResolveDto,
  PlanningDto,
  WorkspaceBulkDto,
  WorkspaceQueryDto,
  WorkspaceReviewDto,
} from "./dto/beneficiary-workspace.dto";

@Controller("beneficiary-workspace")
export class BeneficiaryWorkspaceController {
  constructor(private readonly workspace: BeneficiaryWorkspaceService) {}
  @Get()
  @Roles(AccountRole.ADMIN)
  list(@CurrentUser() ctx: AuthContext, @Query() query: WorkspaceQueryDto) {
    return this.workspace.list(ctx, query);
  }
  @Get("overview")
  @Roles(AccountRole.ADMIN)
  overview(@CurrentUser() ctx: AuthContext, @Query() query: WorkspaceQueryDto) {
    return this.workspace.overview(ctx, query);
  }
  @Get("priorities")
  @Roles(AccountRole.ADMIN)
  priorities(@CurrentUser() ctx: AuthContext, @Query() query: WorkspaceQueryDto) {
    return this.workspace.priorities(ctx, query);
  }
  @Get("planning")
  @Roles(AccountRole.ADMIN)
  planning(@CurrentUser() ctx: AuthContext) {
    return this.workspace.planning(ctx);
  }
  @Post("planning/simulate")
  @Roles(AccountRole.ADMIN)
  simulate(@CurrentUser() ctx: AuthContext, @Body() dto: PlanningDto) {
    return this.workspace.simulate(ctx, dto);
  }
  @Put("planning")
  @Roles(AccountRole.ADMIN)
  savePlanning(@CurrentUser() ctx: AuthContext, @Body() dto: PlanningDto) {
    return this.workspace.savePlanning(ctx, dto);
  }
  @Post("bulk-review")
  @Roles(AccountRole.ADMIN)
  bulk(@CurrentUser() ctx: AuthContext, @Body() dto: WorkspaceBulkDto) {
    return this.workspace.bulk(ctx, dto.items);
  }
  @Get("information")
  @Roles(AccountRole.ADMIN, AccountRole.ASSOCIATION)
  inbox(@CurrentUser() ctx: AuthContext) {
    return this.workspace.informationInbox(ctx);
  }
  @Post("information")
  @Roles(AccountRole.ADMIN)
  request(@CurrentUser() ctx: AuthContext, @Body() dto: InformationCreateDto) {
    return this.workspace.requestInformation(ctx, dto);
  }
  @Post("information/:id/reply")
  @Roles(AccountRole.ASSOCIATION)
  reply(
    @CurrentUser() ctx: AuthContext,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: InformationReplyDto,
  ) {
    return this.workspace.reply(ctx, id, dto);
  }
  @Post("information/:id/resolve")
  @Roles(AccountRole.ADMIN)
  resolve(
    @CurrentUser() ctx: AuthContext,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: InformationResolveDto,
  ) {
    return this.workspace.resolve(ctx, id, dto);
  }
  @Get(":id")
  @Roles(AccountRole.ADMIN)
  detail(
    @CurrentUser() ctx: AuthContext,
    @Param("id", ParseUUIDPipe) id: string,
  ) {
    return this.workspace.detail(ctx, id);
  }
  @Get(":id/next")
  @Roles(AccountRole.ADMIN)
  next(
    @CurrentUser() ctx: AuthContext,
    @Param("id", ParseUUIDPipe) id: string,
    @Query() query: WorkspaceQueryDto,
  ) {
    return this.workspace.next(ctx, id, query);
  }
  @Get(":id/history")
  @Roles(AccountRole.ADMIN)
  history(
    @CurrentUser() ctx: AuthContext,
    @Param("id", ParseUUIDPipe) id: string,
  ) {
    return this.workspace.history(ctx, id);
  }
  @Post(":id/review")
  @Roles(AccountRole.ADMIN)
  review(
    @CurrentUser() ctx: AuthContext,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: WorkspaceReviewDto,
  ) {
    return this.workspace.review(ctx, id, dto);
  }
}
