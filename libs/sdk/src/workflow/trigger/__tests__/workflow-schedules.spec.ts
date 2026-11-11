/**
 * A `trigger: 'schedule'` workflow starts one background run at each time of its cron, in the one process that holds
 * its schedule's lease, with its `schedule.input`, as the role `schedule:<workflow>`.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import {
  createMemoryStorage,
  createStorage,
  resetRuntimeContext,
  type NamespacedStorage,
  type RootStorage,
} from '@frontmcp/utils';

import { workflowTriggerOf } from '../../../common';
import { type WorkflowEntry } from '../../../common/entries/workflow.entry';
import { type FrontMcpLogger } from '../../../common/interfaces/logger.interface';
import { type WorkflowMetadata } from '../../../common/metadata/workflow.metadata';
import { leaseKey } from '../../../duty/lease-store';
import { InvalidInputError, JobNotAuthorizedError, WorkflowTriggerConfigError } from '../../../errors';
import { type JobExecutionManager } from '../../../job/execution/job-execution.manager';
import { type JobRegistryInterface } from '../../../job/job.registry';
import { type WorkflowRegistryInterface } from '../../workflow.registry';
import {
  assertWorkflowSchedules,
  loadWorkflowSchedule,
  scheduledRunId,
  WorkflowSchedules,
} from '../workflow-schedules';
import { assertWorkflowTriggers } from '../workflow-triggers';

jest.mock('@frontmcp/utils', () => {
  const actual = jest.requireActual('@frontmcp/utils');
  return { ...actual, createStorage: jest.fn(actual.createStorage) };
});

const START = new Date('2026-11-10T08:59:30Z').getTime();
const MINUTE = 60_000;
const steps = [{ id: 'send', jobName: 'send-digest' }];

function workflowOf(metadata: Partial<WorkflowMetadata> & { name: string }): WorkflowEntry {
  return { name: metadata.name, metadata: { steps, ...metadata } } as unknown as WorkflowEntry;
}

function scheduled(name: string, cron = '* * * * *', input?: Record<string, unknown>): WorkflowEntry {
  return workflowOf({ name, trigger: 'schedule', schedule: { cron, input } });
}

function clock(): string {
  return new Date().toISOString().slice(11, 19);
}

/** A workflow registry that holds what the test gives it, and tells its subscribers when that changes. */
class FakeRegistry {
  private readonly listeners = new Set<() => void>();
  constructor(private registered: WorkflowEntry[]) {}

  getWorkflows(): WorkflowEntry[] {
    return this.registered;
  }

  subscribe(_options: object, listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  set(registered: WorkflowEntry[]): void {
    this.registered = registered;
    for (const listener of this.listeners) listener();
  }

  get subscribers(): number {
    return this.listeners.size;
  }
}

interface Process {
  schedules: WorkflowSchedules;
  registry: FakeRegistry;
  runs: Array<{ workflow: string; at: string; input: unknown; role: string | undefined }>;
  /** The ids of the runs this process started. */
  runIds: string[];
  startWorkflowRunOnce: jest.Mock;
  logger: jest.Mocked<Pick<FrontMcpLogger, 'verbose' | 'info' | 'warn' | 'error'>>;
}

type LeaseStoreOperations = Pick<
  NamespacedStorage,
  'get' | 'set' | 'setIfEquals' | 'ttl' | 'expireIfEquals' | 'deleteIfEquals' | 'disconnect'
>;

/** A view of the lease store whose operations never return once frozen, as a process that died would leave them. */
function freezable(storage: RootStorage) {
  let frozen = false;
  const through =
    <A extends unknown[], R>(operation: (...args: A) => Promise<R>) =>
    (...args: A): Promise<R> =>
      frozen ? new Promise<R>(() => undefined) : operation(...args);
  const view: LeaseStoreOperations = {
    get: through((key) => storage.get(key)),
    set: through((key, value, options) => storage.set(key, value, options)),
    setIfEquals: through((key, expected, value) => storage.setIfEquals(key, expected, value)),
    ttl: through((key) => storage.ttl(key)),
    expireIfEquals: through((key, expected, ttlSeconds) => storage.expireIfEquals(key, expected, ttlSeconds)),
    deleteIfEquals: through((key, expected) => storage.deleteIfEquals(key, expected)),
    disconnect: async () => undefined,
  };
  return { storage: view as unknown as RootStorage, freeze: () => (frozen = true) };
}

describe('WorkflowSchedules', () => {
  let home: string;
  let previousHome: string | undefined;
  let store: RootStorage;
  let started: WorkflowSchedules[];
  /** The ids of the runs the job store holds, which every process of a test shares. */
  let jobStore: Set<string>;
  const jobs = {} as JobRegistryInterface;
  const builder = { build: jest.fn() };

  beforeEach(async () => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'sdk-workflow-schedules-'));
    previousHome = process.env['FRONTMCP_HOME'];
    process.env['FRONTMCP_HOME'] = home;
    jest.useFakeTimers({ now: START });
    store = createMemoryStorage({ enableSweeper: false });
    await store.connect();
    jest.spyOn(store, 'disconnect').mockResolvedValue(undefined);
    jest.mocked(createStorage).mockResolvedValue(store);
    started = [];
    jobStore = new Set();
  });

  afterEach(async () => {
    await Promise.all(started.map((schedules) => schedules.stop()));
    jest.mocked(createStorage).mockReset();
    jest.restoreAllMocks();
    jest.useRealTimers();
    if (previousHome === undefined) delete process.env['FRONTMCP_HOME'];
    else process.env['FRONTMCP_HOME'] = previousHome;
    fs.rmSync(home, { recursive: true, force: true });
  });

  function processWith(workflows: WorkflowEntry[], redis?: unknown): Process {
    const registry = new FakeRegistry(workflows);
    const runs: Process['runs'] = [];
    const runIds: string[] = [];
    const startWorkflowRunOnce = jest.fn(
      async (workflow: WorkflowEntry, _jobs: unknown, runId: string, options: Record<string, unknown>) => {
        if (jobStore.has(runId)) return false;
        jobStore.add(runId);
        runIds.push(runId);
        runs.push({
          workflow: workflow.name,
          at: clock(),
          input: options['workflowInput'],
          role: workflowTriggerOf(options['authInfo'] as Record<string, unknown>)?.role,
        });
        return true;
      },
    );
    const logger = { verbose: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };
    const schedules = new WorkflowSchedules({
      workflows: registry as unknown as WorkflowRegistryInterface,
      manager: { startWorkflowRunOnce } as unknown as JobExecutionManager,
      jobs,
      authoritiesContextBuilder: () => builder as never,
      logger: logger as unknown as FrontMcpLogger,
      serverName: 'reports',
      redis,
    });
    started.push(schedules);
    return { schedules, registry, runs, runIds, startWorkflowRunOnce, logger };
  }

  /** The key of a schedule's lease without Redis, and the id of its run for a scheduled time. */
  function runIdAt(workflow: string, iso: string): string {
    return scheduledRunId(leaseKey(workflow, 'workspace', 'reports'), new Date(iso).getTime());
  }

  /** The process dies: its lease store stops answering, so its lease runs out, and it is never stopped. */
  function dies(process: Process, view: ReturnType<typeof freezable>): void {
    started.splice(started.indexOf(process.schedules), 1);
    view.freeze();
  }

  it('starts one background run at each scheduled time, as schedule:<workflow>, with the schedule input', async () => {
    const server = processWith([scheduled('digest', '* * * * *', { audience: 'team' })]);
    await server.schedules.onReady();

    await jest.advanceTimersByTimeAsync(2 * MINUTE);

    expect(server.runs).toEqual([
      { workflow: 'digest', at: '09:00:00', input: { audience: 'team' }, role: 'schedule:digest' },
      { workflow: 'digest', at: '09:01:00', input: { audience: 'team' }, role: 'schedule:digest' },
    ]);
    expect(server.startWorkflowRunOnce).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'digest' }),
      jobs,
      runIdAt('digest', '2026-11-10T09:00:00Z'),
      expect.objectContaining({ authoritiesContextBuilder: builder }),
    );
    expect(server.runIds).toEqual([
      runIdAt('digest', '2026-11-10T09:00:00Z'),
      runIdAt('digest', '2026-11-10T09:01:00Z'),
    ]);
    expect(server.logger.info).toHaveBeenCalledWith(
      'The schedule of workflow "digest" runs in this process on cron "* * * * *" (UTC)',
    );
  });

  it('starts a run with {} when the schedule has no input, and reads the cron in its time zone', async () => {
    const nineInBerlin = workflowOf({
      name: 'morning',
      trigger: 'schedule',
      schedule: { cron: '0 9 * * *', timezone: 'Europe/Berlin' },
    });
    const server = processWith([nineInBerlin]);
    await server.schedules.onReady();

    await jest.advanceTimersByTimeAsync(24 * 60 * MINUTE);

    expect(server.runs).toEqual([{ workflow: 'morning', at: '08:00:00', input: {}, role: 'schedule:morning' }]);
  });

  it('starts each scheduled time once among two processes, and the other takes over when the holder stops', async () => {
    const first = processWith([scheduled('digest')]);
    const second = processWith([scheduled('digest')]);
    await first.schedules.onReady();
    await second.schedules.onReady();
    await jest.advanceTimersByTimeAsync(2 * MINUTE);

    expect(first.runs.map((run) => run.at)).toEqual(['09:00:00', '09:01:00']);
    expect(second.runs).toEqual([]);

    await first.schedules.stop();
    await jest.advanceTimersByTimeAsync(2 * MINUTE);

    expect(first.runs).toHaveLength(2);
    expect(second.runs.map((run) => run.at)).toEqual(['09:02:00', '09:03:00']);
  });

  it('starts one run at a takeover for the scheduled times that passed while no process held the schedule', async () => {
    const first = processWith([scheduled('digest')]);
    await first.schedules.onReady();
    await jest.advanceTimersByTimeAsync(MINUTE);
    await first.schedules.stop();

    await jest.advanceTimersByTimeAsync(3 * MINUTE + 15_000);
    const second = processWith([scheduled('digest')]);
    await second.schedules.onReady();
    await jest.advanceTimersByTimeAsync(MINUTE);

    expect(first.runs.map((run) => run.at)).toEqual(['09:00:00']);
    expect(second.runs.map((run) => run.at)).toEqual(['09:03:45', '09:04:00']);
  });

  describe('a holder that dies between taking a scheduled time and its run', () => {
    const daily = () => scheduled('digest', '0 9 * * *');
    const nineToday = '2026-11-10T09:00:00Z';
    const nineTomorrow = '2026-11-11T09:00:00Z';

    /** Two processes share the schedule; the first holds its lease, its lease store seen through `view`. */
    async function holderAndStandby(view: ReturnType<typeof freezable>): Promise<[Process, Process]> {
      jest.mocked(createStorage).mockResolvedValueOnce(view.storage);
      const holder = processWith([daily()]);
      const standby = processWith([daily()]);
      await holder.schedules.onReady();
      await standby.schedules.onReady();
      return [holder, standby];
    }

    it('leaves the run owed when it died before creating it, and the process that takes over starts it once', async () => {
      const view = freezable(store);
      const [holder, standby] = await holderAndStandby(view);
      holder.startWorkflowRunOnce.mockImplementationOnce(() => {
        dies(holder, view);
        return new Promise(() => undefined);
      });

      await jest.advanceTimersByTimeAsync(15 * MINUTE);

      expect(holder.runIds).toEqual([]);
      expect(standby.runIds).toEqual([runIdAt('digest', nineToday)]);
      expect(standby.runs.map((run) => run.at)).toEqual(['09:01:10']);
      expect(standby.startWorkflowRunOnce).toHaveBeenCalledTimes(1);

      await jest.advanceTimersByTimeAsync(24 * 60 * MINUTE);
      expect(standby.runIds).toEqual([runIdAt('digest', nineToday), runIdAt('digest', nineTomorrow)]);
    });

    it('starts no second run when it died after creating the run and before recording it', async () => {
      const view = freezable(store);
      const [holder, standby] = await holderAndStandby(view);
      holder.startWorkflowRunOnce.mockImplementationOnce(async (_workflow: WorkflowEntry, _jobs, runId: string) => {
        jobStore.add(runId);
        holder.runIds.push(runId);
        dies(holder, view);
        return true;
      });

      await jest.advanceTimersByTimeAsync(15 * MINUTE);

      expect(standby.runIds).toEqual([]);
      expect([...jobStore]).toEqual([runIdAt('digest', nineToday)]);
      expect(holder.runIds).toEqual([runIdAt('digest', nineToday)]);
      expect(standby.startWorkflowRunOnce.mock.calls.map(([, , runId]) => runId)).toEqual([
        runIdAt('digest', nineToday),
      ]);

      await jest.advanceTimersByTimeAsync(24 * 60 * MINUTE);
      expect(standby.runIds).toEqual([runIdAt('digest', nineTomorrow)]);
    });

    it('finds the run already started when recording it failed, and catches up the time it held up', async () => {
      const server = processWith([scheduled('digest')]);
      const setIfEquals = store.setIfEquals.bind(store);
      let writes = 0;
      jest.spyOn(store, 'setIfEquals').mockImplementation((key, expected, value) => {
        writes++;
        return writes === 2 ? Promise.reject(new Error('database is locked')) : setIfEquals(key, expected, value);
      });
      await server.schedules.onReady();

      await jest.advanceTimersByTimeAsync(4 * MINUTE);

      expect(server.logger.warn).toHaveBeenCalledWith(
        'The schedule of workflow "digest": the lease store failed: database is locked',
      );
      expect(server.startWorkflowRunOnce.mock.calls.map(([, , runId]) => runId)).toEqual([
        runIdAt('digest', '2026-11-10T09:00:00Z'),
        runIdAt('digest', '2026-11-10T09:00:00Z'),
        runIdAt('digest', '2026-11-10T09:01:00Z'),
        runIdAt('digest', '2026-11-10T09:03:00Z'),
      ]);
      expect(server.runs.map((run) => run.at)).toEqual(['09:00:00', '09:02:00', '09:03:00']);
    });

    it('does not start a run again whose start was refused, after a takeover either', async () => {
      const [holder, standby] = await holderAndStandby(freezable(store));
      holder.startWorkflowRunOnce.mockRejectedValueOnce(new JobNotAuthorizedError('digest'));

      await jest.advanceTimersByTimeAsync(MINUTE);
      await holder.schedules.stop();
      await jest.advanceTimersByTimeAsync(15 * MINUTE);

      expect(holder.startWorkflowRunOnce).toHaveBeenCalledTimes(1);
      expect(holder.logger.warn).toHaveBeenCalledTimes(1);
      expect(standby.startWorkflowRunOnce).not.toHaveBeenCalled();
      expect(jobStore.size).toBe(0);
    });
  });

  it('keeps one lease for every machine in Redis, and one per project root in the SQLite file without it', async () => {
    const clustered = processWith([scheduled('digest')], { url: 'redis://cache.internal:6379' });
    const local = processWith([scheduled('rollup')]);
    await clustered.schedules.onReady();
    await local.schedules.onReady();

    expect(jest.mocked(createStorage).mock.calls.map(([config]) => [config?.type, config?.prefix])).toEqual([
      ['redis', 'frontmcp:cluster:schedule:'],
      ['sqlite', 'frontmcp:schedule:'],
    ]);
    expect(await store.keys('*')).toEqual(
      expect.arrayContaining(['reports:digest', leaseKey('rollup', 'workspace', 'reports')]),
    );
  });

  it('follows the workflows registered and unregistered later, and opens one lease store for all', async () => {
    const digest = scheduled('digest');
    const rollup = scheduled('rollup');
    const server = processWith([digest, workflowOf({ name: 'manual' })]);
    await server.schedules.onReady();
    await jest.advanceTimersByTimeAsync(MINUTE);
    const digestHolder = await store.get('reports:digest');

    server.registry.set([digest, rollup]);
    await jest.advanceTimersByTimeAsync(MINUTE);
    expect(await store.get('reports:digest')).toBe(digestHolder);

    server.registry.set([rollup]);
    await jest.advanceTimersByTimeAsync(MINUTE);

    expect(server.runs.map((run) => [run.workflow, run.at])).toEqual([
      ['digest', '09:00:00'],
      ['digest', '09:01:00'],
      ['rollup', '09:01:00'],
      ['rollup', '09:02:00'],
    ]);
    expect(await store.get('reports:digest')).toBeNull();
    expect(createStorage).toHaveBeenCalledTimes(1);
  });

  it.each([
    [
      new JobNotAuthorizedError('digest'),
      'The schedule did not start workflow "digest": its create or execute rules don\'t allow the role ' +
        '"schedule:digest"; add it to their roles',
    ],
    [
      new InvalidInputError('Invalid input for workflow "digest"', [{ path: ['audience'] }]),
      expect.stringContaining('The schedule did not start workflow "digest": Invalid input for workflow "digest"'),
    ],
    [new Error('the run store is closed'), 'The schedule did not start workflow "digest": the run store is closed'],
    ['unreachable', 'The schedule did not start workflow "digest": unreachable'],
  ])('logs a run that could not start (%p), and tries again at the next scheduled time', async (failure, warning) => {
    const server = processWith([scheduled('digest')]);
    server.startWorkflowRunOnce.mockRejectedValueOnce(failure);
    await server.schedules.onReady();

    await jest.advanceTimersByTimeAsync(2 * MINUTE);

    expect(server.logger.warn).toHaveBeenCalledWith(warning);
    expect(server.runs.map((run) => run.at)).toEqual(['09:01:00']);
  });

  it('does not start a workflow registered later whose cron cannot be read, and says so', async () => {
    const server = processWith([scheduled('digest')]);
    await server.schedules.onReady();

    server.registry.set([scheduled('digest'), scheduled('broken', '61 * * * *')]);
    await jest.advanceTimersByTimeAsync(MINUTE);

    expect(server.logger.error).toHaveBeenCalledWith(
      'The schedule of workflow "broken" did not start: Workflow "broken": schedule.cron "61 * * * *" can\'t be ' +
        'read: Invalid value for minute: 61',
    );
  });

  it('says why no schedule starts when the lease store cannot be opened', async () => {
    jest.mocked(createStorage).mockReset().mockRejectedValue(new Error('@frontmcp/storage-sqlite is not installed'));
    const server = processWith([scheduled('digest'), scheduled('rollup')]);
    await server.schedules.onReady();
    await jest.advanceTimersByTimeAsync(2 * MINUTE);

    expect(server.runs).toEqual([]);
    expect(server.logger.error.mock.calls).toEqual([
      ['The schedule of workflow "digest" did not start: @frontmcp/storage-sqlite is not installed'],
      ['The schedule of workflow "rollup" did not start: @frontmcp/storage-sqlite is not installed'],
    ]);
    await server.schedules.stop();
  });

  it('starts nothing in a serverless deployment, and says which workflows do not run', async () => {
    process.env['FRONTMCP_DEPLOYMENT_MODE'] = 'serverless';
    resetRuntimeContext();
    const server = processWith([scheduled('digest'), scheduled('rollup')]);
    const idle = processWith([workflowOf({ name: 'manual' })]);
    try {
      await server.schedules.onReady();
      await idle.schedules.onReady();
      await jest.advanceTimersByTimeAsync(2 * MINUTE);
    } finally {
      delete process.env['FRONTMCP_DEPLOYMENT_MODE'];
      resetRuntimeContext();
    }

    expect(server.runs).toEqual([]);
    expect(createStorage).not.toHaveBeenCalled();
    expect(server.registry.subscribers).toBe(0);
    expect(server.logger.warn.mock.calls).toEqual([
      [
        'Scheduled workflows ("digest", "rollup") do not run in a serverless or edge deployment: they need a ' +
          'long-lived process',
      ],
    ]);
    expect(idle.logger.warn).not.toHaveBeenCalled();
  });

  it('starts once, stops for good, and stops following the registry', async () => {
    const server = processWith([scheduled('digest')]);
    await server.schedules.onReady();
    await server.schedules.onReady();
    await jest.advanceTimersByTimeAsync(MINUTE);

    await server.schedules.stop();
    await server.schedules.onReady();
    server.registry.set([scheduled('digest'), scheduled('rollup')]);
    await jest.advanceTimersByTimeAsync(3 * MINUTE);

    expect(server.runs.map((run) => run.at)).toEqual(['09:00:00']);
    expect(server.registry.subscribers).toBe(0);
    expect(await store.get('reports:digest')).toBeNull();
    expect(store.disconnect).toHaveBeenCalledTimes(1);
  });

  it('does nothing on stop() before the server served', async () => {
    const server = processWith([scheduled('digest')]);

    await server.schedules.stop();
    await server.schedules.onReady();
    await jest.advanceTimersByTimeAsync(2 * MINUTE);

    expect(server.runs).toEqual([]);
    expect(createStorage).not.toHaveBeenCalled();
  });
});

describe('the schedule of a workflow, checked when the server starts', () => {
  const failure = (workflow: WorkflowEntry) => {
    try {
      assertWorkflowTriggers([workflow]);
    } catch (error) {
      return error;
    }
    return undefined;
  };

  it('accepts a schedule workflow with a cron, and a time zone the runtime knows', async () => {
    const workflows = [
      scheduled('digest', '0 9 * * 1-5'),
      workflowOf({ name: 'morning', trigger: 'schedule', schedule: { cron: '0 9 * * *', timezone: 'Europe/Berlin' } }),
      workflowOf({ name: 'manual' }),
    ];

    expect(() => assertWorkflowTriggers(workflows)).not.toThrow();
    await expect(assertWorkflowSchedules(workflows)).resolves.toBeUndefined();
    expect((await loadWorkflowSchedule(workflows[1])).timezone).toBe('Europe/Berlin');
  });

  it.each([
    [
      'a schedule trigger without a schedule',
      workflowOf({ name: 'digest', trigger: 'schedule' }),
      'Workflow "digest": trigger: \'schedule\' needs schedule.cron, a cron expression such as "0 9 * * 1-5", and ' +
        'the server does not start without it',
    ],
    [
      'a time zone the runtime does not know',
      workflowOf({ name: 'digest', trigger: 'schedule', schedule: { cron: '0 9 * * *', timezone: 'Mars/Olympus' } }),
      'Workflow "digest": schedule.timezone "Mars/Olympus" is not an IANA time zone such as "Europe/Berlin"',
    ],
    [
      'a schedule on a manual workflow',
      workflowOf({ name: 'digest', schedule: { cron: '0 9 * * *' } }),
      "Workflow \"digest\": schedule is set, but trigger is not 'schedule': set trigger: 'schedule' to run it on " +
        'that schedule, or remove schedule',
    ],
    [
      'a schedule on an event workflow',
      workflowOf({ name: 'digest', trigger: 'event', schedule: { cron: '0 9 * * *' } }),
      "Workflow \"digest\": schedule is set, but trigger is not 'schedule': set trigger: 'schedule' to run it on " +
        'that schedule, or remove schedule',
    ],
  ])('refuses %s', (_what, workflow, message) => {
    const error = failure(workflow);

    expect(error).toBeInstanceOf(WorkflowTriggerConfigError);
    expect((error as Error).message).toBe(message);
  });

  it.each([
    ['61 * * * *', 'Invalid value for minute: 61'],
    ['every morning', "invalid configuration format ('every morning')"],
    ['0 0 30 2 *', 'it never matches a date'],
  ])('refuses a cron that cannot be read (%p)', async (cron, reason) => {
    const refused = assertWorkflowSchedules([workflowOf({ name: 'manual' }), scheduled('digest', cron)]);

    await expect(refused).rejects.toBeInstanceOf(WorkflowTriggerConfigError);
    await expect(refused).rejects.toThrow(`Workflow "digest": schedule.cron "${cron}" can't be read: ${reason}`);
  });
});
