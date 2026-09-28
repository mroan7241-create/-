export type WorkflowJob<Key extends string> = readonly [key: Key, title: string, run: () => Promise<unknown>];

export async function settleSelectedWorkflowJobs<Key extends string>(jobs: WorkflowJob<Key>[], selectedKeys?: readonly Key[]) {
  const selected = selectedKeys?.length ? jobs.filter(([key]) => selectedKeys.includes(key)) : jobs;
  const results = await Promise.allSettled(selected.map(([, , run]) => run()));
  return selected.map(([key, title], index) => ({ key, title, result: results[index] }));
}
