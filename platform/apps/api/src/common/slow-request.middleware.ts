import { Injectable, Logger, NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';

const SLOW_REQUEST_MS = 3000;

/** Logs only route templates, never URLs, query strings, bodies, tokens, or headers. */
@Injectable()
export class SlowRequestMiddleware implements NestMiddleware {
  private readonly logger = new Logger(SlowRequestMiddleware.name);

  use(req: Request, res: Response, next: NextFunction) {
    const started = process.hrtime.bigint();
    res.once('finish', () => {
      const elapsedMs = Number(process.hrtime.bigint() - started) / 1_000_000;
      if (elapsedMs < SLOW_REQUEST_MS) return;
      const route = req.route?.path;
      // Express supplies a route *template* here (e.g. :id), not the requested URL.
      if (typeof route !== 'string') return;
      this.logger.warn(JSON.stringify({ method: req.method, route, status: res.statusCode, durationMs: Math.round(elapsedMs) }));
    });
    next();
  }
}
