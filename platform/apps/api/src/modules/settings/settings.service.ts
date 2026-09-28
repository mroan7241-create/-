import { Injectable } from '@nestjs/common';
import { prisma, Prisma } from '@alzad/db';
import { ApiError } from '../../common/api-error';
import type { AuthContext } from '../auth/auth.types';

export const SETTING_KEYS = [
  'selection.passThreshold', 'selection.mainTargetCount', 'selection.weightsVersion',
  'calendar.workingDays', 'calendar.holidays',
  'evidence.requireRecipientSignature',
  'application.intakeClosesAt',
] as const;
export type SettingKey = typeof SETTING_KEYS[number];

@Injectable()
export class SettingsService {
  async list() {
    return { items: await prisma.systemSetting.findMany({ orderBy: { key: 'asc' } }) };
  }

  async getValue<T>(key: SettingKey): Promise<T | undefined> {
    const row = await prisma.systemSetting.findUnique({ where: { key } });
    return row?.value as T | undefined;
  }

  async requireNumber(key: SettingKey): Promise<number> {
    const value = await this.getValue<unknown>(key);
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      throw new ApiError('REQUIRED_SETTING_MISSING', `الإعداد التشغيلي المطلوب غير مضبوط: ${key}`, 409);
    }
    return value;
  }

  async applicationIntakeStatus(now = new Date()) {
    const closesAt = await this.getValue<string | null>('application.intakeClosesAt');
    return applicationIntakeStatus(closesAt, now);
  }

  async assertApplicationIntakeOpen(now = new Date()) {
    const status = await this.applicationIntakeStatus(now);
    if (!status.open) throw new ApiError('APPLICATION_INTAKE_CLOSED', 'انتهت مدة استقبال طلبات الجمعيات. نشكركم على اهتمامكم بالمشاركة.', 409);
  }

  async set(ctx: AuthContext, key: string, rawValue: unknown) {
    if (!SETTING_KEYS.includes(key as SettingKey)) throw new ApiError('SETTING_KEY_NOT_ALLOWED', 'مفتاح الإعداد غير معتمد', 400);
    const value = validateSetting(key as SettingKey, rawValue);
    return prisma.$transaction(async (tx) => {
      const old = await tx.systemSetting.findUnique({ where: { key } });
      const row = await tx.systemSetting.upsert({
        where: { key }, create: { key, value: value === null ? Prisma.JsonNull : value as Prisma.InputJsonValue }, update: { value: value === null ? Prisma.JsonNull : value as Prisma.InputJsonValue },
      });
      await tx.auditLog.create({ data: {
        actorAccountId: ctx.accountId, actorRole: ctx.role, associationId: ctx.associationId ?? null,
        action: 'SYSTEM_SETTING_UPDATED', entityType: 'system_settings', entityId: key,
        metadata: { oldValue: old?.value ?? null, newValue: value } as Prisma.InputJsonValue,
      } });
      return row;
    });
  }
}

export function validateSetting(key: SettingKey, value: unknown): unknown {
  if (key === 'selection.passThreshold') return numberInRange(value, 0, 100, key);
  if (key === 'selection.mainTargetCount') {
    const n = numberInRange(value, 1, 1_000_000, key);
    if (!Number.isInteger(n)) throw invalid(key);
    return n;
  }
  if (key === 'selection.weightsVersion') {
    if (typeof value !== 'string' || !value.trim() || value.length > 80) throw invalid(key);
    return value.trim();
  }
  if (key === 'calendar.workingDays') {
    if (!Array.isArray(value) || value.length === 0 || value.some((v) => !Number.isInteger(v) || v < 0 || v > 6) || new Set(value).size !== value.length) throw invalid(key);
    return [...value].sort();
  }
  if (key === 'calendar.holidays') {
    if (!Array.isArray(value) || value.some((v) => typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v) || !isRealDate(v)) || new Set(value).size !== value.length) throw invalid(key);
    return [...value].sort();
  }
  if (key === 'evidence.requireRecipientSignature') {
    if (value !== true) throw new ApiError('SETTING_VALUE_INVALID', 'متطلب توقيع المستفيد يجب أن يبقى مفعّلًا في النطاق الحالي', 400);
    return true;
  }
  if (key === 'application.intakeClosesAt') {
    if (value === null) return null;
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) || Number.isNaN(Date.parse(value)) || new Date(value).toISOString() !== value) throw invalid(key);
    return value;
  }
  throw invalid(key);
}

export function applicationIntakeStatus(closesAt: string | null | undefined, now = new Date()) {
  const valid = typeof closesAt === 'string' && !Number.isNaN(Date.parse(closesAt));
  return { open: !valid || now.getTime() < Date.parse(closesAt!), closesAt: valid ? closesAt : null };
}

function numberInRange(value: unknown, min: number, max: number, key: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) throw invalid(key);
  return value;
}
function invalid(key: string) { return new ApiError('SETTING_VALUE_INVALID', `قيمة الإعداد غير صالحة: ${key}`, 400); }
function isRealDate(value: string) {
  const [y, m, d] = value.split('-').map(Number); const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() + 1 === m && date.getUTCDate() === d;
}
