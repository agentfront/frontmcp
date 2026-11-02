import { Tool, ToolContext } from '@frontmcp/sdk';

/** The custom headers the request carried: `x-frontmcp-*` and those `http.forwardHeaders` keeps. */
@Tool({ name: 'request-headers', description: 'The custom headers of this request', inputSchema: {} })
export default class RequestHeadersTool extends ToolContext {
  async execute() {
    return { customHeaders: this.context.metadata.customHeaders };
  }
}
