// Stub for StdioClientTransport in browser builds — stdio requires Node.js child_process

export class StdioClientTransport {
  constructor(_options?: unknown) {
    throw new Error('StdioClientTransport is not available in browser environments');
  }
}
