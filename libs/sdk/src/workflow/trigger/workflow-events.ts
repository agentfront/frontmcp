import type { AuthoritiesContextBuilder } from '@frontmcp/auth';

import { type ChannelEventBus } from '../../channel/sources/app-event.source';
import { WorkflowTriggerPrincipal } from '../../common';
import { type WorkflowEntry } from '../../common/entries/workflow.entry';
import { type FrontMcpLogger } from '../../common/interfaces/logger.interface';
import { InvalidInputError, JobNotAuthorizedError } from '../../errors';
import { type JobExecutionManager } from '../../job/execution/job-execution.manager';
import { type JobRegistryInterface } from '../../job/job.registry';
import { eventWorkflows, workflowEventName } from './workflow-triggers';

export interface WorkflowEventListeners {
  bus: ChannelEventBus;
  manager: JobExecutionManager;
  jobs: JobRegistryInterface;
  /** The scope's authorities context builder, read when an event starts a run. */
  authoritiesContextBuilder: () => AuthoritiesContextBuilder | undefined;
  logger: FrontMcpLogger;
}

/**
 * Start a background run of each `trigger: 'event'` workflow whenever the bus emits its event, with the payload as
 * its input, as the role `event:<event>`. A run that can't start is logged, never thrown at the emitter.
 *
 * @returns What stops listening
 */
export function listenToWorkflowEvents(workflows: readonly WorkflowEntry[], listeners: WorkflowEventListeners) {
  const stops = eventWorkflows(workflows).map((workflow) => {
    const event = workflowEventName(workflow);
    return listeners.bus.on(event, (payload) => void startEventRun(workflow, event, payload, listeners));
  });
  return () => stops.forEach((stop) => stop());
}

async function startEventRun(
  workflow: WorkflowEntry,
  event: string,
  payload: unknown,
  { manager, jobs, authoritiesContextBuilder, logger }: WorkflowEventListeners,
): Promise<void> {
  const cannotStart = (reason: string) =>
    logger.warn(`Event "${event}" did not start workflow "${workflow.name}": ${reason}`);
  const input = payload === undefined || payload === null ? {} : payload;
  if (typeof input !== 'object' || Array.isArray(input)) {
    cannotStart('its payload is not an object, which the run takes as its input');
    return;
  }
  const principal = new WorkflowTriggerPrincipal('event', event);
  try {
    await manager.executeWorkflow(workflow, jobs, {
      background: true,
      authInfo: principal.toAuthInfo(),
      authoritiesContextBuilder: authoritiesContextBuilder(),
      workflowInput: input as Record<string, unknown>,
    });
  } catch (error) {
    if (error instanceof JobNotAuthorizedError) {
      cannotStart(`its create or execute rules don't allow the role "${principal.role}"; add it to their roles`);
    } else if (error instanceof InvalidInputError) {
      cannotStart(error.getInternalMessage());
    } else {
      cannotStart(error instanceof Error ? error.message : String(error));
    }
  }
}
