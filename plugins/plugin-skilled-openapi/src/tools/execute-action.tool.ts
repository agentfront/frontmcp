// file: plugins/plugin-skilled-openapi/src/tools/execute-action.tool.ts

import { Tool, ToolContext } from '@frontmcp/sdk';

import { BundleStore } from '../bundle/bundle.store';
import { executeOperation, type OpenApiRuntimeDeps } from '../executor/openapi-runtime';
import { getCompiledOpSchemas } from '../executor/schema-cache';
import { HiddenOpRegistry } from '../registry/hidden-op.registry';
import { AuthorityGuard } from '../security/authority-guard';
import { SkilledOpenApiConfig, SkilledOpenApiCredentialResolver } from '../skilled-openapi.symbols';
import { BundleSyncService } from '../sync/bundle-sync.service';
import {
  executeActionDescription,
  executeActionInputSchema,
  executeActionOutputSchema,
  type ExecuteActionInput,
  type ExecuteActionOutput,
} from './execute-action.schema';

@Tool({
  name: 'execute_action',
  description: executeActionDescription,
  inputSchema: executeActionInputSchema,
  outputSchema: executeActionOutputSchema,
  annotations: {
    readOnlyHint: false,
    destructiveHint: true,
    openWorldHint: true,
  },
})
export default class ExecuteActionTool extends ToolContext {
  async execute(input: ExecuteActionInput): Promise<ExecuteActionOutput> {
    // Lazy-boot: ensure the bundle sync has run at least once.
    this.get(BundleSyncService);
    const config = this.get(SkilledOpenApiConfig);
    const hiddenOps = this.get(HiddenOpRegistry);
    const bundleStore = this.get(BundleStore);
    const guard = this.get(AuthorityGuard);
    const resolver = this.get(SkilledOpenApiCredentialResolver);

    // 1) Resolve hidden op for (skillId, actionId).
    const entry = hiddenOps.get(input.skillId, input.actionId);
    if (!entry) {
      return {
        ok: false,
        status: 0,
        error: `unknown action "${input.skillId}/${input.actionId}" — search_skill / load_skill first`,
      };
    }

    // Pin a snapshot of the entry so a hot bundle-swap mid-call doesn't change
    // the descriptor we execute against (E1 from the plan). `bundleId` comes
    // from the pinned entry rather than from a fresh `bundleStore.current()`
    // read so the credential-scope resolution cannot drift to a newly swapped
    // bundle while the op continues to use the prior descriptor.
    const pinned = entry;
    const bundleId = pinned.bundleId;
    const bundle = bundleStore.current();

    // 2) Authority check (skill-level + op-level merged at call site).
    const policy = pinned.op.requiredAuthorities;
    const authResult = await guard.check({
      policy,
      authInfo: (this.authInfo ?? {}) as never as Parameters<AuthorityGuard['check']>[0]['authInfo'],
      input: input.input ?? {},
    });
    if (!authResult.granted) {
      return {
        ok: false,
        status: 0,
        error: `authority denied: ${authResult.deniedBy ?? 'policy not satisfied'}`,
      };
    }

    // 3) Compile (or fetch from cache) the input/output Zod schemas for this op.
    //    Uses Zod 4's native `z.fromJSONSchema`. Cached per (bundleVersion, operationId).
    const schemas = getCompiledOpSchemas({
      bundleVersion: pinned.bundleVersion,
      operationId: pinned.op.operationId,
      inputSchema: pinned.op.inputSchema,
      outputSchema: pinned.op.outputSchema,
    });

    // 4) Validate input strictly. Mirrors the SDK call-tool flow's parseInput
    //    stage — invalid input never reaches the upstream HTTP call.
    const inputParse = schemas.input.safeParse(input.input ?? {});
    if (!inputParse.success) {
      return {
        ok: false,
        status: 0,
        error: `input validation failed: ${formatZodIssues(inputParse.error.issues)}`,
      };
    }

    // 5) Build runtime deps + execute. Allowed hosts are derived from the
    //    PINNED descriptor's service first (so a hot bundle swap that drops
    //    the service mid-call doesn't strand the in-flight request), then
    //    union'd with the active bundle's services for defense-in-depth.
    const allowedHosts = new Set<string>();
    try {
      allowedHosts.add(new URL(pinned.service.baseUrl).hostname.toLowerCase());
    } catch {
      // pinned service URL malformed — execute path will fail SSRF anyway
    }
    if (bundle) {
      for (const svc of bundle.services) {
        try {
          allowedHosts.add(new URL(svc.baseUrl).hostname.toLowerCase());
        } catch {
          // skip malformed
        }
      }
    }

    const deps: OpenApiRuntimeDeps = {
      outbound: config.outbound,
      resolver: { resolve: (ref, opts) => resolver.resolve(ref, opts) },
      allowedHosts,
      logger: this.logger,
    };

    const result = await executeOperation({
      entry: pinned,
      bundleId,
      input: inputParse.data as Record<string, unknown>,
      deps,
    });

    // 6) Validate the response body shape against the op's outputSchema.
    //    Only runs on a successful upstream call AND when the response is
    //    application/json (text/binary bodies are returned as-is — the
    //    caller is presumed to have configured an appropriate schema or
    //    left it permissive). Error envelopes from the upstream (ok=false)
    //    pass through unchanged so the LLM can see the actual error string
    //    rather than a "schema validation failed" wrapper masking it.
    const isJsonResponse = (result.contentType ?? '').toLowerCase().includes('application/json');
    if (result.ok && isJsonResponse && result.data !== undefined && result.data !== null) {
      const outputParse = schemas.output.safeParse(result.data);
      if (!outputParse.success) {
        return {
          ok: false,
          status: result.status,
          ...(result.contentType ? { contentType: result.contentType } : {}),
          error: `upstream response failed output schema: ${formatZodIssues(outputParse.error.issues)}`,
        };
      }
    }

    return {
      ok: result.ok,
      status: result.status,
      ...(result.data !== undefined && result.data !== null ? { data: result.data } : {}),
      ...(result.contentType ? { contentType: result.contentType } : {}),
      ...(result.error ? { error: result.error } : {}),
    };
  }
}

/**
 * Compact one-line render of zod issues for the meta-tool error envelope.
 * Avoids serializing the full ZodError (which includes call stacks the LLM
 * doesn't need and tokens we don't want to spend).
 */
function formatZodIssues(issues: ReadonlyArray<{ path: ReadonlyArray<PropertyKey>; message: string }>): string {
  if (!issues.length) return 'unspecified validation error';
  return issues
    .slice(0, 3)
    .map((i) => `${i.path.join('.') || '<root>'}: ${i.message}`)
    .join('; ');
}
