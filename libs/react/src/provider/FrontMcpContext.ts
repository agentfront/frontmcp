/**
 * React context for FrontMCP.
 */

import { createContext } from 'react';
import type { FrontMcpContextValue } from '../types';
import { ComponentRegistry } from '../components/ComponentRegistry';

export const FrontMcpContext = createContext<FrontMcpContextValue>({
  name: 'default',
  registry: new ComponentRegistry(),
  connect: async () => {},
});
