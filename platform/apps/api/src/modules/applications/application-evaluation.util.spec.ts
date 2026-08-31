import { APPLICATION_EVALUATION_WEIGHTS, rankApplications, scoreApplication } from './application-evaluation.util';

describe('locked application evaluation', () => {
  it('uses exactly the approved 100-point weights', () => {
    expect(APPLICATION_EVALUATION_WEIGHTS).toEqual({ operationalReadiness: 30, technicalCapability: 20, previousExperience: 20, integrityTransparency: 15, participationCommitment: 10, sustainabilityImpact: 5 });
    expect(Object.values(APPLICATION_EVALUATION_WEIGHTS).reduce((sum, value) => sum + value, 0)).toBe(100);
    expect(scoreApplication({ operationalReadiness: 100, technicalCapability: 100, previousExperience: 100, integrityTransparency: 100, participationCommitment: 100, sustainabilityImpact: 100 }).total).toBe(100);
  });
  it('breaks ties deterministically without adding an unapproved criterion', () => {
    const ranked = rankApplications([
      { id: 'b', score: 80 },
      { id: 'a', score: 80 },
      { id: 'c', score: 80 },
    ]);
    expect(ranked.map((item) => item.id)).toEqual(['a', 'b', 'c']);
  });
});
