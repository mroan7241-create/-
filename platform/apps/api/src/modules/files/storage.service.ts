import { Injectable, Logger } from '@nestjs/common';
import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { storageConfig } from '../../config/storage.config';

/**
 * غلاف S3-compatible صغير (MinIO محليًا/CI؛ أي مزوّد Production حقيقي
 * لاحقًا خلف نفس العقد بلا تغيير في الكود المستدعي). لا public bucket
 * ولا رابط دائم — فقط رفع/حذف كائنات، وsigned URL قصير العمر للقراءة.
 */
@Injectable()
export class StorageService {
  private readonly logger = new Logger(StorageService.name);
  private readonly client: S3Client;

  constructor() {
    this.client = new S3Client({
      endpoint: storageConfig.endpoint,
      region: storageConfig.region,
      forcePathStyle: storageConfig.forcePathStyle,
      credentials: {
        accessKeyId: storageConfig.accessKeyId,
        secretAccessKey: storageConfig.secretAccessKey,
      },
    });
  }

  async uploadPrivateObject(objectKey: string, body: Buffer, contentType: string): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: storageConfig.bucket,
        Key: objectKey,
        Body: body,
        ContentType: contentType,
      }),
    );
  }

  /** حذف best-effort — لا يرمي أبدًا؛ يُستخدم في مسارات compensating cleanup حيث فشل DB بعد رفع ناجح. */
  async deleteObjectBestEffort(objectKey: string): Promise<void> {
    try {
      await this.client.send(new DeleteObjectCommand({ Bucket: storageConfig.bucket, Key: objectKey }));
    } catch (error) {
      this.logger.warn(`فشل حذف الكائن اليتيم ${objectKey} — يحتاج تنظيفًا يدويًا لاحقًا: ${String(error)}`);
    }
  }

  async getSignedGetUrl(objectKey: string, expiresSeconds: number): Promise<string> {
    const command = new GetObjectCommand({ Bucket: storageConfig.bucket, Key: objectKey });
    return getSignedUrl(this.client, command, { expiresIn: expiresSeconds });
  }
}
