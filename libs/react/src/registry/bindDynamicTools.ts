/**
 * bindDynamicTools — mirrors a DynamicRegistry's tools into a DirectMcpServer as real server tools.
 *
 * Components register tools in the DynamicRegistry (ref-counted, latest `execute` kept in the
 * registry). This binder registers each one with `server.registerTool()`, so the tool is listed by
 * the server, runs through its `tools:call-tool` flow (hooks, authorities, quota, `availableWhen`),
 * reaches every client (including WebMCP) and is announced with `notifications/tools/list_changed`.
 *
 * Changes are reconciled on a microtask, so the register → unregister → register churn of React
 * StrictMode settles into a single change on the server.
 */

import type { CallToolResult, DirectMcpServer, RuntimeToolDefinition } from '@frontmcp/sdk';

import type { DynamicToolDef } from '../types';
import type { DynamicRegistry } from './DynamicRegistry';

export interface BindDynamicToolsOptions {
  /** Called when the server refuses a tool (a name conflict, a name over 64 characters, ...). */
  onError?: (error: Error, toolName: string) => void;
}

interface MirroredTool {
  fingerprint: string;
  unregister: () => void;
}

/** What identifies a registration on the server; a change re-registers the tool. */
function fingerprintOf(def: DynamicToolDef): string {
  try {
    return JSON.stringify([def.description, def.inputSchema, def.annotations ?? null, def.availableWhen ?? null]);
  } catch {
    // Not serializable: treat every reconcile as unchanged rather than re-registering forever
    return `unserializable:${def.name}`;
  }
}

function unavailable(name: string): CallToolResult {
  return { isError: true, content: [{ type: 'text', text: `Tool "${name}" is no longer available` }] };
}

/**
 * Keep `server`'s runtime tools in step with `registry`'s tools.
 *
 * @returns A function that stops mirroring and unregisters every mirrored tool
 */
export function bindDynamicTools(
  registry: DynamicRegistry,
  server: DirectMcpServer,
  options: BindDynamicToolsOptions = {},
): () => void {
  const report = (error: unknown, toolName: string) => {
    const err = error instanceof Error ? error : new Error(String(error));
    if (options.onError) options.onError(err, toolName);
    else console.warn(`[frontmcp] dynamic tool "${toolName}" was not registered: ${err.message}`);
  };

  if (typeof server.registerTool !== 'function') {
    // A server that predates runtime tools (or a test double): nothing to mirror into
    return () => undefined;
  }

  const mirrored = new Map<string, MirroredTool>();
  /**
   * The definition the server refused, by name, so the same registration is not retried on every
   * reconcile. A new registration of the name (a remount, a second registrant) puts a new definition
   * in the registry, which is tried again.
   */
  const refused = new Map<string, DynamicToolDef>();
  let disposed = false;
  let scheduled = false;
  let reconciling: Promise<void> = Promise.resolve();

  const register = async (def: DynamicToolDef, fingerprint: string) => {
    const { name } = def;
    const definition: RuntimeToolDefinition = {
      name,
      description: def.description,
      inputSchema: def.inputSchema,
      annotations: def.annotations,
      availableWhen: def.availableWhen,
      // The registry holds the latest execute (components swap closures without re-registering)
      execute: (args) => {
        const current = registry.findTool(name);
        return current ? current.execute(args) : unavailable(name);
      },
    };
    try {
      const unregister = await server.registerTool(definition);
      if (disposed) {
        unregister();
        return;
      }
      mirrored.set(name, { fingerprint, unregister });
      refused.delete(name);
    } catch (error) {
      refused.set(name, def);
      report(error, name);
    }
  };

  const reconcile = async () => {
    if (disposed) return;
    const wanted = new Map(registry.getTools().map((def) => [def.name, def]));

    for (const [name, entry] of mirrored) {
      const def = wanted.get(name);
      if (!def || fingerprintOf(def) !== entry.fingerprint) {
        entry.unregister();
        mirrored.delete(name);
      }
    }
    for (const name of refused.keys()) {
      if (!wanted.has(name)) refused.delete(name);
    }

    const pending: Promise<void>[] = [];
    for (const [name, def] of wanted) {
      if (mirrored.has(name)) continue;
      if (refused.get(name) === def) continue;
      pending.push(register(def, fingerprintOf(def)));
    }
    await Promise.all(pending);
  };

  // Runs on every registry notification until unbound (reconcile itself checks `disposed`)
  const schedule = () => {
    // A refused tool that left the registry is tried again when it comes back, even when it comes
    // back before the queued reconcile runs (and with the very same definition object)
    for (const name of refused.keys()) {
      if (!registry.hasTool(name)) refused.delete(name);
    }
    if (scheduled) return;
    scheduled = true;
    queueMicrotask(() => {
      scheduled = false;
      reconciling = reconciling.then(reconcile, reconcile);
    });
  };

  const unsubscribe = registry.subscribe(schedule);
  schedule();

  return () => {
    if (disposed) return;
    disposed = true;
    unsubscribe();
    for (const entry of mirrored.values()) entry.unregister();
    mirrored.clear();
    refused.clear();
  };
}
