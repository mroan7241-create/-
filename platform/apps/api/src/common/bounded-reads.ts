/** Read-only jobs overlap without flooding the deliberately bounded database pool. */
export async function boundedReads<const Jobs extends readonly (() => PromiseLike<unknown>)[]>(jobs: Jobs, concurrency = 2): Promise<{ [K in keyof Jobs]: Awaited<ReturnType<Jobs[K]>> }> {
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 4) throw new Error('Invalid read concurrency');
  const results: unknown[] = new Array(jobs.length);
  let next = 0, failed = false;
  await Promise.all(Array.from({ length: Math.min(concurrency, jobs.length) }, async () => {
    while (!failed && next < jobs.length) {
      const index = next++;
      try { results[index] = await jobs[index](); }
      catch (error) { failed = true; throw error; }
    }
  }));
  return results as { [K in keyof Jobs]: Awaited<ReturnType<Jobs[K]>> };
}
