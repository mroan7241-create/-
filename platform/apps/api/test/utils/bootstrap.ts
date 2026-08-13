import 'reflect-metadata';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import { json, urlencoded } from 'express';
import { AppModule } from '../../src/app.module';
import { HttpExceptionFilter } from '../../src/common/http-exception.filter';
import { JSON_BODY_LIMIT } from '../../src/common/body-limit.const';
import { EmailService } from '../../src/modules/auth/email/email.service';
import { FakeEmailService } from '../../src/modules/auth/email/fake-email.service';

/**
 * يبني تطبيق Nest حقيقي بنفس إعدادات main.ts (cookieParser + ValidationPipe
 * + HttpExceptionFilter) لكن مع FakeEmailService بدل DevEmailService، حتى
 * تقدر الاختبارات تقرأ رمز إعادة تعيين كلمة المرور مباشرة من الذاكرة.
 */
export async function createTestApp(): Promise<{ app: INestApplication; fakeEmail: FakeEmailService }> {
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
  })
    .overrideProvider(EmailService)
    .useClass(FakeEmailService)
    .compile();

  const app = moduleRef.createNestApplication({ bodyParser: false });
  app.use(json({ limit: JSON_BODY_LIMIT }));
  app.use(urlencoded({ extended: true, limit: JSON_BODY_LIMIT }));
  app.use(cookieParser());
  app.setGlobalPrefix('api/v1');
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  app.useGlobalFilters(new HttpExceptionFilter());
  await app.init();

  const fakeEmail = app.get(EmailService) as unknown as FakeEmailService;
  return { app, fakeEmail };
}
