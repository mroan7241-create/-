export const DRAFT_KEY = 'alzad.apply.v2.draft';

export type DraftCredentials = { draftCode: string; resumeToken?: string; viaSession?: boolean };

export function readDraftSession(storage: Pick<Storage, 'getItem' | 'removeItem'>): DraftCredentials | null {
  const raw = storage.getItem(DRAFT_KEY);
  if (!raw) return null;
  try {
    const saved: unknown = JSON.parse(raw);
    if (saved && typeof saved === 'object' && !Array.isArray(saved)) {
      const metadata = saved as DraftCredentials;
      if (typeof metadata.draftCode === 'string' && metadata.draftCode.trim()) {
        const draftCode = metadata.draftCode.trim();
        if (typeof metadata.resumeToken === 'string' && metadata.resumeToken.length >= 32) return { draftCode, resumeToken: metadata.resumeToken };
        if (metadata.viaSession === true) return { draftCode, viaSession: true };
      }
    }
  } catch { /* Invalid browser metadata is not a resumable draft. */ }
  storage.removeItem(DRAFT_KEY);
  return null;
}

export function isInvalidDraftAccess(reason: unknown): boolean {
  return reason instanceof Error && 'code' in reason &&
    (reason.code === 'APPLICATION_RESUME_INVALID' || reason.code === 'APPLICATION_ACCESS_INVALID');
}

export async function restoreDraftSession<T>(storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>, existing: DraftCredentials, upgrade: (code: string, token: string) => Promise<unknown>, load: (code: string, token: string) => Promise<T>) {
  try {
    // Upgrade only when the applicant selects this draft, before its read. A
    // background upgrade can replace the cookie belonging to a newly created draft.
    if (existing.resumeToken) await upgrade(existing.draftCode, existing.resumeToken);
    const draft = await load(existing.draftCode, '');
    return { draft, metadata: rememberDraftSession(storage, existing.draftCode) };
  } catch (reason) {
    if (isInvalidDraftAccess(reason)) {
      try { if (readDraftSession(storage)?.draftCode === existing.draftCode) storage.removeItem(DRAFT_KEY); } catch { /* Browser storage is optional; preserve the access error for recovery. */ }
    }
    throw reason;
  }
}

export function rememberDraftSession(storage: Pick<Storage, 'setItem'>, draftCode: string) {
  const metadata = { draftCode, viaSession: true as const };
  try { storage.setItem(DRAFT_KEY, JSON.stringify(metadata)); } catch { /* The server cookie remains usable when browser storage is blocked. */ }
  return metadata;
}
