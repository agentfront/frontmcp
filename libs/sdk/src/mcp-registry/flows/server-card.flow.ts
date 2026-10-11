/** GET <entryPath>/server-card: the SEP-2127 server card of the server's own streamable-HTTP endpoint. */

import { z } from '@frontmcp/lazy-zod';
import { sha256Base64url } from '@frontmcp/utils';

import {
  enforceGlobalRateLimit,
  enforceIpFilter,
  Flow,
  FlowBase,
  getRequestBaseUrl,
  HttpEmptySchema,
  httpInputSchema,
  HttpJsonSchema,
  httpRespond,
  HttpTextSchema,
  StageHookOf,
  type FlowPlan,
  type FlowRunOptions,
  type ScopeEntry,
  type ServerRequest,
} from '../../common';
import { FRONTMCP_SUPPORTED_PROTOCOL_VERSIONS } from '../../transport/mcp-20260728/protocol-20260728.constants';
import { mcpEndpointPath, SERVER_CARD_MEDIA_TYPE, serverCardPath } from '../mcp-registry.utils';

const SERVER_CARD_SCHEMA_URL = 'https://static.modelcontextprotocol.io/schemas/v1/server-card.schema.json';
const MAX_TITLE_LENGTH = 100;
const MAX_ICON_SRC_LENGTH = 255;

const SERVER_CARD_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET',
  'Access-Control-Allow-Headers': 'Content-Type, If-None-Match',
  'Access-Control-Expose-Headers': 'ETag',
  'Cache-Control': 'public, max-age=3600',
};

const isHttpsUrl = (url: string): boolean => url.startsWith('https://');

function ifNoneMatchIncludes(ifNoneMatch: string | undefined, etag: string): boolean {
  const candidates = (ifNoneMatch ?? '').split(',').map((candidate) => candidate.trim().replace(/^W\//, ''));
  return candidates.includes('*') || candidates.includes(etag);
}

const inputSchema = httpInputSchema;

const stateSchema = z.object({
  card: z.record(z.string(), z.unknown()),
});

const outputSchema = z.union([HttpJsonSchema, HttpEmptySchema, HttpTextSchema]);

const plan = {
  pre: ['checkIpFilter', 'acquireQuota'],
  execute: ['buildCard', 'respondWithCard'],
} as const satisfies FlowPlan<string>;

declare global {
  interface ExtendFlows {
    'registry:server-card': FlowRunOptions<
      ServerCardFlow,
      typeof plan,
      typeof inputSchema,
      typeof outputSchema,
      typeof stateSchema
    >;
  }
}

const name = 'registry:server-card' as const;
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
export default class ServerCardFlow extends FlowBase<typeof name> {
  static canActivate(request: ServerRequest, scope: ScopeEntry): boolean {
    return request.path === serverCardPath(scope);
  }

  @Stage('checkIpFilter')
  async checkIpFilter() {
    enforceIpFilter(this.scope, this.tryGetContext()?.metadata.clientIp);
  }

  @Stage('acquireQuota')
  async acquireQuota() {
    await enforceGlobalRateLimit(this.scope, this.tryGetContext());
  }

  @Stage('buildCard')
  async buildCard() {
    const { info, registry } = this.scope.metadata;
    if (!registry?.name) {
      this.respond(httpRespond.notFound());
      return;
    }
    const icons = (info.icons ?? []).filter((icon) => isHttpsUrl(icon.src) && icon.src.length <= MAX_ICON_SRC_LENGTH);
    const endpointUrl = getRequestBaseUrl(this.rawInput.request, mcpEndpointPath(this.scope) || '/');
    this.state.set({
      card: {
        $schema: SERVER_CARD_SCHEMA_URL,
        name: registry.name,
        version: info.version,
        description: registry.description,
        ...(info.title && info.title.length <= MAX_TITLE_LENGTH ? { title: info.title } : {}),
        ...(info.websiteUrl && isHttpsUrl(info.websiteUrl) ? { websiteUrl: info.websiteUrl } : {}),
        ...(icons.length > 0 ? { icons } : {}),
        ...(registry.repository ? { repository: registry.repository } : {}),
        remotes: [
          {
            type: 'streamable-http',
            url: endpointUrl,
            supportedProtocolVersions: [...FRONTMCP_SUPPORTED_PROTOCOL_VERSIONS],
          },
        ],
      },
    });
  }

  @Stage('respondWithCard')
  async respondWithCard() {
    const { card } = this.state.required;
    const etag = `"${sha256Base64url(JSON.stringify(card))}"`;
    const headers = { ...SERVER_CARD_HEADERS, ETag: etag };
    this.respond(
      ifNoneMatchIncludes(this.rawInput.request.headers['if-none-match'], etag)
        ? { kind: 'empty', status: 304, headers }
        : { kind: 'json', status: 200, body: card, contentType: SERVER_CARD_MEDIA_TYPE, headers },
    );
  }
}
