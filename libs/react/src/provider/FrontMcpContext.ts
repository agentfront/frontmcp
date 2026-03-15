/**
 * React context for FrontMCP.
 */

import { createContext } from 'react';
import type { FrontMcpContextValue } from '../types';
import { ComponentRegistry } from '../components/ComponentRegistry';
import { DynamicRegistry } from '../registry/DynamicRegistry';

const defaultDynamicRegistry = new DynamicRegistry();

export const FrontMcpContext = createContext<FrontMcpContextValue>({
  name: 'default',
  registry: new ComponentRegistry(),
  dynamicRegistry: defaultDynamicRegistry,
  getDynamicRegistry: () => defaultDynamicRegistry,
  connect: async () => {},
});
