import React from 'react';
import { useFrontMcp } from '@frontmcp/react';

export function ProviderStatus(): React.ReactElement {
  const { status, name, tools, resources } = useFrontMcp();

  return (
    <div>
      <h2>Provider Status</h2>
      <p>
        Status: <span data-testid="status">{status}</span>
      </p>
      <p>
        Server Name: <span data-testid="server-name">{name}</span>
      </p>
      <p>
        Tool Count: <span data-testid="tool-count">{tools.length}</span>
      </p>
      <p>
        Resource Count: <span data-testid="resource-count">{resources.length}</span>
      </p>
    </div>
  );
}
