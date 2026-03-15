// Stub for StdioServerTransport in browser builds — stdio requires Node.js process.stdin/stdout

export class StdioServerTransport {
  constructor() {
    throw new Error('StdioServerTransport is not available in browser environments');
  }
}
