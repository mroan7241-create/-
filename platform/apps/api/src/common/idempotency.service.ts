import { Injectable } from '@nestjs/common';
import { Prisma } from '@alzad/db';
import { createHash } from 'node:crypto';
import { ApiError } from './api-error';

export interface IdempotencyClaim<T> {
  /** true = هذا الاستدعاء هو من ينفّذ العملية فعليًا؛ false = رد مُعاد من نتيجة سابقة مخزَّنة. */
  claimed: boolean;
  existingResponse?: T;
}

/**
 * idempotency_keys — منع تكرار عمليات قد تُعاد بسبب network retry (مراجعة
 * طلب انضمام، إنشاء جمعية مباشرة). UNIQUE(account_id, scope, key) هو خط
 * الدفاع الذري: `INSERT ... ON CONFLICT DO NOTHING` داخل نفس المعاملة
 * التي تقفل السجل المستهدف (FOR UPDATE) — طلبان متزامنان بنفس opId
 * يتسلسلان تلقائيًا عبر قفل الصف على idempotency_keys نفسه (لا حاجة
 * لاستطلاع/polling)، فيرى الثاني نتيجة الأول المخزَّنة بعد التزامه.
 *
 * لا تُخزَّن أي بيانات حساسة (كلمة مرور صريحة، توكن) في response_json —
 * راجع ASSOCIATION_APPLICATIONS.md لسياسة "لا إعادة تسليم كلمة مرور مؤقتة".
 */
@Injectable()
export class IdempotencyService {
  hashPayload(payload: unknown): string {
    return createHash('sha256').update(JSON.stringify(payload ?? null)).digest('hex');
  }

  /**
   * يحاول ادّعاء ملكية opId داخل tx الحالية. إن كان أول مرة (claimed=true)
   * على المستدعي تنفيذ العملية ثم استدعاء `complete`. إن كان مكرَّرًا
   * بنفس الحمولة (claimed=false) يُعاد الرد المخزَّن سابقًا. حمولة مختلفة
   * لنفس opId → `ApiError('APPLICATION_IDEMPOTENCY_CONFLICT', ..., 409)`.
   */
  async claim<T>(tx: Prisma.TransactionClient, accountId: string, scope: string, opId: string, payload: unknown): Promise<IdempotencyClaim<T>> {
    const requestHash = this.hashPayload(payload);

    const inserted = await tx.$queryRaw<{ id: string }[]>`
      INSERT INTO idempotency_keys (id, account_id, scope, key, request_hash, status, created_at)
      VALUES (uuidv7(), ${accountId}::uuid, ${scope}, ${opId}, ${requestHash}, 'IN_PROGRESS', now())
      ON CONFLICT (account_id, scope, key) DO NOTHING
      RETURNING id
    `;
    if (inserted.length > 0) {
      return { claimed: true };
    }

    const existingRows = await tx.$queryRaw<{ request_hash: string; status: string; response_json: T | null }[]>`
      SELECT request_hash, status, response_json FROM idempotency_keys
      WHERE account_id = ${accountId}::uuid AND scope = ${scope} AND key = ${opId}
    `;
    const existing = existingRows[0];
    if (!existing || existing.request_hash !== requestHash) {
      throw new ApiError('APPLICATION_IDEMPOTENCY_CONFLICT', 'تم استخدام نفس معرّف العملية (opId) لبيانات مختلفة عن الطلب الأصلي', 409);
    }
    if (existing.status !== 'COMPLETED') {
      // نظريًا لا يحدث تحت نفس القفل، لكن دفاعًا: لا نُعيد نتيجة جزئية أبدًا.
      throw new ApiError('APPLICATION_IDEMPOTENCY_CONFLICT', 'العملية بنفس المعرّف قيد التنفيذ بالفعل، أعد المحاولة بعد قليل', 409);
    }
    return { claimed: false, existingResponse: existing.response_json ?? undefined };
  }

  async complete<T>(tx: Prisma.TransactionClient, accountId: string, scope: string, opId: string, response: T): Promise<void> {
    await tx.$executeRaw`
      UPDATE idempotency_keys
      SET status = 'COMPLETED', response_json = ${JSON.stringify(response)}::jsonb
      WHERE account_id = ${accountId}::uuid AND scope = ${scope} AND key = ${opId}
    `;
  }
}
