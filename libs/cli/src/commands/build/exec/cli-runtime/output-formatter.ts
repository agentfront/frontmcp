/**
 * Output formatting for MCP tool/resource results in CLI context.
 * This module is embedded in the generated CLI bundle.
 */

export type OutputMode = 'text' | 'json';

export interface ContentBlock {
  type: string;
  text?: string;
  mimeType?: string;
  data?: string;
  uri?: string;
  [key: string]: unknown;
}

export interface CallToolResult {
  content?: ContentBlock[];
  isError?: boolean;
  [key: string]: unknown;
}

/**
 * Format a tool call result for terminal output.
 */
export function formatToolResult(result: CallToolResult, mode: OutputMode): string {
  if (mode === 'json') {
    return JSON.stringify(result, null, 2);
  }

  return formatTextOutput(result);
}

/**
 * Format a resource read result for terminal output.
 */
export function formatResourceResult(result: Record<string, unknown>, mode: OutputMode): string {
  if (mode === 'json') {
    return JSON.stringify(result, null, 2);
  }

  const contents = result.contents as ContentBlock[] | undefined;
  if (!contents || contents.length === 0) {
    return '(empty resource)';
  }

  return contents
    .map((c) => {
      if (c.text) return c.text;
      if (c.uri) return `[Resource: ${c.uri}]`;
      if (c.data && c.mimeType) return `[Binary: ${c.mimeType}, ${c.data.length} chars base64]`;
      return JSON.stringify(c, null, 2);
    })
    .join('\n');
}

/**
 * Format a prompt result for terminal output.
 */
export function formatPromptResult(result: Record<string, unknown>, mode: OutputMode): string {
  if (mode === 'json') {
    return JSON.stringify(result, null, 2);
  }

  const messages = result.messages as Array<{ role?: string; content?: ContentBlock }> | undefined;
  if (!messages || messages.length === 0) {
    return '(empty prompt)';
  }

  return messages
    .map((m) => {
      const role = m.role || 'unknown';
      const text = m.content?.text || JSON.stringify(m.content);
      return `[${role}] ${text}`;
    })
    .join('\n\n');
}

function formatTextOutput(result: CallToolResult): string {
  if (!result.content || result.content.length === 0) {
    return result.isError ? '(error: no content)' : '(no output)';
  }

  const blocks = result.content.map((block) => {
    switch (block.type) {
      case 'text':
        return block.text || '';
      case 'image':
        return `[Image: ${block.mimeType || 'unknown'}, ${(block.data?.length || 0)} chars base64]`;
      case 'resource':
        return `[Resource: ${block.uri || 'unknown'}]`;
      case 'audio':
        return `[Audio: ${block.mimeType || 'unknown'}]`;
      default:
        return `[${block.type}: ${JSON.stringify(block)}]`;
    }
  });

  const output = blocks.join('\n');

  if (result.isError) {
    return `Error: ${output}`;
  }

  return output;
}

/**
 * Generate the output-formatter module source code for embedding in CLI bundle.
 */
export function generateOutputFormatterSource(): string {
  return `
'use strict';

function formatToolResult(result, mode) {
  if (mode === 'json') return JSON.stringify(result, null, 2);
  if (!result.content || result.content.length === 0) {
    return result.isError ? '(error: no content)' : '(no output)';
  }
  const blocks = result.content.map(function(block) {
    switch (block.type) {
      case 'text': return block.text || '';
      case 'image': return '[Image: ' + (block.mimeType || 'unknown') + ']';
      case 'resource': return '[Resource: ' + (block.uri || 'unknown') + ']';
      case 'audio': return '[Audio: ' + (block.mimeType || 'unknown') + ']';
      default: return '[' + block.type + ']';
    }
  });
  var output = blocks.join('\\n');
  return result.isError ? 'Error: ' + output : output;
}

function formatResourceResult(result, mode) {
  if (mode === 'json') return JSON.stringify(result, null, 2);
  var contents = result.contents;
  if (!contents || contents.length === 0) return '(empty resource)';
  return contents.map(function(c) {
    if (c.text) return c.text;
    if (c.uri) return '[Resource: ' + c.uri + ']';
    if (c.data && c.mimeType) return '[Binary: ' + c.mimeType + ']';
    return JSON.stringify(c, null, 2);
  }).join('\\n');
}

function formatPromptResult(result, mode) {
  if (mode === 'json') return JSON.stringify(result, null, 2);
  var messages = result.messages;
  if (!messages || messages.length === 0) return '(empty prompt)';
  return messages.map(function(m) {
    var role = m.role || 'unknown';
    var text = m.content && m.content.text ? m.content.text : JSON.stringify(m.content);
    return '[' + role + '] ' + text;
  }).join('\\n\\n');
}

module.exports = { formatToolResult, formatResourceResult, formatPromptResult };
`.trim();
}
