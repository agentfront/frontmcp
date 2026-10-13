// Calls the greet tool through a Worker bundle's fetch handler and prints the tool result as JSON: node call-greet-over-fetch.mjs <workerBundle>
import { pathToFileURL } from 'node:url';

const [workerBundle] = process.argv.slice(2);
const { handlerPromise } = await import(pathToFileURL(workerBundle).href);
const handler = await handlerPromise;

const protocolVersion = '2026-07-28';
const response = await handler(
  new Request('http://localhost/mcp', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      'mcp-protocol-version': protocolVersion,
      'mcp-method': 'tools/call',
      'mcp-name': 'greet',
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: {
        name: 'greet',
        arguments: { name: 'FrontMCP' },
        _meta: { 'io.modelcontextprotocol/protocolVersion': protocolVersion },
      },
    }),
  }),
);
const body = await response.text();
const dataLine = body.split('\n').find((line) => line.startsWith('data: '));
const message = JSON.parse(dataLine ? dataLine.slice('data: '.length) : body);
process.stdout.write(JSON.stringify(message.result ?? message.error));
