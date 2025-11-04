import { ToolMetadata, FrontMcpToolTokens, ToolType, Token, ToolRecord, ToolKind } from '@frontmcp/sdk';
import { depsOfClass, depsOfFunc, isClass } from '../utils/token.utils';
import { getMetadata } from '../utils/metadata.utils';

export function collectToolMetadata(cls: ToolType): ToolMetadata {
  return Object.entries(FrontMcpToolTokens).reduce((metadata, [key, token]) => {
    return Object.assign(metadata, {
      [key]: getMetadata(token, cls),
    });
  }, {} as ToolMetadata);
}

export function normalizeTool(item: any): ToolRecord {
  if (item && typeof item === 'function' && item[FrontMcpToolTokens.type] === 'function-tool' && item[FrontMcpToolTokens.metadata]) {
    return {
      kind: ToolKind.FUNCTION,
      provide: item(),
      metadata: item[FrontMcpToolTokens.metadata] as ToolMetadata,
    };
  }

  if (isClass(item)) {
    // read McpToolMetadata from class
    const metadata = collectToolMetadata(item);
    return { kind: ToolKind.CLASS_TOKEN, provide: item, metadata };
  }
  const name = (item as any)?.name ?? String(item);
  throw new Error(
    `Invalid adapter '${name}'. Expected a class or a adapter object.`,
  );
}

/**
 * For graph/cycle detection. Returns dependency tokens that should be graphed.
 * - FUNCTION: get function params without the first argument (the tool input)
 * - CLASS_TOKEN: deps come from the class constructor
 */
export function toolDiscoveryDeps(rec: ToolRecord): Token[] {
  switch (rec.kind) {
    case ToolKind.FUNCTION: {
      return depsOfFunc(rec.provide, 'discovery');
    }
    case ToolKind.CLASS_TOKEN:
      return depsOfClass(rec.provide, 'discovery');
  }
}

