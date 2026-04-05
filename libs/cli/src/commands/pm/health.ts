/**
 * HTTP health checks against running MCP servers.
 * Supports both TCP (port) and Unix socket connections.
 */

import * as http from 'http';

export interface HealthCheckResult {
  healthy: boolean;
  statusCode?: number;
  responseTime: number;
  error?: string;
  body?: Record<string, unknown>;
}

export function checkHealth(opts: {
  port?: number;
  socketPath?: string;
  timeout?: number;
  /** Endpoint to check: '/health', '/healthz', or '/readyz'. Defaults to '/health'. */
  endpoint?: string;
}): Promise<HealthCheckResult> {
  const timeout = opts.timeout ?? 5000;
  const start = Date.now();

  return new Promise((resolve) => {
    const requestOpts: http.RequestOptions = {
      method: 'GET',
      path: opts.endpoint ?? '/health',
      timeout,
    };

    if (opts.socketPath) {
      requestOpts.socketPath = opts.socketPath;
    } else if (opts.port) {
      requestOpts.hostname = '127.0.0.1';
      requestOpts.port = opts.port;
    } else {
      resolve({
        healthy: false,
        responseTime: Date.now() - start,
        error: 'No port or socket path provided',
      });
      return;
    }

    const req = http.request(requestOpts, (res) => {
      const responseTime = Date.now() - start;
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', () => {
        let body: Record<string, unknown> | undefined;
        try {
          body = JSON.parse(Buffer.concat(chunks).toString('utf-8'));
        } catch {
          // Ignore parse errors — body is optional
        }
        resolve({
          healthy: res.statusCode === 200,
          statusCode: res.statusCode,
          responseTime,
          body,
        });
      });
      res.on('error', (err) => {
        resolve({
          healthy: false,
          statusCode: res.statusCode,
          responseTime,
          error: err.message,
        });
      });
    });

    req.on('error', (err) => {
      resolve({
        healthy: false,
        responseTime: Date.now() - start,
        error: err.message,
      });
    });

    req.on('timeout', () => {
      req.destroy();
      resolve({
        healthy: false,
        responseTime: Date.now() - start,
        error: 'Health check timed out',
      });
    });

    req.end();
  });
}
