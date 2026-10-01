// A plain browser app on the built @frontmcp packages, the way a project installs them from npm:
// no source aliases, no Node polyfills, no `express` alias (#681). It creates a server in the page,
// renders the tool list through @frontmcp/react and calls a tool.
import React from 'react';
import { createRoot } from 'react-dom/client';

import { FrontMcpProvider, useCallTool, useListTools } from '@frontmcp/react';
import { create, LogLevel, tool } from '@frontmcp/sdk';

const ping = tool({ name: 'ping', description: 'Answers pong', inputSchema: {} })(() => ({ pong: true }));

function Tools() {
  const tools = useListTools();
  const [call, { data }] = useCallTool('ping');
  React.useEffect(() => {
    if (tools.length > 0 && !data) call({});
  }, [tools.length, data, call]);
  const result = data ? JSON.stringify(data.structuredContent ?? data.content) : '';
  return React.createElement('p', { id: 'tools' }, `tools:${tools.map((t) => t.name).join(',')} result:${result}`);
}

create({ info: { name: 'published-app', version: '1.0.0' }, tools: [ping], logging: { level: LogLevel.Error } })
  .then((server) => {
    createRoot(document.getElementById('root')).render(
      React.createElement(FrontMcpProvider, { server }, React.createElement(Tools)),
    );
  })
  .catch((error) => {
    document.getElementById('root').textContent = `error:${error instanceof Error ? error.message : String(error)}`;
  });
