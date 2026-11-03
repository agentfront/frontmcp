import { isSharedServerNonce } from '@frontmcp/auth';
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
import { SHARED_IDENTIFY_PATH } from '../shared-endpoint';
import { SharedServerIdentity } from '../shared-server.identity';
import { exitingResponse, SharedServerLifecycle } from '../shared-server.lifecycle';

const inputSchema = httpInputSchema;
const outputSchema = HttpJsonSchema;

const plan = {
  pre: ['checkIpFilter', 'acquireQuota'],
  execute: ['prove'],
} as const satisfies FlowPlan<string>;

declare global {
  interface ExtendFlows {
    'shared:identify': FlowRunOptions<
      SharedIdentifyFlow,
      typeof plan,
      typeof inputSchema,
      typeof outputSchema,
      z.ZodObject<Record<string, never>>
    >;
  }
}

const name = 'shared:identify' as const;
const Stage = StageHookOf(name);

/** POST /.well-known/frontmcp-shared-server: the HMAC of the client's nonce, bound to the server's endpoint and version. */
@Flow({
  name,
  plan,
  inputSchema,
  outputSchema,
  access: 'public',
  middleware: { method: 'POST' },
})
export default class SharedIdentifyFlow extends FlowBase<typeof name> {
  static canActivate(request: ServerRequest): boolean {
    return request.path === SHARED_IDENTIFY_PATH;
  }

  @Stage('checkIpFilter')
  async checkIpFilter() {
    enforceIpFilter(this.scope, this.tryGetContext()?.metadata.clientIp);
  }

  @Stage('acquireQuota')
  async acquireQuota() {
    await enforceGlobalRateLimit(this.scope, this.tryGetContext());
  }

  @Stage('prove')
  async prove() {
    const nonce = (this.rawInput.request?.body as { nonce?: unknown } | undefined)?.nonce;
    if (!isSharedServerNonce(nonce)) {
      this.respond(httpRespond.json({ error: 'nonce must be 32 random bytes in base64url' }, { status: 400 }));
      return;
    }
    const lifecycle = this.get(SharedServerLifecycle);
    if (lifecycle.isExiting) this.respond(exitingResponse());
    lifecycle.touch();
    this.respond(httpRespond.json(this.get(SharedServerIdentity).prove(nonce)));
  }
}
