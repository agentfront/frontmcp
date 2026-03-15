import React, { useState } from 'react';
import { useCallTool } from '@frontmcp/react';
import type { CallToolResult } from '@frontmcp/react';

export function ToolCalling(): React.ReactElement {
  const [inputValue, setInputValue] = useState('');
  const [callGreet, greetState] = useCallTool<{ name: string }, CallToolResult>('greet');

  const handleGreet = async () => {
    await callGreet({ name: inputValue });
  };

  const resultText =
    greetState.data?.content?.[0]?.type === 'text'
      ? (greetState.data.content[0] as { type: 'text'; text: string }).text
      : '';

  return (
    <div>
      <h2>Tool Calling</h2>
      <div>
        <input
          data-testid="greet-input"
          type="text"
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          placeholder="Enter a name"
        />
        <button data-testid="greet-button" onClick={handleGreet}>
          Greet
        </button>
      </div>
      <p>
        Result: <span data-testid="greet-result">{resultText}</span>
      </p>
    </div>
  );
}
