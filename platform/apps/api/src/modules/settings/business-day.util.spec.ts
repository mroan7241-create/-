import { addRiyadhWorkingHours } from './business-day.util';
describe('Asia/Riyadh business calendar', () => {
  it('skips Friday, Saturday, and configured holidays', () => {
    const start = new Date('2026-08-20T20:00:00.000Z'); // Thursday 23:00 Riyadh
    expect(addRiyadhWorkingHours(start, 2, { workingDays: [0, 1, 2, 3, 4], holidays: ['2026-08-23'] }).toISOString()).toBe('2026-08-23T22:00:00.000Z');
  });
});
