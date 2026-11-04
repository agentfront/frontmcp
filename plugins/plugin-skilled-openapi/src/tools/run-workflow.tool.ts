// file: plugins/plugin-skilled-openapi/src/tools/run-workflow.tool.ts
//
// The EXECUTE leg of the skilled-OpenAPI mechanism: an agent submits a short
// AgentScript program that orchestrates one or more LOADED skill actions, run
// inside an @enclave-vm sandbox (no host access, no network except `callTool`):
// the iframe sandbox in a browser page, the dependency-free interpreter
// elsewhere. Each `callTool(actionId, input)` resolves the operation across
// loaded skills and runs it through the SAME authorize → validate →
// outbound-HTTPS → validate path as a direct action call.
import { Tool, ToolContext, ToolCredentialsRequiredError, type CallToolResult } from '@frontmcp/sdk';

import { confirmationSchema, confirmWorkflow } from '../executor/action-confirmation';
import {
  actionFailureMessage,
  actionOutcome,
  unknownActionError,
  type ActionOutcome,
} from '../executor/action-outcome';
import { executeSkillAction } from '../executor/execute-skill-action';
import { skillActionDepsOf } from '../executor/run-skill-action';
import { loadWorkflowSandbox, splitCallOptions, type WorkflowToolHandler } from '../executor/workflow-sandbox';
import { HiddenOpRegistry } from '../registry/hidden-op.registry';
import { AuthorityGuard } from '../security/authority-guard';
import { SkilledOpenApiConfig } from '../skilled-openapi.symbols';
import { BundleSyncService } from '../sync/bundle-sync.service';
import {
  runWorkflowDescription,
  runWorkflowInputSchema,
  runWorkflowOutputSchema,
  type RunWorkflowInput,
  type RunWorkflowOutput,
} from './run-workflow.schema';

/** A failed workflow as a failed tool call with the same structured content, so clients and the generated CLI see it fail. */
function failedWorkflow(error: string, stats?: RunWorkflowOutput['stats']): CallToolResult {
  const output: RunWorkflowOutput = { success: false, error, ...(stats ? { stats } : {}) };
  return { content: [{ type: 'text', text: JSON.stringify(output) }], structuredContent: output, isError: true };
}

@Tool({
  name: 'run_workflow',
  description: runWorkflowDescription,
  inputSchema: runWorkflowInputSchema,
  outputSchema: runWorkflowOutputSchema,
  annotations: {
    readOnlyHint: false,
    destructiveHint: true,
    openWorldHint: true,
  },
})
export default class RunWorkflowTool extends ToolContext {
  async execute(input: RunWorkflowInput): Promise<RunWorkflowOutput | CallToolResult> {
    // Await the bundle sync so the hidden-op registry is populated before the
    // sandboxed script resolves actions via callTool (stateless workers have no
    // background loop to finish a deferred sync).
    await this.get(BundleSyncService).ensureLoaded();

    // The enclave is an OPTIONAL peer: a missing install surfaces as a clear error rather than a module-eval crash.
    const sandbox = await loadWorkflowSandbox();
    if ('unavailable' in sandbox) return failedWorkflow(sandbox.unavailable);

    // The operations of the bundle the workflow starts on: a swap while it runs doesn't change them.
    const hiddenOps = this.get(HiddenOpRegistry).snapshot();

    let program: string;
    try {
      program = await sandbox.compile(input.script);
    } catch (error) {
      return failedWorkflow(`AgentScript rejected: ${error instanceof Error ? error.message : String(error)}`);
    }

    // Asked before the script starts: time spent waiting for the user would count against the script's time limit.
    const confirmation = await confirmWorkflow({
      script: input.script,
      config: this.get(SkilledOpenApiConfig),
      guard: this.get(AuthorityGuard),
      hiddenOps,
      authInfo: this.authInfo,
      askUser: (message) => this.elicit(message, confirmationSchema),
    });
    if ('refusal' in confirmation) return failedWorkflow(confirmation.refusal);
    const deps = skillActionDepsOf(this, this.logger, confirmation.confirmAction);

    // Aborted once the workflow ends, whatever ends it, so no request it started outlives it.
    const workflowEnded = new AbortController();
    const requestSignal = this.signal ? AbortSignal.any([workflowEnded.signal, this.signal]) : workflowEnded.signal;

    // An action that needs a credential the caller hasn't connected; the sandbox keeps only its message.
    let missingCredential: ToolCredentialsRequiredError | undefined;

    // The bridge the sandboxed script reaches as `await callTool(actionId, input, options)`.
    // It is the ONLY way the script touches the outside world.
    const callAction = async (actionId: string, actionInput: Record<string, unknown>): Promise<ActionOutcome> => {
      const listings = hiddenOps.listingsOf(actionId);
      if (!listings) {
        return {
          ok: false,
          status: 0,
          error: unknownActionError(actionId),
        };
      }
      const result = await executeSkillAction({
        listings,
        input: actionInput,
        authInfo: this.authInfo,
        signal: requestSignal,
        deps,
      }).catch((error: unknown) => {
        if (error instanceof ToolCredentialsRequiredError) missingCredential ??= error;
        throw error;
      });
      return actionOutcome(result, deps.config.outbound.errorBodies, listings[0].authBinding);
    };
    const toolHandler: WorkflowToolHandler = async (actionId, scriptInput) => {
      const { input: actionInput, throwOnError } = splitCallOptions(scriptInput);
      const outcome = await callAction(actionId, actionInput);
      if (!throwOnError) return outcome;
      if (!outcome.ok) throw new Error(actionFailureMessage(actionId, outcome));
      return outcome.data;
    };

    const result = await sandbox
      .run(program, toolHandler)
      .finally(() => workflowEnded.abort(new Error('the workflow ended before the request finished')));

    const stats = {
      durationMs: result.stats.duration,
      toolCalls: result.stats.toolCallCount,
      steps: result.stats.iterationCount,
    };
    if (!result.success && missingCredential) throw missingCredential;
    if (!result.success) return failedWorkflow(result.error?.message ?? 'workflow failed', stats);
    return { success: true, value: result.value, stats };
  }
}
