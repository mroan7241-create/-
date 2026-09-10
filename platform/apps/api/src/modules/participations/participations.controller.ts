import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Res, StreamableFile, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { AccountRole } from '@alzad/db';
import { Roles } from '../auth/decorators/roles.decorator'; import { CurrentUser } from '../auth/decorators/current-user.decorator'; import type { AuthContext } from '../auth/auth.types';
import { Public } from '../../common/decorators/public.decorator';
import { RECEIPT_EVIDENCE_MAX_BYTES } from '../files/file-validation.util';
import { ParticipationsService } from './participations.service';
import { AgreementTransitionDto, AssociationCovenantSignDto, CoordinatorChangeDto, CoordinatorDecisionDto, CreateAgreementDto, OperationDto, PartyOneCovenantSignDto } from './dto/participation.dto';
@Controller('participations')
export class ParticipationsController {
  constructor(private readonly service: ParticipationsService) {}
  @Get() @Roles(AccountRole.ADMIN, AccountRole.ASSOCIATION) list(@CurrentUser() ctx: AuthContext) { return this.service.list(ctx); }
  @Post(':id/agreements') @Roles(AccountRole.ADMIN) createAgreement(@CurrentUser() ctx: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: CreateAgreementDto) { return this.service.createAgreement(ctx, id, dto); }
  @Post('agreements/:id/transition') @Roles(AccountRole.ADMIN) transition(@CurrentUser() ctx: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: AgreementTransitionDto) { return this.service.transitionAgreement(ctx, id, dto.status, dto.signerName, dto.opId); }
  @Post(':id/signing-account') @Roles(AccountRole.ADMIN) signingAccount(@CurrentUser() ctx: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: OperationDto) { return this.service.prepareSigningAccount(ctx, id, dto.opId); }
  @Get('covenant') @Roles(AccountRole.ASSOCIATION) ownCovenant(@CurrentUser() ctx: AuthContext) { return this.service.getOwnCovenant(ctx); }
  @Get('covenant/template') @Roles(AccountRole.ASSOCIATION) covenantTemplate(@Res({ passthrough: true }) res: Response) { prepareCovenantPdfResponse(res); return new StreamableFile(this.service.covenantTemplate()); }
  @Post('covenant/sign') @Roles(AccountRole.ASSOCIATION) @UseInterceptors(FileInterceptor('signature', { limits: { fileSize: RECEIPT_EVIDENCE_MAX_BYTES + 1024 } }))
  associationSign(@CurrentUser() ctx: AuthContext, @Body() dto: AssociationCovenantSignDto, @UploadedFile() signature?: Express.Multer.File) { return this.service.signAssociation(ctx, dto, { buffer: signature?.buffer ?? Buffer.alloc(0), declaredMimeType: signature?.mimetype }); }
  @Post('agreements/:id/party-one-session') @Roles(AccountRole.ADMIN) partyOneSession(@CurrentUser() ctx: AuthContext, @Param('id', ParseUUIDPipe) id: string) { return this.service.issuePartyOneSigningSession(ctx, id); }
  @Public() @Get('covenant/party-one/:token') partyOneView(@Param('token') token: string) { return this.service.getPartyOneSigningView(token); }
  @Public() @Get('covenant/party-one/:token/template') partyOneTemplate(@Param('token') token: string, @Res({ passthrough: true }) res: Response) { return this.service.getPartyOneSigningView(token).then(() => { prepareCovenantPdfResponse(res); return new StreamableFile(this.service.covenantTemplate()); }); }
  @Public() @Get('covenant/party-one/:token/association-signature') partyOneAssociationSignature(@Param('token') token: string) { return this.service.getPartyOneAssociationSignatureUrl(token); }
  @Public() @Post('covenant/party-one/:token/sign') @UseInterceptors(FileInterceptor('signature', { limits: { fileSize: RECEIPT_EVIDENCE_MAX_BYTES + 1024 } }))
  partyOneSign(@Param('token') token: string, @Body() dto: PartyOneCovenantSignDto, @UploadedFile() signature?: Express.Multer.File) { return this.service.signPartyOne(token, dto.opId, { buffer: signature?.buffer ?? Buffer.alloc(0), declaredMimeType: signature?.mimetype }); }
  @Get('covenant/final') @Roles(AccountRole.ASSOCIATION) ownFinal(@CurrentUser() ctx: AuthContext) { return this.service.getFinalCovenantUrl(ctx); }
  @Get('agreements/:id/final') @Roles(AccountRole.ADMIN) adminFinal(@CurrentUser() ctx: AuthContext, @Param('id', ParseUUIDPipe) id: string) { return this.service.getFinalCovenantUrl(ctx, id); }
  @Post(':id/setup-complete') @Roles(AccountRole.ADMIN) setup(@CurrentUser() ctx: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: OperationDto) { return this.service.completeSetup(ctx, id, dto.opId); }
  @Post(':id/activate') @Roles(AccountRole.ADMIN) activate(@CurrentUser() ctx: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: OperationDto) { return this.service.activate(ctx, id, dto.opId); }
  @Post(':id/coordinator-change') @Roles(AccountRole.ADMIN, AccountRole.ASSOCIATION) coordinator(@CurrentUser() ctx: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: CoordinatorChangeDto) { return this.service.requestCoordinatorChange(ctx, id, dto); }
  @Post('coordinator-changes/:id/decision') @Roles(AccountRole.ADMIN) decide(@CurrentUser() ctx: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: CoordinatorDecisionDto) { return this.service.decideCoordinatorChange(ctx, id, dto.decision, dto.notes); }
}

function prepareCovenantPdfResponse(res: Response) {
  const configuredOrigin = process.env.CORS_ORIGIN ?? 'http://localhost:3000';
  let frameOrigin = "'none'";
  try { frameOrigin = new URL(configuredOrigin).origin; } catch { /* Invalid CORS config remains fail-closed for framing. */ }
  res.removeHeader('X-Frame-Options');
  res.setHeader('Content-Security-Policy', `frame-ancestors ${frameOrigin}`);
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', 'inline; filename="covenant-v1.pdf"');
}
