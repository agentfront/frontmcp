/**
 * useStoreResource — generic hook that exposes any state store as MCP
 * resources (with optional deep selectors) and actions as tools.
 *
 * This is the core hook; useReduxResource and useValtioResource are
 * thin wrappers around it.
 */

import { useContext, useEffect, useRef, useCallback } from 'react';
import type { CallToolResult, ReadResourceResult } from '@frontmcp/sdk';
import { FrontMcpContext } from '../provider/FrontMcpContext';
import type { StoreResourceOptions } from './state.types';

const VALID_NAME_RE = /^[a-zA-Z0-9_-]+$/;

export function useStoreResource(options: StoreResourceOptions): void {
  const { name, getState, subscribe, selectors, actions } = options;
  const { dynamicRegistry } = useContext(FrontMcpContext);

  if (!name || !VALID_NAME_RE.test(name)) {
    throw new Error(`useStoreResource: invalid store name "${name}". Names must match ${VALID_NAME_RE}.`);
  }

  // Keep latest getState in ref
  const getStateRef = useRef(getState);
  getStateRef.current = getState;

  // Register main state resource
  const readState = useCallback(
    async (): Promise<ReadResourceResult> => ({
      contents: [
        {
          uri: `state://${name}`,
          mimeType: 'application/json',
          text: JSON.stringify(getStateRef.current()),
        },
      ],
    }),
    [name],
  );

  useEffect(() => {
    const unregister = dynamicRegistry.registerResource({
      uri: `state://${name}`,
      name: `${name}-state`,
      description: `Full state of ${name} store`,
      mimeType: 'application/json',
      read: readState,
    });

    // Subscribe to store changes and notify the dynamic registry
    const unsubscribe = subscribe(() => {
      // The resource's read function always reads fresh state via ref,
      // so we just need to trigger a version bump so consumers re-read.
      dynamicRegistry.updateResourceRead(`state://${name}`, readState);
    });

    return () => {
      unregister();
      unsubscribe();
    };
  }, [dynamicRegistry, name, subscribe, readState]);

  // Register selector sub-resources and subscribe to store changes
  useEffect(() => {
    if (!selectors) return;

    const cleanups: (() => void)[] = [];
    const selectorUris: { uri: string; readSelector: () => Promise<ReadResourceResult> }[] = [];

    for (const [key, selector] of Object.entries(selectors)) {
      const uri = `state://${name}/${key}`;
      const selectorRef = { current: selector };

      const readSelector = async (): Promise<ReadResourceResult> => ({
        contents: [
          {
            uri,
            mimeType: 'application/json',
            text: JSON.stringify(selectorRef.current(getStateRef.current())),
          },
        ],
      });

      selectorUris.push({ uri, readSelector });

      cleanups.push(
        dynamicRegistry.registerResource({
          uri,
          name: `${name}-${key}`,
          description: `Selector "${key}" from ${name} store`,
          mimeType: 'application/json',
          read: readSelector,
        }),
      );
    }

    // Subscribe to store changes so selectors get updated reads
    const unsubscribe = subscribe(() => {
      for (const { uri, readSelector } of selectorUris) {
        dynamicRegistry.updateResourceRead(uri, readSelector);
      }
    });
    cleanups.push(unsubscribe);

    return () => {
      cleanups.forEach((fn) => {
        fn();
      });
    };
  }, [dynamicRegistry, name, selectors, subscribe]);

  // Register action tools
  useEffect(() => {
    if (!actions) return;

    const cleanups: (() => void)[] = [];
    for (const [key, action] of Object.entries(actions)) {
      const toolName = `${name}_${key}`;

      const execute = async (args: Record<string, unknown>): Promise<CallToolResult> => {
        const argsArray = args['args'];
        const result = await (Array.isArray(argsArray) ? action(...argsArray) : action(args));
        return {
          content: [{ type: 'text', text: JSON.stringify({ success: true, result }) }],
        };
      };

      cleanups.push(
        dynamicRegistry.registerTool({
          name: toolName,
          description: `Action "${key}" on ${name} store`,
          inputSchema: {
            type: 'object',
            properties: {
              args: { type: 'array', description: 'Arguments to pass to the action' },
            },
          },
          execute,
        }),
      );
    }

    return () => {
      cleanups.forEach((fn) => {
        fn();
      });
    };
  }, [dynamicRegistry, name, actions]);
}
