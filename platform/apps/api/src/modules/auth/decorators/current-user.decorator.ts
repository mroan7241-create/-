import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import type { AuthContext } from '../auth.types';

interface RequestWithAuth extends Request {
  authContext?: AuthContext;
}

/** يستخرج AuthContext المُرفَق من SessionAuthGuard — لا يُستدعى إطلاقًا على endpoint مُعلَّم @Public() بلا جلسة. */
export const CurrentUser = createParamDecorator((_data: unknown, ctx: ExecutionContext): AuthContext => {
  const request = ctx.switchToHttp().getRequest<RequestWithAuth>();
  return request.authContext as AuthContext;
});
