import { type z } from '@frontmcp/lazy-zod';

import {
  enforceGlobalRateLimit,
  enforceIpFilter,
  Flow,
  FlowBase,
  httpInputSchema,
  HttpJsonSchema,
  httpRespond,
  StageHookOf,
  type FlowPlan,
  type FlowRunOptions,
  type ServerRequest,
} from '../../common';
import { isSharedVersion, SHARED_DRAIN_PATH } from '../shared-endpoint';
import { SharedServerIdentity } from '../shared-server.identity';
import { SharedServerLifecycle } from '../shared-server.lifecycle';
import { compareSharedVersions } from '../shared-version';

const inputSchema = httpInputSchema;
const outputSchema = HttpJsonSchema;

const plan = {
  pre: ['checkIpFilter', 'acquireQuota', 'authorize'],
  execute: ['drain'],
} as const satisfies FlowPlan<string>;

declare global {
  interface ExtendFlows {
    'shared:drain': FlowRunOptions<
      SharedDrainFlow,
      typeof plan,
      typeof inputSchema,
      typeof outputSchema,
      z.ZodObject<Record<string, never>>
    >;
  }
}

const name = 'shared:drain' as const;
const Stage = StageHookOf(name);

/** POST /.well-known/frontmcp-shared-server/drain: with the token, a session of a newer version makes the server exit. */
@Flow({
  name,
  plan,
  inputSchema,
  outputSchema,
  access: 'public',
  middleware: { method: 'POST' },
})
export default class SharedDrainFlow extends FlowBase<typeof name> {
  static canActivate(request: ServerRequest): boolean {
    return request.path === SHARED_DRAIN_PATH;
  }

  @Stage('checkIpFilter')
  async checkIpFilter() {
    enforceIpFilter(this.scope, this.tryGetContext()?.metadata.clientIp);
  }

  @Stage('acquireQuota')
  async acquireQuota() {
    await enforceGlobalRateLimit(this.scope, this.tryGetContext());
  }

  @Stage('authorize')
  async authorize() {
    if (!this.get(SharedServerIdentity).acceptsToken(this.rawInput.request?.headers?.['authorization'])) {
      this.respond(httpRespond.unauthorized());
    }
  }

  @Stage('drain')
  async drain() {
    const version = (this.rawInput.request?.body as { version?: unknown } | undefined)?.version;
    if (!isSharedVersion(version)) {
      this.respond(httpRespond.json({ error: 'version must be the version of the session' }, { status: 400 }));
      return;
    }
    const own = this.get(SharedServerIdentity).version;
    if (!((compareSharedVersions(version, own) ?? 0) > 0)) {
      this.respond(
        httpRespond.json(
          { error: 'only a session of a newer version replaces this server', version: own },
          { status: 409 },
        ),
      );
      return;
    }
    this.get(SharedServerLifecycle).exit(`a session of version ${version} replaces it`);
    this.respond(httpRespond.json({ draining: true }, { status: 202 }));
  }
}
