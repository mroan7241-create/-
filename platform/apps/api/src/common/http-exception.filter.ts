import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import type { Request, Response } from 'express';
import { ApiError } from './api-error';

interface CorrelatedRequest extends Request {
  correlationId?: string;
}

/**
 * يحوّل أي استثناء (ApiError، NestJS HttpException القياسي بما فيها
 * أخطاء ValidationPipe، أو خطأ غير متوقَّع) إلى مغلَّف استجابة موحَّد —
 * لا يُعاد أبدًا stack trace أو تفاصيل Prisma/SQL خامة للعميل.
 */
@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger('HttpExceptionFilter');

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<CorrelatedRequest>();
    const correlationId = request.correlationId ?? 'unknown';

    if (exception instanceof ApiError) {
      response.status(exception.getStatus()).json({
        ok: false,
        error: { code: exception.code, message: exception.message, correlationId },
      });
      return;
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body = exception.getResponse();
      const message =
        typeof body === 'string'
          ? body
          : Array.isArray((body as { message?: unknown }).message)
            ? ((body as { message: string[] }).message[0] ?? 'طلب غير صالح')
            : ((body as { message?: string }).message ?? 'طلب غير صالح');
      const code = status === HttpStatus.BAD_REQUEST ? 'AUTH_VALIDATION_FAILED' : `HTTP_${status}`;
      response.status(status).json({ ok: false, error: { code, message, correlationId } });
      return;
    }

    this.logger.error(`unhandled error — correlationId=${correlationId}`, exception instanceof Error ? exception.stack : String(exception));
    response.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      ok: false,
      error: { code: 'INTERNAL_ERROR', message: 'حدث خطأ غير متوقَّع. حاول مرة أخرى لاحقًا', correlationId },
    });
  }
}
