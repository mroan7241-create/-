import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query, UploadedFiles, UseInterceptors } from '@nestjs/common';
import { FileFieldsInterceptor } from '@nestjs/platform-express';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { AccountRole } from '@alzad/db';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthContext } from '../auth/auth.types';
import { RECEIPT_EVIDENCE_MAX_BYTES } from '../files/file-validation.util';
import { DeliveriesService } from './deliveries.service';
import { ApproveDeliveryDto, AssignDelegateDto, ConfirmDeliveryDto, ConfirmHandoverDto, ConfirmReturnDto, DelegatePortalQueryDto, FailDeliveryDto, ListDeliveriesQueryDto, RescheduleDeliveryDto, RetryDeliveryDto, ReturnDeliveryDto } from './dto/delivery.dto';

interface ConfirmFiles {
  proofPhoto?: Express.Multer.File[];
  recipientSignature?: Express.Multer.File[];
}

/**
 * التسليمات — NODE-6 (يوازي assignDelegate + confirmDelivery/
 * updateDeliveryStatus/retryDelivery/listBeneficiaryDeliveryAttempts/
 * getDeliveryProofImage القديمة). راجع deliveries.service.ts للقرار
 * الموثَّق حول دمج "الإسناد" و"التسليم الفعلي للمندوب" في خطوة واحدة.
 */
@ApiTags('deliveries')
@Controller('deliveries')
export class DeliveriesController {
  constructor(private readonly deliveries: DeliveriesService) {}

  @Get('delegate-portal')
  @Roles(AccountRole.DELEGATE)
  @ApiOperation({ summary: 'مهام المندوب النشطة والسجل في طلب موحد مع ترقيم خادمي مستقل' })
  delegatePortal(@CurrentUser() ctx: AuthContext, @Query() query: DelegatePortalQueryDto) {
    return this.deliveries.delegatePortal(ctx, query);
  }

  @Get()
  @Roles(AccountRole.ADMIN, AccountRole.ASSOCIATION, AccountRole.DELEGATE)
  @ApiOperation({ summary: 'قائمة مهام التسليم — DELEGATE مهامه فقط، ASSOCIATION جمعيتها فقط، ADMIN الكل' })
  async list(@CurrentUser() ctx: AuthContext, @Query() query: ListDeliveriesQueryDto) {
    return this.deliveries.listDeliveries(ctx, query);
  }

  @Post('assign')
  @Roles(AccountRole.ADMIN, AccountRole.ASSOCIATION)
  @ApiOperation({ summary: 'إسناد مندوب لمستفيد — يشترط اكتمال كل احتياجاته المعتمدة عبر التخصيص التلقائي أولًا' })
  async assign(@CurrentUser() ctx: AuthContext, @Body() dto: AssignDelegateDto) {
    return this.deliveries.assignDelegate(ctx, dto);
  }

  @Get(':id')
  @Roles(AccountRole.ADMIN, AccountRole.ASSOCIATION, AccountRole.DELEGATE)
  @ApiOperation({ summary: 'تفاصيل مهمة تسليم + سجل محاولاتها الكامل' })
  async detail(@CurrentUser() ctx: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.deliveries.getDeliveryDetail(ctx, id);
  }

  @Post(':id/confirm-handover')
  @Roles(AccountRole.DELEGATE)
  @ApiOperation({ summary: 'تأكيد المندوب استلام عهدة المهمة فعليًا بعد الإسناد' })
  async confirmHandover(@CurrentUser() ctx: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ConfirmHandoverDto) {
    return this.deliveries.confirmHandover(ctx, id, dto.opId);
  }

  @Post(':id/confirm')
  @Roles(AccountRole.DELEGATE)
  @UseInterceptors(FileFieldsInterceptor([{ name: 'proofPhoto', maxCount: 1 }, { name: 'recipientSignature', maxCount: 1 }], { limits: { fileSize: RECEIPT_EVIDENCE_MAX_BYTES + 1024 } }))
  @ApiOperation({ summary: 'تأكيد التسليم — DELEGATE فقط ولمهمته حصرًا، الصورة والتوقيع والإقرار إلزامية' })
  async confirm(@CurrentUser() ctx: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ConfirmDeliveryDto, @UploadedFiles() files?: ConfirmFiles) {
    const proof = files?.proofPhoto?.[0];
    const signature = files?.recipientSignature?.[0];
    return this.deliveries.confirmDelivery(ctx, id, { buffer: proof?.buffer ?? Buffer.alloc(0), declaredMimeType: proof?.mimetype }, { buffer: signature?.buffer ?? Buffer.alloc(0), declaredMimeType: signature?.mimetype }, dto.opId);
  }

  @Post(':id/fail')
  @Roles(AccountRole.DELEGATE)
  @ApiOperation({ summary: 'تسجيل تعذّر التسليم — الأجهزة تبقى مع المندوب' })
  async fail(@CurrentUser() ctx: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: FailDeliveryDto) {
    return this.deliveries.failDelivery(ctx, id, dto);
  }

  @Post(':id/retry')
  @Roles(AccountRole.ADMIN, AccountRole.ASSOCIATION, AccountRole.DELEGATE)
  @ApiOperation({ summary: 'إعادة محاولة تسليم بعد تعذّر سابق — بلا مساس بالأجهزة أو المندوب أو السجل' })
  async retry(@CurrentUser() ctx: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: RetryDeliveryDto) {
    return this.deliveries.retryDelivery(ctx, id, dto.opId);
  }

  @Post(':id/return')
  @Roles(AccountRole.ADMIN, AccountRole.ASSOCIATION, AccountRole.DELEGATE)
  @ApiOperation({
    summary:
      'طلب إرجاع فقط — تبقى العهدة كما هي حتى تأكيد الجمعية للاستلام الفعلي',
  })
  async returnToWarehouse(@CurrentUser() ctx: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ReturnDeliveryDto) {
    return this.deliveries.requestReturn(ctx, id, dto);
  }

  @Post(':id/association-approval') @Roles(AccountRole.ASSOCIATION)
  associationApproval(@CurrentUser() ctx: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ApproveDeliveryDto) { return this.deliveries.approveDelivery(ctx, id, 'ASSOCIATION', dto); }

  @Post(':id/zaad-approval') @Roles(AccountRole.ADMIN)
  zaadApproval(@CurrentUser() ctx: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ApproveDeliveryDto) { return this.deliveries.approveDelivery(ctx, id, 'ZAAD', dto); }

  @Post(':id/reschedule') @Roles(AccountRole.ADMIN, AccountRole.ASSOCIATION, AccountRole.DELEGATE)
  reschedule(@CurrentUser() ctx: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: RescheduleDeliveryDto) { return this.deliveries.reschedule(ctx, id, dto); }

  @Post(':id/resume') @Roles(AccountRole.ADMIN, AccountRole.ASSOCIATION, AccountRole.DELEGATE)
  resume(@CurrentUser() ctx: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: RetryDeliveryDto) { return this.deliveries.resumeDeferred(ctx, id, dto.opId); }

  @Post(':id/confirm-return') @Roles(AccountRole.ASSOCIATION)
  confirmReturn(@CurrentUser() ctx: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ConfirmReturnDto) { return this.deliveries.confirmPhysicalReturn(ctx, id, dto); }

  @Post(':id/admin-return-override') @Roles(AccountRole.ADMIN)
  overrideReturn(@CurrentUser() ctx: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ConfirmReturnDto) { return this.deliveries.confirmPhysicalReturn(ctx, id, dto, true); }

  @Get('attempts/:attemptId/proof')
  @Roles(AccountRole.ADMIN, AccountRole.ASSOCIATION, AccountRole.DELEGATE)
  @ApiOperation({ summary: 'رابط موقَّع قصير العمر لصورة إثبات تسليم — audit عند كل عرض' })
  async proof(@CurrentUser() ctx: AuthContext, @Param('attemptId', ParseUUIDPipe) attemptId: string) {
    return this.deliveries.getDeliveryProofUrl(ctx, attemptId);
  }

  @Get('attempts/:attemptId/signature') @Roles(AccountRole.ADMIN, AccountRole.ASSOCIATION, AccountRole.DELEGATE)
  signature(@CurrentUser() ctx: AuthContext, @Param('attemptId', ParseUUIDPipe) attemptId: string) { return this.deliveries.getDeliverySignatureUrl(ctx, attemptId); }
}
