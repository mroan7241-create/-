import { Injectable, NestMiddleware } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

const HEADER_NAME = process.env.CORRELATION_HEADER ?? 'x-correlation-id';

/**
 * يضمن correlation/request ID على كل طلب — يُعاد استخدام القيمة الواردة
 * من العميل إن وُجدت (تتبّع عبر خدمات متعددة لاحقًا)، وإلا يُولَّد واحد
 * جديد. يُستخدم في structured logging لاحقًا (منطق النظام القديم لديه
 * traceId مشابه — راجع requestMeta_() في DataUtils.gs).
 */
@Injectable()
export class CorrelationIdMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction) {
    const incoming = req.header(HEADER_NAME);
    const correlationId = incoming && incoming.trim() ? incoming.trim() : randomUUID();
    (req as Request & { correlationId: string }).correlationId = correlationId;
    res.setHeader(HEADER_NAME, correlationId);
    next();
  }
}
