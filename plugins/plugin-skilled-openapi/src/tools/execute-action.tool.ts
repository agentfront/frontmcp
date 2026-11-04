import { z } from '@frontmcp/lazy-zod';
import { Tool, ToolContext, type CallToolResult } from '@frontmcp/sdk';

import { confirmationSchema } from '../executor/action-confirmation';
import { actionFailureMessage, unknownActionError, type ActionOutcome } from '../executor/action-outcome';
import { runSkillAction } from '../executor/run-skill-action';
import { HiddenOpRegistry, type OperationListings } from '../registry/hidden-op.registry';
import { SkilledOpenApiConfig } from '../skilled-openapi.symbols';
import { BundleSyncService } from '../sync/bundle-sync.service';
import { executeActionDescription, executeActionInputSchema, type ExecuteActionInput } from './execute-action.schema';
import { operationToolName } from './operation-tool.factory';

/** The outcome an operation tool answers with, as its structured content. */
const operationOutcomeSchema = z.object({
  ok: z.boolean(),
  status: z.number(),
  data: z.unknown().optional(),
  error: z.string().optional(),
});

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** A succeeded action's data as the tool result: as text, and as structured content (an object, or under `value`). */
function succeededAction(actionId: string, { status, data }: ActionOutcome): CallToolResult {
  if (data === undefined) {
    return { content: [{ type: 'text', text: `action "${actionId}" succeeded with status ${status} and no content` }] };
  }
  return {
    content: [{ type: 'text', text: typeof data === 'string' ? data : JSON.stringify(data) }],
    structuredContent: isJsonObject(data) ? data : { value: data },
  };
}

/** A failed action as a failed tool call: why it failed as text, and the outcome as structured content. */
function failedAction(actionId: string, outcome: ActionOutcome): CallToolResult {
  return {
    content: [{ type: 'text', text: actionFailureMessage(actionId, outcome) }],
    structuredContent: { ...outcome },
    isError: true,
  };
}

function actionResult(actionId: string, outcome: ActionOutcome): CallToolResult {
  return outcome.ok ? succeededAction(actionId, outcome) : failedAction(actionId, outcome);
}

@Tool({
  name: 'execute_action',
  description: executeActionDescription,
  inputSchema: executeActionInputSchema,
  annotations: {
    readOnlyHint: false,
    destructiveHint: true,
    openWorldHint: true,
  },
})
export default class ExecuteActionTool extends ToolContext {
  async execute({ actionId, input = {} }: ExecuteActionInput): Promise<CallToolResult> {
    await this.get(BundleSyncService).ensureLoaded();
    const listings = this.get(HiddenOpRegistry).listingsOf(actionId);
    if (!listings) return failedAction(actionId, { ok: false, status: 0, error: unknownActionError(actionId) });

    if (!this.get(SkilledOpenApiConfig).options.exposeOperationsAsInternalTools) {
      const askUser = (message: string) => this.elicit(message, confirmationSchema);
      return actionResult(actionId, await runSkillAction({ ctx: this, logger: this.logger, listings, input, askUser }));
    }
    return this.callOperationTool(actionId, listings, input);
  }

  /** Call the action's operation tool, and answer with its outcome; an answer a hook reshaped goes back as it is. */
  private async callOperationTool(
    actionId: string,
    [{ bundleId, op }]: OperationListings,
    input: Record<string, unknown>,
  ): Promise<CallToolResult> {
    const answer = await this.callTool(operationToolName(bundleId, op.operationId), input, { signal: this.signal });
    const outcome = operationOutcomeSchema.safeParse(answer.structuredContent);
    return outcome.success ? actionResult(actionId, outcome.data) : answer;
  }
}
