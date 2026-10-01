/**
 * The part of the WebMCP API (`document.modelContext`) this plugin uses, per the W3C Web Machine
 * Learning CG draft of 2026-09-30 (https://webmachinelearning.github.io/webmcp/).
 *
 * Declared here rather than taken from a types package: the API is still in origin trial and
 * changes between Chrome releases, so the plugin pins the shape it was written against.
 */

/** Behavioral hints an agent may use to decide how carefully to call a tool. */
export interface ModelContextToolAnnotations {
  /** The tool only reads state. */
  readOnlyHint?: boolean;
  /** The tool's output may contain content the page does not vouch for. */
  untrustedContentHint?: boolean;
  /** The tool has consequences the user may want to confirm (purchases, deletions, messages). */
  consequentialHint?: boolean;
}

/** What `execute` receives besides its input. */
export interface ModelContextToolExecuteOptions {
  /** Aborted when the agent cancels the call. */
  signal: AbortSignal;
}

/** A tool as the page registers it. */
export interface ModelContextTool {
  /** 1-128 characters from `[A-Za-z0-9_.-]`, unique among the page's tools. */
  name: string;
  title?: string;
  /** Required and non-empty. */
  description: string;
  /** JSON Schema of the input object. */
  inputSchema?: Record<string, unknown>;
  /** Runs the tool. Its result is JSON-serialized for the agent; a rejection is a failed call. */
  execute(input: Record<string, unknown>, options: ModelContextToolExecuteOptions): Promise<unknown>;
  annotations?: ModelContextToolAnnotations;
}

/** Options of `registerTool`. Aborting `signal` unregisters the tool. */
export interface ModelContextRegisterToolOptions {
  /** Other origins (e.g. the parent of an iframe) the tool is offered to. */
  exposedTo?: string[];
  signal?: AbortSignal;
}

/** A tool as `getTools()` describes it. */
export interface ModelContextRegisteredTool {
  name: string;
  title?: string;
  description: string;
  inputSchema?: Record<string, unknown>;
  origin?: string;
  annotations?: ModelContextToolAnnotations;
}

/** `document.modelContext`. */
export interface ModelContext {
  /**
   * Register a tool. Rejects with `InvalidStateError` for a duplicate or invalid name, and with
   * `NotAllowedError` when the `tools` permissions policy denies it.
   */
  registerTool(tool: ModelContextTool, options?: ModelContextRegisterToolOptions): Promise<void>;
  /** The tools registered in this page (and, with `fromOrigins`, those other origins expose to it). */
  getTools?(options?: { fromOrigins?: string[] }): Promise<ModelContextRegisteredTool[]>;
  /** Run a registered tool, as an in-page agent would. Resolves to the JSON-serialized result. */
  executeTool?(
    tool: ModelContextRegisteredTool,
    input?: Record<string, unknown>,
    options?: { signal?: AbortSignal },
  ): Promise<string | null>;
}
