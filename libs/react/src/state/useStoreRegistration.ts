/**
 * useStoreRegistration — internal hook that takes StoreAdapter[] and a
 * DynamicRegistry, then registers all resources/tools.
 *
 * Reuses the same registration logic as useStoreResource:
 * - For each adapter: register main resource state://{name}, selector
 *   sub-resources, and action tools
 * - Subscribe to store changes, call updateResourceRead on change
 * - Cleanup on unmount
 */

import { useEffect, useRef, useCallback } from 'react';
import type { CallToolResult, ReadResourceResult } from '@frontmcp/sdk';
import type { DynamicRegistry } from '../registry/DynamicRegistry';
import type { StoreAdapter } from '../types';

export function useStoreRegistration(stores: StoreAdapter[], dynamicRegistry: DynamicRegistry): void {
  const storesRef = useRef(stores);
  storesRef.current = stores;

  useEffect(() => {
    if (stores.length === 0) return;

    const cleanups: (() => void)[] = [];

    for (const adapter of stores) {
      const { name, getState, subscribe, selectors, actions } = adapter;

      // Keep a ref-like closure for getState
      const getStateWrapper = () => adapter.getState();

      // Register main state resource
      const readState = async (): Promise<ReadResourceResult> => ({
        contents: [
          {
            uri: `state://${name}`,
            mimeType: 'application/json',
            text: JSON.stringify(getStateWrapper()),
          },
        ],
      });

      cleanups.push(
        dynamicRegistry.registerResource({
          uri: `state://${name}`,
          name: `${name}-state`,
          description: `Full state of ${name} store`,
          mimeType: 'application/json',
          read: readState,
        }),
      );

      // Subscribe to store changes
      const unsubscribe = subscribe(() => {
        dynamicRegistry.updateResourceRead(`state://${name}`, readState);
      });
      cleanups.push(unsubscribe);

      // Register selector sub-resources
      if (selectors) {
        for (const [key, selector] of Object.entries(selectors)) {
          const uri = `state://${name}/${key}`;

          const readSelector = async (): Promise<ReadResourceResult> => ({
            contents: [
              {
                uri,
                mimeType: 'application/json',
                text: JSON.stringify(selector(getStateWrapper())),
              },
            ],
          });

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
      }

      // Register action tools
      if (actions) {
        for (const [key, action] of Object.entries(actions)) {
          const toolName = `${name}_${key}`;

          const execute = async (args: Record<string, unknown>): Promise<CallToolResult> => {
            const argsArray = args['args'];
            const result = Array.isArray(argsArray) ? action(...argsArray) : action(args);
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
      }
    }

    return () => {
      cleanups.forEach((fn) => fn());
    };
  }, [stores, dynamicRegistry]);
}
