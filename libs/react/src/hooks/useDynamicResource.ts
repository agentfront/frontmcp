/**
 * useDynamicResource — registers an MCP resource on mount, unregisters on unmount.
 *
 * Uses useRef for the read function to avoid stale closures.
 * The resource appears in useListResources and can be read by agents.
 */

import { useContext, useEffect, useRef } from 'react';
import type { ReadResourceResult } from '@frontmcp/sdk';
import { FrontMcpContext } from '../provider/FrontMcpContext';

export interface UseDynamicResourceOptions {
  uri: string;
  name: string;
  description?: string;
  mimeType?: string;
  read: () => Promise<ReadResourceResult>;
  /** Set to false to conditionally disable the resource (default: true). */
  enabled?: boolean;
  /** Target a specific named server from the ServerRegistry. */
  server?: string;
}

export function useDynamicResource(options: UseDynamicResourceOptions): void {
  const { uri, name, description, mimeType, read, enabled = true } = options;
  const { dynamicRegistry } = useContext(FrontMcpContext);

  // Keep the latest read fn in a ref to avoid stale closures
  const readRef = useRef(read);
  readRef.current = read;

  useEffect(() => {
    if (!enabled) return;

    const stableRead = () => readRef.current();

    const unregister = dynamicRegistry.registerResource({
      uri,
      name,
      description,
      mimeType,
      read: stableRead,
    });

    return unregister;
  }, [dynamicRegistry, uri, name, description, mimeType, enabled]);
}
