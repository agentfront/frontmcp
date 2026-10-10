import { z } from '@frontmcp/lazy-zod';
import type { DirectAuthContext, ListToolsResult } from '@frontmcp/sdk';

import type { ModelContext } from './webmcp.types';

/** A tool as the server lists it (`tools/list`), before it is exposed through WebMCP. */
export type WebMcpListedTool = ListToolsResult['tools'][number];

/** Who the server sees calling: an auth context, or a function that returns the current one. */
export type WebMcpAuthContext = DirectAuthContext | (() => DirectAuthContext | Promise<DirectAuthContext>);

function isModelContext(value: unknown): value is ModelContext {
  return typeof value === 'object' && value !== null && typeof (value as ModelContext).registerTool === 'function';
}

export const webMcpPluginOptionsSchema = z.object({
  /**
   * Prepended to every exposed tool name, e.g. `'shop.'`, so the page's tools stay apart from
   * other tools on it. Names are then made WebMCP-valid (see `toWebMcpToolName`).
   */
  prefix: z.string().default(''),
  /** Decides which listed tools are exposed. Runs after `availableWhen` and authorities. */
  include: z.custom<(tool: WebMcpListedTool) => boolean>((value) => typeof value === 'function').optional(),
  /** Other origins (e.g. an iframe's parent) the tools are offered to, through WebMCP's `exposedTo`. */
  exposedTo: z.array(z.string().min(1)).optional(),
  /** Auth context the tools are listed and called with. Defaults to an anonymous `webmcp` caller. */
  authContext: z
    .custom<WebMcpAuthContext>((value) => typeof value === 'function' || (typeof value === 'object' && value !== null))
    .optional(),
  /** The `ModelContext` to register with. Defaults to `document.modelContext`; pass a polyfill or test double. */
  modelContext: z
    .custom<ModelContext>(isModelContext, { message: 'modelContext must have a registerTool function' })
    .optional(),
  /**
   * What a call resolves to. The agent reads the whole value as text, so by default it gets each result once:
   * - `'structured'`: the tool's `structuredContent` alone when its content only repeats it (one text block with
   *   the same JSON, as the server writes it); otherwise `{ content }`, plus `structuredContent` when there is one.
   * - `'content'`: `{ content }`.
   * - `'both'`: `{ content, structuredContent }`, as an MCP client gets them.
   */
  result: z.enum(['structured', 'content', 'both']).default('structured'),
});

/** What an agent's call resolves to (see the `result` option). */
export type WebMcpResultMode = z.output<typeof webMcpPluginOptionsSchema>['result'];

/** Options of `WebMcpPlugin.init()`, as the plugin holds them (defaults applied). */
export type WebMcpPluginOptions = z.output<typeof webMcpPluginOptionsSchema>;

/** Options of `WebMcpPlugin.init()`, as passed. */
export type WebMcpPluginOptionsInput = z.input<typeof webMcpPluginOptionsSchema>;
