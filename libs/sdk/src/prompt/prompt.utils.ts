// file: libs/sdk/src/prompt/prompt.utils.ts

import {
  PromptMetadata,
  FrontMcpPromptTokens,
  PromptType,
  Token,
  PromptRecord,
  PromptKind,
  Type,
  PromptEntry,
} from '../common';
import { depsOfClass, depsOfFunc, isClass } from '../utils/token.utils';
import { getMetadata } from '../utils/metadata.utils';
import { GetPromptResult, PromptMessage } from '@modelcontextprotocol/sdk/types.js';

// Re-export shared naming utilities
export {
  splitWords,
  toCase,
  sepFor,
  normalizeSegment,
  normalizeProviderId,
  normalizeOwnerPath,
  shortHash,
  ensureMaxLen,
} from '../utils/naming.utils';

// Re-export shared lineage utilities
export { ownerKeyOf, qualifiedNameOf } from '../utils/lineage.utils';

/**
 * Collect metadata from a class decorated with @FrontMcpPrompt
 */
export function collectPromptMetadata(cls: PromptType): PromptMetadata {
  return Object.entries(FrontMcpPromptTokens).reduce((metadata, [key, token]) => {
    const value = getMetadata(token, cls);
    if (value !== undefined) {
      return Object.assign(metadata, {
        [key]: value,
      });
    }
    return metadata;
  }, {} as PromptMetadata);
}

/**
 * Normalize any prompt input (class or function) to a PromptRecord
 */
export function normalizePrompt(item: any): PromptRecord {
  // Function-style decorator: prompt({ name: '...' })(handler)
  if (
    item &&
    typeof item === 'function' &&
    item[FrontMcpPromptTokens.type] === 'function-prompt' &&
    item[FrontMcpPromptTokens.metadata]
  ) {
    return {
      kind: PromptKind.FUNCTION,
      provide: item(),
      metadata: item[FrontMcpPromptTokens.metadata] as PromptMetadata,
    };
  }

  // Class-style decorator: @FrontMcpPrompt({ name: '...' })
  if (isClass(item)) {
    const metadata = collectPromptMetadata(item as PromptType);
    return { kind: PromptKind.CLASS_TOKEN, provide: item as Type<PromptEntry>, metadata };
  }

  const name = (item as any)?.name ?? String(item);
  throw new Error(`Invalid prompt '${name}'. Expected a class or a prompt function.`);
}

/**
 * Get dependency tokens for graph/cycle detection
 */
export function promptDiscoveryDeps(rec: PromptRecord): Token[] {
  switch (rec.kind) {
    case PromptKind.FUNCTION:
      return depsOfFunc(rec.provide, 'discovery');
    case PromptKind.CLASS_TOKEN:
      return depsOfClass(rec.provide, 'discovery');
  }
}

/**
 * Build a parsed prompt result from raw output
 */
export function buildParsedPromptResult(raw: any, metadata: PromptMetadata): GetPromptResult {
  // If already in GetPromptResult format
  if (raw && typeof raw === 'object' && 'messages' in raw && Array.isArray(raw.messages)) {
    return {
      description: raw.description ?? metadata.description,
      messages: raw.messages as PromptMessage[],
    };
  }

  // If raw is a string, convert to single user message
  if (typeof raw === 'string') {
    return {
      description: metadata.description,
      messages: [{ role: 'user', content: { type: 'text', text: raw } }],
    };
  }

  // If raw is an array of messages
  if (Array.isArray(raw)) {
    return {
      description: metadata.description,
      messages: raw.map(normalizePromptMessage),
    };
  }

  // Default: wrap in user message as JSON
  return {
    description: metadata.description,
    messages: [{ role: 'user', content: { type: 'text', text: JSON.stringify(raw) } }],
  };
}

/**
 * Normalize a single message to PromptMessage format
 */
function normalizePromptMessage(msg: any): PromptMessage {
  // If already in correct format
  if (msg && msg.role && msg.content) {
    return msg as PromptMessage;
  }

  // Assume user message with text content
  return {
    role: 'user',
    content: { type: 'text', text: typeof msg === 'string' ? msg : JSON.stringify(msg) },
  };
}
