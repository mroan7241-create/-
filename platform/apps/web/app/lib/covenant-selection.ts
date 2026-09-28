/** Only a currently selected MAIN participation may prepare or send Covenant V1. */
export function canPrepareCovenant(selectionList: unknown, agreementStatus: unknown): boolean {
  return selectionList === 'MAIN' && (agreementStatus == null || agreementStatus === 'DRAFT');
}
