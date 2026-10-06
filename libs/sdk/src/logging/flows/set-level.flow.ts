// file: libs/sdk/src/logging/flows/set-level.flow.ts

import { z } from '@frontmcp/lazy-zod';
import { EmptyResultSchema, LoggingLevelSchema, SetLevelRequestSchema } from '@frontmcp/protocol';

import { Flow, FlowBase, FlowHooksOf, type FlowPlan, type FlowRunOptions } from '../../common';
import { InvalidInputError, InvalidMethodError } from '../../errors';
import { mcpRequestSessionId } from '../../transport/mcp-handlers/mcp-surface';

const inputSchema = z.object({
  request: SetLevelRequestSchema,
  ctx: z.unknown(),
});

const outputSchema = EmptyResultSchema;

const stateSchema = z.object({
  input: z.object({
    level: LoggingLevelSchema,
  }),
  sessionId: z.string().optional(),
  output: outputSchema,
});

const plan = {
  pre: ['parseInput'],
  execute: ['setLevel'],
  finalize: ['finalize'],
} as const satisfies FlowPlan<string>;

declare global {
  interface ExtendFlows {
    'logging:set-level': FlowRunOptions<
      SetLevelFlow,
      typeof plan,
      typeof inputSchema,
      typeof outputSchema,
      typeof stateSchema
    >;
  }
}

const name = 'logging:set-level' as const;
const { Stage } = FlowHooksOf<'logging:set-level'>(name);

@Flow({
  name,
  plan,
  inputSchema,
  outputSchema,
  access: 'authorized',
})
export default class SetLevelFlow extends FlowBase<typeof name> {
  logger = this.scopeLogger.child('SetLevelFlow');

  @Stage('parseInput')
  async parseInput() {
    this.logger.verbose('parseInput:start');

    let method!: string;
    let params: z.infer<typeof SetLevelRequestSchema>['params'];
    let ctx: unknown;
    try {
      const inputData = inputSchema.parse(this.rawInput);
      method = inputData.request.method;
      params = inputData.request.params;
      ctx = inputData.ctx;
    } catch (e) {
      throw new InvalidInputError('Invalid Input', e instanceof z.ZodError ? e.issues : undefined);
    }

    if (method !== 'logging/setLevel') {
      this.logger.warn(`parseInput: invalid method "${method}"`);
      throw new InvalidMethodError(method, 'logging/setLevel');
    }

    // The session whose level is set: a request without one is answered without setting it
    const sessionId = mcpRequestSessionId(ctx);
    this.state.set({ input: params, sessionId });
    this.logger.verbose('parseInput:done');
  }

  @Stage('setLevel')
  async setLevel() {
    this.logger.verbose('setLevel:start');
    const { level } = this.state.required.input;
    const { sessionId } = this.state;
    if (!sessionId) {
      this.logger.warn('setLevel: no session ID in the request context');
      return;
    }

    // A session the notification service doesn't know is answered like a known one: the level has nothing to apply to
    if (this.scope.notifications.setLogLevel(sessionId, level)) {
      this.logger.verbose(`setLevel: session log level set to "${level}"`);
    } else {
      this.logger.warn('setLevel: the session is not registered with the notification service');
    }

    this.logger.verbose('setLevel:done');
  }

  @Stage('finalize')
  async finalize() {
    this.logger.verbose('finalize:start');
    // Per MCP spec, logging/setLevel returns an empty result on success
    this.respond({});
    this.logger.verbose('finalize:done');
  }
}
