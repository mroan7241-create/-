import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { prisma } from '@alzad/db';
import { authConfig } from '../../../config/auth.config';
import { sha256Hex } from '../../../common/crypto.util';
import { authForbidden, authPasswordChangeRequired, authSessionExpired } from '../../../common/api-error';
import { IS_PUBLIC_KEY } from '../../../common/decorators/public.decorator';
import { ROLES_KEY } from '../decorators/roles.decorator';
import { ALLOW_MUST_CHANGE_PASSWORD_KEY } from '../decorators/allow-must-change-password.decorator';
import type { AuthContext } from '../auth.types';

interface RequestWithAuth extends Request {
  authContext?: AuthContext;
}

/**
 * Global Auth Guard — نقطة الفحص المركزية الوحيدة (لا تكرار للشروط
 * التالية داخل أي controller):
 * 1) صحة الجلسة (hash فقط، لا raw token يُقارَن).
 * 2) revoked_at IS NULL، expires_at > now، absolute_expires_at > now.
 * 3) حالة الحساب ACTIVE.
 * 4) حالة الجمعية ACTIVE إن كان الدور تابعًا لجمعية (نفس assertActorEnabled_ القديمة).
 * 5) sliding expiry: last_seen_at + expires_at = min(now+6h, absolute_expires_at) — لا تمديد للسقف المطلق أبدًا.
 * 6) mustChangePassword gate (دور ASSOCIATION فقط — نفس شرط legacy requireSession_ الحرفي) ما لم يُعفَ endpoint صراحة.
 * 7) فحص الدور (@Roles) إن وُجد.
 */
@Injectable()
export class SessionAuthGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [context.getHandler(), context.getClass()]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<RequestWithAuth>();
    const rawToken = (request.cookies as Record<string, string> | undefined)?.[authConfig.sessionCookieName];
    if (!rawToken) throw authSessionExpired();

    const tokenHash = sha256Hex(rawToken);
    const session = await prisma.authSession.findUnique({
      where: { tokenHash },
      include: { account: { include: { association: true } } },
    });

    const now = new Date();
    if (
      !session ||
      session.revokedAt !== null ||
      session.expiresAt <= now ||
      session.absoluteExpiresAt <= now
    ) {
      throw authSessionExpired();
    }

    const account = session.account;
    if (account.status !== 'ACTIVE') throw authSessionExpired();
    if (account.associationId && account.association && account.association.status !== 'ACTIVE') {
      throw authSessionExpired();
    }

    // ABANMI is deny-by-default at the central boundary. This remains effective
    // even if a future controller forgets @Roles: only the approved read-only
    // portal resources plus session/password lifecycle endpoints are reachable.
    if (account.role === 'ABANMI') {
      const path = request.originalUrl.split('?')[0];
      const approvedRead = request.method === 'GET' && /\/(auth\/me|activities|reports\/abanmi(?:\/export\.xlsx)?)$/.test(path);
      const approvedSessionWrite =
        (request.method === 'POST' && /\/auth\/logout$/.test(path)) ||
        (request.method === 'PATCH' && /\/auth\/password$/.test(path));
      if (!approvedRead && !approvedSessionWrite) throw authForbidden();
    }

    // Sliding expiry مع خفض تضخيم الكتابة: نلمس الصف مرة واحدة كل خمس دقائق
    // فقط، مع بقاء انتهاء الخمول والسقف المطلق قابلين للتحقق في كل طلب.
    const touchIntervalMs = 5 * 60 * 1000;
    const slidExpiresAt = new Date(Math.min(now.getTime() + authConfig.sessionIdleSeconds * 1000, session.absoluteExpiresAt.getTime()));
    const expiryNeedsRefresh = session.expiresAt.getTime() < slidExpiresAt.getTime() - 60_000;
    if (now.getTime() - session.lastSeenAt.getTime() >= touchIntervalMs || expiryNeedsRefresh) {
      await prisma.authSession.updateMany({
        where: { id: session.id, lastSeenAt: session.lastSeenAt, revokedAt: null },
        data: { lastSeenAt: now, expiresAt: slidExpiresAt },
      });
    }

    const allowMustChangePassword = this.reflector.getAllAndOverride<boolean>(ALLOW_MUST_CHANGE_PASSWORD_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    // الحسابات المنشأة بكلمة مرور مؤقتة لا تدخل أي بوابة أعمال قبل تغييرها.
    if (account.mustChangePassword && (account.role === 'ASSOCIATION' || account.role === 'ABANMI') && !allowMustChangePassword) {
      throw authPasswordChangeRequired();
    }

    const roles = this.reflector.getAllAndOverride<string[]>(ROLES_KEY, [context.getHandler(), context.getClass()]);
    if (roles && roles.length && !roles.includes(account.role)) {
      throw authForbidden();
    }

    request.authContext = {
      accountId: account.id,
      role: account.role,
      associationId: account.associationId,
      sessionId: session.id,
      mustChangePassword: account.mustChangePassword,
    };
    return true;
  }
}
