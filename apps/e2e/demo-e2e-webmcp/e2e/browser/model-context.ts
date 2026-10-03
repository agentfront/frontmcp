/**
 * A `document.modelContext` that follows the WebMCP draft (2026-09-30), installed into the page with
 * `page.addInitScript(installModelContext)` before the app loads. The browser Playwright runs has no
 * WebMCP (it is behind a flag / origin trial), so the specs supply it, the way a polyfill would.
 *
 * Self-contained on purpose: Playwright serializes this function into the page.
 */
export function installModelContext(): void {
  type Tool = {
    name: string;
    title?: string;
    description: string;
    inputSchema?: object;
    annotations?: Record<string, boolean>;
    execute: (input: object, options: { signal: AbortSignal }) => Promise<unknown>;
  };

  const NAME = /^[A-Za-z0-9_.-]{1,128}$/;
  const tools = new Map<string, Tool>();
  const events = new EventTarget();
  const changed = () => events.dispatchEvent(new Event('toolchange'));

  const modelContext = Object.assign(events, {
    async registerTool(tool: Tool, options: { signal?: AbortSignal; exposedTo?: string[] } = {}): Promise<void> {
      if (!NAME.test(tool?.name ?? ''))
        throw new DOMException(`Invalid tool name "${tool?.name}"`, 'InvalidStateError');
      if (!tool.description) throw new DOMException('A tool needs a description', 'InvalidStateError');
      if (tools.has(tool.name)) throw new DOMException(`Duplicate tool name "${tool.name}"`, 'InvalidStateError');
      JSON.stringify(tool.inputSchema ?? {});
      if (options.signal?.aborted) return;
      tools.set(tool.name, tool);
      changed();
      options.signal?.addEventListener(
        'abort',
        () => {
          if (tools.get(tool.name) !== tool) return;
          tools.delete(tool.name);
          changed();
        },
        { once: true },
      );
    },

    async getTools(): Promise<Array<Omit<Tool, 'execute'> & { origin: string }>> {
      return [...tools.values()].map(({ name, title, description, inputSchema, annotations }) => ({
        name,
        title,
        description,
        inputSchema,
        annotations,
        origin: location.origin,
      }));
    },

    async executeTool(registered: { name: string }, input: object = {}, options: { signal?: AbortSignal } = {}) {
      const tool = tools.get(registered.name);
      if (!tool) throw new DOMException(`No tool "${registered.name}"`, 'NotFoundError');
      const result = await tool.execute(input, { signal: options.signal ?? new AbortController().signal });
      return JSON.stringify(result);
    },
  });

  Object.defineProperty(Document.prototype, 'modelContext', {
    configurable: true,
    get: () => modelContext,
  });
}
