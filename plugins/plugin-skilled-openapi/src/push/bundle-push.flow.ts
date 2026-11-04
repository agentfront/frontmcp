// file: plugins/plugin-skilled-openapi/src/push/bundle-push.flow.ts

import 'reflect-metadata';

import {
  OverlayParseError,
  parseOverlay,
  SaasPushRefusedError,
  type BundlePushReceiver,
  type ResolvedBundle,
} from '@frontmcp/adapters/skills';
import { extractBearerToken } from '@frontmcp/auth';
import { z } from '@frontmcp/lazy-zod';
import {
  enforceGlobalRateLimit,
  enforceIpFilter,
  Flow,
  FlowBase,
  FlowHooksOf,
  httpInputSchema,
  HttpJsonSchema,
  httpRespond,
  type FlowPlan,
  type FlowRunOptions,
} from '@frontmcp/sdk';

import { BundleSyncService } from '../sync/bundle-sync.service';

/** Where a server whose `saas` source has `enableWebhook` takes the bundles its SaaS pushes. */
export const BUNDLE_PUSH_PATH = '/__skilled_openapi/push';

const plan = {
  pre: ['checkIpFilter', 'acquireQuota', 'verifyPushToken', 'parseBundle'],
  execute: ['applyBundle'],
} as const satisfies FlowPlan<string>;

export const bundlePushStateSchema = z.object({
  receiver: z.custom<BundlePushReceiver>(),
  bundle: z.custom<ResolvedBundle>(),
});

declare global {
  interface ExtendFlows {
    'skilled-openapi:bundle-push': FlowRunOptions<
      BundlePushFlow,
      typeof plan,
      typeof httpInputSchema,
      typeof HttpJsonSchema,
      typeof bundlePushStateSchema
    >;
  }
}

const name = 'skilled-openapi:bundle-push' as const;
const { Stage } = FlowHooksOf(name);

function refusal(status: number, error: string, description: string) {
  return httpRespond.json({ error, error_description: description }, { status });
}

function invalidToken(description: string) {
  return httpRespond.unauthorized({
    headers: { 'WWW-Authenticate': 'Bearer error="invalid_token"' },
    body: { error: 'invalid_token', error_description: description },
  });
}

/**
 * `POST /__skilled_openapi/push`: a bundle the SaaS pushes. Its token passes the pull token's checks and the replay
 * guard, the body passes the checks a pulled bundle passes (schema, then signature when required), and it is applied
 * after the bundles already queued, then kept as the last good bundle.
 */
@Flow({
  name,
  plan,
  access: 'public',
  inputSchema: httpInputSchema,
  outputSchema: HttpJsonSchema,
  middleware: { method: 'POST', path: BUNDLE_PUSH_PATH },
})
export default class BundlePushFlow extends FlowBase<typeof name> {
  private readonly logger = this.scope.logger.child('skilled-openapi:push');

  @Stage('checkIpFilter')
  async checkIpFilter() {
    enforceIpFilter(this.scope, this.tryGetContext()?.metadata.clientIp);
  }

  @Stage('acquireQuota')
  async acquireQuota() {
    await enforceGlobalRateLimit(this.scope, this.tryGetContext());
  }

  @Stage('verifyPushToken')
  async verifyPushToken() {
    const receiver = this.get(BundleSyncService).pushReceiver;
    if (!receiver) return this.next();
    const token = extractBearerToken(this.rawInput.request.headers['authorization'] as string | undefined);
    if (!token) return this.respond(invalidToken('the push carries no bearer token'));

    let refused: SaasPushRefusedError | undefined;
    try {
      await receiver.verifyPushToken(token);
    } catch (error) {
      if (!(error instanceof SaasPushRefusedError)) {
        this.logger.error(`bundle push not checked: ${(error as Error).message}`);
        return this.respond(refusal(503, 'temporarily_unavailable', "the issuer's JWKS could not be read"));
      }
      refused = error;
    }
    if (refused) {
      this.logger.warn(refused.message);
      return this.respond(
        refused.refusal === 'replayed'
          ? refusal(409, 'push_replayed', 'a push already used this token')
          : invalidToken('the push token was refused'),
      );
    }
    this.state.set('receiver', receiver);
  }

  @Stage('parseBundle')
  async parseBundle() {
    const { body } = this.rawInput.request;
    if (typeof body !== 'object' || body === null) {
      return this.respond(refusal(400, 'invalid_bundle', 'the body must be the bundle, as JSON'));
    }
    let bundle: ResolvedBundle;
    try {
      bundle = parseOverlay({ kind: 'object', content: body });
    } catch (error) {
      const issues = error instanceof OverlayParseError ? (error.errors ?? []) : [];
      const problems = issues.length > 0 ? `: ${issues.slice(0, 5).join('; ')}` : '';
      return this.respond(refusal(400, 'invalid_bundle', `${(error as Error).message}${problems}`));
    }
    this.state.set('bundle', bundle);
  }

  @Stage('applyBundle')
  async applyBundle() {
    const { receiver, bundle } = this.state.required;
    const result = await this.get(BundleSyncService).applyPushed(bundle);
    if (!result.applied) {
      return this.respond(
        refusal(
          422,
          'bundle_not_applied',
          `bundle ${bundle.bundleId}@${bundle.version} was not applied: ${result.reason}`,
        ),
      );
    }
    await receiver.keepBundle(bundle);
    this.logger.info(`applied pushed bundle ${bundle.bundleId}@${bundle.version}`);
    this.respond(httpRespond.json({ applied: true, bundleId: result.bundleId, bundleVersion: result.bundleVersion }));
  }
}
