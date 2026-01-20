/**
 * Elicitation Result Flow
 *
 * Flow for handling incoming elicitation results from the client.
 * Provides hook points for middleware/plugins to intercept result processing.
 *
 * @module elicitation/flows/elicitation-result.flow
 */

import { Flow, FlowBase, FlowHooksOf, FlowPlan, FlowRunOptions } from '../../common';
import { z } from 'zod';
import type { ElicitResult, ElicitStatus } from '../elicitation.types';
import type { ElicitationStore, PendingElicitRecord } from '../store';
import type { Scope } from '../../scope';

const inputSchema = z.object({
  /** Session ID for the elicitation */
  sessionId: z.string(),
  /** The result from the client */
  result: z.object({
    action: z.enum(['accept', 'cancel', 'decline']),
    content: z.unknown().optional(),
  }),
});

const outputSchema = z.object({
  /** Whether the result was handled */
  handled: z.boolean(),
  /** The elicit ID (if pending was found) */
  elicitId: z.string().optional(),
  /** The processed result */
  result: z.any().optional() as z.ZodType<ElicitResult | undefined>,
});

const stateSchema = z.object({
  sessionId: z.string(),
  action: z.enum(['accept', 'cancel', 'decline']),
  content: z.unknown().optional(),
  pendingRecord: z.any().optional() as z.ZodType<PendingElicitRecord | undefined>,
  elicitResult: z.any().optional() as z.ZodType<ElicitResult | undefined>,
  handled: z.boolean().default(false),
  output: outputSchema.optional(),
});

const plan = {
  pre: ['parseInput'],
  execute: ['lookupPending', 'buildResult', 'publishResult'],
  finalize: ['finalize'],
} as const satisfies FlowPlan<string>;

declare global {
  interface ExtendFlows {
    'elicitation:result': FlowRunOptions<
      ElicitationResultFlow,
      typeof plan,
      typeof inputSchema,
      typeof outputSchema,
      typeof stateSchema
    >;
  }
}

const name = 'elicitation:result' as const;
const { Stage } = FlowHooksOf<'elicitation:result'>(name);

/**
 * Flow for handling elicitation results.
 *
 * This flow handles the processing of elicitation results:
 * 1. Parse and validate input
 * 2. Lookup pending record by session ID
 * 3. Build the result object
 * 4. Publish result via store (for distributed routing)
 *
 * The local handling (clearing timeouts, resolving promises) is still
 * done by the transport adapter for performance.
 */
@Flow({
  name,
  plan,
  inputSchema,
  outputSchema,
  access: 'authorized',
})
export default class ElicitationResultFlow extends FlowBase<typeof name> {
  logger = this.scopeLogger.child('ElicitationResultFlow');

  @Stage('parseInput')
  async parseInput() {
    this.logger.verbose('parseInput:start');

    const input = inputSchema.parse(this.rawInput);

    this.state.set({
      sessionId: input.sessionId,
      action: input.result.action,
      content: input.result.content,
    });

    this.logger.verbose('parseInput:done', {
      sessionId: input.sessionId,
      action: input.result.action,
    });
  }

  @Stage('lookupPending')
  async lookupPending() {
    this.logger.verbose('lookupPending:start');

    const { sessionId } = this.state.required;
    const scope = this.scope as Scope;

    const pendingRecord = await scope.elicitationStore.getPending(sessionId);
    this.state.set('pendingRecord', pendingRecord ?? undefined);

    if (!pendingRecord) {
      this.logger.verbose('lookupPending:notFound', { sessionId });
    } else {
      this.logger.verbose('lookupPending:found', {
        sessionId,
        elicitId: pendingRecord.elicitId,
      });
    }
  }

  @Stage('buildResult')
  async buildResult() {
    this.logger.verbose('buildResult:start');

    const { action, content } = this.state.required;

    // Map action directly to status (same names)
    const elicitResult: ElicitResult = {
      status: action as ElicitStatus,
      ...(action === 'accept' && content !== undefined && { content }),
    };

    this.state.set('elicitResult', elicitResult);

    this.logger.verbose('buildResult:done', { status: elicitResult.status });
  }

  @Stage('publishResult')
  async publishResult() {
    this.logger.verbose('publishResult:start');

    const { sessionId, pendingRecord, elicitResult } = this.state;
    const scope = this.scope as Scope;

    if (!pendingRecord || !elicitResult) {
      this.state.set('handled', false);
      this.logger.verbose('publishResult:skip (no pending or no result)');
      return;
    }

    try {
      await scope.elicitationStore.publishResult(pendingRecord.elicitId, sessionId!, elicitResult);
      this.state.set('handled', true);
      this.logger.verbose('publishResult:done', {
        elicitId: pendingRecord.elicitId,
        sessionId: sessionId!.slice(0, 20),
      });
    } catch (error) {
      this.logger.warn('publishResult:failed', {
        elicitId: pendingRecord.elicitId,
        error: (error as Error).message,
      });
      this.state.set('handled', false);
    }
  }

  @Stage('finalize')
  async finalize() {
    this.logger.verbose('finalize:start');

    const { handled, pendingRecord, elicitResult } = this.state;

    this.state.set('output', {
      handled: handled ?? false,
      elicitId: pendingRecord?.elicitId,
      result: elicitResult,
    });

    this.logger.verbose('finalize:done', { handled });
  }
}

export { ElicitationResultFlow };
