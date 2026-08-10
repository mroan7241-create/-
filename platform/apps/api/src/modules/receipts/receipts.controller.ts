import { BadRequestException, Body, Controller, Get, Param, ParseUUIDPipe, Post, Query, UploadedFiles, UseInterceptors } from '@nestjs/common';
import { FileFieldsInterceptor } from '@nestjs/platform-express';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { AccountRole } from '@alzad/db';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthContext } from '../auth/auth.types';
import { RECEIPT_EVIDENCE_MAX_BYTES } from '../files/file-validation.util';
import { ReceiptsService } from './receipts.service';
import { ConfirmReceiptBatchDto, CreateReceiptBatchDto, ListReceiptBatchesQueryDto, ReceiptEvidenceQueryDto, SendReceiptBatchDto } from './dto/receipt.dto';
import { parseConfirmItems, parseDamagePhotoLinks } from './confirm-multipart.util';

interface ConfirmFiles {
  quantityPhoto?: Express.Multer.File[];
  signatureImage?: Express.Multer.File[];
  damagePhotos?: Express.Multer.File[];
}

/**
 * محاضر استلام دفعات الأجهزة — NODE-4.
 *
 * الأدوار مطابقة لِLegacy حرفيًا: `createReceiptBatch`/`sendReceiptBatch`
 * = ADMIN فقط، `confirmReceiptBatch` = ASSOCIATION فقط (لجمعيتها حصرًا،
 * من AuthContext لا من الجسم)، `listReceiptBatches`/`getReceiptBatchDetail`
 * = ADMIN وASSOCIATION معًا بنفس عزل tenant.
 */
@ApiTags('receipts')
@Controller('receipts')
export class ReceiptsController {
  constructor(private readonly receipts: ReceiptsService) {}

  @Get()
  @Roles(AccountRole.ADMIN, AccountRole.ASSOCIATION)
  @ApiOperation({ summary: 'قائمة محاضر الاستلام — ADMIN يرى الكل (اختياريًا مصفّاة)، ASSOCIATION محاضرها فقط' })
  async list(@CurrentUser() ctx: AuthContext, @Query() query: ListReceiptBatchesQueryDto) {
    return this.receipts.listReceiptBatches(ctx, {
      page: query.page,
      pageSize: query.pageSize,
      associationId: query.associationId,
      status: query.status,
    });
  }

  @Post()
  @Roles(AccountRole.ADMIN)
  @ApiOperation({ summary: 'إنشاء محضر استلام + بنوده — ADMIN فقط، عملية ذرّية واحدة، الحالة الابتدائية دومًا مسودة' })
  async create(@CurrentUser() ctx: AuthContext, @Body() dto: CreateReceiptBatchDto) {
    return this.receipts.createBatch(ctx, dto);
  }

  @Get(':id')
  @Roles(AccountRole.ADMIN, AccountRole.ASSOCIATION)
  @ApiOperation({ summary: 'تفاصيل محضر استلام واحد' })
  async detail(@CurrentUser() ctx: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.receipts.getBatchDetail(ctx, id);
  }

  @Post(':id/send')
  @Roles(AccountRole.ADMIN)
  @ApiOperation({ summary: 'إرسال محضر للجمعية — ADMIN فقط، مسودة ← بانتظار تأكيد الجمعية فقط' })
  async send(@CurrentUser() ctx: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: SendReceiptBatchDto) {
    return this.receipts.sendBatch(ctx, id, dto.opId);
  }

  @Post(':id/confirm')
  @Roles(AccountRole.ASSOCIATION)
  @UseInterceptors(
    FileFieldsInterceptor(
      [
        { name: 'quantityPhoto', maxCount: 1 },
        { name: 'signatureImage', maxCount: 1 },
        { name: 'damagePhotos', maxCount: 50 },
      ],
      { limits: { fileSize: RECEIPT_EVIDENCE_MAX_BYTES + 1024 } },
    ),
  )
  @ApiOperation({ summary: 'تأكيد استلام محضر — ASSOCIATION فقط ولجمعيتها حصرًا، multipart/form-data' })
  async confirm(@CurrentUser() ctx: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ConfirmReceiptBatchDto, @UploadedFiles() files: ConfirmFiles) {
    const items = parseConfirmItems(dto.items);
    const damagePhotoItemLinks = parseDamagePhotoLinks(dto.damagePhotoLinks);

    const quantityPhoto = files?.quantityPhoto?.[0];
    const signatureImage = files?.signatureImage?.[0];
    const damagePhotos = files?.damagePhotos ?? [];

    return this.receipts.confirmBatch(
      ctx,
      id,
      { receiverTitle: dto.receiverTitle, items, damagePhotoItemLinks, opId: dto.opId },
      { buffer: quantityPhoto?.buffer ?? Buffer.alloc(0), declaredMimeType: quantityPhoto?.mimetype },
      { buffer: signatureImage?.buffer ?? Buffer.alloc(0), declaredMimeType: signatureImage?.mimetype },
      damagePhotos.map((f) => ({ buffer: f.buffer, declaredMimeType: f.mimetype })),
    );
  }

  @Get(':id/evidence/:evidenceType')
  @Roles(AccountRole.ADMIN, AccountRole.ASSOCIATION)
  @ApiOperation({ summary: 'رابط موقَّع قصير العمر لإثبات محضر (كمية/توقيع/تلف) — بنفس عزل tenant، audit عند كل عرض' })
  async evidence(
    @CurrentUser() ctx: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('evidenceType') evidenceType: string,
    @Query() query: ReceiptEvidenceQueryDto,
  ) {
    if (evidenceType !== 'quantity' && evidenceType !== 'signature' && evidenceType !== 'damage') {
      throw new BadRequestException('نوع إثبات غير معروف');
    }
    return this.receipts.getEvidenceSignedUrl(ctx, id, evidenceType, query.damagePhotoId);
  }
}
