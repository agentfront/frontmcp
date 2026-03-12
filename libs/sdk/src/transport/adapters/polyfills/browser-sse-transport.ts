// Stub for SSEServerTransport in browser builds

export interface SSEServerTransportOptions {
  allowedHosts?: string[];
  allowedOrigins?: string[];
  enableDnsRebindingProtection?: boolean;
  sessionId?: string;
}

export class SSEServerTransport {
  constructor(_endpoint?: string, _res?: unknown, _options?: SSEServerTransportOptions) {
    throw new Error('SSEServerTransport is not available in browser environments');
  }
}
