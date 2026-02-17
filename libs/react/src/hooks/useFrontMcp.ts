/**
 * useFrontMcp — access the full FrontMcpProvider context.
 */

import { useContext } from 'react';
import type { FrontMcpContextValue } from '../types';
import { FrontMcpContext } from '../provider/FrontMcpContext';

export function useFrontMcp(): FrontMcpContextValue {
  return useContext(FrontMcpContext);
}
