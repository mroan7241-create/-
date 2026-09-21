import { CanActivate, ExecutionContext, Injectable, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { RateLimitService } from './rate-limit.service';

interface SourceLimitRule { scope: string; limit: number; windowSeconds: number }
const SOURCE_LIMIT_KEY = 'publicSourceLimit';

export const PublicSourceLimit = (scope: string, limit: number, windowSeconds: number) =>
  SetMetadata(SOURCE_LIMIT_KEY, { scope, limit, windowSeconds } satisfies SourceLimitRule);

/** Additional independent IP/source limit for explicitly marked public routes. */
@Injectable()
export class PublicSourceLimitGuard implements CanActivate {
  constructor(private readonly reflector: Reflector, private readonly rateLimit: RateLimitService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const rule = this.reflector.getAllAndOverride<SourceLimitRule>(SOURCE_LIMIT_KEY, [context.getHandler(), context.getClass()]);
    if (!rule) return true;
    const request = context.switchToHttp().getRequest<Request>();
    const source = request.ip || request.socket.remoteAddress || 'unknown';
    await this.rateLimit.consume(`source:${rule.scope}`, source, { limit: rule.limit, windowSeconds: rule.windowSeconds });
    return true;
  }
}
