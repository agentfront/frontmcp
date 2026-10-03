import type { ModelContext, ModelContextRegisterToolOptions, ModelContextTool } from '../../webmcp.types';

interface Registered {
  tool: ModelContextTool;
  options?: ModelContextRegisterToolOptions;
}

/**
 * A `document.modelContext` that behaves like the spec's: a duplicate name is refused, aborting the
 * registration signal unregisters the tool, and an in-page agent can run a registered tool by name.
 */
export class FakeModelContext implements ModelContext {
  readonly registered = new Map<string, Registered>();
  /** Every name `registerTool` was called with, in order. */
  readonly registerCalls: string[] = [];
  /** Every name whose registration was aborted, in order. */
  readonly unregistered: string[] = [];
  /** Names `registerTool` refuses, as another script on the page holding them would. */
  readonly refuse = new Set<string>();

  async registerTool(tool: ModelContextTool, options?: ModelContextRegisterToolOptions): Promise<void> {
    this.registerCalls.push(tool.name);
    if (this.refuse.has(tool.name) || this.registered.has(tool.name)) {
      throw Object.assign(new Error(`Tool "${tool.name}" is already registered`), { name: 'InvalidStateError' });
    }
    if (options?.signal?.aborted) return;
    this.registered.set(tool.name, { tool, options });
    options?.signal?.addEventListener(
      'abort',
      () => {
        if (this.registered.get(tool.name)?.tool !== tool) return;
        this.registered.delete(tool.name);
        this.unregistered.push(tool.name);
      },
      { once: true },
    );
  }

  names(): string[] {
    return [...this.registered.keys()].sort();
  }

  tool(name: string): ModelContextTool {
    const entry = this.registered.get(name);
    if (!entry) throw new Error(`No WebMCP tool "${name}" (registered: ${this.names().join(', ')})`);
    return entry.tool;
  }

  options(name: string): ModelContextRegisterToolOptions | undefined {
    return this.registered.get(name)?.options;
  }

  /** Run a registered tool the way an agent does. */
  execute(name: string, input: Record<string, unknown> = {}, signal = new AbortController().signal): Promise<unknown> {
    return this.tool(name).execute(input, { signal });
  }
}

/** Let pending registry changes and syncs run. */
export async function settle(): Promise<void> {
  for (let i = 0; i < 10; i++) await new Promise((resolve) => setTimeout(resolve, 0));
}

/** Wait until `condition` holds (or fail after `timeoutMs`). */
export async function waitFor(condition: () => boolean, timeoutMs = 2000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error('Timed out waiting for condition');
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}
