import { Injectable } from '@nestjs/common';
import { prisma, Prisma, AccountRole, DeviceStatus, DeviceType } from '@alzad/db';
import { ApiError, authForbidden } from '../../common/api-error';
import { normalizePagination, toPaginatedResult, type PaginatedResult, type PaginationParams } from '../../common/pagination.util';
import type { AuthContext } from '../auth/auth.types';

/**
 * مخزون الأجهزة — NODE-4، تكافؤ قراءة فقط مع `getDeviceDetail`/جزء
 * القراءة من `saveDevice` القديمتين. الإنشاء يتم **حصرًا** عبر تأكيد
 * محضر استلام ناجح (`ReceiptsService.confirmBatch`) — لا endpoint إنشاء
 * يدوي هنا في NODE-4؛ العهدة/التسليم/التخصيص اليدوي نطاق NODE-5/NODE-6
 * ولم يبدآ.
 */
@Injectable()
export class InventoryService {
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
