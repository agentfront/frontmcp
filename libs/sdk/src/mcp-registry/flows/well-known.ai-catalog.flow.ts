/** GET /.well-known/ai-catalog.json at the literal root of the host: the AI Catalog listing the server card. */

import { z } from '@frontmcp/lazy-zod';

import {
  enforceGlobalRateLimit,
  enforceIpFilter,
  Flow,
  FlowBase,
  getRequestBaseUrl,
  httpInputSchema,
  HttpJsonSchema,
  httpRespond,
  HttpTextSchema,
  StageHookOf,
  type FlowPlan,
  type FlowRunOptions,
  type ServerRequest,
} from '../../common';
import { SERVER_CARD_MEDIA_TYPE, serverCardPath } from '../mcp-registry.utils';

const AI_CATALOG_PATH = '/.well-known/ai-catalog.json';

/** `com.acme/weather` is `urn:air:acme.com:mcp:weather`. */
function aiCatalogIdentifier(registryName: string): string {
  const [namespace, serverName] = registryName.split('/');
  return `urn:air:${namespace.split('.').reverse().join('.')}:mcp:${serverName}`;
}

const inputSchema = httpInputSchema;

const outputSchema = z.union([HttpJsonSchema, HttpTextSchema]);

const plan = {
  pre: ['checkIpFilter', 'acquireQuota'],
  execute: ['serveCatalog'],
} as const satisfies FlowPlan<string>;

declare global {
  interface ExtendFlows {
    'well-known.ai-catalog': FlowRunOptions<
      WellKnownAiCatalogFlow,
      typeof plan,
      typeof inputSchema,
      typeof outputSchema,
      z.ZodObject<Record<string, never>>
    >;
  }
}

const name = 'well-known.ai-catalog' as const;
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
export default class WellKnownAiCatalogFlow extends FlowBase<typeof name> {
  static canActivate(request: ServerRequest): boolean {
    return request.path === AI_CATALOG_PATH;
  }

  @Stage('checkIpFilter')
  async checkIpFilter() {
    enforceIpFilter(this.scope, this.tryGetContext()?.metadata.clientIp);
  }

  @Stage('acquireQuota')
  async acquireQuota() {
    await enforceGlobalRateLimit(this.scope, this.tryGetContext());
  }

  @Stage('serveCatalog')
  async serveCatalog() {
    const registryName = this.scope.metadata.registry?.name;
    if (!registryName) {
      this.respond(httpRespond.notFound());
      return;
    }
    this.respond({
      kind: 'json',
      status: 200,
      contentType: 'application/ai-catalog+json',
      body: {
        specVersion: '1.0',
        entries: [
          {
            identifier: aiCatalogIdentifier(registryName),
            type: SERVER_CARD_MEDIA_TYPE,
            url: getRequestBaseUrl(this.rawInput.request, serverCardPath(this.scope)),
          },
        ],
      },
    });
  }
}
