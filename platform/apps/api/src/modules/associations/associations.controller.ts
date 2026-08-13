import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { AccountRole } from '@alzad/db';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthContext } from '../auth/auth.types';
import { AssociationsService } from './associations.service';
import { AssociationSelfSettingsDto, CreateAssociationDto, ListAssociationsQueryDto, UpdateAssociationDto } from './dto/association.dto';

@ApiTags('associations')
@Controller('associations')
export class AssociationsController {
  constructor(private readonly associations: AssociationsService) {}

  // ملاحظة ترتيب: 'me/settings' يجب أن يسبق ':id' حتى لا يُلتقَط كـid.
  @Get('me/settings')
  @Roles(AccountRole.ASSOCIATION)
  @ApiOperation({ summary: 'قراءة إعدادات الجمعية الذاتية الحالية — لتعبئة نموذج التعديل مسبقًا' })
  async getSelfSettings(@CurrentUser() ctx: AuthContext) {
    return this.associations.getSelfSettings(ctx);
  }

  @Patch('me/settings')
  @Roles(AccountRole.ASSOCIATION)
  @ApiOperation({ summary: 'إعدادات الجمعية الذاتية — phone/email فقط، associationId من الجلسة حصرًا' })
  async updateSelfSettings(@CurrentUser() ctx: AuthContext, @Body() dto: AssociationSelfSettingsDto) {
    return this.associations.updateSelfSettings(ctx, dto);
  }

  @Get()
  @Roles(AccountRole.ADMIN)
  @ApiOperation({ summary: 'قائمة الجمعيات — ADMIN فقط، مع pagination/search/filter وعدّادات مجمَّعة' })
  async list(@Query() query: ListAssociationsQueryDto) {
    return this.associations.listAssociations(query);
  }

  @Post()
  @Roles(AccountRole.ADMIN)
  @ApiOperation({ summary: 'إنشاء جمعية مباشرة — ADMIN فقط، ينشئ Association+Account+AuthCredential في معاملة واحدة، idempotent عبر opId' })
  async create(@CurrentUser() ctx: AuthContext, @Body() dto: CreateAssociationDto) {
    return this.associations.createAssociation(ctx, dto);
  }

  @Get(':id')
  @Roles(AccountRole.ADMIN)
  @ApiOperation({ summary: 'تفاصيل جمعية — ADMIN فقط' })
  async detail(@Param('id', ParseUUIDPipe) id: string) {
    return this.associations.getAssociationDetail(id);
  }

  @Patch(':id')
  @Roles(AccountRole.ADMIN)
  @ApiOperation({ summary: 'تعديل جمعية — ADMIN فقط؛ الانتقال إلى INACTIVE يُبطل جلسات كل حساباتها' })
  async update(@CurrentUser() ctx: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateAssociationDto) {
    return this.associations.updateAssociation(ctx, id, dto);
  }
}
