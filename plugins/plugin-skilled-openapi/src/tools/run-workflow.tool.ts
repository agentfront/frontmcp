// file: plugins/plugin-skilled-openapi/src/tools/run-workflow.tool.ts
//
// The EXECUTE leg of the skilled-OpenAPI mechanism: an agent submits a short
// AgentScript program that orchestrates one or more LOADED skill actions, run
// inside the dependency-free enclave interpreter (no host access, no network
// except `callTool`). Each `callTool(actionId, input)` resolves the operation
// across loaded skills and runs it through the SAME authorize → validate →
// outbound-HTTPS → validate path as a direct action call. This replaces the
// prior single-shot execute tool with a composable, sandboxed executor.
import { SkillAuditWriterToken, type SkillAuditWriter } from '@frontmcp/adapters/skills';
import { Tool, ToolContext, type CallToolResult } from '@frontmcp/sdk';

import { actionFailureMessage, actionOutcome, type ActionOutcome } from '../executor/action-outcome';
import { credentialResolverOf } from '../executor/credential-resolver';
import { executeSkillAction, type SkillActionDeps } from '../executor/execute-skill-action';
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

// Sandbox limits for a single workflow run.
const MAX_STEPS = 2_000_000;
const MAX_TOOL_CALLS = 25;
const TIMEOUT_MS = 8_000;

/** The input key the options of a script's `callTool` travel under: the sandbox passes its tool handler two arguments. */
const CALL_OPTIONS_KEY = '__callToolOptions';

/** The script's `callTool(actionId, input, options)`, declared ahead of its program, folds the options into the input. */
const CALL_TOOL_PRELUDE = `async function callTool(actionId, input, options) {
  return __safe_callTool(actionId, options == null ? input : { ...input, ${CALL_OPTIONS_KEY}: options });
}`;

function splitCallOptions(scriptInput: Record<string, unknown> | undefined): {
  input: Record<string, unknown>;
  throwOnError: boolean;
} {
  const { [CALL_OPTIONS_KEY]: options, ...input } = scriptInput ?? {};
  const quiet =
    typeof options === 'object' && options !== null && 'throwOnError' in options && options.throwOnError === false;
  return { input, throwOnError: !quiet };
}

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
    const config = this.get(SkilledOpenApiConfig);
    const hiddenOps = this.get(HiddenOpRegistry);
    const guard = this.get(AuthorityGuard);
    const resolver = credentialResolverOf(this);

    // The enclave is an OPTIONAL peer: lazy-import so installs that never run
    // workflows don't need it, and a missing install surfaces as a clear error
    // rather than a module-eval crash.
    let transformAgentScript: (
      code: string,
      cfg?: { transformLoops?: boolean; additionalIdentifiers?: string[] },
    ) => string;
    let InterpreterAdapter: typeof import('@enclave-vm/core/worker').InterpreterAdapter;
    try {
      ({ transformAgentScript } = await import('@enclave-vm/ast'));
      ({ InterpreterAdapter } = await import('@enclave-vm/core/worker'));
    } catch {
      return failedWorkflow(
        'workflow execution unavailable: the @enclave-vm sandbox is not installed. Install @enclave-vm/core and @enclave-vm/ast to enable run_workflow.',
      );
    }

    // Opt-in tamper-evident audit (registered when skillsConfig.audit.enabled).
    const auditWriter = this.tryGet<SkillAuditWriter>(SkillAuditWriterToken);
    const deps: SkillActionDeps = {
      config: { outbound: config.outbound, unprotectedOps: config.unprotectedOps },
      resolver: { resolve: (ref, opts) => resolver.resolve(ref, opts) },
      guard,
      logger: this.logger,
      ...(auditWriter ? { audit: { writer: auditWriter, subject: this.authInfo?.user?.sub ?? 'anonymous' } } : {}),
    };

    // Aborted once the workflow ends, whatever ends it, so no request it started outlives it.
    const workflowEnded = new AbortController();
    const requestSignal = this.signal ? AbortSignal.any([workflowEnded.signal, this.signal]) : workflowEnded.signal;

    // The bridge the sandboxed script reaches as `await callTool(actionId, input, options)`.
    // It is the ONLY way the script touches the outside world.
    const callAction = async (actionId: string, actionInput: Record<string, unknown>): Promise<ActionOutcome> => {
      const listings = hiddenOps.listingsOf(actionId);
      if (!listings) {
        return {
          ok: false,
          status: 0,
          error: `unknown action "${actionId}" — run search_skill then load_skill to discover available actions`,
        };
      }
      const result = await executeSkillAction({
        listings,
        input: actionInput,
        authInfo: this.authInfo,
        signal: requestSignal,
        deps,
      });
      return actionOutcome(result, config.outbound.errorBodies, listings[0].authBinding);
    };
    const toolHandler = async (
      actionId: string,
      scriptInput: Record<string, unknown> | undefined,
    ): Promise<unknown> => {
      const { input: actionInput, throwOnError } = splitCallOptions(scriptInput);
      const outcome = await callAction(actionId, actionInput);
      if (!throwOnError) return outcome;
      if (!outcome.ok) throw new Error(actionFailureMessage(actionId, outcome));
      return outcome.data;
    };

    // Transform user AgentScript → wrapped form. `transformLoops:false` because
    // the interpreter enforces its OWN step budget (the loop-rewrite helpers are
    // unavailable in its scope).
    let transformed: string;
    try {
      transformed = transformAgentScript(input.script, { transformLoops: false, additionalIdentifiers: ['callTool'] });
    } catch (error) {
      return failedWorkflow(`AgentScript rejected: ${error instanceof Error ? error.message : String(error)}`);
    }

    const adapter = new InterpreterAdapter({ maxSteps: MAX_STEPS });
    const context = {
      config: { maxToolCalls: MAX_TOOL_CALLS, timeout: TIMEOUT_MS },
      stats: { duration: 0, toolCallCount: 0, iterationCount: 0, startTime: 0 },
      abortController: new AbortController(),
      aborted: false,
      toolHandler,
    };
    // enclave >= 2.14 types `ExecutionContext.config` as the FULL (Required)
    // EnclaveConfig, but the interpreter only reads `maxToolCalls`/`timeout`/
    // `toolHandler` from the context at runtime (the rest come from the adapter
    // options/defaults). Cast to the adapter's own param type — runtime is
    // unchanged and the extra config fields are genuinely unused here.
    const result = await adapter
      .execute(`${CALL_TOOL_PRELUDE}\n${transformed}`, context as Parameters<typeof adapter.execute>[1])
      .finally(() => workflowEnded.abort(new Error('the workflow ended before the request finished')));

    const stats = {
      durationMs: result.stats.duration,
      toolCalls: result.stats.toolCallCount,
      steps: result.stats.iterationCount,
    };
    if (!result.success) return failedWorkflow(result.error?.message ?? 'workflow failed', stats);
    return { success: true, value: result.value, stats };
  }
}
