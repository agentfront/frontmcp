// file: libs/sdk/src/prompt/prompt.utils.ts

import { Token, Type, depsOfClass, depsOfFunc, isClass, getMetadata } from '@frontmcp/di';
import { PromptMetadata, FrontMcpPromptTokens, PromptType, PromptRecord, PromptKind, PromptEntry } from '../common';
import { GetPromptResult, PromptMessage } from '@modelcontextprotocol/sdk/types.js';
import { InvalidEntityError } from '../errors';

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
 * Normalize any prompt input (class or function) to a PromptRecord.
 *
 * @param item - The prompt input to normalize. Accepts:
 *   - A class decorated with @FrontMcpPrompt
 *   - A function returned from prompt() builder
 *   The `any` type is intentional to handle both decorator patterns and provide
 *   meaningful error messages for invalid inputs.
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
  throw new InvalidEntityError('prompt', name, 'a class or a prompt function');
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
export function buildParsedPromptResult(raw: unknown, metadata: PromptMetadata): GetPromptResult {
  // If already in GetPromptResult format
  if (raw && typeof raw === 'object' && 'messages' in raw && Array.isArray(raw.messages)) {
    const rawObj = raw as { description?: string; messages: unknown[] };
    return {
      description: rawObj.description ?? metadata.description,
      messages: rawObj.messages as PromptMessage[],
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
function normalizePromptMessage(msg: unknown): PromptMessage {
  // If already in correct format with valid role and content
  if (
    msg &&
    typeof msg === 'object' &&
    'role' in msg &&
    'content' in msg &&
    typeof (msg as Record<string, unknown>)['role'] === 'string' &&
    typeof (msg as Record<string, unknown>)['content'] === 'object'
  ) {
    return msg as PromptMessage;
  }

  // Assume user message with text content
  return {
    role: 'user',
    content: { type: 'text', text: typeof msg === 'string' ? msg : JSON.stringify(msg) },
  };
}
