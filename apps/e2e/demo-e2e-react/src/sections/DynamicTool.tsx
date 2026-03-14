import React, { useState, useCallback, useMemo } from 'react';
import { useDynamicTool, useCallTool } from '@frontmcp/react';
import type { CallToolResult } from '@frontmcp/react';

const INPUT_SCHEMA = {
  type: 'object',
  properties: {
    text: { type: 'string' },
  },
  required: ['text'],
} as const;

export function DynamicTool(): React.ReactElement {
  const [inputValue, setInputValue] = useState('');
  const [registered, setRegistered] = useState(false);

  const execute = useCallback(async (args: Record<string, unknown>) => {
    const text = String(args['text'] ?? '');
    const reversed = text.split('').reverse().join('');
    return {
      content: [{ type: 'text' as const, text: reversed }],
    };
  }, []);

  useDynamicTool({
    name: 'reverse_text',
    description: 'Reverses a text string',
    inputSchema: INPUT_SCHEMA,
    execute,
  });

  React.useEffect(() => {
    setRegistered(true);
  }, []);

  const [callReverse, reverseState] = useCallTool<{ text: string }, CallToolResult>('reverse_text');

  const handleReverse = async () => {
    await callReverse({ text: inputValue });
  };

  const resultText =
    reverseState.data?.content?.[0]?.type === 'text'
      ? (reverseState.data.content[0] as { type: 'text'; text: string }).text
      : '';

  return (
    <div>
      <h2>Dynamic Tool</h2>
      <p>
        Registration: <span data-testid="dynamic-registered">{registered ? 'registered' : 'pending'}</span>
      </p>
      <div>
        <input
          data-testid="reverse-input"
          type="text"
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          placeholder="Text to reverse"
        />
        <button data-testid="reverse-button" onClick={handleReverse}>
          Reverse
        </button>
      </div>
      <p>
        Result: <span data-testid="reverse-result">{resultText}</span>
      </p>
    </div>
  );
}
