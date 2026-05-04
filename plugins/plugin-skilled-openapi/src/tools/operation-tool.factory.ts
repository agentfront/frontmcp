// file: plugins/plugin-skilled-openapi/src/tools/operation-tool.factory.ts
//
// Builds a synthetic `ToolInstance` per OpenAPI operation so other in-process
// callers (skilled tools, agents, CodeCall scripts, jobs) can compose with the
// operation via `this.callTool(name, args)` from `ExecutionContextBase`.
//
// These tools are registered with `metadata.visibility: 'internal'`:
//   - never advertised in `tools/list`
//   - never callable from external `tools/call` requests (the SDK's call-tool
//     flow rejects external invocations of internal tools)
//   - callable only via the SDK-internal `callTool` helper, which tags the
//     request ctx with `internalCall: true`

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

import { executeOperation, type OpenApiRuntimeDeps } from '../executor/openapi-runtime';
import { getCompiledOpSchemas } from '../executor/schema-cache';
import { type HiddenOpEntry } from '../registry/hidden-op.registry';
import { AuthorityGuard } from '../security/authority-guard';
import { SkilledOpenApiConfig, SkilledOpenApiCredentialResolver } from '../skilled-openapi.symbols';

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
  // alone (the flow's findByName checks both `fullName` and `name`).
  const namespaced = `${bundleId}.${operationId}`;
  return namespaced.length <= 64 ? namespaced : operationId;
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
}

type OperationExecutor = (input: Record<string, unknown>, ctx: ToolCtxLike) => Promise<unknown>;

interface ToolCtxLike {
  get<T>(token: Token<T>): T;
  logger: FrontMcpLogger;
  authInfo?: unknown;
}

/**
 * Manages the lifecycle of synthetic per-operation internal tools for one
 * Skilled OpenAPI plugin instance.
 */
export class OperationToolFactory {
  /** Map (bundleId|opId) → the executor function that doubles as registry token. */
  private registered = new Map<string, OperationExecutor>();

  constructor(private readonly deps: OperationToolFactoryDeps) {}

  /**
   * Register one operation as an internal tool. Idempotent — calling twice
   * with the same `(bundleId, operationId)` is a no-op (the existing
   * registration is left in place).
   */
  register(entry: HiddenOpEntry): void {
    const key = `${entry.bundleId}|${entry.op.operationId}`;
    if (this.registered.has(key)) return;

    const executor = this.makeExecutor(entry);
    const metadata = buildOperationMetadata(entry);
    const record: ToolFunctionTokenRecord = {
      kind: ToolKind.FUNCTION,
      provide: executor,
      metadata,
    };

    const instance = new ToolInstance(record, this.deps.providers, OPERATION_TOOL_OWNER);
    this.deps.toolRegistry.registerToolInstance(instance);
    this.registered.set(key, executor);
  }

  /**
   * Unregister every tool this factory has registered. Used on bundle swap
   * before re-registering the new bundle's operations.
   */
  unregisterAll(): void {
    for (const executor of this.registered.values()) {
      try {
        // For ToolKind.FUNCTION the provide function IS the registry token.
        this.deps.toolRegistry.unregisterToolInstance(executor as unknown as Token);
      } catch (e) {
        this.deps.logger.warn(`unregister failed: ${(e as Error).message}`);
      }
    }
    this.registered.clear();
  }

  /** Number of currently-registered internal operation tools (test/audit hook). */
  get size(): number {
    return this.registered.size;
  }

  /**
   * Build the actual function executor for one op. Mirrors `ExecuteActionTool.execute`:
   * authority check + input validation + `executeOperation` — so callers
   * reaching the op via `callTool` get the same security gates as callers
   * going through `execute_action`.
   */
  private makeExecutor(entry: HiddenOpEntry): OperationExecutor {
    return async (input, ctx) => {
      const config = ctx.get(SkilledOpenApiConfig);
      const guard = ctx.get(AuthorityGuard);
      const resolver = ctx.get(SkilledOpenApiCredentialResolver);

      // 1) Authority gate (same policy plumbing as execute_action).
      const policy = entry.op.requiredAuthorities;
      const authResult = await guard.check({
        policy,
        authInfo: (ctx.authInfo ?? {}) as Parameters<AuthorityGuard['check']>[0]['authInfo'],
        input: (input ?? {}) as Record<string, unknown>,
      });
      if (!authResult.granted) {
        throw new Error(`authority denied: ${authResult.deniedBy ?? 'policy not satisfied'}`);
      }

      // 2) Input schema validation. Internal callers can't ship malformed
      // arguments any more than external callers can — run the same
      // compiled-schema check here.
      const schemas = getCompiledOpSchemas({
        bundleVersion: entry.bundleVersion,
        operationId: entry.op.operationId,
        inputSchema: entry.op.inputSchema,
        outputSchema: entry.op.outputSchema,
      });
      const inputParse = schemas.input.safeParse(input ?? {});
      if (!inputParse.success) {
        throw new Error(
          `input validation failed: ${inputParse.error.issues
            .slice(0, 3)
            .map((i) => `${i.path.join('.') || '<root>'}: ${i.message}`)
            .join('; ')}`,
        );
      }

      // 3) Execute. Allowed-hosts is just the pinned service URL — internal
      // tool calls don't need the live-bundle union because there's no
      // meta-tool indirection where a bundle swap could race.
      const allowedHosts = new Set<string>();
      try {
        allowedHosts.add(new URL(entry.service.baseUrl).hostname.toLowerCase());
      } catch {
        // pinned service URL malformed — execute path will fail SSRF anyway
      }

      const deps: OpenApiRuntimeDeps = {
        outbound: config.outbound,
        resolver: { resolve: (ref, opts) => resolver.resolve(ref, opts) },
        allowedHosts,
        logger: ctx.logger,
      };

      const result = await executeOperation({
        entry,
        bundleId: entry.bundleId,
        input: inputParse.data as Record<string, unknown>,
        deps,
      });

      // 4) Same envelope shape as execute_action so call-site code is uniform.
      return {
        ok: result.ok,
        status: result.status,
        ...(result.data !== undefined && result.data !== null ? { data: result.data } : {}),
        ...(result.contentType ? { contentType: result.contentType } : {}),
        ...(result.error ? { error: result.error } : {}),
      };
    };
  }
}
