// flows/flow.utils.ts

import { FlowKind, FlowMetadata, FlowRecord, FlowType, FrontMcpFlowTokens, Token } from '../common';
import { depsOfClass, isClass } from '../utils/token.utils';
import { getMetadata } from '../utils/metadata.utils';

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
  throw new Error(
    `Invalid adapter '${name}'. Expected a class or a adapter object.`,
  );
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

