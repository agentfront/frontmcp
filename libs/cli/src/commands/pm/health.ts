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
}

export function checkHealth(opts: {
  port?: number;
  socketPath?: string;
  timeout?: number;
}): Promise<HealthCheckResult> {
  const timeout = opts.timeout ?? 5000;
  const start = Date.now();

  return new Promise((resolve) => {
    const requestOpts: http.RequestOptions = {
      method: 'GET',
      path: '/health',
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
      resolve({
        healthy: res.statusCode === 200,
        statusCode: res.statusCode,
        responseTime,
      });
      res.resume(); // drain the response
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
