// file: libs/sdk/src/completion/flows/complete.flow.ts

import { Flow, FlowBase, FlowHooksOf, FlowPlan, FlowRunOptions } from '../../common';
import { z } from 'zod';
import { CompleteRequestSchema, CompleteResultSchema } from '@modelcontextprotocol/sdk/types.js';
import { InvalidMethodError, InvalidInputError } from '../../errors';

const inputSchema = z.object({
  request: CompleteRequestSchema,
  ctx: z.unknown(),
});

const outputSchema = CompleteResultSchema;

/**
 * Reference types for completion requests
 */
const PromptRefSchema = z.object({
  type: z.literal('ref/prompt'),
  name: z.string(),
});

const ResourceRefSchema = z.object({
  type: z.literal('ref/resource'),
  uri: z.string(),
});

const stateSchema = z.object({
  ref: z.discriminatedUnion('type', [PromptRefSchema, ResourceRefSchema]),
  argument: z.object({
    name: z.string(),
    value: z.string(),
  }),
  output: outputSchema,
});

const plan = {
  pre: ['parseInput'],
  execute: ['complete'],
  finalize: ['finalize'],
} as const satisfies FlowPlan<string>;

declare global {
  interface ExtendFlows {
    'completion:complete': FlowRunOptions<
      CompleteFlow,
      typeof plan,
      typeof inputSchema,
      typeof outputSchema,
      typeof stateSchema
    >;
  }
}

const name = 'completion:complete' as const;
const { Stage } = FlowHooksOf<'completion:complete'>(name);

@Flow({
  name,
  plan,
  inputSchema,
  outputSchema,
  access: 'authorized',
})
export default class CompleteFlow extends FlowBase<typeof name> {
  logger = this.scopeLogger.child('CompleteFlow');

  @Stage('parseInput')
  async parseInput() {
    this.logger.verbose('parseInput:start');

    let method!: string;
    let params: z.infer<typeof CompleteRequestSchema>['params'];
    try {
      const inputData = inputSchema.parse(this.rawInput);
      method = inputData.request.method;
      params = inputData.request.params;
    } catch (e) {
      throw new InvalidInputError('Invalid Input', e instanceof z.ZodError ? e.issues : undefined);
    }

    if (method !== 'completion/complete') {
      this.logger.warn(`parseInput: invalid method "${method}"`);
      throw new InvalidMethodError(method, 'completion/complete');
    }

    const { ref, argument } = params;

    // Validate ref structure
    if (!ref || !ref.type) {
      throw new InvalidInputError('Reference (ref) is required with type field');
    }

    if (ref.type !== 'ref/prompt' && ref.type !== 'ref/resource') {
      // Cast needed because TypeScript exhaustively checks ref.type, making it 'never' in this branch
      throw new InvalidInputError(
        `Invalid reference type: ${(ref as { type: string }).type}. Expected "ref/prompt" or "ref/resource"`,
      );
    }

    // Validate argument structure
    if (!argument || typeof argument.name !== 'string' || typeof argument.value !== 'string') {
      throw new InvalidInputError('Argument must have "name" and "value" string fields');
    }

    this.state.set({ ref, argument });
    this.logger.verbose('parseInput:done');
  }

  @Stage('complete')
  async complete() {
    this.logger.verbose('complete:start');
    const { ref, argument } = this.state.required;

    let values: string[] = [];
    let total: number | undefined;
    let hasMore: boolean | undefined;

    if (ref.type === 'ref/prompt') {
      // Get completion suggestions for a prompt argument
      const { name: promptName } = ref;
      const { name: argName, value: argValue } = argument;

      this.logger.debug(
        `complete: prompt completion for "${promptName}" argument "${argName}" with value "${argValue}"`,
      );

      // Look up the prompt in the registry
      const prompt = this.scope.prompts.findByName(promptName);

      if (prompt) {
        // Check if the prompt instance has a completer for this argument
        // Completion support is optional - prompts can implement getArgumentCompleter to provide suggestions
        const instance = prompt as any; // PromptInstance may have completer method
        if (typeof instance.getArgumentCompleter === 'function') {
          const completer = instance.getArgumentCompleter(argName);
          if (completer) {
            try {
              const result = await completer(argValue);
              values = result.values || [];
              total = result.total;
              hasMore = result.hasMore;
            } catch (e) {
              this.logger.warn(`complete: completer failed for prompt "${promptName}" argument "${argName}": ${e}`);
            }
          }
        }
      } else {
        this.logger.debug(`complete: prompt "${promptName}" not found`);
      }
    } else if (ref.type === 'ref/resource') {
      // Get completion suggestions for a resource template URI
      const { uri } = ref;
      const { name: argName, value: argValue } = argument;

      this.logger.debug(
        `complete: resource completion for URI "${uri}" argument "${argName}" with value "${argValue}"`,
      );

      // Look up the resource template in the registry by URI
      const resourceMatch = this.scope.resources.findResourceForUri(uri);

      if (resourceMatch) {
        // Check if the resource instance has a completer for this argument
        // Completion support is optional - resources can implement getArgumentCompleter to provide suggestions
        const instance = resourceMatch.instance as any; // ResourceInstance may have completer method
        if (typeof instance.getArgumentCompleter === 'function') {
          const completer = instance.getArgumentCompleter(argName);
          if (completer) {
            try {
              const result = await completer(argValue);
              values = result.values || [];
              total = result.total;
              hasMore = result.hasMore;
            } catch (e) {
              this.logger.warn(`complete: completer failed for resource "${uri}" argument "${argName}": ${e}`);
            }
          }
        }
      } else {
        this.logger.debug(`complete: resource "${uri}" not found`);
      }
    }

    // Build the completion result
    const completion: { values: string[]; total?: number; hasMore?: boolean } = { values };
    if (total !== undefined) {
      completion.total = total;
    }
    if (hasMore !== undefined) {
      completion.hasMore = hasMore;
    }

    this.state.set({ output: { completion } });
    this.logger.verbose('complete:done');
  }

  @Stage('finalize')
  async finalize() {
    this.logger.verbose('finalize:start');
    const { output } = this.state.required;
    this.respond(output);
    this.logger.verbose('finalize:done');
  }
}
