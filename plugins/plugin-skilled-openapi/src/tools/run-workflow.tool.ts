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
import { Tool, ToolContext } from '@frontmcp/sdk';

import { executeSkillAction, type SkillActionDeps } from '../executor/execute-skill-action';
import { HiddenOpRegistry } from '../registry/hidden-op.registry';
import { AuthorityGuard } from '../security/authority-guard';
import { SkilledOpenApiConfig, SkilledOpenApiCredentialResolver } from '../skilled-openapi.symbols';
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
  async execute(input: RunWorkflowInput): Promise<RunWorkflowOutput> {
    // Lazy-boot the bundle sync so loaded skills' operations are registered.
    this.get(BundleSyncService);
    const config = this.get(SkilledOpenApiConfig);
    const hiddenOps = this.get(HiddenOpRegistry);
    const guard = this.get(AuthorityGuard);
    const resolver = this.get(SkilledOpenApiCredentialResolver);

    // The enclave is an OPTIONAL peer: lazy-import so installs that never run
    // workflows don't need it, and a missing install surfaces as a clear error
    // rather than a module-eval crash.
    let transformAgentScript: (code: string, cfg?: { transformLoops?: boolean }) => string;
    let InterpreterAdapter: typeof import('@enclave-vm/core/worker').InterpreterAdapter;
    try {
      ({ transformAgentScript } = await import('@enclave-vm/ast'));
      ({ InterpreterAdapter } = await import('@enclave-vm/core/worker'));
    } catch {
      return {
        success: false,
        error:
          'workflow execution unavailable: the @enclave-vm sandbox is not installed. Install @enclave-vm/core and @enclave-vm/ast to enable run_workflow.',
      };
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

    // The bridge the sandboxed script reaches as `await callTool(actionId, input)`.
    // It is the ONLY way the script touches the outside world.
    const toolHandler = async (actionId: string, actionInput: Record<string, unknown>): Promise<unknown> => {
      const entry = hiddenOps.getByActionId(actionId);
      if (!entry) {
        throw new Error(`unknown action "${actionId}" — run search_skill then load_skill to discover available actions`);
      }
      const res = await executeSkillAction({ entry, input: actionInput ?? {}, authInfo: this.authInfo, deps });
      if (!res.ok) {
        throw new Error(res.error ?? `action "${actionId}" failed with status ${res.status}`);
      }
      return res.data;
    };

    // Transform user AgentScript → wrapped form. `transformLoops:false` because
    // the interpreter enforces its OWN step budget (the loop-rewrite helpers are
    // unavailable in its scope).
    let transformed: string;
    try {
      transformed = transformAgentScript(input.script, { transformLoops: false });
    } catch (error) {
      return { success: false, error: `AgentScript rejected: ${error instanceof Error ? error.message : String(error)}` };
    }

    const adapter = new InterpreterAdapter({ maxSteps: MAX_STEPS });
    const context = {
      config: { maxToolCalls: MAX_TOOL_CALLS, timeout: TIMEOUT_MS },
      stats: { duration: 0, toolCallCount: 0, iterationCount: 0, startTime: 0 },
      abortController: new AbortController(),
      aborted: false,
      toolHandler,
    };
    const result = await adapter.execute(transformed, context);

    const stats = {
      durationMs: result.stats.duration,
      toolCalls: result.stats.toolCallCount,
      steps: result.stats.iterationCount,
    };
    if (!result.success) {
      return { success: false, error: result.error?.message ?? 'workflow failed', stats };
    }
    return { success: true, value: result.value, stats };
  }
}
