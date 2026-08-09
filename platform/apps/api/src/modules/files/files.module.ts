import { Module } from '@nestjs/common';
import { StorageService } from './storage.service';

/**
 * NODE-2: تخزين كائنات خاص (S3-compatible) — مفعَّل الآن لغرض
 * ASSOCIATION_LICENSE فقط، عبر ApplicationsModule. لا public endpoint
 * عام للرفع/التنزيل هنا — كل وصول يمرّ عبر endpoint النطاق المسؤول
 * (مثل GET /association-applications/:id/license-file) الذي يتحقق من
 * الصلاحية والملكية أولًا.
 */
@Module({
  providers: [StorageService],
  exports: [StorageService],
})
export class FilesModule {}
