import assert from 'node:assert/strict';
import { test } from 'node:test';
import { settleSelectedWorkflowJobs, type WorkflowJob } from './workflow-jobs.ts';

test('only the requested portal workflow endpoint is called', async () => {
  const called: string[] = [];
  const jobs: WorkflowJob<'participations' | 'deliveries' | 'notifications'>[] = [
    ['participations', 'الميثاق', async () => { called.push('participations'); return [1]; }],
    ['deliveries', 'التسليم', async () => { called.push('deliveries'); return []; }],
    ['notifications', 'الإشعارات', async () => { called.push('notifications'); return []; }],
  ];

  const results = await settleSelectedWorkflowJobs(jobs, ['participations']);
  assert.deepEqual(called, ['participations']);
  assert.deepEqual(results.map(({ key }) => key), ['participations']);
  assert.deepEqual(results[0].result, { status: 'fulfilled', value: [1] });
});

test('a failing requested section cannot hide another requested section', async () => {
  const results = await settleSelectedWorkflowJobs([
    ['one', 'الأول', async () => { throw new Error('offline'); }],
    ['two', 'الثاني', async () => [2]],
  ]);
  assert.deepEqual(results.map(({ result }) => result.status), ['rejected', 'fulfilled']);
});
