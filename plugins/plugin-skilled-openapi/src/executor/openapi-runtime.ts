// file: plugins/plugin-skilled-openapi/src/executor/openapi-runtime.ts
//
// Thin runtime wrapper around `@frontmcp/adapters/openapi`'s `buildRequest`
// and `parseResponse`. We DO NOT reinvent path interpolation, header injection
// defenses, body building, or response parsing — those exist in the adapter
// and are battle-tested.
//
// What this module adds on top of the adapter:
//   1. Projection from our `OperationDescriptor` to the upstream `McpOpenAPITool`
//      shape that buildRequest expects.
//   2. Direct `SecurityContext` construction from our `AuthBinding` + a
//      vault-resolved credential. (We bypass the adapter's
//      `createSecurityContextFromAuth` because that path requires a full
//      FrontMcpContext / authProviderMapper, which is over-engineered for the
//      bundle-driven case where the credential is already pinned per binding.)
//   3. Layered SSRF defenses (post-DNS IP blocklist + cloud metadata host
//      block) on top of the adapter's `validateBaseUrl`.

import {
  buildRequest,
  parseResponse,
  type HTTPMethod,
  type McpOpenAPITool,
  type SecurityResolver as McpSecurityResolver,
  type ParameterMapper,
  type SecurityContext,
} from '@frontmcp/adapters/openapi';
import type { AuthBinding } from '@frontmcp/adapters/skills';
import type { FrontMcpLogger } from '@frontmcp/sdk';

import type { HiddenOpEntry } from '../registry/hidden-op.registry';
import type { OutboundOptions } from '../skilled-openapi.types';
import type { CredentialResolver } from './credential-resolver';
import { checkOutboundUrl } from './ssrf-guard';

/** Caller-supplied input. Flat keys match `mapper[].inputKey`. */
export type OperationInput = Record<string, unknown>;

export interface ExecutionResult {
  ok: boolean;
  status: number;
  data: unknown;
  contentType?: string;
  error?: string;
  responseBytes: number;
}

/**
 * Build a `SecurityContext` directly from our AuthBinding + a resolved
 * credential. This populates the same fields that `mcp-from-openapi`'s
 * `SecurityResolver` expects so `resolveToolSecurity` (or our equivalent
 * direct invocation below) can produce headers/query/cookies the way
 * `buildRequest` consumes them.
 */
async function buildSecurityContext(args: {
  binding: AuthBinding;
  bundleId: string;
  resolver: CredentialResolver;
  callerToken?: string;
}): Promise<SecurityContext> {
  const { binding, bundleId, resolver, callerToken } = args;
  const ctx: SecurityContext = {};
  switch (binding.kind) {
    case 'none':
      return ctx;
    case 'bearer': {
      let token: string | undefined;
      if (binding.passthroughCallerToken) {
        token = callerToken;
        if (!token) throw new Error('passthrough caller token requested but not supplied');
      } else {
        token = await resolver.resolve(binding.vaultRef, { bundleId });
        if (!token) throw new Error(`bearer vaultRef "${binding.vaultRef}" did not resolve`);
      }
      ctx.jwt = token;
      return ctx;
    }
    case 'apiKey': {
      const value = await resolver.resolve(binding.vaultRef, { bundleId });
      if (!value) throw new Error(`apiKey vaultRef "${binding.vaultRef}" did not resolve`);
      // Use named apiKeys so the SecurityResolver routes it to the declared
      // header / query slot named in the bundle (the mapper carries the slot).
      ctx.apiKeys = { [binding.name]: value };
      // Also set the legacy single-apiKey field for resolvers that look at it.
      ctx.apiKey = value;
      return ctx;
    }
    case 'oauth2': {
      const token = await resolver.resolve(binding.vaultRef, { bundleId });
      if (!token) throw new Error(`oauth2 vaultRef "${binding.vaultRef}" did not resolve`);
      ctx.oauth2Token = token;
      return ctx;
    }
  }
}

/**
 * Project an OperationDescriptor + its service/auth context into the
 * McpOpenAPITool shape that the adapter's `buildRequest` consumes.
 */
function toMcpOpenAPITool(entry: HiddenOpEntry): McpOpenAPITool {
  const { op, service, authBinding } = entry;
  // Mapper for the security parameter, if any. The shape mirrors what
  // mcp-from-openapi's parser would produce so the SecurityResolver routes
  // the credential to the right slot.
  const securityMapper: ParameterMapper[] = [];
  if (authBinding.kind === 'apiKey') {
    securityMapper.push({
      inputKey: `__sec_${authBinding.name}`,
      type: authBinding.in,
      key: authBinding.name,
      required: false,
      security: { scheme: authBinding.name, type: 'apiKey', name: authBinding.name, in: authBinding.in },
    } as unknown as ParameterMapper);
  } else if (authBinding.kind === 'bearer') {
    securityMapper.push({
      inputKey: '__sec_bearer',
      type: 'header',
      key: 'Authorization',
      required: false,
      security: { scheme: 'bearer', type: 'http', httpScheme: 'bearer' },
    } as unknown as ParameterMapper);
  } else if (authBinding.kind === 'oauth2') {
    securityMapper.push({
      inputKey: '__sec_oauth2',
      type: 'header',
      key: 'Authorization',
      required: false,
      security: { scheme: 'oauth2', type: 'oauth2' },
    } as unknown as ParameterMapper);
  }

  return {
    name: op.operationId,
    description: op.description ?? op.summary ?? `${op.httpMethod} ${op.pathTemplate}`,
    inputSchema: op.inputSchema as never,
    outputSchema: op.outputSchema as never,
    mapper: [...op.mapper, ...securityMapper],
    metadata: {
      path: op.pathTemplate,
      method: op.httpMethod as HTTPMethod,
      operationId: op.operationId,
      operationSummary: op.summary,
      operationDescription: op.description,
      servers: [{ url: service.baseUrl }],
    } as never,
  };
}

/**
 * Resolve the security context to `{headers, query, cookies}` using the
 * `mcp-from-openapi` SecurityResolver. The resolver consumes the tool's
 * mapper array (not the tool object) plus a populated SecurityContext.
 */
type AwaitedSecurity = Awaited<ReturnType<McpSecurityResolver['resolve']>>;
async function resolveSecurity(tool: McpOpenAPITool, ctx: SecurityContext): Promise<AwaitedSecurity> {
  // Lazy import: SecurityResolver lives in mcp-from-openapi which is the
  // upstream the adapter wraps. A dynamic `import()` (not `require()`) keeps the
  // surface narrow AND stays bundlable on V8-isolate runtimes — esbuild inlines
  // a literal dynamic import, whereas a `require()` under an ESM `createRequire`
  // banner is left as a runtime resolve that fails on a Worker (no node_modules).
  const { SecurityResolver } = (await import('mcp-from-openapi')) as {
    SecurityResolver: new () => McpSecurityResolver;
  };
  const resolver = new SecurityResolver();
  return resolver.resolve(tool.mapper, ctx);
}

export interface OpenApiRuntimeDeps {
  outbound: OutboundOptions;
  resolver: CredentialResolver;
  allowedHosts: ReadonlySet<string>;
  logger: FrontMcpLogger;
  fetchImpl?: typeof fetch;
}

/**
 * Execute one hidden operation against the customer's REST API. Returns a
 * structured envelope; never raw-stringifies the response into model context.
 */
export async function executeOperation(args: {
  entry: HiddenOpEntry;
  bundleId: string;
  input: OperationInput;
  callerToken?: string;
  deps: OpenApiRuntimeDeps;
}): Promise<ExecutionResult> {
  const { entry, bundleId, input, callerToken, deps } = args;
  const { outbound, resolver, allowedHosts, logger } = deps;
  const fetchImpl = deps.fetchImpl ?? fetch;

  let mcpTool: McpOpenAPITool;
  try {
    mcpTool = toMcpOpenAPITool(entry);
  } catch (e) {
    return failure(0, `tool projection failed: ${(e as Error).message}`);
  }

  let securityContext: SecurityContext;
  try {
    securityContext = await buildSecurityContext({
      binding: entry.authBinding,
      bundleId,
      resolver,
      callerToken,
    });
  } catch (e) {
    return failure(0, `auth resolution failed: ${(e as Error).message}`);
  }

  let security: AwaitedSecurity;
  try {
    security = await resolveSecurity(mcpTool, securityContext);
  } catch (e) {
    return failure(0, `security resolve failed: ${(e as Error).message}`);
  }

  let req;
  try {
    req = buildRequest(mcpTool, input, security, entry.service.baseUrl);
  } catch (e) {
    return failure(0, `request build failed: ${(e as Error).message}`);
  }

  const ssrf = await checkOutboundUrl(req.url, allowedHosts, outbound);
  if (!ssrf.ok) {
    return failure(0, `ssrf check rejected request: ${ssrf.reason}`);
  }

  const timeoutMs = entry.op.timeoutMs ?? outbound.defaultTimeoutMs;
  const maxBytes = entry.op.maxResponseBytes ?? outbound.defaultMaxResponseBytes;
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  timer.unref?.();

  try {
    const response = await fetchImpl(req.url, {
      method: entry.op.httpMethod,
      headers: req.headers,
      body: req.body !== undefined ? JSON.stringify(req.body) : undefined,
      signal: ac.signal,
    });
    const contentType = response.headers.get('content-type') ?? undefined;
    const reader = response.body?.getReader();
    let received = 0;
    const chunks: Uint8Array[] = [];
    if (reader) {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        if (value) {
          received += value.byteLength;
          if (received > maxBytes) {
            return failure(response.status, `response exceeded maxResponseBytes (${maxBytes})`);
          }
          chunks.push(value);
        }
      }
    }
    const buf = Buffer.concat(chunks.map((c) => Buffer.from(c)));
    // Re-create Response so parseResponse can do its own content-type handling.
    const synthetic = new Response(buf, {
      status: response.status,
      headers: response.headers,
    });
    const parsed = await parseResponse(synthetic);
    void logger;
    return {
      ok: response.ok,
      status: response.status,
      contentType,
      data: parsed.data,
      responseBytes: received,
    };
  } catch (e) {
    const err = e as Error;
    return failure(0, err.name === 'AbortError' ? `timeout after ${timeoutMs}ms` : err.message);
  } finally {
    clearTimeout(timer);
  }
}

function failure(status: number, error: string): ExecutionResult {
  return { ok: false, status, data: null, error, responseBytes: 0 };
}
