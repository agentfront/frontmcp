// file: libs/sdk/src/logging/flows/set-level.flow.ts

import { Flow, FlowBase, FlowHooksOf, FlowPlan, FlowRunOptions } from '../../common';
import { z } from 'zod';
import { SetLevelRequestSchema, EmptyResultSchema, LoggingLevelSchema } from '@modelcontextprotocol/sdk/types.js';
import { InvalidMethodError, InvalidInputError, GenericServerError } from '../../errors';
import type { McpLoggingLevel } from '../../notification';

const inputSchema = z.object({
  request: SetLevelRequestSchema,
  ctx: z.unknown(),
});

const outputSchema = EmptyResultSchema;

const stateSchema = z.object({
  input: z.object({
    level: LoggingLevelSchema,
  }),
  sessionId: z.string(),
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
      throw new InvalidInputError('Invalid Input', e instanceof z.ZodError ? e.errors : undefined);
    }

    if (method !== 'logging/setLevel') {
      this.logger.warn(`parseInput: invalid method "${method}"`);
      throw new InvalidMethodError(method, 'logging/setLevel');
    }

    // Get session ID from context - required for logging level tracking
    const sessionId = (ctx as Record<string, unknown> | undefined)?.['sessionId'];
    if (!sessionId || typeof sessionId !== 'string') {
      this.logger.warn('parseInput: sessionId not found in context');
      throw new InvalidInputError('Session ID is required for setting log level');
    }

    this.state.set({ input: params, sessionId });
    this.logger.verbose('parseInput:done');
  }

  @Stage('setLevel')
  async setLevel() {
    this.logger.verbose('setLevel:start');
    const { level } = this.state.required.input;
    const { sessionId } = this.state.required;

    // Set the log level for this session via NotificationService
    const success = this.scope.notifications.setLogLevel(sessionId, level as McpLoggingLevel);

    if (success) {
      this.logger.info(`setLevel: session log level set to "${level}"`);
    } else {
      // Per MCP spec, return Internal error (-32603) when operation fails
      this.logger.warn(`setLevel: failed to set log level for session (session not registered?)`);
      throw new GenericServerError('Failed to set log level: session not registered');
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
