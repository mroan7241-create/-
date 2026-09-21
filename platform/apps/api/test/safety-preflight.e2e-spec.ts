describe('destructive E2E preflight', () => {
  it('runs only after setup has verified the database canary', () => {
    expect(process.env.ALLOW_DESTRUCTIVE_E2E).toBe('true');
  });
});
