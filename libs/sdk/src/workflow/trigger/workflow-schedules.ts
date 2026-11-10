import type { AuthoritiesContextBuilder } from '@frontmcp/auth';
import { type RootStorage } from '@frontmcp/utils';

import { WorkflowTriggerPrincipal, type OnReady } from '../../common';
import { type WorkflowEntry } from '../../common/entries/workflow.entry';
import { type FrontMcpLogger } from '../../common/interfaces/logger.interface';
import { loadCronSchedule, type CronSchedule } from '../../duty/cron-schedule';
import { DutyRunner } from '../../duty/duty.runner';
import {
  isLongLivedProcess,
  leaseKey,
  leaseStorageConfig,
  openLeaseStore,
  type LeaseScope,
} from '../../duty/lease-store';
import { InvalidInputError, JobNotAuthorizedError } from '../../errors';
import { WorkflowTriggerConfigError } from '../../errors/workflow.errors';
import { type JobExecutionManager } from '../../job/execution/job-execution.manager';
import { type JobRegistryInterface } from '../../job/job.registry';
import { type WorkflowRegistryInterface } from '../workflow.registry';
import { resolveWorkflowSchedule, scheduleWorkflows } from './workflow-triggers';

/** How long a schedule's lease outlives a holder that stopped renewing it. */
const SCHEDULE_LEASE_MS = 60_000;

export interface WorkflowSchedulesOptions {
  workflows: WorkflowRegistryInterface;
  manager: JobExecutionManager;
  jobs: JobRegistryInterface;
  /** The scope's authorities context builder, read when a schedule starts a run. */
  authoritiesContextBuilder: () => AuthoritiesContextBuilder | undefined;
  logger: FrontMcpLogger;
  /** The server's name: the leases of its schedules are per server name. */
  serverName: string;
  /** The server's top-level `redis`: with one, a schedule has one lease for every machine. */
  redis: unknown;
}

/**
 * Read a schedule workflow's cron expression.
 *
 * @throws WorkflowTriggerConfigError when the schedule is missing or can't be read
 */
export async function loadWorkflowSchedule(workflow: WorkflowEntry): Promise<CronSchedule> {
  const { cron, timezone } = resolveWorkflowSchedule(workflow);
  return loadCronSchedule({ expression: cron, timezone }).catch((error: Error) => {
    throw new WorkflowTriggerConfigError(workflow.name, `schedule.cron "${cron}" can't be read: ${error.message}`);
  });
}

/**
 * Check the cron expression of each `trigger: 'schedule'` workflow when the server starts.
 *
 * @throws WorkflowTriggerConfigError for the first one that can't be read
 */
export async function assertWorkflowSchedules(workflows: readonly WorkflowEntry[]): Promise<void> {
  for (const workflow of scheduleWorkflows(workflows)) await loadWorkflowSchedule(workflow);
}

/**
 * Starts a background run of each `trigger: 'schedule'` workflow at its scheduled times, with its `schedule.input`, as
 * the role `schedule:<workflow>`. Each schedule has a lease that one process holds, among the machines that share the
 * server's Redis or, without one, among the processes of this machine: a scheduled time starts one run, and a process
 * that takes the lease over starts one run for the times that passed meanwhile. A run that can't start is logged.
 */
export class WorkflowSchedules implements OnReady {
  private readonly runners = new Map<WorkflowEntry, DutyRunner>();
  private storage?: Promise<RootStorage>;
  private unsubscribe?: () => void;
  private followed: Promise<void> = Promise.resolve();
  private started = false;
  private stopped = false;

  constructor(private readonly options: WorkflowSchedulesOptions) {}

  /** Start once the server serves, in a long-lived process only, and follow the workflows registered later. */
  async onReady(): Promise<void> {
    if (this.started || this.stopped) return;
    this.started = true;
    const { workflows, logger } = this.options;
    if (!isLongLivedProcess()) {
      const names = scheduleWorkflows(workflows.getWorkflows(true)).map((workflow) => `"${workflow.name}"`);
      if (names.length > 0) {
        logger.warn(
          `Scheduled workflows (${names.join(', ')}) do not run in a serverless or edge deployment: ` +
            'they need a long-lived process',
        );
      }
      return;
    }
    this.unsubscribe = workflows.subscribe({}, () => void this.follow());
    await this.follow();
  }

  /** Stop every schedule and release its lease. */
  async stop(): Promise<void> {
    this.stopped = true;
    this.unsubscribe?.();
    await this.follow();
    await (await this.storage?.catch(() => undefined))?.disconnect();
  }

  /** Bring the running schedules in line with the registry, one change at a time. */
  private follow(): Promise<void> {
    this.followed = this.followed.then(() => this.followRegistry());
    return this.followed;
  }

  private async followRegistry(): Promise<void> {
    const registered = this.stopped ? [] : scheduleWorkflows(this.options.workflows.getWorkflows(true));
    const current = new Set(registered);
    for (const [workflow, runner] of this.runners) {
      if (current.has(workflow)) continue;
      this.runners.delete(workflow);
      await runner.stop();
    }
    for (const workflow of registered) {
      if (this.runners.has(workflow)) continue;
      try {
        const runner = await this.runnerOf(workflow);
        this.runners.set(workflow, runner);
        await runner.start();
      } catch (error) {
        this.options.logger.error(`The schedule of workflow "${workflow.name}" did not start: ${messageOf(error)}`);
      }
    }
  }

  private async runnerOf(workflow: WorkflowEntry): Promise<DutyRunner> {
    const { serverName, redis, logger } = this.options;
    const { input } = resolveWorkflowSchedule(workflow);
    const cron = await loadWorkflowSchedule(workflow);
    const scope: LeaseScope = leaseStorageConfig(redis, 'schedule', 'cluster').type === 'redis' ? 'cluster' : 'machine';
    this.storage ??= openLeaseStore(leaseStorageConfig(redis, 'schedule', scope));
    return new DutyRunner({
      name: workflow.name,
      label: `The schedule of workflow "${workflow.name}"`,
      key: leaseKey(workflow.name, scope, serverName),
      cron,
      leaseMs: SCHEDULE_LEASE_MS,
      storage: await this.storage,
      logger,
      run: () => this.startRun(workflow, input),
    });
  }

  private async startRun(workflow: WorkflowEntry, input: Record<string, unknown>): Promise<void> {
    const { manager, jobs, authoritiesContextBuilder, logger } = this.options;
    const principal = new WorkflowTriggerPrincipal('schedule', workflow.name);
    try {
      await manager.executeWorkflow(workflow, jobs, {
        background: true,
        authInfo: principal.toAuthInfo(),
        authoritiesContextBuilder: authoritiesContextBuilder(),
        workflowInput: input,
      });
    } catch (error) {
      logger.warn(`The schedule did not start workflow "${workflow.name}": ${whyNotStarted(error, principal.role)}`);
    }
  }
}

function whyNotStarted(error: unknown, role: string): string {
  if (error instanceof JobNotAuthorizedError) {
    return `its create or execute rules don't allow the role "${role}"; add it to their roles`;
  }
  return error instanceof InvalidInputError ? error.getInternalMessage() : messageOf(error);
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
