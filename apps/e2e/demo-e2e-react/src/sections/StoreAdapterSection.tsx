import React, { useState } from 'react';
import { useFrontMcp, useCallTool, useListTools } from '@frontmcp/react';
import type { CallToolResult } from '@frontmcp/react';

export function StoreAdapterSection(): React.ReactElement {
  const { client, status } = useFrontMcp();
  const tools = useListTools();
  const [storeValue, setStoreValue] = useState<string>('');

  const hasIncrementTool = tools.some((t) => t.name === 'counter_increment');

  const [callIncrement] = useCallTool<{ args: unknown[] }, CallToolResult>('counter_increment');

  const handleReadState = async () => {
    if (!client || status !== 'connected') return;
    try {
      const result = await client.readResource('state://counter');
      const contents = (result as { contents?: Array<{ text?: string }> }).contents;
      if (contents?.[0]?.text) {
        setStoreValue(contents[0].text);
      }
    } catch {
      setStoreValue('error');
    }
  };

  const handleIncrement = async () => {
    await callIncrement({ args: [] });
    // Re-read state after increment
    await handleReadState();
  };

  return (
    <div>
      <h2>Store Adapter</h2>
      <p>
        Increment Tool: <span data-testid="store-tool-registered">{hasIncrementTool ? 'registered' : 'not found'}</span>
      </p>
      <div>
        <button data-testid="store-read" onClick={handleReadState}>
          Read State
        </button>
        <button data-testid="store-increment" onClick={handleIncrement}>
          Increment
        </button>
      </div>
      <p>
        State: <span data-testid="store-value">{storeValue}</span>
      </p>
    </div>
  );
}
