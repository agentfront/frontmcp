// v2 moved the Node.js transport (`IncomingMessage`/`ServerResponse` on top of the web-standard one) to `@modelcontextprotocol/node`
export { NodeStreamableHTTPServerTransport as StreamableHTTPServerTransport } from '@modelcontextprotocol/node';
export {
  WebStandardStreamableHTTPServerTransport,
  type EventStore,
  type EventId,
  type StreamId,
} from '@modelcontextprotocol/server';
