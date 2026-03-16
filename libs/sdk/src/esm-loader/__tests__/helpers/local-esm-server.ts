/**
 * @file local-esm-server.ts
 * @description Reusable local HTTP server that mimics both an npm registry API and ESM CDN.
 * Used for E2E testing of the ESM loader pipeline without real network calls.
 */

import * as http from 'node:http';

/**
 * A package hosted by the local ESM server.
 */
export interface LocalEsmServerPackage {
  /** Package name (e.g., '@test/simple-tools') */
  name: string;
  /** Map of version → ESM bundle source code */
  versions: Record<string, { bundle: string }>;
  /** Dist-tags (e.g., { latest: '1.0.0', next: '2.0.0-beta.1' }) */
  'dist-tags'?: Record<string, string>;
}

/**
 * A local HTTP server that acts as both an npm registry and ESM CDN.
 *
 * URL patterns:
 * - `GET /{packageName}` → npm registry JSON (versions, dist-tags)
 * - `GET /{packageName}@{version}?bundle` → ESM module source code
 * - `GET /{packageName}@{version}` → ESM module source code (also without ?bundle)
 */
export class LocalEsmServer {
  private server: http.Server | undefined;
  private readonly packages = new Map<string, LocalEsmServerPackage>();
  private requiredToken: string | undefined;
  private port = 0;
  private requestLog: Array<{ method: string; url: string; headers: Record<string, string | undefined> }> = [];

  /**
   * Add a package to the server.
   */
  addPackage(pkg: LocalEsmServerPackage): void {
    this.packages.set(pkg.name, pkg);
  }

  /**
   * Update or add a specific version to an existing package.
   */
  updatePackage(name: string, version: string, bundle: string): void {
    const pkg = this.packages.get(name);
    if (pkg) {
      pkg.versions[version] = { bundle };
      // Update 'latest' dist-tag to the new version
      if (!pkg['dist-tags']) {
        pkg['dist-tags'] = {};
      }
      pkg['dist-tags']['latest'] = version;
    }
  }

  /**
   * Require a specific bearer token for all requests.
   * Set to undefined to disable auth.
   */
  setAuthToken(token: string | undefined): void {
    this.requiredToken = token;
  }

  /**
   * Get the request log (for verifying what was requested).
   */
  getRequestLog(): typeof this.requestLog {
    return [...this.requestLog];
  }

  /**
   * Clear the request log.
   */
  clearRequestLog(): void {
    this.requestLog = [];
  }

  /**
   * Start the server on a random port.
   */
  async start(): Promise<{ registryUrl: string; esmBaseUrl: string; port: number }> {
    return new Promise((resolve, reject) => {
      this.server = http.createServer((req, res) => this.handleRequest(req, res));

      this.server.listen(0, '127.0.0.1', () => {
        const addr = this.server!.address();
        if (!addr || typeof addr === 'string') {
          reject(new Error('Failed to get server address'));
          return;
        }
        this.port = addr.port;
        const baseUrl = `http://127.0.0.1:${this.port}`;
        resolve({
          registryUrl: baseUrl,
          esmBaseUrl: baseUrl,
          port: this.port,
        });
      });

      this.server.on('error', reject);
    });
  }

  /**
   * Stop the server.
   */
  async stop(): Promise<void> {
    return new Promise((resolve) => {
      if (!this.server) {
        resolve();
        return;
      }
      this.server.close(() => resolve());
    });
  }

  private handleRequest(req: http.IncomingMessage, res: http.ServerResponse): void {
    const url = req.url ?? '/';
    const method = req.method ?? 'GET';

    this.requestLog.push({
      method,
      url,
      headers: {
        authorization: req.headers['authorization'],
        accept: req.headers['accept'],
      },
    });

    // Check auth if required
    if (this.requiredToken) {
      const authHeader = req.headers['authorization'];
      if (!authHeader || authHeader !== `Bearer ${this.requiredToken}`) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Unauthorized' }));
        return;
      }
    }

    // Parse the URL path
    const urlObj = new URL(url, `http://127.0.0.1:${this.port}`);
    const pathname = decodeURIComponent(urlObj.pathname).slice(1); // Remove leading /

    // Check if this is a versioned request (e.g., @scope/name@1.0.0)
    const versionMatch = pathname.match(/^(.+?)@(\d+\.\d+\.\d+.*)$/);

    if (versionMatch) {
      // ESM bundle request: /{package}@{version}
      this.serveBundleRequest(res, versionMatch[1], versionMatch[2]);
    } else {
      // Registry metadata request: /{package}
      this.serveRegistryRequest(res, pathname);
    }
  }

  private serveRegistryRequest(res: http.ServerResponse, packageName: string): void {
    const pkg = this.packages.get(packageName);
    if (!pkg) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Not found' }));
      return;
    }

    // Build npm registry-style response
    const versions: Record<string, unknown> = {};
    const time: Record<string, string> = {};

    for (const ver of Object.keys(pkg.versions)) {
      versions[ver] = { version: ver, name: pkg.name };
      time[ver] = new Date().toISOString();
    }

    const registryData = {
      name: pkg.name,
      'dist-tags': pkg['dist-tags'] ?? { latest: Object.keys(pkg.versions).pop() ?? '0.0.0' },
      versions,
      time,
    };

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(registryData));
  }

  private serveBundleRequest(res: http.ServerResponse, packageName: string, version: string): void {
    const pkg = this.packages.get(packageName);
    if (!pkg) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end(`Package "${packageName}" not found`);
      return;
    }

    const versionEntry = pkg.versions[version];
    if (!versionEntry) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end(`Version "${version}" not found for "${packageName}"`);
      return;
    }

    res.writeHead(200, {
      'Content-Type': 'application/javascript',
      ETag: `"${packageName}@${version}"`,
    });
    res.end(versionEntry.bundle);
  }
}
