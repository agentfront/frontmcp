/**
 * useStoreResource — generic hook that exposes any state store as MCP
 * resources (with optional deep selectors) and actions as tools.
 *
 * This is the core hook; useReduxResource and useValtioResource are
 * thin wrappers around it.
 *
 * Options may be written inline: `getState`, `selectors` and `actions` are read
 * through refs, so a new function or object on every render does not register the
 * resources and tools again. They are registered again only when the store `name`,
 * the target server, or the set of selector / action names changes. A new
 * `subscribe` function re-subscribes to the store, which touches no registry.
 */

import { useContext, useEffect, useRef } from 'react';

import type { CallToolResult, ReadResourceResult } from '@frontmcp/sdk';

import { FrontMcpContext } from '../provider/FrontMcpContext';
import { useIsomorphicLayoutEffect } from '../utils/useIsomorphicLayoutEffect';
import type { StoreResourceOptions } from './state.types';

const VALID_NAME_RE = /^[a-zA-Z0-9_-]+$/;

/** The sorted, JSON-encoded names of a selector / action map: changes only when a name is added or removed. */
function keysOf(map: Record<string, unknown> | undefined, kind: 'selector' | 'action'): string {
  if (!map) return '[]';
  const keys = Object.keys(map);
  if (kind === 'selector') {
    for (const key of keys) {
      if (!key || !VALID_NAME_RE.test(key)) {
        throw new Error(`useStoreResource: invalid selector key "${key}". Keys must match ${VALID_NAME_RE}.`);
      }
    }
  }
  return JSON.stringify(keys.sort());
}

function parseKeys(keys: string): string[] {
  return JSON.parse(keys) as string[];
}

function jsonResource(uri: string, value: unknown): ReadResourceResult {
  return { contents: [{ uri, mimeType: 'application/json', text: JSON.stringify(value ?? null) }] };
}

export function useStoreResource(options: StoreResourceOptions): void {
  const { name, subscribe, getState, selectors, actions } = options;
  const { getDynamicRegistry } = useContext(FrontMcpContext);
  const dynamicRegistry = getDynamicRegistry(options.server);

  if (!name || !VALID_NAME_RE.test(name)) {
    throw new Error(`useStoreResource: invalid store name "${name}". Names must match ${VALID_NAME_RE}.`);
  }

  const selectorKeys = keysOf(selectors, 'selector');
  const actionKeys = keysOf(actions, 'action');

  const getStateRef = useRef(getState);
  const selectorsRef = useRef(selectors);
  const actionsRef = useRef(actions);

  // Set at commit, before passive effects and never during render: a render React discards must not reach a registered read or action
  useIsomorphicLayoutEffect(() => {
    getStateRef.current = getState;
    selectorsRef.current = selectors;
    actionsRef.current = actions;
  }, [getState, selectors, actions]);

  const stateUri = `state://${name}`;

  // Main state resource
  useEffect(
    () =>
      dynamicRegistry.registerResource({
        uri: stateUri,
        name: `${name}-state`,
        description: `Full state of ${name} store`,
        mimeType: 'application/json',
        read: async () => jsonResource(stateUri, getStateRef.current()),
      }),
    [dynamicRegistry, name, stateUri],
  );

  // Selector sub-resources
  useEffect(() => {
    const cleanups = parseKeys(selectorKeys).map((key) => {
      const uri = `${stateUri}/${key}`;
      return dynamicRegistry.registerResource({
        uri,
        name: `${name}-${key}`,
        description: `Selector "${key}" from ${name} store`,
        mimeType: 'application/json',
        read: async () => {
          const selector = selectorsRef.current?.[key];
          return jsonResource(uri, selector ? selector(getStateRef.current()) : undefined);
        },
      });
    });
    return () => {
      cleanups.forEach((fn) => {
        fn();
      });
    };
  }, [dynamicRegistry, name, stateUri, selectorKeys]);

  // Store changes: tell readers of the state and selector resources to read again
  useEffect(() => {
    const uris = [stateUri, ...parseKeys(selectorKeys).map((key) => `${stateUri}/${key}`)];
    return subscribe(() => {
      for (const uri of uris) {
        const resource = dynamicRegistry.findResource(uri);
        if (resource) dynamicRegistry.updateResourceRead(uri, resource.read);
      }
    });
  }, [dynamicRegistry, stateUri, selectorKeys, subscribe]);

  // Action tools
  useEffect(() => {
    const cleanups = parseKeys(actionKeys).map((key) => {
      const execute = async (args: Record<string, unknown>): Promise<CallToolResult> => {
        const action = actionsRef.current?.[key];
        if (!action) {
          return { isError: true, content: [{ type: 'text', text: `Action "${key}" is no longer available` }] };
        }
        const argsArray = args['args'];
        const result = await (Array.isArray(argsArray) ? action(...argsArray) : action(args));
        return {
          content: [{ type: 'text', text: JSON.stringify({ success: true, result }) }],
        };
      };

      return dynamicRegistry.registerTool({
        name: `${name}_${key}`,
        description: `Action "${key}" on ${name} store`,
        inputSchema: {
          type: 'object',
          properties: {
            args: { type: 'array', description: 'Arguments to pass to the action' },
          },
        },
        execute,
      });
    });
    return () => {
      cleanups.forEach((fn) => {
        fn();
      });
    };
  }, [dynamicRegistry, name, actionKeys]);
}
