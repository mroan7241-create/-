import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';
import { json, urlencoded } from 'express';
import type { NextFunction, Request, Response } from 'express';
import { AppModule } from './app.module';
import { HttpExceptionFilter } from './common/http-exception.filter';
import { assertProductionSecretsConfigured } from './config/auth.config';
import { assertProductionStorageConfigured } from './config/storage.config';
import { JSON_BODY_LIMIT } from './common/body-limit.const';

async function bootstrap() {
  // يرفض الإقلاع بوضوح إن كان NODE_ENV=production وأي مفتاح HMAC أمني حسّاس ما زال بقيمته الافتراضية للتطوير.
  assertProductionSecretsConfigured();
  assertProductionStorageConfigured();

  const corsOrigin = process.env.CORS_ORIGIN ?? 'http://localhost:3000';
  const app = await NestFactory.create(AppModule, {
    cors: { origin: corsOrigin, credentials: true },
    // bodyParser الافتراضي حدّه 100kb (body-parser)، غير كافٍ لِBEN-013
    // (استيراد حتى 1000 صف مستفيد دفعة JSON واحدة) — راجع body-limit.const.ts.
    bodyParser: false,
  });
  app.getHttpAdapter().getInstance().disable('x-powered-by');
  app.use((_request: Request, response: Response, next: NextFunction) => {
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('X-Frame-Options', 'DENY');
    response.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    response.setHeader('Permissions-Policy', 'camera=(self), geolocation=(self), microphone=()');
    if (process.env.NODE_ENV === 'production') response.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    next();
  });
  app.use(json({ limit: JSON_BODY_LIMIT }));
  app.use(urlencoded({ extended: true, limit: JSON_BODY_LIMIT }));

  // HttpOnly session cookie (alzad_session) يُقرَأ من req.cookies هنا — لا localStorage/sessionStorage إطلاقًا.
  app.use(cookieParser());

  const basePath = process.env.API_BASE_PATH ?? '/api/v1';
  app.setGlobalPrefix(basePath.replace(/^\/+/, ''));

  // Validation server-side موحّدة لكل DTO — whitelist يرفض أي حقل غير معرَّف صراحة.
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  // مغلَّف استجابة موحَّد لكل خطأ — لا stack trace ولا تفاصيل Prisma/SQL خامة تصل للعميل.
  app.useGlobalFilters(new HttpExceptionFilter());

  if (process.env.NODE_ENV !== 'production' || process.env.ENABLE_API_DOCS === 'true') {
    const swaggerConfig = new DocumentBuilder()
      .setTitle('منصة جمعية الزاد — API')
      .setDescription('OpenAPI documentation لمنصة توزيع الأجهزة الجديدة.')
      .setVersion('1.0.0')
      .addCookieAuth('alzad_session')
      .build();
    const swaggerDocument = SwaggerModule.createDocument(app, swaggerConfig);
    SwaggerModule.setup(`${basePath.replace(/^\/+/, '')}/docs`, app, swaggerDocument);
  }

  // PORT: يوفّرها تشغيل Hostinger المُدار (managed runtime) ويجب أن تكون الأولوية.
  // API_PORT: احتياطي محلي/CI/يدوي. 3001: احتياطي أخير محلي.
  const rawPort = process.env.PORT ?? process.env.API_PORT ?? '3001';
  const port = Number(rawPort);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error(`منفذ استماع غير صالح: "${rawPort}" (PORT أو API_PORT). يجب رقمًا صحيحًا بين 1 و65535.`);
  }
  await app.listen(port);
  // eslint-disable-next-line no-console
  console.log(`API listening on :${port}${basePath}`);
}

bootstrap();
