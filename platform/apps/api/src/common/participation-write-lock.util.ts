import { ParticipationStatus, Prisma } from '@alzad/db';
import { ApiError } from './api-error';

/**
 * Keep operational writes concurrent with each other, but serialize them with
 * closure's participation FOR UPDATE lock. Call after idempotency replay and
 * before entity/advisory locks. Associations without a participation retain
 * their existing operational behavior.
 */
export async function lockParticipationForOperationalWrite(
  tx: Prisma.TransactionClient,
  associationId: string,
  options: { skipFrozen?: boolean } = {},
): Promise<boolean> {
  const rows = await tx.$queryRaw<{ status: ParticipationStatus }[]>`
    SELECT status FROM project_participations
    WHERE association_id=${associationId}::uuid FOR SHARE
  `;
  const frozen = rows.some(({ status }) =>
    status === ParticipationStatus.READY_TO_CLOSE ||
    status === ParticipationStatus.CLOSURE_SUBMITTED ||
    status === ParticipationStatus.CLOSED,
  );
  if (!frozen) return true;
  if (options.skipFrozen) return false;
  throw new ApiError('PARTICIPATION_CLOSURE_IN_PROGRESS', 'الكتابة التشغيلية مقفلة أثناء الإغلاق؛ يجب إعادة فتح المشاركة قبل تعديل بيانات التنفيذ', 409);
}
