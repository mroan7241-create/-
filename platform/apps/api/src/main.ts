import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { cors: true });

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

  const swaggerConfig = new DocumentBuilder()
    .setTitle('منصة جمعية الزاد — API')
    .setDescription('OpenAPI documentation لمنصة توزيع الأجهزة الجديدة (NODE-0 — هيكل أولي، Feature Parity قيد الهجرة التدريجية).')
    .setVersion('0.0.1')
    .addBearerAuth()
    .build();
  const swaggerDocument = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup(`${basePath.replace(/^\/+/, '')}/docs`, app, swaggerDocument);

  const port = Number(process.env.API_PORT ?? 3001);
  await app.listen(port);
  // eslint-disable-next-line no-console
  console.log(`API listening on :${port}${basePath}`);
}

bootstrap();
