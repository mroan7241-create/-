import { BadRequestException } from '@nestjs/common';
import { isUUID } from 'class-validator';
import type { ConfirmItemInput } from './receipts.service';

/**
 * NODE-4.1 — `JSON.parse` وحدها كانت تضمن فقط "نص JSON صالح"، لا شكل
 * البيانات الفعلي: `items={}`/`[null]`/`"x"` كانت تجتاز `JSON.parse` ثم
 * تنفجر لاحقًا داخل `ReceiptsService` (قراءة `.itemId` من `null` مثلًا) —
 * خطأ غير مُتحكَّم فيه قد يتسرَّب كـ500. هنا: تحقق شكل زمن تشغيل صريح قبل
 * أي استدعاء للخدمة، برسائل 400 نظيفة فقط، بلا أي تفاصيل Prisma/SQL.
 */
export function parseConfirmItems(raw: string | undefined): ConfirmItemInput[] {
  if (raw === undefined) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new BadRequestException('صيغة بيانات بنود التأكيد غير صالحة');
  }
  if (!Array.isArray(parsed)) {
    throw new BadRequestException('بنود التأكيد يجب أن تكون مصفوفة');
  }
  return parsed.map((entry, index) => {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
      throw new BadRequestException(`البند رقم ${index + 1} غير صالح`);
    }
    const record = entry as Record<string, unknown>;
    if (typeof record.itemId !== 'string' || !isUUID(record.itemId)) {
      throw new BadRequestException(`معرّف البند رقم ${index + 1} غير صالح`);
    }
    for (const key of ['receivedQty', 'damagedQty', 'missingQty'] as const) {
      if (record[key] !== undefined && typeof record[key] !== 'number') {
        throw new BadRequestException(`${key} للبند رقم ${index + 1} يجب أن يكون رقمًا`);
      }
    }
    for (const key of ['differenceReason', 'differenceNotes'] as const) {
      if (record[key] !== undefined && typeof record[key] !== 'string') {
        throw new BadRequestException(`${key} للبند رقم ${index + 1} يجب أن يكون نصًا`);
      }
    }
    return {
      itemId: record.itemId,
      receivedQty: record.receivedQty as number | undefined,
      damagedQty: record.damagedQty as number | undefined,
      missingQty: record.missingQty as number | undefined,
      differenceReason: record.differenceReason as string | undefined,
      differenceNotes: record.differenceNotes as string | undefined,
    };
  });
}

/** نفس مبدأ `parseConfirmItems` — مصفوفة مصفوفات من معرّفات UUID فقط. */
export function parseDamagePhotoLinks(raw: string | undefined): string[][] {
  if (raw === undefined) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new BadRequestException('صيغة روابط صور التلف غير صالحة');
  }
  if (!Array.isArray(parsed)) {
    throw new BadRequestException('روابط صور التلف يجب أن تكون مصفوفة');
  }
  return parsed.map((group, index) => {
    if (!Array.isArray(group)) {
      throw new BadRequestException(`رابط صورة التلف رقم ${index + 1} غير صالح`);
    }
    return group.map((itemId, itemIndex) => {
      if (typeof itemId !== 'string' || !isUUID(itemId)) {
        throw new BadRequestException(`معرّف البند رقم ${itemIndex + 1} في صورة التلف رقم ${index + 1} غير صالح`);
      }
      return itemId;
    });
  });
}
