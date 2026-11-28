import { StdioServerTransport as V2StdioServerTransport } from '@modelcontextprotocol/server/stdio';

/**
 * v2's stdio transport closes itself when stdin ends, which drops the answers to requests still in flight: a client
 * that sends a request and closes stdin never gets its reply. v1's transport didn't watch stdin's end, and FrontMCP
 * closes the transport itself once those requests are answered (`stdin ended; shutting down`). This keeps v1's
 * behaviour.
 */
export class StdioServerTransport extends V2StdioServerTransport {
  constructor(...args: ConstructorParameters<typeof V2StdioServerTransport>) {
    super(...args);
    (this as unknown as { _onstdinclose: () => void })._onstdinclose = () => undefined;
  }
}
