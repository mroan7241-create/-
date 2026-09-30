import { EventEmitter } from 'node:events';
import { Logger } from '@nestjs/common';
import { jest } from '@jest/globals';
import type { NextFunction, Request, Response } from 'express';
import { SlowRequestMiddleware } from './slow-request.middleware';

describe('slow request diagnostics', () => {
  afterEach(() => jest.restoreAllMocks());

  it('logs only a slow route template and excludes URL, query, body, and secrets', () => {
    jest.spyOn(process.hrtime, 'bigint').mockReturnValueOnce(0n).mockReturnValueOnce(4_000_000_000n);
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const response = new EventEmitter() as Response;
    response.statusCode = 200;
    const request = {
      method: 'POST', route: { path: '/api/v1/participations/covenant/party-one/:token/sign' },
      originalUrl: '/api/v1/participations/covenant/party-one/private-token/sign?email=private@example.test',
      body: { password: 'private-password' },
    } as unknown as Request;

    new SlowRequestMiddleware().use(request, response, jest.fn() as NextFunction);
    response.emit('finish');

    const logged = String(warn.mock.calls[0]?.[0]);
    expect(logged).toContain('"durationMs":4000');
    expect(logged).toContain('/party-one/:token/sign');
    expect(logged).not.toMatch(/private-token|private@example|private-password/);
  });

  it('does not log normal requests or paths without a safe route template', () => {
    jest.spyOn(process.hrtime, 'bigint').mockReturnValueOnce(0n).mockReturnValueOnce(1_000_000_000n)
      .mockReturnValueOnce(0n).mockReturnValueOnce(4_000_000_000n);
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const middleware = new SlowRequestMiddleware();
    const response = new EventEmitter() as Response;
    response.statusCode = 200;
    middleware.use({ method: 'GET', route: { path: '/api/v1/health' } } as Request, response, jest.fn() as NextFunction);
    response.emit('finish');
    const unmatched = new EventEmitter() as Response;
    unmatched.statusCode = 404;
    middleware.use({ method: 'GET', originalUrl: '/secret-path' } as Request, unmatched, jest.fn() as NextFunction);
    unmatched.emit('finish');
    expect(warn).not.toHaveBeenCalled();
  });
});
