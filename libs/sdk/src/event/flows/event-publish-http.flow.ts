import { internalZ as z } from '@frontmcp/lazy-zod';
import type { AuthInfo } from '@frontmcp/protocol';

import {
  authInfoFromAuthorization,
  challengeHeaders,
  enforceGlobalRateLimit,
  enforceIpFilter,
  EventEntry,
  Flow,
  FlowBase,
  FlowControl,
  FlowHooksOf,
  httpInputSchema,
  HttpJsonSchema,
  httpRespond,
  type EventPublisher,
  type FlowPlan,
  type FlowRunOptions,
  type ScopeEntry,
  type ServerRequest,
} from '../../common';
import { PublicMcpError } from '../../errors';
import { matchRoutePath } from '../../flows/flow.http-path';
import { verifyWorkflowWebhook } from '../../workflow/trigger/workflow-webhook.signature';
import { eventSubscriberOf } from '../event-subscriber';
import type EventRegistry from '../event.registry';
import { type EventPublishEndpoint } from '../publish-endpoint/event-publish-endpoint';

/** The largest body of a publish request, in bytes: what one delivery may carry. */
export const EVENT_PUBLISH_MAX_BODY_BYTES = 262_144;

const EVENT_ID_PATTERN = /^[\x21-\x7e]{1,255}$/;

/** Whether a string is a date `publish()` can take as the time of an occurrence. */
function isTimestamp(value: string): boolean {
  return !Number.isNaN(new Date(value).getTime());
}

const audienceValueSchema = z.union([z.string(), z.array(z.string())]);

/** The body of a publish request. Unknown keys are refused, so a misspelled `audience` never widens a publish. */
const publishRequestSchema = z
  .object({
    name: z.string().min(1),
    data: z.record(z.string(), z.unknown()),
    eventId: z.string().regex(EVENT_ID_PATTERN, 'eventId must be 1 to 255 visible ASCII characters').optional(),
    timestamp: z.string().refine(isTimestamp, 'timestamp must be a date such as 2026-10-02T12:00:00Z').optional(),
    subscriptionId: z.string().min(1).optional(),
    audience: z
      .object({
        sub: audienceValueSchema.optional(),
        tenantId: audienceValueSchema.optional(),
        roles: z
          .object({ any: z.array(z.string()).optional(), all: z.array(z.string()).optional() })
          .strict()
          .optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

const inputSchema = httpInputSchema;
const outputSchema = HttpJsonSchema;

const stateSchema = z.object({
  body: z.custom<Uint8Array>(),
  caller: z.custom<Partial<AuthInfo>>().optional(),
  publication: publishRequestSchema,
  event: z.instanceof(EventEntry),
  claimedEventId: z.string().optional(),
  claimToken: z.string().optional(),
  result: z.object({ eventId: z.string(), matched: z.number() }),
  flowError: z.instanceof(Error).optional(),
});

// No `post` stage: one would still run after a stage answered the request early.
const plan = {
  pre: [
    'checkIpFilter',
    'acquireQuota',
    'readBody',
    'authenticate',
    'parseBody',
    'checkAuthorities',
    'findEvent',
    'validatePayload',
  ],
  execute: ['claimEventId', 'publish', 'rememberResult', 'buildResponse'],
  finalize: ['finalize'],
} as const satisfies FlowPlan<string>;

declare global {
  interface ExtendFlows {
    'events:publish-http': FlowRunOptions<
      EventPublishHttpFlow,
      typeof plan,
      typeof inputSchema,
      typeof outputSchema,
      typeof stateSchema
    >;
  }
}

const name = 'events:publish-http' as const;
const { Stage } = FlowHooksOf<'events:publish-http'>(name);
const decoder = new TextDecoder();

/** The media type of a `Content-Type` header, without its parameters. */
function mediaTypeOf(contentType: string | undefined): string {
  return (contentType ?? '').split(';')[0].trim().toLowerCase();
}

/** The body as a JSON value; undefined when it is not JSON. */
function jsonOf(body: Uint8Array): unknown {
  try {
    return JSON.parse(decoder.decode(body));
  } catch {
    return undefined;
  }
}

/** Where each problem is and what it is, without the value that caused it. */
function summarizeIssues(error: z.ZodError): Array<{ path: string; message: string }> {
  return error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message }));
}

/** `events:publish-http`: publish one event for a `POST` to the server's publish endpoint. */
@Flow({
  name,
  plan,
  inputSchema,
  outputSchema,
  access: 'public',
  middleware: { method: 'POST' },
})
export default class EventPublishHttpFlow extends FlowBase<typeof name> {
  logger = this.scopeLogger.child('EventPublishHttpFlow');

  /** Whether the request is a `POST` to the publish endpoint of a scope that serves one. */
  static canActivate(request: ServerRequest, scope: ScopeEntry): boolean {
    const endpoint = scope.events?.publishEndpoint;
    return (
      endpoint !== undefined && request.method === 'POST' && matchRoutePath(endpoint.path, request.path) !== undefined
    );
  }

  /** The event registry of the scope: the flow is registered with it. */
  private get events(): EventRegistry {
    return this.scope.events as EventRegistry;
  }

  /** The endpoint the flow serves; it is registered only on a scope that has one. */
  private get endpoint(): EventPublishEndpoint {
    return this.events.publishEndpoint as EventPublishEndpoint;
  }

  /** The publisher of the scope, which the registry has from startup. */
  private get publisher(): EventPublisher {
    return this.events.publisher as EventPublisher;
  }

  /** The HTTP request the flow answers. */
  private get httpRequest(): ServerRequest {
    return this.rawInput.request as ServerRequest;
  }

  /** Answer the request with an error and end the flow; the refusal is the run's failure, for its span and hooks. */
  private refuse(
    status: number,
    error: string,
    details: Record<string, unknown> = {},
    headers?: Record<string, string>,
  ): never {
    this.state.set('flowError', new PublicMcpError(`HTTP ${status}: ${error}`, 'EVENT_PUBLISH_REFUSED', status));
    return FlowControl.respond(httpRespond.json({ error, ...details }, { status, headers }));
  }

  /** Run a guard that answers its own refusals, and keep such a refusal as the run's failure, as `refuse()` does. */
  private async recordingRefusal(guard: () => void | Promise<void>): Promise<void> {
    try {
      await guard();
    } catch (signal) {
      if (signal instanceof FlowControl && signal.type === 'respond') {
        const { status, body } = signal.output as { status: number; body?: { error?: unknown } };
        const error = typeof body?.error === 'string' ? body.error : 'Refused';
        this.state.set('flowError', new PublicMcpError(`HTTP ${status}: ${error}`, 'EVENT_PUBLISH_REFUSED', status));
      }
      throw signal;
    }
  }

  /** Refuse a caller `throttle.ipFilter` blocks. */
  @Stage('checkIpFilter')
  async checkIpFilter() {
    await this.recordingRefusal(() => enforceIpFilter(this.scope, this.tryGetContext()?.metadata.clientIp));
  }

  /** Count the request against the server's global rate limit. */
  @Stage('acquireQuota')
  async acquireQuota() {
    await this.recordingRefusal(() => enforceGlobalRateLimit(this.scope, this.tryGetContext()));
  }

  /** Take the body's bytes: JSON, no larger than one delivery may be. */
  @Stage('readBody')
  async readBody() {
    const request = this.httpRequest;
    if (mediaTypeOf(request.headers['content-type']) !== 'application/json') {
      this.refuse(415, 'The body must be application/json');
    }
    const body = request.bodyBytes ?? new Uint8Array();
    if (body.length > EVENT_PUBLISH_MAX_BODY_BYTES) this.refuse(413, 'Payload too large');
    this.state.set('body', body);
  }

  /** Know the caller: by the request's signature when the endpoint has a `secret`, else by bearer credentials. */
  @Stage('authenticate')
  async authenticate() {
    const { secret, replays } = this.endpoint;
    if (secret === undefined) {
      this.state.set('caller', await this.verifyBearer());
      return;
    }
    const signedRequest = { headers: this.httpRequest.headers, body: this.state.required.body };
    const refusal = verifyWorkflowWebhook(signedRequest, secret, replays);
    if (refusal) {
      this.logger.warn(`authenticate: a publish request was refused: ${refusal}`);
      this.refuse(401, 'Unauthorized');
    }
  }

  /** Read what to publish from the body. */
  @Stage('parseBody')
  async parseBody() {
    const parsed = publishRequestSchema.safeParse(jsonOf(this.state.required.body));
    if (!parsed.success) this.refuse(400, 'Invalid publish request', { issues: summarizeIssues(parsed.error) });
    this.state.set('publication', parsed.data);
  }

  /** Evaluate `events.publishEndpoint.authorities` for the bearer caller, with the request body as input. */
  @Stage('checkAuthorities')
  async checkAuthorities() {
    const engine = this.scope.authoritiesEngine;
    const contextBuilder = this.scope.authoritiesContextBuilder;
    const { authorities } = this.endpoint;
    if (!engine || !contextBuilder || authorities === undefined) return;

    const caller = this.state.caller ?? {};
    const evaluationContext = contextBuilder.build(caller as never, this.state.required.publication);
    const result = await engine.evaluate(authorities, evaluationContext);
    if (result.granted) return;
    this.logger.verbose(`checkAuthorities: a publish request was refused: ${result.deniedBy ?? 'policy denied'}`);
    this.refuse(403, 'Forbidden');
  }

  /** Find the event the request names. */
  @Stage('findEvent')
  async findEvent() {
    const eventName = this.state.required.publication.name;
    const event = this.events.findByName(eventName);
    if (!event) this.refuse(404, `Event "${eventName}" is not registered`);
    this.state.set('event', event);
  }

  /** Check `data` against the event's `payloadSchema`; a mismatch is answered with where and why, never with the data. */
  @Stage('validatePayload')
  async validatePayload() {
    const { event, publication } = this.state.required;
    try {
      event.parsePayload(publication.data);
    } catch (error) {
      if (!(error instanceof z.ZodError)) throw error;
      this.refuse(422, `data does not match the payloadSchema of event "${event.name}"`, {
        issues: summarizeIssues(error),
      });
    }
  }

  /** For a request that names an `eventId`: answer what its first publish got, or claim it for this one. */
  @Stage('claimEventId')
  async claimEventId() {
    const { name: eventName, eventId } = this.state.required.publication;
    if (eventId === undefined) return;
    const claim = await this.endpoint.idempotency.claim(eventName, eventId);
    if (claim.state === 'published') return this.respond(httpRespond.json(claim.result, { status: 202 }));
    if (claim.state === 'in-flight') {
      this.refuse(409, `Event "${eventName}" with eventId "${eventId}" is being published; retry for its answer`);
    }
    this.state.set({ claimedEventId: eventId, claimToken: claim.token });
  }

  /** Publish through the server's publisher, as `this.events.publish()` does; a failure gives the `eventId` back. */
  @Stage('publish')
  async publish() {
    const { name: eventName, data, eventId, timestamp, subscriptionId, audience } = this.state.required.publication;
    try {
      const options = { eventId, timestamp, subscriptionId, audience };
      this.state.set('result', await this.publisher.publish(eventName, data, options));
    } catch (error) {
      const { claimedEventId, claimToken } = this.state;
      if (claimedEventId !== undefined && claimToken !== undefined) {
        await this.endpoint.idempotency.release(eventName, claimedEventId, claimToken);
      }
      throw error;
    }
  }

  /** Keep the answer of a claimed `eventId`, for a repeat; the event is published, so a store failure only logs. */
  @Stage('rememberResult')
  async rememberResult() {
    const { claimedEventId, claimToken } = this.state;
    if (claimedEventId === undefined || claimToken === undefined) return;
    const { publication, result } = this.state.required;
    try {
      await this.endpoint.idempotency.complete(publication.name, claimedEventId, claimToken, result);
    } catch (error) {
      this.logger.warn(
        `rememberResult: event "${publication.name}" with eventId "${claimedEventId}" was published, ` +
          'but its answer could not be kept for a repeat',
        error,
      );
    }
  }

  /** Answer `202` with the event's id and how many deliveries were queued. */
  @Stage('buildResponse')
  async buildResponse() {
    this.respond(httpRespond.json(this.state.required.result, { status: 202 }));
  }

  /** Runs however the request ended, so a hook on it sees every request, with a refusal or a failure as `ctx.error`. */
  @Stage('finalize')
  async finalize() {
    this.logger.verbose(`finalize: ${this.state.result ? 'published' : 'not published'}`);
  }

  /** The signed-in caller of a bearer request: an unverified or anonymous one is answered 401, a short scope 403. */
  private async verifyBearer(): Promise<Partial<AuthInfo>> {
    const verified = await this.scope.runFlow('session:verify', {
      request: this.httpRequest as unknown as Record<string, unknown>,
      sessionless: true,
    });
    if (verified?.kind === 'authorized') {
      const caller: Partial<AuthInfo> = authInfoFromAuthorization(verified.authorization);
      if (eventSubscriberOf(caller, this.scope.authoritiesContextBuilder)) return caller;
      return this.refuse(401, 'Unauthorized', { message: 'Publishing needs a signed-in caller' });
    }
    const headers = challengeHeaders(verified?.prmMetadataHeader);
    return verified?.kind === 'forbidden'
      ? this.refuse(403, 'Forbidden', {}, headers)
      : this.refuse(401, 'Unauthorized', {}, headers);
  }
}
