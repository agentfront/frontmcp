// flows/flow.utils.ts

import { Token, depsOfClass, isClass, getMetadata } from '@frontmcp/di';
import { FlowKind, FlowMetadata, FlowRecord, FlowType, FrontMcpFlowTokens } from '../common';

export function collectFlowMetadata(cls: FlowType): FlowMetadata<never> {
  return Object.entries(FrontMcpFlowTokens).reduce((metadata, [key, token]) => {
    return Object.assign(metadata, {
      [key]: getMetadata(token, cls),
    });
  }, {} as FlowMetadata<never>);
}

export function normalizeFlow(item: FlowType): FlowRecord {
  if (isClass(item)) {
    // read McpFlowMetadata from class
    const metadata = collectFlowMetadata(item);
    return { kind: FlowKind.CLASS_TOKEN, provide: item, metadata };
  }
  const name = (item as any)?.name ?? String(item);
  throw new Error(`Invalid flow '${name}'. Expected a class or a flow object.`);
}

/**
 * For graph/cycle detection. Returns dependency tokens that should be graphed.
 * - CLASS_TOKEN: deps come from the class constructor
 */
export function flowDiscoveryDeps(rec: FlowRecord): Token[] {
  switch (rec.kind) {
    case FlowKind.CLASS_TOKEN:
      return depsOfClass(rec.provide, 'discovery');
  }
}
