'use strict';
// A CommonJS dependency of the app: the bundler resolves this require() with the `browser` condition.
const { create, LogLevel, tool } = require('@frontmcp/sdk');

const ping = tool({ name: 'ping', description: 'Answers pong', inputSchema: {} })(() => ({ pong: true }));

exports.listAndCallPing = async function listAndCallPing() {
  const server = await create({
    info: { name: 'published-cjs-app', version: '1.0.0' },
    tools: [ping],
    logging: { level: LogLevel.Error },
  });
  const { tools } = await server.listTools();
  const result = await server.callTool('ping', {});
  const toolNames = tools.map((listedTool) => listedTool.name).join(',');
  return `tools:${toolNames} result:${JSON.stringify(result.structuredContent ?? result.content)}`;
};
