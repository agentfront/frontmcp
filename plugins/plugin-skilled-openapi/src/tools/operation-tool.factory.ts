// file: plugins/plugin-skilled-openapi/src/tools/operation-tool.factory.ts
//
// Builds a synthetic `ToolInstance` per OpenAPI operation so other in-process
// callers (skilled tools, agents, CodeCall scripts, jobs, and the plugin's own
// `execute_action`) can compose with the operation via
// `this.callTool(name, args)` from `ExecutionContextBase`.
//
// These tools are registered with `metadata.visibility: 'internal'`:
//   - never advertised in `tools/list`
//   - never callable from external `tools/call` requests (the SDK's call-tool
//     flow rejects external invocations of internal tools)
//   - callable only via the SDK-internal `callTool` helper, which tags the
//     request ctx with `internalCall: true`

import { classifyOne, type ClassificationRegistry } from '@frontmcp/adapters/skills';
import { type Token } from '@frontmcp/di';
import {
  ToolInstance,
  ToolKind,
  type EntryOwnerRef,
  type FrontMcpLogger,
  type ProviderRegistry,
  type ToolFunctionTokenRecord,
  type ToolMetadata,
  type ToolRegistry,
} from '@frontmcp/sdk';

import { runSkillAction, type OperationToolResult, type SkillActionContext } from '../executor/run-skill-action';
import { type HiddenOpEntry, type OperationListings } from '../registry/hidden-op.registry';

const OPERATION_TOOL_OWNER_TOKEN = Symbol.for('skilled-openapi:operation-tool-owner');
const OPERATION_TOOL_OWNER: EntryOwnerRef = {
  kind: 'plugin',
  id: 'skilled-openapi',
  ref: OPERATION_TOOL_OWNER_TOKEN,
};

/**
 * Compute the registered tool name for an OpenAPI operation.
 * Format: `<bundleId>.<operationId>` — bundle-namespaced so multiple bundles
 * can register operations with overlapping operationIds without collision.
 */
export function operationToolName(bundleId: string, operationId: string): string {
  // Tool names are constrained to 1..64 chars by the call-tool flow's input
  // schema. Prefer the namespaced form; if it overflows, fall back to opId
  // alone (the flow's findByName checks both `fullName` and `name`). When
  // operationId itself exceeds 64 chars, deterministically truncate so the
  // returned name is always valid.
  const namespaced = `${bundleId}.${operationId}`;
  if (namespaced.length <= 64) return namespaced;
  return operationId.length <= 64 ? operationId : operationId.slice(0, 64);
}

/** Build the ToolMetadata block for an operation entry. */
function buildOperationMetadata(entry: HiddenOpEntry): ToolMetadata {
  const name = operationToolName(entry.bundleId, entry.op.operationId);
  const summary = entry.op.summary ?? `${entry.op.httpMethod} ${entry.op.pathTemplate}`;
  const description = entry.op.description ? `${summary}\n\n${entry.op.description}` : summary;
  // The op's input schema is JSON Schema (Draft 2020-12). The SDK's tool
  // call-tool flow honors `rawInputSchema` (set via metadata passthrough)
  // for non-zod schemas — passing the JSON Schema as `rawInputSchema` lets
  // the existing remote-style validation flow without coercing to a Zod shape.
  const meta: ToolMetadata & { rawInputSchema?: unknown } = {
    name,
    description,
    inputSchema: {},
    outputSchema: undefined,
    visibility: 'internal',
    annotations: {
      readOnlyHint: entry.op.httpMethod === 'GET' || entry.op.httpMethod === 'HEAD',
      destructiveHint: entry.op.httpMethod !== 'GET' && entry.op.httpMethod !== 'HEAD',
      openWorldHint: true,
    },
  };
  meta.rawInputSchema = entry.op.inputSchema;
  return meta;
}

export interface OperationToolFactoryDeps {
  /** Tool registry to register/unregister synthetic operation tools. */
  toolRegistry: ToolRegistry;
  /** Provider registry to bind synthesized ToolInstances to. */
  providers: ProviderRegistry;
  /** Logger for diagnostics. */
  logger: FrontMcpLogger;
  /**
   * Optional classification registry. When set together with `pathsWithGet`
   * on each `register()` call, the factory also records the OpenAPI -> MCP
   * classification for the operation so a runtime dispatcher hook can
   * auto-emit `notifications/resources/updated` / `…/list_changed` on
   * successful tool calls. Unregistering via `unregisterAll()` clears the
   * matching classification entries.
   */
  classificationRegistry?: ClassificationRegistry;
}

/**
 * Optional context passed per `register()` call so the factory can classify
 * the operation against the rest of the bundle. Callers (typically the
 * bundle-sync service) precompute `pathsWithGet` once over the bundle's
 * full operation list before iterating.
 */
export interface OperationRegisterContext {
  /** Set of path templates that have a GET op in the same bundle. */
  pathsWithGet: ReadonlySet<string>;
}

/** The tool context an operation's function runs in. */
type OperationToolContext = SkillActionContext & { logger: FrontMcpLogger };

type OperationExecutor = (input: Record<string, unknown>, ctx: OperationToolContext) => Promise<OperationToolResult>;

/**
 * Manages the lifecycle of synthetic per-operation internal tools for one
 * Skilled OpenAPI plugin instance.
 */
export class OperationToolFactory {
  /** Map (bundleId|opId) → the executor function that doubles as registry token, and the skills that list the op. */
  private registered = new Map<
    string,
    { executor: OperationExecutor; listings: [HiddenOpEntry, ...HiddenOpEntry[]] }
  >();
  /** Tool names this factory has pushed into the classification registry. */
  private classificationKeys = new Set<string>();

  constructor(private readonly deps: OperationToolFactoryDeps) {}

  /**
   * Register one skill's listing of an operation as an internal tool. The
   * first listing of a `(bundleId, operationId)` registers the tool; another
   * skill's listing is added to it, so the tool admits a caller that any of
   * its listing skills admits (as `run_workflow` does). Registering the same
   * skill's listing again is a no-op.
   *
   * When the factory was constructed with a `classificationRegistry` AND
   * the caller supplies `ctx.pathsWithGet`, the factory also classifies the
   * operation (per HTTP semantics) and pushes the result into the
   * classification registry. A downstream `tools/call` hook can then look
   * up the classification by tool name and auto-emit
   * `notifications/resources/*` on success.
   */
  register(entry: HiddenOpEntry, ctx?: OperationRegisterContext): void {
    const key = `${entry.bundleId}|${entry.op.operationId}`;
    const existing = this.registered.get(key);
    if (existing) {
      if (!existing.listings.some((listing) => listing.skillId === entry.skillId)) existing.listings.push(entry);
      return;
    }

    const listings: [HiddenOpEntry, ...HiddenOpEntry[]] = [entry];
    const executor = this.makeExecutor(listings);
    const metadata = buildOperationMetadata(entry);
    const record: ToolFunctionTokenRecord = {
      kind: ToolKind.FUNCTION,
      provide: executor,
      metadata,
    };

    const instance = new ToolInstance(record, this.deps.providers, OPERATION_TOOL_OWNER);
    this.deps.toolRegistry.registerToolInstance(instance);
    this.registered.set(key, { executor, listings });

    // Optional classification registration. Both the registry and per-call
    // pathsWithGet must be present; absent either, this is a no-op so the
    // existing call sites that don't yet pass `ctx` keep working.
    if (this.deps.classificationRegistry && ctx?.pathsWithGet) {
      try {
        const classification = classifyOne(
          entry.bundleId,
          {
            operationId: entry.op.operationId,
            method: entry.op.httpMethod,
            path: entry.op.pathTemplate,
          },
          ctx.pathsWithGet,
        );
        const toolName = metadata.name;
        this.deps.classificationRegistry.register(toolName, classification);
        this.classificationKeys.add(toolName);
      } catch (e) {
        // Classification failure must not block tool registration — log and
        // continue so the meta-tool surface stays available.
        this.deps.logger.warn(
          `[operation-tool-factory] classification failed for ${entry.bundleId}.${entry.op.operationId}: ${(e as Error).message}`,
        );
      }
    }
  }

  /**
   * Unregister every tool this factory has registered. Used on bundle swap
   * before re-registering the new bundle's operations. Also clears the
   * classification entries this factory pushed.
   */
  unregisterAll(): void {
    for (const { executor } of this.registered.values()) {
      try {
        // For ToolKind.FUNCTION the provide function IS the registry token.
        this.deps.toolRegistry.unregisterToolInstance(executor as unknown as Token);
      } catch (e) {
        this.deps.logger.warn(`unregister failed: ${(e as Error).message}`);
      }
    }
    this.registered.clear();

    // Clear classification entries this factory was responsible for. Other
    // factories' entries (if any) are left intact.
    if (this.deps.classificationRegistry && this.classificationKeys.size > 0) {
      for (const toolName of this.classificationKeys) {
        this.deps.classificationRegistry.unregister(toolName);
      }
      this.classificationKeys.clear();
    }
  }

  /** Number of currently-registered internal operation tools (test/audit hook). */
  get size(): number {
    return this.registered.size;
  }

  /** The function that runs one op: the shared path of a `run_workflow` call, with its checks, audit and error body. */
  private makeExecutor(listings: OperationListings): OperationExecutor {
    return (input, ctx) => runSkillAction({ ctx, logger: ctx.logger, listings, input: input ?? {} });
  }
}
