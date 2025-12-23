// file: libs/browser/src/polyfill/model-context-session.ts
/**
 * ModelContextSession implementation for the navigator.modelContext polyfill.
 */

import type { BrowserMcpServer } from '../server';
import type {
  ModelContextSession,
  SessionState,
  SessionEventType,
  ToolDefinition,
  ResourceDefinition,
  PromptDefinition,
  ClientInfo,
  JSONSchema,
} from './types';

type EventHandler = (...args: unknown[]) => void;

/**
 * Convert Zod schema to JSON Schema if needed
 */
function toJsonSchema(schema: JSONSchema | { _def?: unknown }): JSONSchema {
  // Check if it's a Zod schema by looking for _def property
  if ('_def' in schema && schema._def) {
    // For now, we'll use a basic conversion
    // In production, you'd use zod-to-json-schema
    const zodSchema = schema as { _def: { typeName?: string; shape?: () => Record<string, unknown> } };
    const typeName = zodSchema._def.typeName;

    if (typeName === 'ZodObject' && zodSchema._def.shape) {
      const shape = zodSchema._def.shape();
      const properties: Record<string, JSONSchema> = {};

      for (const [key, value] of Object.entries(shape)) {
        properties[key] = toJsonSchema(value as JSONSchema | { _def?: unknown });
      }

      return {
        type: 'object',
        properties,
      };
    }

    if (typeName === 'ZodString') return { type: 'string' };
    if (typeName === 'ZodNumber') return { type: 'number' };
    if (typeName === 'ZodBoolean') return { type: 'boolean' };
    if (typeName === 'ZodArray') return { type: 'array' };

    return { type: 'object' };
  }

  return schema as JSONSchema;
}

/**
 * ModelContextSession implementation that wraps BrowserMcpServer.
 */
export class ModelContextSessionImpl implements ModelContextSession {
  private _state: SessionState = 'connecting';
  private _clientInfo: ClientInfo | null = null;
  private _eventHandlers: Map<SessionEventType, Set<EventHandler>> = new Map();
  private _registeredTools: Set<string> = new Set();
  private _registeredResources: Set<string> = new Set();
  private _registeredPrompts: Set<string> = new Set();

  constructor(private readonly server: BrowserMcpServer) {}

  get clientInfo(): ClientInfo | null {
    return this._clientInfo;
  }

  get state(): SessionState {
    return this._state;
  }

  /**
   * Initialize the session by starting the server
   */
  async initialize(): Promise<void> {
    try {
      await this.server.start();
      this._state = 'connected';
      this._clientInfo = {
        name: 'ModelContext Client',
        version: '1.0.0',
      };
    } catch (error) {
      this._state = 'disconnected';
      this.emit('error', error instanceof Error ? error : new Error(String(error)));
      throw error;
    }
  }

  /**
   * Register a tool with the MCP server
   */
  registerTool<In = unknown, Out = unknown>(name: string, definition: ToolDefinition<In, Out>): () => void {
    if (this._registeredTools.has(name)) {
      throw new Error(`Tool "${name}" is already registered`);
    }

    const jsonSchema = toJsonSchema(definition.inputSchema);

    this.server.addTool({
      name,
      description: definition.description,
      inputSchema: {
        type: 'object' as const,
        properties: jsonSchema.properties,
        required: jsonSchema.required,
      },
      handler: async (args) => {
        this.emit('toolCall', name, args);
        return definition.execute(args as In);
      },
    });

    this._registeredTools.add(name);

    return () => this.unregisterTool(name);
  }

  /**
   * Register a resource with the MCP server
   */
  registerResource<Params extends Record<string, string> = Record<string, string>>(
    uri: string,
    definition: ResourceDefinition<Params>,
  ): () => void {
    if (this._registeredResources.has(uri)) {
      throw new Error(`Resource "${uri}" is already registered`);
    }

    this.server.addResource({
      uri,
      name: definition.name,
      description: definition.description,
      mimeType: definition.mimeType,
      handler: async () => {
        // Extract params from URI if it's a template
        const params = {} as Params;
        return definition.read(params);
      },
    });

    this._registeredResources.add(uri);

    return () => this.unregisterResource(uri);
  }

  /**
   * Register a prompt with the MCP server
   */
  registerPrompt(name: string, definition: PromptDefinition): () => void {
    if (this._registeredPrompts.has(name)) {
      throw new Error(`Prompt "${name}" is already registered`);
    }

    this.server.addPrompt({
      name,
      description: definition.description,
      arguments: definition.arguments,
      handler: async (args) => {
        const result = await definition.execute(args as Record<string, string>);
        // Convert GetPromptResult to BrowserPromptDefinition handler format
        return {
          messages: result.messages.map((msg) => ({
            role: msg.role,
            content: Array.isArray(msg.content)
              ? msg.content.filter((c): c is { type: 'text'; text: string } => c.type === 'text')
              : [{ type: 'text' as const, text: String(msg.content) }],
          })),
        };
      },
    });

    this._registeredPrompts.add(name);

    return () => this.unregisterPrompt(name);
  }

  /**
   * Unregister a tool
   */
  unregisterTool(name: string): void {
    if (!this._registeredTools.has(name)) {
      return;
    }

    this.server.removeTool(name);
    this._registeredTools.delete(name);
  }

  /**
   * Unregister a resource
   */
  unregisterResource(uri: string): void {
    if (!this._registeredResources.has(uri)) {
      return;
    }

    this.server.removeResource(uri);
    this._registeredResources.delete(uri);
  }

  /**
   * Unregister a prompt
   */
  unregisterPrompt(name: string): void {
    if (!this._registeredPrompts.has(name)) {
      return;
    }

    this.server.removePrompt(name);
    this._registeredPrompts.delete(name);
  }

  /**
   * Send a notification to connected clients
   */
  notify(method: string, params?: unknown): void {
    this.server.sendNotification(method, params);
  }

  /**
   * Close the session
   */
  async close(): Promise<void> {
    if (this._state === 'disconnected') {
      return;
    }

    // Unregister all tools, resources, and prompts
    for (const name of this._registeredTools) {
      this.server.removeTool(name);
    }
    for (const uri of this._registeredResources) {
      this.server.removeResource(uri);
    }
    for (const name of this._registeredPrompts) {
      this.server.removePrompt(name);
    }

    this._registeredTools.clear();
    this._registeredResources.clear();
    this._registeredPrompts.clear();

    await this.server.stop();
    this._state = 'disconnected';
    this.emit('disconnect');
  }

  /**
   * Register an event handler
   */
  on(event: SessionEventType, handler: EventHandler): () => void {
    if (!this._eventHandlers.has(event)) {
      this._eventHandlers.set(event, new Set());
    }
    this._eventHandlers.get(event)!.add(handler);

    return () => {
      this._eventHandlers.get(event)?.delete(handler);
    };
  }

  /**
   * Emit an event to all registered handlers
   */
  private emit(event: SessionEventType, ...args: unknown[]): void {
    const handlers = this._eventHandlers.get(event);
    if (handlers) {
      for (const handler of handlers) {
        try {
          handler(...args);
        } catch (error) {
          console.error(`Error in ${event} handler:`, error);
        }
      }
    }
  }
}
