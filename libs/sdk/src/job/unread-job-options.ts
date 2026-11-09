import { type WorkflowMetadata } from '../common/metadata/workflow.metadata';

/**
 * Describe the trigger options of a workflow that nothing reads, in one message. A workflow runs only through
 * `execute_workflow`: `trigger: 'webhook'` and `webhook` register no HTTP route, and `trigger: 'event'` listens
 * to no event.
 */
export function describeIgnoredTrigger(metadata: Pick<WorkflowMetadata, 'name' | 'trigger' | 'webhook'>): string[] {
  const { name, trigger, webhook } = metadata;
  if (trigger === 'event') {
    return [
      `Workflow "${name}": \`trigger: 'event'\` listens to no event, so nothing starts the workflow on its own; ` +
        'it runs only through execute_workflow.',
    ];
  }
  if (trigger === 'webhook' || webhook !== undefined) {
    return [
      `Workflow "${name}": \`trigger: 'webhook'\` and \`webhook\` register no HTTP route, so no request starts ` +
        'the workflow; it runs only through execute_workflow. To start it from a webhook, serve an @HttpRoute ' +
        "that checks the request's signature and calls execute_workflow.",
    ];
  }
  return [];
}
