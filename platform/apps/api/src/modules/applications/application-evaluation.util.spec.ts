import { APPLICATION_EVALUATION_WEIGHTS, rankApplications, scoreApplication } from './application-evaluation.util';

describe('locked application evaluation', () => {
  it('uses exactly the approved 100-point weights', () => {
    expect(APPLICATION_EVALUATION_WEIGHTS).toEqual({ operationalReadiness: 30, technicalCapability: 20, previousExperience: 20, integrityTransparency: 15, participationCommitment: 10, sustainabilityImpact: 5 });
    expect(Object.values(APPLICATION_EVALUATION_WEIGHTS).reduce((sum, value) => sum + value, 0)).toBe(100);
    expect(scoreApplication({ operationalReadiness: 5, technicalCapability: 5, previousExperience: 5, integrityTransparency: 5, participationCommitment: 5, sustainabilityImpact: 5 }).total).toBe(100);
  });
  it('breaks ties deterministically without adding an unapproved criterion', () => {
    const ranked = rankApplications([
      { id: 'b', publicCode: 'APP-000002', score: 80 },
      { id: 'a', publicCode: 'APP-000001', score: 80 },
      { id: 'c', publicCode: 'APP-000003', score: 80 },
    ]);
    expect(ranked.map((item) => item.id)).toEqual(['a', 'b', 'c']);
  });
});
