/** GET /.well-known/mcp-registry-auth at the literal root of the host, the only URL the MCP Registry fetches. */

import { type z } from '@frontmcp/lazy-zod';

import {
  enforceGlobalRateLimit,
  enforceIpFilter,
  Flow,
  FlowBase,
  httpInputSchema,
  httpRespond,
  HttpTextSchema,
  StageHookOf,
  type FlowPlan,
  type FlowRunOptions,
  type ScopeEntry,
  type ServerRequest,
} from '../../common';
import { resolveRegistryAuthRecord } from '../mcp-registry.utils';

const MCP_REGISTRY_AUTH_PATH = '/.well-known/mcp-registry-auth';

const inputSchema = httpInputSchema;

const outputSchema = HttpTextSchema;

const plan = {
  pre: ['checkIpFilter', 'acquireQuota'],
  execute: ['serveRecord'],
} as const satisfies FlowPlan<string>;

declare global {
  interface ExtendFlows {
    'well-known.mcp-registry-auth': FlowRunOptions<
      WellKnownMcpRegistryAuthFlow,
      typeof plan,
      typeof inputSchema,
      typeof outputSchema,
      z.ZodObject<Record<string, never>>
    >;
  }
}

const name = 'well-known.mcp-registry-auth' as const;
const Stage = StageHookOf(name);

@Flow({
  name,
  plan,
  inputSchema,
  outputSchema,
  access: 'public',
  middleware: {
    method: 'GET',
  },
})
export default class WellKnownMcpRegistryAuthFlow extends FlowBase<typeof name> {
  static canActivate(request: ServerRequest, scope: ScopeEntry): boolean {
    return request.path === MCP_REGISTRY_AUTH_PATH && resolveRegistryAuthRecord(scope) !== undefined;
  }

  @Stage('checkIpFilter')
  async checkIpFilter() {
    enforceIpFilter(this.scope, this.tryGetContext()?.metadata.clientIp);
  }

  @Stage('acquireQuota')
  async acquireQuota() {
    await enforceGlobalRateLimit(this.scope, this.tryGetContext());
  }

  @Stage('serveRecord')
  async serveRecord() {
    const record = resolveRegistryAuthRecord(this.scope);
    this.respond(
      record
        ? { kind: 'text', status: 200, body: record, contentType: 'text/plain; charset=utf-8' }
        : httpRespond.notFound(),
    );
  }
}
