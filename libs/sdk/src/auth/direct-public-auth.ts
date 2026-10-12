import { getEnv } from '@frontmcp/utils';

import { defaultHttpPort, FrontMcpAuth, type PublicAuthOptions, type ScopeEntry } from '../common';

/** The public auth of a direct-only scope without `auth`: no OAuth, discovery or session flows, which serve HTTP. */
export class DirectPublicAuth extends FrontMcpAuth<PublicAuthOptions> {
  override ready = Promise.resolve();
  readonly issuer: string;

  constructor(scope: ScopeEntry, options: PublicAuthOptions) {
    super(options);
    const host = getEnv('FRONTMCP_PUBLIC_HOST')?.trim() || 'localhost';
    this.issuer = `http://${host}:${scope.metadata.http?.port ?? defaultHttpPort()}${scope.fullPath}`;
  }

  override fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    return fetch(input, init);
  }

  override validate(): Promise<void> {
    return Promise.resolve();
  }
}
