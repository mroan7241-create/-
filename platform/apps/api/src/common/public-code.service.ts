import { Injectable } from '@nestjs/common';
import { Prisma } from '@alzad/db';

/**
 * مولّد publicCode ذرّي متزامن — يستبدل منطق nextId_/SELECT MAX(...)+1
 * القديم (غير آمن أصلًا تحت التزامن الحقيقي؛ Sheets لم يكن يواجه هذا
 * الخطر لأن الكتابة كانت مسلسَلة عبر LockService دائمًا). راجع
 * platform/docs/LEGACY_DATA_MIGRATION.md لخطة NODE-8 لمصالحة/تقديم
 * العداد بعد استيراد أرقام Legacy القديمة.
 *
 * يجب استدعاؤها دائمًا مع `tx` (Prisma.TransactionClient) من داخل نفس
 * المعاملة التي تُنشئ السجل المُرقَّم — إن تراجعت المعاملة (rollback)
 * يتراجع الرقم معها تلقائيًا (لا فجوة مؤذية، ولا تكرار).
 */
@Injectable()
export class PublicCodeService {
  async nextPublicCode(tx: Prisma.TransactionClient, prefix: string): Promise<string> {
    const rows = await tx.$queryRaw<{ next_value: number }[]>`
      INSERT INTO public_code_counters (prefix, next_value, updated_at)
      VALUES (${prefix}, 1, now())
      ON CONFLICT (prefix) DO UPDATE
        SET next_value = public_code_counters.next_value + 1, updated_at = now()
      RETURNING next_value
    `;
    const value = rows[0].next_value;
    return `${prefix}-${String(value).padStart(6, '0')}`;
  }
}
