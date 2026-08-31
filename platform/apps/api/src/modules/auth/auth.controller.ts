import { Body, Controller, Get, HttpCode, HttpStatus, Param, Patch, Post, Req, Res } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { authConfig } from '../../config/auth.config';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { ConfirmPasswordResetDto, RequestPasswordResetDto } from './dto/password-reset.dto';
import { Public } from '../../common/decorators/public.decorator';
import { Roles } from './decorators/roles.decorator';
import { AllowMustChangePassword } from './decorators/allow-must-change-password.decorator';
import { CurrentUser } from './decorators/current-user.decorator';
import type { AuthContext } from './auth.types';
import { AccountRole } from '@alzad/db';

function requestMeta(req: Request) {
  return { ipAddress: req.ip, userAgent: req.get('user-agent') ?? undefined };
}

/**
 * عمر الكوكي = absoluteExpiresAt (السقف المطلق 12h)، وليس expiresAt
 * المنزلق (idle 6h) — المتصفح لا يجب أن يحذف الكوكي عند الساعة السادسة
 * فيما الجلسة نفسها قد تكون ما زالت نشطة (تم تمديد expires_at في DB
 * عبر أي طلب موثَّق لاحق). الخادم (SessionAuthGuard) هو الحكم الوحيد
 * لصلاحية الجلسة الفعلية على كل طلب — الكوكي غلاف نقل فقط، لا يفرض
 * idle timeout بذاته. راجع AUTHENTICATION.md §3.
 */
function setSessionCookie(res: Response, token: string, absoluteExpiresAt: Date) {
  res.cookie(authConfig.sessionCookieName, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    expires: absoluteExpiresAt,
  });
}

function clearSessionCookie(res: Response) {
  res.clearCookie(authConfig.sessionCookieName, { path: '/' });
}

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'تسجيل دخول ADMIN/ASSOCIATION/ABANMI (بريد+كلمة مرور) أو DELEGATE (رمز دخول)' })
  async login(@Body() dto: LoginDto, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const meta = requestMeta(req);
    const result =
      dto.type === 'delegate'
        ? await this.authService.loginDelegate(dto.code ?? '', meta)
        : await this.authService.loginUser(dto.email ?? '', dto.password ?? '', meta);

    setSessionCookie(res, result.rawToken, result.absoluteExpiresAt);
    return { ok: true, user: result.account };
  }

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  @AllowMustChangePassword()
  @ApiOperation({ summary: 'تسجيل خروج — يُبطل الجلسة الحالية فورًا' })
  async logout(@CurrentUser() ctx: AuthContext, @Res({ passthrough: true }) res: Response) {
    await this.authService.logout(ctx);
    clearSessionCookie(res);
    return { ok: true };
  }

  @Get('me')
  @AllowMustChangePassword()
  @ApiOperation({ summary: 'بيانات الحساب الحالي — بلا أي credential/hash' })
  async me(@CurrentUser() ctx: AuthContext) {
    return this.authService.getMe(ctx);
  }

  @Patch('password')
  @Roles(AccountRole.ADMIN, AccountRole.ASSOCIATION, AccountRole.ABANMI)
  @AllowMustChangePassword()
  @ApiOperation({ summary: 'تغيير كلمة المرور — يعمل حتى إذا mustChangePassword=true؛ يُبطل كل الجلسات بعد النجاح' })
  async changePassword(@CurrentUser() ctx: AuthContext, @Body() dto: ChangePasswordDto, @Res({ passthrough: true }) res: Response) {
    await this.authService.changePassword(ctx, dto.currentPassword, dto.newPassword);
    clearSessionCookie(res);
    return { ok: true };
  }

  @Public()
  @Post('password-reset/request')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'طلب استعادة كلمة مرور — رد موحَّد دائمًا، بلا كشف حالة الحساب' })
  async requestPasswordReset(@Body() dto: RequestPasswordResetDto) {
    return this.authService.requestPasswordReset(dto.email);
  }

  @Public()
  @Post('password-reset/confirm')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'إتمام استعادة كلمة المرور برمز صالح' })
  async confirmPasswordReset(@Body() dto: ConfirmPasswordResetDto) {
    return this.authService.confirmPasswordReset(dto.email, dto.code, dto.newPassword);
  }

  @Post('associations/:id/reset-password')
  @Roles(AccountRole.ADMIN)
  @ApiOperation({ summary: 'ADMIN فقط: إعادة تعيين كلمة مرور حساب جمعية — كلمة المرور المؤقتة تُعاد مرة واحدة فقط' })
  async resetAssociationPassword(@CurrentUser() ctx: AuthContext, @Param('id') associationId: string) {
    return this.authService.resetAssociationPassword(ctx, associationId);
  }
}
