/**
 * ServerRegistry — shared singleton that maps server names to DirectMcpServer instances.
 *
 * Enables multiple MCP servers to coexist in a single React app without
 * requiring multiple providers or React Router trees. Hooks can target
 * a specific server by name via `{ server: 'name' }` option.
 *
 * Integrates with React via useSyncExternalStore for tear-free reads.
 */

import type { DirectMcpServer, DirectClient } from '@frontmcp/sdk';
import type { FrontMcpStatus, ToolInfo, ResourceInfo, ResourceTemplateInfo, PromptInfo } from '../types';

type Listener = () => void;

export interface ServerEntry {
  server: DirectMcpServer;
  client: DirectClient | null;
  status: FrontMcpStatus;
  error: Error | null;
  tools: ToolInfo[];
  resources: ResourceInfo[];
  resourceTemplates: ResourceTemplateInfo[];
  prompts: PromptInfo[];
}

export class ServerRegistry {
  private entries = new Map<string, ServerEntry>();
  private listeners = new Set<Listener>();
  private version = 0;

  register(name: string, server: DirectMcpServer): void {
    this.entries.set(name, {
      server,
      client: null,
      status: 'idle',
      error: null,
      tools: [],
      resources: [],
      resourceTemplates: [],
      prompts: [],
    });
    this.notify();
  }

  unregister(name: string): void {
    this.entries.delete(name);
    this.notify();
  }

  get(name: string): ServerEntry | undefined {
    return this.entries.get(name);
  }

  has(name: string): boolean {
    return this.entries.has(name);
  }

  list(): string[] {
    return [...this.entries.keys()];
  }

  async connect(name: string): Promise<DirectClient> {
    const entry = this.entries.get(name);
    if (!entry) throw new Error(`Server "${name}" not registered`);
    if (entry.client) return entry.client;

    this.entries.set(name, { ...entry, status: 'connecting', error: null });
    this.notify();

    try {
      const client = await entry.server.connect();

      const [toolsResult, resourcesResult, templatesResult, promptsResult] = await Promise.all([
        client.listTools(),
        client.listResources(),
        client.listResourceTemplates(),
        client.listPrompts(),
      ]);

      const connected: ServerEntry = {
        ...entry,
        client,
        tools: toolsResult as ToolInfo[],
        resources: (resourcesResult as { resources?: ResourceInfo[] }).resources ?? [],
        resourceTemplates: (templatesResult as { resourceTemplates?: ResourceTemplateInfo[] }).resourceTemplates ?? [],
        prompts: (promptsResult as { prompts?: PromptInfo[] }).prompts ?? [],
        status: 'connected',
        error: null,
      };
      this.entries.set(name, connected);
      this.notify();
      return client;
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      this.entries.set(name, { ...entry, error, status: 'error' });
      this.notify();
      throw error;
    }
  }

  async connectAll(): Promise<void> {
    await Promise.all(this.list().map((name) => this.connect(name)));
  }

  update(name: string, partial: Partial<ServerEntry>): void {
    const entry = this.entries.get(name);
    if (entry) {
      this.entries.set(name, { ...entry, ...partial });
      this.notify();
    }
  }

  clear(): void {
    this.entries.clear();
    this.notify();
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  getVersion(): number {
    return this.version;
  }

  private notify(): void {
    this.version++;
    this.listeners.forEach((l) => l());
  }
}

/** Module-scoped singleton — shared across all components. */
export const serverRegistry = new ServerRegistry();
