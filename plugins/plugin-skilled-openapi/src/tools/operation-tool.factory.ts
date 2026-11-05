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
import { type Token, type Type } from '@frontmcp/di';
import {
  ToolContext,
  ToolInstance,
  ToolKind,
  type EntryOwnerRef,
  type FrontMcpLogger,
  type ProviderRegistry,
  type ToolClassTokenRecord,
  type ToolMetadata,
  type ToolRegistry,
} from '@frontmcp/sdk';
import { sha256Hex } from '@frontmcp/utils';

import { confirmationSchema } from '../executor/action-confirmation';
import { runSkillAction, type OperationToolResult } from '../executor/run-skill-action';
import { type HiddenOpEntry, type OperationListings } from '../registry/hidden-op.registry';

const OPERATION_TOOL_OWNER_TOKEN = Symbol.for('skilled-openapi:operation-tool-owner');
const OPERATION_TOOL_OWNER: EntryOwnerRef = {
  kind: 'plugin',
  id: 'skilled-openapi',
  ref: OPERATION_TOOL_OWNER_TOKEN,
};

const MAX_TOOL_NAME_LENGTH = 64;
const NAME_HASH_LENGTH = 16;

/**
 * The registered tool name of an OpenAPI operation: `<bundleId>.<operationId>`, so bundles can share operationIds.
 * Tool names have at most 64 characters, so a longer one keeps its start and ends with a hash of the full name: it
 * stays unique, and never equals the name of another tool, such as a server tool named like the operationId.
 */
export function operationToolName(bundleId: string, operationId: string): string {
  const namespaced = `${bundleId}.${operationId}`;
  if (namespaced.length <= MAX_TOOL_NAME_LENGTH) return namespaced;
  const hash = sha256Hex(namespaced).slice(0, NAME_HASH_LENGTH);
  return `${namespaced.slice(0, MAX_TOOL_NAME_LENGTH - NAME_HASH_LENGTH - 1)}.${hash}`;
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
  /** The plugin's own providers, which the tools resolve through: init({ providers }), the app's, then the server's. */
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

/** The tool an operation runs as: the shared path of a `run_workflow` call, asking the user first when `confirm` names it. */
function operationToolClass(listings: OperationListings): Type<ToolContext> {
  return class OperationTool extends ToolContext {
    execute(input: Record<string, unknown> | undefined): Promise<OperationToolResult> {
      return runSkillAction({
        ctx: this,
        logger: this.logger,
        listings,
        input: input ?? {},
        askUser: (message) => this.elicit(message, confirmationSchema),
      });
    }
  };
}

/**
 * Manages the lifecycle of synthetic per-operation internal tools for one
 * Skilled OpenAPI plugin instance.
 */
export class OperationToolFactory {
  /** Map (bundleId|opId) → the tool class that doubles as registry token, and the skills that list the op. */
  private registered = new Map<
    string,
    { toolClass: Type<ToolContext>; listings: [HiddenOpEntry, ...HiddenOpEntry[]] }
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
    const toolClass = operationToolClass(listings);
    const metadata = buildOperationMetadata(entry);
    const record: ToolClassTokenRecord = {
      kind: ToolKind.CLASS_TOKEN,
      provide: toolClass,
      metadata,
    };

    const instance = new ToolInstance(record, this.deps.providers, OPERATION_TOOL_OWNER);
    this.deps.toolRegistry.registerToolInstance(instance);
    this.registered.set(key, { toolClass, listings });

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
    for (const { toolClass } of this.registered.values()) {
      try {
        // For ToolKind.CLASS_TOKEN the provided class IS the registry token.
        this.deps.toolRegistry.unregisterToolInstance(toolClass as Token);
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
}
