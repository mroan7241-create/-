import { Prisma, prisma } from '@alzad/db';
import { LEGACY_APPLICATION_QUESTIONS } from '@alzad/shared';
import { ApiError } from '../../common/api-error';
import type { AuthContext } from '../auth/auth.types';
import { adminApplicationRegionCodes } from '../auth/admin-route-permissions';

// Bounded metadata snapshot, not a dossier export. Never silently truncate global filters/ranks.
export const APPLICATION_INDEX_LIMIT = 5000;
export function assertCompleteIndex(rows: readonly unknown[]) {
  if (rows.length > APPLICATION_INDEX_LIMIT) throw new ApiError('APPLICATION_INDEX_TOO_LARGE', 'تجاوز الفهرس حد العرض الآمن؛ يلزم استخدام قائمة مرقمة قبل المتابعة.', 422);
}

type FileIndexRow = {
  id: string; publicCode: string; name: string; sector: string | null; region: string; city: string;
  email: string | null; contactName: string; licenseNumber: string | null;
  regionOfficialCode: string | null; governorateOfficialCode: string | null; centerOfficialCode: string | null;
  status: string; eligibilityStatus: string; selectionList: string; processingStartedAt: Date | null;
  resultingAssociationId: string | null; submittedAt: Date; sectorValues: Prisma.JsonValue; sectorOther: string | null; yesCount: number;
};

export async function readApplicationFileIndex(ctx: AuthContext) {
  const codes = adminApplicationRegionCodes(ctx);
  const scope = codes === null ? Prisma.sql`TRUE` : codes.length ? Prisma.sql`a.region_official_code IN (${Prisma.join(codes)})` : Prisma.sql`FALSE`;
  // Extract only the sector JSON keys in PostgreSQL: no v2Payload, financial data,
  // notes, answers, evidence, contacts' phones, or agreement/signature payloads cross this boundary.
  const rows = await prisma.$queryRaw<FileIndexRow[]>(Prisma.sql`
    SELECT a.id, a.public_code AS "publicCode", a.name, a.sector, a.region, a.city,
      a.email, a.contact_name AS "contactName", a.license_number AS "licenseNumber",
      a.region_official_code AS "regionOfficialCode", a.governorate_official_code AS "governorateOfficialCode",
      a.center_official_code AS "centerOfficialCode", a.status, a.eligibility_status AS "eligibilityStatus",
      a.selection_list AS "selectionList", a.processing_started_at AS "processingStartedAt",
      a.resulting_association_id AS "resultingAssociationId", a.submitted_at AS "submittedAt",
      a.v2_payload #> '{organization,sectors}' AS "sectorValues",
      CASE WHEN jsonb_typeof(a.v2_payload #> '{organization,sectorOther}') = 'string'
        THEN a.v2_payload #>> '{organization,sectorOther}' ELSE NULL END AS "sectorOther",
      (SELECT count(*)::int FROM application_answers ans WHERE ans.application_id = a.id
        AND ans.question_key IN (${Prisma.join(LEGACY_APPLICATION_QUESTIONS.map(q => q.key))}) AND ans.answer = TRUE) AS "yesCount"
    FROM association_applications a WHERE ${scope}
    ORDER BY a.submitted_at DESC, a.id DESC LIMIT ${APPLICATION_INDEX_LIMIT + 1}
  `);
  assertCompleteIndex(rows);
  return rows.map(({ sectorValues, sectorOther, yesCount, ...row }) => ({
    ...row,
    sectorValues: [...new Set([...(Array.isArray(sectorValues) ? sectorValues : (row.sector ?? '').split(/[,،;؛]/)), sectorOther]
      .filter((value): value is string => typeof value === 'string' && !!value.trim()).map(value => value.trim()))],
    scoreLabel: `${yesCount}/${LEGACY_APPLICATION_QUESTIONS.length}`,
  }));
}
