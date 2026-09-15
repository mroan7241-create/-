export const APPLICATION_EVALUATION_WEIGHTS = {
  operationalReadiness: 30,
  technicalCapability: 20,
  previousExperience: 20,
  integrityTransparency: 15,
  participationCommitment: 10,
  sustainabilityImpact: 5,
} as const;

export type EvaluationCriterion = keyof typeof APPLICATION_EVALUATION_WEIGHTS;
export type EvaluationInput = Record<EvaluationCriterion, number>;

export function scoreApplication(input: EvaluationInput) {
  const weighted: Record<string, number> = {};
  let total = 0;
  for (const [key, weight] of Object.entries(APPLICATION_EVALUATION_WEIGHTS) as [EvaluationCriterion, number][]) {
    const raw = input[key];
    if (!Number.isInteger(raw) || raw < 1 || raw > 5) throw new Error(`Invalid evaluation criterion: ${key}`);
    const points = Math.round(((raw / 5) * weight) * 100) / 100;
    weighted[key] = points; total += points;
  }
  return { total: Math.round(total * 100) / 100, breakdown: { raw: input, weighted, weights: APPLICATION_EVALUATION_WEIGHTS } };
}

export interface RankedApplication { id: string; publicCode: string; score: number; evaluationBreakdown?: unknown; }
export function rankApplications<T extends RankedApplication>(items: T[]): T[] {
  return [...items].sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    const aRaw = readRaw(a.evaluationBreakdown);
    const bRaw = readRaw(b.evaluationBreakdown);
    if (bRaw.operationalReadiness !== aRaw.operationalReadiness) return bRaw.operationalReadiness - aRaw.operationalReadiness;
    if (bRaw.technicalCapability !== aRaw.technicalCapability) return bRaw.technicalCapability - aRaw.technicalCapability;
    return a.publicCode.localeCompare(b.publicCode, 'ar');
  });
}

function readRaw(value: unknown): Pick<EvaluationInput, 'operationalReadiness' | 'technicalCapability'> {
  const raw = value && typeof value === 'object' && 'raw' in value ? (value as { raw?: Record<string, unknown> }).raw : undefined;
  return {
    operationalReadiness: typeof raw?.operationalReadiness === 'number' ? raw.operationalReadiness : 0,
    technicalCapability: typeof raw?.technicalCapability === 'number' ? raw.technicalCapability : 0,
  };
}
