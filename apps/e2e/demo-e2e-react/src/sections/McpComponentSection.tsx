import React from 'react';

import { z } from '@frontmcp/lazy-zod';
import { mcpComponent, useCallTool, type CallToolResult } from '@frontmcp/react';

function GreetingCard({ title, message }: { title: string; message: string }): React.ReactElement {
  return (
    <div data-testid="greeting-card">
      <h3>{title}</h3>
      <p>{message}</p>
    </div>
  );
}

const McpGreetingCard = mcpComponent(GreetingCard, {
  name: 'show_greeting',
  description: 'Shows a greeting card',
  schema: z.object({
    title: z.string(),
    message: z.string(),
  }),
  fallback: <div data-testid="greeting-fallback">Waiting for greeting data...</div>,
});

export function McpComponentSection(): React.ReactElement {
  const [callShowGreeting] = useCallTool<{ title: string; message: string }, CallToolResult>('show_greeting');

  const handleTrigger = async () => {
    await callShowGreeting({ title: 'Welcome', message: 'Hello from MCP!' });
  };

  return (
    <div>
      <h2>MCP Component</h2>
      <button data-testid="greeting-trigger" onClick={handleTrigger}>
        Show Greeting
      </button>
      <div data-testid="greeting-container">
        <McpGreetingCard />
      </div>
    </div>
  );
}
