import { appendFileSync } from 'node:fs';

import { z } from '@frontmcp/lazy-zod';
import { App, Job, JobContext, Workflow, type JobPermission } from '@frontmcp/sdk';

/** Any caller may read and cancel these runs: each test client is a different anonymous user. */
const anyone: JobPermission[] = [{ action: 'read' }, { action: 'delete' }];

/** Append `<tag> <event> <ms> <pid>` to the file the test reads, from whichever process writes it. */
export function record(tag: string, event: string): void {
  const events = process.env['JOBS_EVENTS_PATH'];
  if (events) appendFileSync(events, `${tag} ${event} ${Date.now()} ${process.pid}\n`);
}

@Job({
  name: 'hold-slot',
  description: 'Holds its admission slot for `holdMs`, writing when it starts and ends',
  inputSchema: { tag: z.string(), holdMs: z.number().int().nonnegative() },
  outputSchema: { pid: z.number() },
  runner: 'detached',
  timeout: 0,
  permissions: anyone,
})
export class HoldSlotJob extends JobContext {
  async execute({ tag, holdMs }: { tag: string; holdMs: number }) {
    record(tag, 'start');
    await new Promise((resolve) => setTimeout(resolve, holdMs));
    record(tag, 'end');
    return { pid: process.pid };
  }
}

@Job({
  name: 'note-step',
  description: 'Writes that its step ran, and where',
  inputSchema: { tag: z.string() },
  outputSchema: { pid: z.number() },
  timeout: 0,
})
export class NoteStepJob extends JobContext {
  async execute({ tag }: { tag: string }) {
    record(tag, 'step');
    return { pid: process.pid };
  }
}

@Job({
  name: 'wait-step',
  description: 'Runs until its workflow run is cancelled',
  inputSchema: { tag: z.string() },
  outputSchema: {},
  timeout: 0,
})
export class WaitStepJob extends JobContext {
  async execute({ tag }: { tag: string }): Promise<Record<string, never>> {
    record(tag, 'waiting');
    await new Promise((resolve) => this.signal?.addEventListener('abort', resolve, { once: true }));
    record(tag, 'aborted');
    return {};
  }
}

@Workflow({
  name: 'detached-notes',
  description: 'Two steps, run in a process of their own',
  runner: 'detached',
  permissions: anyone,
  inputSchema: { tag: z.string() },
  steps: [
    { id: 'first', jobName: 'note-step', input: (_steps, input) => ({ tag: `${input['tag']}-first` }) },
    {
      id: 'second',
      jobName: 'note-step',
      dependsOn: ['first'],
      input: (_steps, input) => ({ tag: `${input['tag']}-second` }),
    },
  ],
})
export class DetachedNotesFlow {}

@Workflow({
  name: 'detached-wait',
  description: 'A step that runs until the run is cancelled, then one that must never run',
  runner: 'detached',
  permissions: anyone,
  inputSchema: { tag: z.string() },
  steps: [
    { id: 'wait', jobName: 'wait-step' },
    {
      id: 'after',
      jobName: 'note-step',
      dependsOn: ['wait'],
      input: (_steps, input) => ({ tag: `${input['tag']}-after` }),
    },
  ],
})
export class DetachedWaitFlow {}

const RuntimeBoot = Symbol('RuntimeBoot');
const MarkerBoot = Symbol('MarkerBoot');

/** The jobs and workflows; its provider writes `runtime booted` in each process that boots it. */
@App({
  id: 'runtime',
  name: 'Runtime',
  jobs: [HoldSlotJob, NoteStepJob, WaitStepJob],
  workflows: [DetachedNotesFlow, DetachedWaitFlow],
  providers: [{ name: 'runtime-boot', provide: RuntimeBoot, useFactory: () => record('runtime', 'booted') }],
})
export class RuntimeApp {}

/** An app with no jobs: its provider writes `marker booted` in each process that boots it. */
@App({
  id: 'marker',
  name: 'Marker',
  providers: [{ name: 'marker-boot', provide: MarkerBoot, useFactory: () => record('marker', 'booted') }],
})
export class MarkerApp {}
