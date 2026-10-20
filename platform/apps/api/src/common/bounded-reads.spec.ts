import { boundedReads } from './bounded-reads';

describe('bounded read scheduling', () => {
  it('preserves results and caps simultaneous jobs at two', async () => {
    let active = 0, peak = 0;
    const result = await boundedReads(Array.from({ length: 9 }, (_, index) => async () => {
      active++; peak = Math.max(peak, active);
      await new Promise(resolve => setTimeout(resolve, index === 0 ? 8 : 1));
      active--; return index;
    }));
    expect(result).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);
    expect(peak).toBe(2);
  });
  it('propagates failure instead of manufacturing zero counts', async () => {
    await expect(boundedReads([async () => { throw new Error('database unavailable'); }])).rejects.toThrow('database unavailable');
    await expect(boundedReads([], 99)).rejects.toThrow('Invalid read concurrency');
  });
});
