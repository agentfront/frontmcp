import type { CallToolResult } from '@frontmcp/protocol';

import { PublicMcpError } from '../mcp.error';
import { ToolCallError } from '../tool-call.error';

describe('ToolCallError', () => {
  it('uses the text blocks of the result as its message', () => {
    const result: CallToolResult = {
      isError: true,
      content: [
        { type: 'text', text: 'first' },
        { type: 'text', text: 'second' },
      ],
    };

    const error = new ToolCallError('lookup', result);

    expect(error).toBeInstanceOf(PublicMcpError);
    expect(error.message).toBe('first\nsecond');
    expect(error.result).toBe(result);
  });

  it('falls back to a generic message for a result with no content array', () => {
    const legacyResult = { isError: true, toolResult: 'failed' } as unknown as CallToolResult;

    const error = new ToolCallError('lookup', legacyResult);

    expect(error.message).toBe('Tool "lookup" failed');
    expect(error.toolName).toBe('lookup');
  });
});
