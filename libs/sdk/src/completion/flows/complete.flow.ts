// file: libs/sdk/src/completion/flows/complete.flow.ts

import { z } from '@frontmcp/lazy-zod';
import { CompleteRequestSchema, CompleteResultSchema } from '@frontmcp/protocol';

import { loadRemoteAppCapabilities } from '../../app/remote-capabilities.utils';
import {
  Flow,
  FlowBase,
  FlowHooksOf,
  ToolEntry,
  type FlowPlan,
  type FlowRunOptions,
  type PromptEntry,
  type ResourceEntry,
  type ScopeEntry,
} from '../../common';
import { InvalidInputError, InvalidMethodError } from '../../errors';
import { ResolvedEntries } from '../../flows/resolved-entries';
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

const CompletionRefSchema = z.discriminatedUnion('type', [PromptRefSchema, ResourceRefSchema]);

const stateSchema = z.object({
  ref: CompletionRefSchema,
  argument: z.object({
    name: z.string(),
    value: z.string(),
  }),
  // z.any() used because PromptEntry and ResourceEntry are complex abstract class types
  prompt: z.any().optional() as z.ZodType<PromptEntry | undefined>,
  resource: z.any().optional() as z.ZodType<ResourceEntry | undefined>,
  widgetTools: z.array(z.instanceof(ToolEntry)).optional(),
  output: outputSchema,
});

const plan = {
  pre: ['parseInput', 'findReference', 'findWidgetTools'],
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

interface CompletionReference {
  prompt?: PromptEntry;
  resource?: ResourceEntry;
}

/** References `resolveHookOwnerId` found, reused by the same run's `findReference`. */
const resolvedReferences = new ResolvedEntries<CompletionReference>();

/** The prompt or resource a completion refers to, when the scope serves one. */
function findCompletionReference(scope: ScopeEntry, ref: CompletionRef): CompletionReference {
  if (ref.type === 'ref/prompt') return { prompt: scope.prompts.findByName(ref.name) };
  return { resource: scope.resources.findResourceForUri(ref.uri)?.instance };
}

function referenceKeyOf(ref: CompletionRef): string {
  return ref.type === 'ref/prompt' ? `prompt:${ref.name}` : `resource:${ref.uri}`;
}

/** Upper bound on the `tools/list` pages one widget completion walks. */
const MAX_TOOL_LIST_PAGES = 1000;

/** Whether a completion asks for the `toolName` of a `ui://widget/` URI. */
function isWidgetToolNameCompletion(ref: CompletionRef, argumentName: string): boolean {
  return ref.type === 'ref/resource' && ref.uri.startsWith('ui://widget/') && argumentName === 'toolName';
}

/** Whether `tools/list` listed the tool, under its own name or the app-prefixed name a name conflict gives it. */
function isListedTool(tool: ToolEntry, listedNames: ReadonlySet<string>): boolean {
  const baseName = tool.metadata.id ?? tool.metadata.name;
  return listedNames.has(baseName) || listedNames.has(`${tool.owner.id}:${baseName}`);
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
    const parsed = CompletionRefSchema.safeParse(
      (rawInput as { request?: { params?: { ref?: unknown } } } | undefined)?.request?.params?.ref,
    );
    if (!parsed.success) return undefined;
    const ref = parsed.data;
    let reference = findCompletionReference(scope, ref);
    if (!reference.prompt && !reference.resource) {
      await loadRemoteAppCapabilities(scope);
      reference = findCompletionReference(scope, ref);
    }
    const { prompt, resource } = reference;
    if (!prompt && !resource) return undefined;
    resolvedReferences.remember(rawInput, referenceKeyOf(ref), reference);
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
    const { ref } = this.state.required;
    const { prompt, resource } =
      resolvedReferences.take(this.rawInput, referenceKeyOf(ref)) ?? findCompletionReference(this.scope, ref);
    this.state.set({ prompt, resource });
    this.logger.verbose('findReference:done');
  }

  /** For a `ui://widget/` `toolName` completion, the UI tools the caller's `tools:list-tools` flow lists. */
  @Stage('findWidgetTools')
  async findWidgetTools() {
    const { ref, argument } = this.state.required;
    if (!isWidgetToolNameCompletion(ref, argument.name)) return;
    this.logger.verbose('findWidgetTools:start');

    const uiTools = this.scope.tools.getTools().filter((tool) => hasUIConfig(tool.metadata));
    const listedNames = uiTools.length > 0 ? await this.listToolNames() : new Set<string>();
    this.state.set(
      'widgetTools',
      uiTools.filter((tool) => isListedTool(tool, listedNames)),
    );
    this.logger.verbose('findWidgetTools:done');
  }

  /** Every tool name `tools/list` returns this caller, across all pages; none when listing fails. */
  private async listToolNames(): Promise<Set<string>> {
    const names = new Set<string>();
    let cursor: string | undefined;
    try {
      for (let page = 0; page < MAX_TOOL_LIST_PAGES; page++) {
        const { tools, nextCursor } = await this.scope.runFlowForOutput('tools:list-tools', {
          request: { method: 'tools/list', params: cursor ? { cursor } : {} },
          ctx: this.input.ctx,
        });
        for (const tool of tools) names.add(tool.name);
        if (!nextCursor) break;
        cursor = nextCursor;
      }
    } catch (e) {
      this.logger.warn(`findWidgetTools: tools/list failed, offering no tool names: ${e}`);
      names.clear();
    }
    return names;
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

      // ui:// widget URIs complete with the UI tools findWidgetTools kept for this caller
      if (isWidgetToolNameCompletion(ref, argName)) {
        const toolNames = (this.state.widgetTools ?? []).map((t) => t.metadata.id ?? t.metadata.name);

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
