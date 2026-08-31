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
    if (!Number.isFinite(raw) || raw < 0 || raw > 100) throw new Error(`Invalid evaluation criterion: ${key}`);
    const points = Math.round((raw * weight)) / 100;
    weighted[key] = points; total += points;
  }
  return { total: Math.round(total * 100) / 100, breakdown: { raw: input, weighted, weights: APPLICATION_EVALUATION_WEIGHTS } };
}

export interface RankedApplication { id: string; score: number; }
export function rankApplications<T extends RankedApplication>(items: T[]): T[] {
  return [...items].sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
}
