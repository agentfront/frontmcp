import { z } from '@frontmcp/lazy-zod';
import {
  DynamicPlugin,
  FrontMcpLogger,
  Plugin,
  ProviderScope,
  ResourceHook,
  storeProvider,
  ToolHook,
  type CallToolResult,
  type FlowCtxOf,
  type PluginStoreInBrowser,
  type ProviderType,
} from '@frontmcp/sdk';

import { jsonBytes, previewOf, shapeOf, type FoldedAnswer } from './folded-answer';
import { createResultHandleStore } from './result-handle-store.factory';
import { addFoldingStore, resultOwnerOf, type ResultHandleStore, type ResultOwner } from './result-handle.store';
import {
  parseResultHandlesOptions,
  RESULT_HANDLE_META_KEY,
  type ResultHandlesPluginOptions,
  type ResultHandlesPluginOptionsInput,
} from './result-handles.options';
import { ResultHandlesConfigToken, ResultHandleStoreToken } from './result-handles.symbols';
import ResultQueryTool, { RESULT_QUERY_TOOL_NAME } from './result-query.tool';

type FoldedTool = NonNullable<FlowCtxOf<'tools:call-tool'>['state']['tool']>;

function parsedJsonText(text: string): unknown {
  const start = text.trimStart()[0];
  if (start !== '{' && start !== '[') return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/**
 * What a resource's text holds: for a JSON media type (`application/json`, `+json`), any JSON value, a string or a
 * number included; else an object or a list its text spells, as for a tool's text. The text itself when it does not
 * parse.
 */
function resourceAnswerOf(text: string, mimeType: string | undefined): unknown {
  const media = mimeType?.split(';')[0].trim().toLowerCase();
  if (media !== 'application/json' && !media?.endsWith('+json')) return parsedJsonText(text) ?? text;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

/** Whether `text` only repeats `structured` as the SDK writes it: its JSON, or the primitive `{ content }` wraps. */
function repeatsStructuredContent(text: string, structured: Record<string, unknown>): boolean {
  if (JSON.stringify(parsedJsonText(text) ?? text) === JSON.stringify(structured)) return true;
  const keys = Object.keys(structured);
  const content = structured['content'];
  const isPrimitive = content === null || typeof content !== 'object';
  return keys.length === 1 && keys[0] === 'content' && isPrimitive && text === String(content);
}

/** The answer's data: `structuredContent` when its one text only repeats it, else its one text (parsed when JSON). */
function answerDataOf(result: CallToolResult): unknown {
  const texts = result.content.flatMap((block) => (block.type === 'text' ? [block.text] : []));
  if (texts.length !== result.content.length || texts.length > 1) return undefined;
  const structured = result.structuredContent;
  if (structured !== undefined) {
    return texts.length === 0 || repeatsStructuredContent(texts[0], structured) ? structured : undefined;
  }
  if (texts.length !== 1) return undefined;
  return parsedJsonText(texts[0]) ?? texts[0];
}

/** The tool's answer for `folded`, or undefined when its Zod schema (no undeclared key) or JSON Schema rejects it. */
function foldedAnswerOf(tool: FoldedTool, folded: FoldedAnswer): CallToolResult | undefined {
  const jsonSchema = tool.getRawOutputSchema();
  const hasJsonSchemaOnly = tool.outputSchema === undefined && typeof jsonSchema === 'object' && jsonSchema !== null;
  if (hasJsonSchemaOnly && !jsonSchemaAdmits(jsonSchema, folded)) return undefined;
  const parsed = tool.safeParseOutput(folded, { undeclaredKeys: 'fail' });
  if (!parsed.success || parsed.data.structuredContent?.['handle'] !== folded.handle) return undefined;
  return parsed.data;
}

function jsonSchemaAdmits(jsonSchema: object, folded: FoldedAnswer): boolean {
  try {
    return z.fromJSONSchema(jsonSchema as Parameters<typeof z.fromJSONSchema>[0]).safeParse(folded).success;
  } catch {
    return false;
  }
}

/** Whether a client read the resource, rather than an agent or a flow in process. */
function isClientRead(rawInput: unknown): boolean {
  const ctx = (rawInput as { ctx?: { internalCall?: boolean; agentPrivateCall?: boolean } } | undefined)?.ctx;
  return !(ctx?.internalCall || ctx?.agentPrivateCall);
}

/** Folds an answer over `thresholdBytes` into a preview, a shape and a handle that `result_query` reads. */
@Plugin({
  name: 'result-handles',
  description:
    'Folds large tool answers (and, opted in, resource reads) into a preview, a shape and a handle that result_query reads',
  tools: [ResultQueryTool],
})
export default class ResultHandlesPlugin extends DynamicPlugin<
  ResultHandlesPluginOptions,
  ResultHandlesPluginOptionsInput
> {
  options: ResultHandlesPluginOptions;
  private readonly unfoldableTools = new WeakSet<FoldedTool>();

  constructor(options: ResultHandlesPluginOptionsInput = {}) {
    super();
    this.options = parseResultHandlesOptions(options);
  }

  /** A `storage` on Redis or SQLite, which a browser refuses at startup (#1033). */
  static override browserStores = (input: ResultHandlesPluginOptionsInput): PluginStoreInBrowser[] => {
    const { type } = parseResultHandlesOptions(input).storage;
    return [
      {
        plugin: 'ResultHandlesPlugin',
        option: type === 'redis' || type === 'sqlite' ? `storage: { type: '${type}' }` : undefined,
        memory: "storage: { type: 'memory' }",
      },
    ];
  };

  static override dynamicProviders = (input: ResultHandlesPluginOptionsInput): ProviderType[] => {
    const options = parseResultHandlesOptions(input);
    return [
      { name: 'result-handles:config', provide: ResultHandlesConfigToken, useValue: options },
      storeProvider({
        name: 'result-handles:store',
        provide: ResultHandleStoreToken,
        scope: ProviderScope.GLOBAL,
        inject: () => [] as const,
        useFactory: () => createResultHandleStore(options),
      }),
    ];
  };

  /** Runs before the answer budget (`fitAnswer`), so the budget sees the folded answer. */
  @ToolHook.Will('fitAnswer')
  async foldAnswer(flowCtx: FlowCtxOf<'tools:call-tool'>): Promise<void> {
    const { tool, toolContext, output, uiResult } = flowCtx.state;
    if (!tool || !toolContext || !output || output.isError || uiResult || !flowCtx.isClientCall()) return;
    if (toolContext instanceof ResultQueryTool) return;
    const answer = answerDataOf(output);
    const bytes = jsonBytes(answer);
    if (answer === undefined || bytes <= this.options.thresholdBytes) return;
    const owner = resultOwnerOf(toolContext);
    if (owner.session === undefined && owner.caller === undefined) return;
    const context = { bytes, fullName: tool.fullName, request: flowCtx.request };
    if (!this.options.foldPolicy(flowCtx.toolName, answer, context)) return;

    const store = this.get(ResultHandleStoreToken);
    const handle = store.newHandle();
    const preview = previewOf(answer, this.options.preview);
    const folded = foldedAnswerOf(tool, { preview, shape: shapeOf(answer), handle });
    if (!folded) {
      this.warnUnfoldableOnce(tool, bytes);
      return;
    }
    if (!(await this.kept(store, handle, answer, owner, `tool "${tool.fullName}"`))) return;
    addFoldingStore(toolContext.scope, store);
    flowCtx.respond({
      ...folded,
      content: [...folded.content, { type: 'text', text: this.foldNote(bytes, handle) }],
      _meta: { ...output._meta, [RESULT_HANDLE_META_KEY]: { handle, bytes, ttlSeconds: this.options.ttlSeconds } },
    });
  }

  /** With `resources` on, folds a read of one text over the threshold, as `foldAnswer` folds a tool's answer. */
  @ResourceHook.Will('fitAnswer')
  async foldResource(flowCtx: FlowCtxOf<'resources:read-resource'>): Promise<void> {
    const policy = this.options.resources;
    const { resource, resourceContext, output, isUIResource } = flowCtx.state;
    if (!policy || !resource || !resourceContext || !output || isUIResource || !isClientRead(flowCtx.rawInput)) return;
    const [content, ...others] = output.contents;
    if (!content || others.length > 0 || !('text' in content) || typeof content.text !== 'string') return;
    if (content.mimeType?.startsWith('text/html')) return;
    const answer = resourceAnswerOf(content.text, content.mimeType);
    const bytes = jsonBytes(answer);
    if (bytes <= this.options.thresholdBytes) return;
    const owner = resultOwnerOf(resourceContext);
    if (owner.session === undefined && owner.caller === undefined) return;
    const context = { bytes, fullName: resource.fullName, request: flowCtx.request };
    if (policy !== true && !policy(content.uri, answer, context)) return;

    const store = this.get(ResultHandleStoreToken);
    const handle = store.newHandle();
    if (!(await this.kept(store, handle, answer, owner, `resource "${resource.fullName}"`))) return;
    addFoldingStore(resourceContext.scope, store);
    const folded: FoldedAnswer = { preview: previewOf(answer, this.options.preview), shape: shapeOf(answer), handle };
    flowCtx.respond({
      ...output,
      contents: [
        { ...content, mimeType: 'application/json', text: JSON.stringify(folded) },
        { uri: content.uri, mimeType: 'text/plain', text: this.foldNote(bytes, handle) },
      ],
      _meta: { ...output._meta, [RESULT_HANDLE_META_KEY]: { handle, bytes, ttlSeconds: this.options.ttlSeconds } },
    });
  }

  /** Whether the store kept `answer`; when it could not, the answer is sent whole and a warning names `entry`. */
  private async kept(
    store: ResultHandleStore,
    handle: string,
    answer: unknown,
    owner: ResultOwner,
    entry: string,
  ): Promise<boolean> {
    try {
      await store.save(handle, answer, owner);
      return true;
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      this.logger().warn(`Could not keep the answer of ${entry} for result_query, so it is sent whole: ${reason}`);
      return false;
    }
  }

  private foldNote(bytes: number, handle: string): string {
    const { ttlSeconds, slidingTtl } = this.options;
    return (
      `This answer is ${bytes} bytes, so it was folded: preview is its start and shape its structure. ` +
      `Read the rest with ${RESULT_QUERY_TOOL_NAME} and handle "${handle}" ` +
      `(a path, then offset and limit or a page, and fields) within ${ttlSeconds} seconds` +
      `${slidingTtl ? ' of its last read' : ''}.`
    );
  }

  private logger(): FrontMcpLogger {
    return this.get(FrontMcpLogger).child('ResultHandles');
  }

  private warnUnfoldableOnce(tool: FoldedTool, bytes: number): void {
    if (this.unfoldableTools.has(tool)) return;
    this.unfoldableTools.add(tool);
    this.logger().warn(
      `Tool "${tool.fullName}" answered ${bytes} bytes, over the ${this.options.thresholdBytes}-byte fold threshold, ` +
        'but its outputSchema does not admit the folded form { preview, shape, handle }, so its answers are sent ' +
        'whole. Make foldedAnswerSchema a member of a z.union() outputSchema to fold them.',
    );
  }
}

export { ResultHandlesPlugin };
