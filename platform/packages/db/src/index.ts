import { PrismaClient } from '../generated/client';

/**
 * عميل Prisma وحيد مشترك (singleton) — يمنع فتح اتصالات متعددة غير
 * ضرورية بقاعدة البيانات في بيئة Node.js طويلة العمر (NestJS). أي وحدة
 * في apps/api تستورد `prisma` من هنا بدل إنشاء PrismaClient خاص بها.
 */
declare global {
  // eslint-disable-next-line no-var
  var __alzadPrismaClient: PrismaClient | undefined;
}

export const prisma: PrismaClient =
  globalThis.__alzadPrismaClient ??
  new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
  });

if (process.env.NODE_ENV !== 'production') {
  globalThis.__alzadPrismaClient = prisma;
}

export * from '../generated/client';
