export const DRAFT_KEY = 'alzad.apply.v2.draft';

export function rememberDraftSession(storage: Pick<Storage, 'setItem'>, draftCode: string) {
  const metadata = { draftCode, viaSession: true as const };
  storage.setItem(DRAFT_KEY, JSON.stringify(metadata));
  return metadata;
}
