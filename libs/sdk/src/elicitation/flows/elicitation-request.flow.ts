/**
 * Elicitation Request Flow
 *
 * Flow for initiating an elicitation request to the client.
 * Provides hook points for middleware/plugins to intercept elicitation.
 *
 * @module elicitation/flows/elicitation-request.flow
 */

import { Flow, FlowBase, FlowHooksOf, FlowPlan, FlowRunOptions } from '../../common';
import { z } from 'zod';
import { InvalidInputError } from '../../errors';
import type { ElicitMode } from '../elicitation.types';
import { DEFAULT_ELICIT_TTL } from '../elicitation.types';
import type { PendingElicitRecord } from '../store';
import type { Scope } from '../../scope';

const inputSchema = z.object({
  /** Related request ID from the transport */
  relatedRequestId: z.union([z.string(), z.number()]),
  /** Session ID for the elicitation */
  sessionId: z.string(),
  /** Message to display to the user */
  message: z.string(),
  /** JSON Schema for the expected response (already converted from Zod) */
  requestedSchema: z.record(z.string(), z.unknown()),
  /** Elicitation options */
  options: z
    .object({
      mode: z.enum(['form', 'url']).optional(),
      ttl: z.number().optional(),
      elicitationId: z.string().optional(),
    })
    .optional(),
});

const outputSchema = z.object({
  /** Generated or provided elicit ID */
  elicitId: z.string(),
  /** Session ID */
  sessionId: z.string(),
  /** Expiration timestamp */
  expiresAt: z.number(),
  /** Elicitation mode */
  mode: z.enum(['form', 'url']),
  /** Request parameters to send to client */
  requestParams: z.record(z.string(), z.unknown()),
  /** The pending record that was stored */
  pendingRecord: z.any() as z.ZodType<PendingElicitRecord>,
});

const stateSchema = z.object({
  relatedRequestId: z.union([z.string(), z.number()]),
  sessionId: z.string(),
  message: z.string(),
  requestedSchema: z.record(z.string(), z.unknown()),
  mode: z.enum(['form', 'url']).default('form'),
  ttl: z.number().default(DEFAULT_ELICIT_TTL),
  elicitationId: z.string().optional(),
  elicitId: z.string(),
  expiresAt: z.number(),
  pendingRecord: z.any().optional() as z.ZodType<PendingElicitRecord | undefined>,
  requestParams: z.record(z.string(), z.unknown()).optional(),
  output: outputSchema.optional(),
});

const plan = {
  pre: ['parseInput', 'validateRequest'],
  execute: ['generateElicitId', 'storePendingRecord', 'buildRequestParams'],
  finalize: ['finalize'],
} as const satisfies FlowPlan<string>;

declare global {
  interface ExtendFlows {
    'elicitation:request': FlowRunOptions<
      ElicitationRequestFlow,
      typeof plan,
      typeof inputSchema,
      typeof outputSchema,
      typeof stateSchema
    >;
  }
}

const name = 'elicitation:request' as const;
const { Stage } = FlowHooksOf<'elicitation:request'>(name);

/**
 * Flow for preparing an elicitation request.
 *
 * This flow handles the preparation stages of an elicitation:
 * 1. Parse and validate input
 * 2. Validate the request (mode requirements)
 * 3. Generate elicit ID
 * 4. Store pending record
 * 5. Build request parameters
 *
 * The actual sending and waiting for response is handled by the transport
 * adapter after this flow completes.
 */
@Flow({
  name,
  plan,
  inputSchema,
  outputSchema,
  access: 'authorized',
})
export default class ElicitationRequestFlow extends FlowBase<typeof name> {
  logger = this.scopeLogger.child('ElicitationRequestFlow');

  @Stage('parseInput')
  async parseInput() {
    this.logger.verbose('parseInput:start');

    const input = inputSchema.parse(this.rawInput);
    const { mode = 'form', ttl = DEFAULT_ELICIT_TTL, elicitationId } = input.options ?? {};

    this.state.set({
      relatedRequestId: input.relatedRequestId,
      sessionId: input.sessionId,
      message: input.message,
      requestedSchema: input.requestedSchema,
      mode: mode as ElicitMode,
      ttl,
      elicitationId,
    });

    this.logger.verbose('parseInput:done', { sessionId: input.sessionId, mode });
  }

  @Stage('validateRequest')
  async validateRequest() {
    this.logger.verbose('validateRequest:start');

    const { mode, elicitationId } = this.state;

    // URL mode requires elicitationId for out-of-band tracking
    if (mode === 'url' && !elicitationId) {
      throw new InvalidInputError('elicitationId is required when mode is "url"');
    }

    this.logger.verbose('validateRequest:done');
  }

  @Stage('generateElicitId')
  async generateElicitId() {
    this.logger.verbose('generateElicitId:start');

    const { elicitationId, ttl } = this.state;

    // Generate elicit ID if not provided
    const elicitId = elicitationId ?? `elicit-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const expiresAt = Date.now() + (ttl ?? DEFAULT_ELICIT_TTL);

    this.state.set({ elicitId, expiresAt });

    this.logger.verbose('generateElicitId:done', { elicitId });
  }

  @Stage('storePendingRecord')
  async storePendingRecord() {
    this.logger.verbose('storePendingRecord:start');

    const { elicitId, sessionId, message, mode, expiresAt } = this.state.required;
    const scope = this.scope as Scope;

    const pendingRecord: PendingElicitRecord = {
      elicitId,
      sessionId,
      createdAt: Date.now(),
      expiresAt,
      message,
      mode,
    };

    await scope.elicitationStore.setPending(pendingRecord);
    this.state.set('pendingRecord', pendingRecord);

    this.logger.verbose('storePendingRecord:done', { elicitId, sessionId });
  }

  @Stage('buildRequestParams')
  async buildRequestParams() {
    this.logger.verbose('buildRequestParams:start');

    const { mode, message, requestedSchema } = this.state.required;
    // elicitationId is optional - access directly from state
    const elicitationId = this.state.elicitationId;

    // Build request params based on mode
    const requestParams: Record<string, unknown> = {
      mode,
      message,
      requestedSchema,
    };

    // Add elicitationId for URL mode (required for out-of-band tracking)
    if (mode === 'url' && elicitationId) {
      requestParams['elicitationId'] = elicitationId;
    }

    this.state.set('requestParams', requestParams);

    this.logger.verbose('buildRequestParams:done');
  }

  @Stage('finalize')
  async finalize() {
    this.logger.verbose('finalize:start');

    const { elicitId, sessionId, expiresAt, mode, requestParams, pendingRecord } = this.state.required;

    // Set the output using respond() so runFlowForOutput can return it
    this.respond({
      elicitId,
      sessionId,
      expiresAt,
      mode,
      requestParams: requestParams!,
      pendingRecord: pendingRecord!,
    });

    this.logger.verbose('finalize:done');
  }
}

export { ElicitationRequestFlow };
