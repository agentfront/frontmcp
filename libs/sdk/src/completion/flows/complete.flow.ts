// file: libs/sdk/src/completion/flows/complete.flow.ts

import { z } from '@frontmcp/lazy-zod';
import { CompleteRequestSchema, CompleteResultSchema } from '@frontmcp/protocol';

import { loadRemoteAppCapabilities } from '../../app/remote-capabilities.utils';
import {
  Flow,
  FlowBase,
  FlowHooksOf,
  type FlowPlan,
  type FlowRunOptions,
  type PromptEntry,
  type ResourceEntry,
  type ScopeEntry,
} from '../../common';
import { InvalidInputError, InvalidMethodError } from '../../errors';
import { hasUIConfig } from '../../tool/ui';
import { appOwnerIdOf } from '../../utils/lineage.utils';

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
  // z.any() used because PromptEntry and ResourceEntry are complex abstract class types
  prompt: z.any().optional() as z.ZodType<PromptEntry | undefined>,
  resource: z.any().optional() as z.ZodType<ResourceEntry | undefined>,
  output: outputSchema,
});

const plan = {
  pre: ['parseInput', 'findReference'],
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

type CompletionRef = z.infer<typeof CompleteRequestSchema>['params']['ref'];

/** The prompt or resource a completion refers to, when the scope serves one. */
function findCompletionReference(
  scope: ScopeEntry,
  ref: CompletionRef,
): { prompt?: PromptEntry; resource?: ResourceEntry } {
  if (ref.type === 'ref/prompt') return { prompt: scope.prompts.findByName(ref.name) };
  return { resource: scope.resources.findResourceForUri(ref.uri)?.instance };
}

@Flow({
  name,
  plan,
  inputSchema,
  outputSchema,
  access: 'authorized',
})
export default class CompleteFlow extends FlowBase<typeof name> {
  static override async resolveHookOwnerId(rawInput: unknown, scope: ScopeEntry): Promise<string | undefined> {
    const parsed = inputSchema.safeParse(rawInput);
    if (!parsed.success) return undefined;
    const { ref } = parsed.data.request.params;
    let { prompt, resource } = findCompletionReference(scope, ref);
    if (!prompt && !resource) {
      await loadRemoteAppCapabilities(scope);
      ({ prompt, resource } = findCompletionReference(scope, ref));
    }
    if (prompt) return appOwnerIdOf(scope.prompts.lineageOf(prompt) ?? [], prompt.owner);
    return resource ? appOwnerIdOf(scope.resources.lineageOf(resource) ?? [], resource.owner) : undefined;
  }

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

  /**
   * Resolve the prompt or resource the completion refers to, before any completer runs.
   * Hookable: gate the referenced entry with Will/Did/Around on 'findReference' or 'complete'.
   */
  @Stage('findReference')
  async findReference() {
    this.logger.verbose('findReference:start');
    const { prompt, resource } = findCompletionReference(this.scope, this.state.required.ref);
    this.state.set({ prompt, resource });
    this.logger.verbose('findReference:done');
  }

  @Stage('complete')
  async complete() {
    this.logger.verbose('complete:start');
    const { ref, argument } = this.state.required;
    const { prompt, resource } = this.state;

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

      // Special handling for ui:// widget URIs - complete with tool names that have UI config
      if (uri.startsWith('ui://widget/') && argName === 'toolName') {
        const toolsWithUI = this.scope.tools.getTools().filter((t) => hasUIConfig(t.metadata));
        const toolNames = toolsWithUI.map((t) => t.metadata.id ?? t.metadata.name);

        // Filter by prefix if value is provided
        const prefix = argValue.toLowerCase();
        values = toolNames.filter((name) => name.toLowerCase().startsWith(prefix));
        total = values.length;

        this.logger.debug(`complete: found ${values.length} tools with UI config matching "${argValue}"`);
      } else if (resource) {
        // Check if the resource has a completer for this argument
        // Completion support is optional — resources override getArgumentCompleter to provide suggestions
        const completer = resource.getArgumentCompleter(argName);
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
