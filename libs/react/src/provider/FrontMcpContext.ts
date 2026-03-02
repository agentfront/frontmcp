/**
 * React context for FrontMCP.
 */

import { createContext } from 'react';
import type { FrontMcpContextValue } from '../types';
import { ComponentRegistry } from '../components/ComponentRegistry';

// Default context value — server is typed as non-null in the interface
// because FrontMcpProvider always supplies it. The default is only used
// when consuming context outside a provider (which is a usage error).
export const FrontMcpContext = createContext<FrontMcpContextValue>({
  status: 'idle',
  error: null,
  server: null as never,
  client: null,
  tools: [],
  resources: [],
  resourceTemplates: [],
  prompts: [],
  registry: new ComponentRegistry(),
  connect: async () => {},
});
