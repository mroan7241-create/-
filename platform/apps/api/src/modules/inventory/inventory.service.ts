import { Injectable } from '@nestjs/common';
import { prisma, Prisma, AccountRole, DeviceStatus, DeviceType, DeviceMovementLocationType } from '@alzad/db';
import { ApiError, authForbidden } from '../../common/api-error';
import { normalizePagination, toPaginatedResult, type PaginatedResult, type PaginationParams } from '../../common/pagination.util';
import { IdempotencyService } from '../../common/idempotency.service';
import { AuditService } from '../audit/audit.service';
import { validateDeviceSpec } from '../receipts/receipt-reference.util';
import type { AuthContext } from '../auth/auth.types';
import type { UpdateDeviceUnitDto, MarkDeviceDamagedDto } from './dto/inventory.dto';

/**
 * مخزون الأجهزة — NODE-4 (قراءة) + DEV-003..011 (نطاق مصغَّر متعمَّد، راجع
 * PRODUCT_PARITY_MASTER.md §2.3/§5): الإنشاء يبقى **حصرًا** عبر تأكيد محضر
 * استلام ناجح (`ReceiptsService.confirmBatch`) — لا endpoint إنشاء يدوي.
 * التصحيح اليدوي (نوع/مواصفة) ووَسم "تالف" هنا مقصوران على أجهزة لا تزال
 * WAREHOUSE فقط — أي جهاز مرتبط بتخصيص (ALLOCATED) أو عهدة مندوب
 * (WITH_DELEGATE) أو مُسلَّم (DELIVERED) يبقى مملوكًا حصرًا لـNODE-5/6
 * (auto-allocation/deliveries)؛ لا كتابة هنا تتجاوزها أو تتنافس معها.
 */
@Injectable()
export class InventoryService {
  constructor(
    private readonly idempotency: IdempotencyService,
    private readonly audit: AuditService,
  ) {}
  async listDeviceUnits(
    ctx: AuthContext,
    params: PaginationParams & { associationId?: string; deviceType?: DeviceType; status?: DeviceStatus },
  ): Promise<PaginatedResult<unknown>> {
    const { page, pageSize, skip, take } = normalizePagination(params);
    const where: Prisma.DeviceUnitWhereInput = {};
    if (ctx.role === AccountRole.ASSOCIATION) {
      if (!ctx.associationId) throw authForbidden();
      where.associationId = ctx.associationId;
    } else if (params.associationId) {
      where.associationId = params.associationId;
    }
    if (params.deviceType) where.deviceType = params.deviceType;
    if (params.status) where.status = params.status;

    const [rows, total] = await Promise.all([
      prisma.deviceUnit.findMany({ where, orderBy: { createdAt: 'desc' }, skip, take }),
      prisma.deviceUnit.count({ where }),
    ]);

    return toPaginatedResult(rows.map(mapDeviceUnit), total, page, pageSize);
  }

  async getDeviceUnitDetail(ctx: AuthContext, id: string) {
    const device = await prisma.deviceUnit.findUnique({ where: { id }, include: { receiptItem: { include: { receiptBatch: true } } } });
    if (!device) throw new ApiError('DEVICE_NOT_FOUND', 'الجهاز غير موجود', 404);
    if (ctx.role === AccountRole.ASSOCIATION && ctx.associationId !== device.associationId) {
      throw new ApiError('DEVICE_NOT_FOUND', 'الجهاز غير موجود', 404);
    }
    return {
      ...mapDeviceUnit(device),
      receiptBatchId: device.receiptItem?.receiptBatchId ?? null,
      receiptBatchPublicCode: device.receiptItem?.receiptBatch?.publicCode ?? null,
    };
  }

  /** DEV-005/006 (نطاق مصغَّر) — تصحيح نوع/مواصفة جهاز لا يزال WAREHOUSE فقط. */
  async updateDeviceUnit(ctx: AuthContext, id: string, dto: UpdateDeviceUnitDto) {
    if (dto.deviceType === undefined && dto.spec === undefined) {
      throw new ApiError('DEVICE_UPDATE_EMPTY', 'لا يوجد تعديل فعلي في الطلب', 400);
    }

    const payload = { deviceType: dto.deviceType ?? null, spec: dto.spec ?? null };

    const outcome = await prisma.$transaction(async (tx) => {
      const claim = await this.idempotency.claim<{ ok: true; id: string }>(tx, ctx.accountId, 'device-update', dto.opId, payload);
      if (!claim.claimed) return { replayed: true as const, response: claim.existingResponse! };

      const device = await tx.deviceUnit.findUnique({ where: { id } });
      if (!device) throw new ApiError('DEVICE_NOT_FOUND', 'الجهاز غير موجود', 404);
      if (device.status !== DeviceStatus.WAREHOUSE) {
        throw new ApiError('DEVICE_NOT_EDITABLE', 'لا يمكن تعديل نوع/مواصفة جهاز بعد تخصيصه أو خروجه من المستودع', 409);
      }

      const nextDeviceType = dto.deviceType ?? device.deviceType;
      if (dto.spec !== undefined && !nextDeviceType) {
        throw new ApiError('DEVICE_TYPE_REQUIRED', 'لا يمكن تصحيح المواصفة بلا نوع جهاز معروف — حدِّد النوع أيضًا', 400);
      }
      const nextSpec = dto.spec !== undefined ? await validateDeviceSpec(dto.spec, nextDeviceType!) : device.spec;

      await tx.deviceUnit.update({
        where: { id },
        data: { deviceType: nextDeviceType, spec: nextSpec },
      });

      const response = { ok: true as const, id };
      await this.idempotency.complete(tx, ctx.accountId, 'device-update', dto.opId, response);
      return { replayed: false as const, response };
    });

    if (!outcome.replayed) {
      await this.audit.log({ id: ctx.accountId, role: ctx.role, associationId: ctx.associationId }, 'DEVICE_UPDATED', 'device_units', id, payload);
    }
    return outcome.response;
  }

  /** وَسم جهاز "تالف" — WAREHOUSE فقط (أجهزة العهدة/التسليم تُدار حصرًا عبر مسار فشل التسليم في NODE-6). */
  async markDeviceDamaged(ctx: AuthContext, id: string, dto: MarkDeviceDamagedDto) {
    const outcome = await prisma.$transaction(async (tx) => {
      const claim = await this.idempotency.claim<{ ok: true; id: string }>(tx, ctx.accountId, 'device-mark-damaged', dto.opId, { id });
      if (!claim.claimed) return { replayed: true as const, response: claim.existingResponse! };

      const device = await tx.deviceUnit.findUnique({ where: { id } });
      if (!device) throw new ApiError('DEVICE_NOT_FOUND', 'الجهاز غير موجود', 404);
      if (device.status !== DeviceStatus.WAREHOUSE) {
        throw new ApiError('DEVICE_NOT_EDITABLE', 'لا يمكن وَسم جهاز مخصَّص أو مع مندوب أو مُسلَّم تالفًا من هنا', 409);
      }

      await tx.deviceUnit.update({
        where: { id },
        data: { status: DeviceStatus.DAMAGED, currentLocationType: DeviceMovementLocationType.DAMAGED_HOLDING, currentLocationRef: null },
      });

      const response = { ok: true as const, id };
      await this.idempotency.complete(tx, ctx.accountId, 'device-mark-damaged', dto.opId, response);
      return { replayed: false as const, response };
    });

    if (!outcome.replayed) {
      await this.audit.log({ id: ctx.accountId, role: ctx.role, associationId: ctx.associationId }, 'DEVICE_MARKED_DAMAGED', 'device_units', id, { notes: dto.notes ?? null });
    }
    return outcome.response;
  }
}

function mapDeviceUnit(row: {
  id: string;
  publicCode: string;
  associationId: string;
  deviceType: string | null;
  legacyDeviceTypeText: string | null;
  spec: string | null;
  status: string;
  currentLocationType: string;
  createdAt: Date;
  updatedAt: Date;
  deliveredAt: Date | null;
}) {
  return {
    id: row.id,
    publicCode: row.publicCode,
    associationId: row.associationId,
    deviceType: row.deviceType ?? row.legacyDeviceTypeText,
    spec: row.spec,
    status: row.status,
    currentLocationType: row.currentLocationType,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    deliveredAt: row.deliveredAt,
  };
}
