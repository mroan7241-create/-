import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';
import { AppModule } from './app.module';
import { HttpExceptionFilter } from './common/http-exception.filter';

async function bootstrap() {
  const corsOrigin = process.env.CORS_ORIGIN ?? 'http://localhost:3000';
  const app = await NestFactory.create(AppModule, {
    cors: { origin: corsOrigin, credentials: true },
  });

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

  const swaggerConfig = new DocumentBuilder()
    .setTitle('منصة جمعية الزاد — API')
    .setDescription('OpenAPI documentation لمنصة توزيع الأجهزة الجديدة (NODE-1 — Auth/Sessions/Roles/ReferenceData حقيقية؛ بقية النطاقات لا تزال قيد الهجرة التدريجية).')
    .setVersion('0.1.0')
    .addCookieAuth('alzad_session')
    .build();
  const swaggerDocument = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup(`${basePath.replace(/^\/+/, '')}/docs`, app, swaggerDocument);

  const port = Number(process.env.API_PORT ?? 3001);
  await app.listen(port);
  // eslint-disable-next-line no-console
  console.log(`API listening on :${port}${basePath}`);
}

bootstrap();
