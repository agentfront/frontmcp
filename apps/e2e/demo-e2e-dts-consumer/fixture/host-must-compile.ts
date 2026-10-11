import 'reflect-metadata';

import {
  App,
  createWebFetchHandler,
  FrontMcp,
  HostServerAdapter,
  type HttpMethod,
  type Scope,
  type ScopeEntry,
  type ServerRequestHandler,
  type WebFetchHandler,
} from '@frontmcp/sdk';

// A custom host implements the host contract; it has no enhancedHandler() to write (#819).
export class RecordingHost extends HostServerAdapter {
  readonly routes: string[] = [];

  registerMiddleware(_entryPath: string, _handler: ServerRequestHandler): void {
    return;
  }

  registerRoute(method: HttpMethod, path: string, _handler: ServerRequestHandler): void {
    this.routes.push(`${method} ${path}`);
  }

  prepare(): void {
    return;
  }

  getHandler(): unknown {
    return undefined;
  }

  start(_portOrSocketPath: number | string, _bindAddress?: string): void {
    return;
  }
}

@App({ name: 'hosted' })
class HostedApp {}

@FrontMcp({
  info: { name: 'custom-host', version: '1.0.0' },
  apps: [HostedApp],
  http: { hostFactory: () => new RecordingHost() },
})
export class CustomHostServer {}

// The web-fetch helpers take a Scope, a type a consumer can name.
export function fetchHandlerFor(scope: Scope): WebFetchHandler {
  return createWebFetchHandler(scope);
}

export function entryOf(scope: Scope): ScopeEntry {
  return scope;
}
