import React from 'react';
import { useListTools } from '@frontmcp/react';

export function ToolListing(): React.ReactElement {
  const tools = useListTools();

  return (
    <div>
      <h2>Tool Listing</h2>
      <p>
        Count: <span data-testid="tools-count">{tools.length}</span>
      </p>
      <ul>
        {tools.map((tool) => (
          <li key={tool.name} data-testid={`tool-${tool.name}`}>
            <strong>{tool.name}</strong>
            {tool.description ? ` — ${tool.description}` : ''}
          </li>
        ))}
      </ul>
    </div>
  );
}
