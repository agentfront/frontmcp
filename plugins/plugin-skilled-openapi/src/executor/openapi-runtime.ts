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
import { isRedirectResponse } from '@frontmcp/utils';

import type { HiddenOpEntry } from '../registry/hidden-op.registry';
import type { OutboundOptions } from '../skilled-openapi.types';
import { callerTokenRefusal } from './caller-token';
import type { CredentialResolver } from './credential-resolver';
import { withHostConcurrency } from './host-concurrency';
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

/** The credentials for one request, and the caller's own token when they are that token. */
interface ResolvedAuth {
  context: SecurityContext;
  /** The caller's token, when a `passthroughCallerToken` binding forwards it; it must cover the request URL. */
  forwardedCallerToken?: string;
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
  /** The service the request goes to; a passed-through caller token must have been issued for it. */
  serviceBaseUrl: string;
  callerToken?: string;
}): Promise<ResolvedAuth> {
  const { binding, bundleId, resolver, serviceBaseUrl, callerToken } = args;
  switch (binding.kind) {
    case 'none':
      return { context: {} };
    case 'bearer': {
      if (binding.passthroughCallerToken) {
        if (!callerToken) throw new Error('passthrough caller token requested but the caller presented none');
        // Refused here when the token does not cover the service at all; `executeOperation` checks the
        // URL the request is built for as well, which a path parameter can move.
        const refusal = callerTokenRefusal(callerToken, serviceBaseUrl);
        if (refusal) throw new Error(`passthrough caller token refused: ${refusal}`);
        return { context: { jwt: callerToken }, forwardedCallerToken: callerToken };
      }
      const token = await resolver.resolve(binding.vaultRef, { bundleId });
      if (!token) throw new Error(`bearer vaultRef "${binding.vaultRef}" did not resolve`);
      return { context: { jwt: token } };
    }
    case 'apiKey': {
      const value = await resolver.resolve(binding.vaultRef, { bundleId });
      if (!value) throw new Error(`apiKey vaultRef "${binding.vaultRef}" did not resolve`);
      // Use named apiKeys so the SecurityResolver routes it to the declared
      // header / query slot named in the bundle (the mapper carries the slot).
      // Also set the legacy single-apiKey field for resolvers that look at it.
      return { context: { apiKeys: { [binding.name]: value }, apiKey: value } };
    }
    case 'oauth2': {
      const token = await resolver.resolve(binding.vaultRef, { bundleId });
      if (!token) throw new Error(`oauth2 vaultRef "${binding.vaultRef}" did not resolve`);
      return { context: { oauth2Token: token } };
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

  let auth: ResolvedAuth;
  try {
    auth = await buildSecurityContext({
      binding: entry.authBinding,
      bundleId,
      resolver,
      serviceBaseUrl: entry.service.baseUrl,
      callerToken,
    });
  } catch (e) {
    return failure(0, `auth resolution failed: ${(e as Error).message}`);
  }

  let security: AwaitedSecurity;
  try {
    security = await resolveSecurity(mcpTool, auth.context);
  } catch (e) {
    return failure(0, `security resolve failed: ${(e as Error).message}`);
  }

  let req;
  try {
    req = buildRequest(mcpTool, input, security, entry.service.baseUrl);
  } catch (e) {
    return failure(0, `request build failed: ${(e as Error).message}`);
  }

  // The caller's token was checked against the service's base URL; the request must stay inside the
  // API it was issued for too. Path parameters are substituted into the URL, and URL parsing resolves
  // the result (`/v1/{id}/me` with an `id` of `..` is `/me`), so check the URL fetch will request.
  if (auth.forwardedCallerToken) {
    const refusal = callerTokenRefusal(auth.forwardedCallerToken, req.url);
    if (refusal) return failure(0, `auth resolution failed: passthrough caller token refused: ${refusal}`);
  }

  const ssrf = await checkOutboundUrl(req.url, allowedHosts, outbound);
  if (!ssrf.ok) {
    return failure(0, `ssrf check rejected request: ${ssrf.reason}`);
  }

  // The body is sent JSON-serialized below. Label it: a string body with no content-type goes out
  // as `text/plain;charset=UTF-8`, which a JSON API rejects or misreads. A content-type the
  // request already carries (a `header` mapper) is kept, as the OpenAPI adapter does.
  let body: string | undefined;
  try {
    body = req.body !== undefined ? JSON.stringify(req.body) : undefined;
  } catch (e) {
    return failure(0, `request body serialization failed: ${(e as Error).message}`);
  }
  if (body !== undefined && !req.headers.has('content-type')) {
    req.headers.set('content-type', 'application/json');
  }

  const timeoutMs = entry.op.timeoutMs ?? outbound.defaultTimeoutMs;
  const maxBytes = entry.op.maxResponseBytes ?? outbound.defaultMaxResponseBytes;

  // Bound concurrent in-flight requests to this single host (B6). The timeout
  // clock starts AFTER a slot is acquired so queue wait doesn't count against
  // the op timeout. `req.url` already passed the SSRF allowlist above.
  const host = ((): string => {
    try {
      return new URL(req.url).hostname.toLowerCase();
    } catch {
      return req.url;
    }
  })();

  return withHostConcurrency(host, outbound.maxConcurrencyPerHost, async () => {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), timeoutMs);
    timer.unref?.();

    try {
      const response = await fetchImpl(req.url, {
        method: entry.op.httpMethod,
        headers: req.headers,
        body,
        signal: ac.signal,
        // SECURITY: never auto-follow redirects. `fetch` defaults to
        // `redirect: 'follow'`, which re-sends the request — INCLUDING the
        // vault-injected `Authorization`/api-key headers — to the redirect
        // target, even cross-origin. An allowlisted-but-compromised (or
        // open-redirecting) upstream could thus exfiltrate the credential to an
        // attacker host, and the SSRF allowlist (validated only on the initial
        // URL) would never re-evaluate the hop. `manual` makes the 3xx visible
        // here so we can refuse it instead of following blindly.
        redirect: 'manual',
      });
      // A redirect from the upstream is not followed (credential-exfiltration +
      // SSRF-allowlist-bypass guard). REST operations should resolve in one hop;
      // surface the redirect as a failure rather than chasing it with creds.
      // Browser runtimes report it as a status-0 `opaqueredirect`.
      if (isRedirectResponse(response)) {
        return failure(
          response.status,
          `upstream returned a redirect (${response.status}); not followed to protect injected credentials`,
        );
      }
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
  });
}

function failure(status: number, error: string): ExecutionResult {
  return { ok: false, status, data: null, error, responseBytes: 0 };
}
