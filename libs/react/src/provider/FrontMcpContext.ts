/**
 * React context for FrontMCP.
 */

import { createContext, type Context } from 'react';

import { ComponentRegistry } from '../components/ComponentRegistry';
import { DynamicRegistry } from '../registry/DynamicRegistry';
import type { FrontMcpContextValue } from '../types';

// The package ships one bundle per entry point (`/state`, `/api`, `/ai`, ...), and each
// bundle would otherwise carry its own copy of this module, with its own context object.
// A provider from the root entry would then be invisible to hooks from a subpath. Keeping
// the instance on `globalThis` makes every copy share one context.
const CONTEXT_KEY = Symbol.for('@frontmcp/react/FrontMcpContext');

type ContextHost = { [CONTEXT_KEY]?: Context<FrontMcpContextValue> };

function getOrCreateContext(): Context<FrontMcpContextValue> {
  const host = globalThis as ContextHost;
  const existing = host[CONTEXT_KEY];
  if (existing) return existing;

  const defaultDynamicRegistry = new DynamicRegistry();
  const created = createContext<FrontMcpContextValue>({
    name: 'default',
    registry: new ComponentRegistry(),
    dynamicRegistry: defaultDynamicRegistry,
    getDynamicRegistry: () => defaultDynamicRegistry,
    connect: async () => {},
  });
  host[CONTEXT_KEY] = created;
  return created;
}

export const FrontMcpContext = getOrCreateContext();
