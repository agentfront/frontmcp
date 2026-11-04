// file: plugins/plugin-skilled-openapi/src/skilled-openapi.symbols.ts
//
// Class-shaped DI tokens for plugin-internal services. Concrete instances are
// built by the plugin's `dynamicProviders()` and injected into the meta-tools
// via the standard `this.get(Token)` API.

import { type CredentialResolveOptions, type CredentialResolver } from './executor/credential-resolver';
import { type UnprotectedOpsPolicy } from './security/authority-guard';
import { type OutboundOptions, type SkilledOpenApiPluginOptions } from './skilled-openapi.types';

/**
 * Resolved-at-construction config for the plugin. Mirrors plugin options after
 * Zod parsing so downstream services don't re-parse.
 */
export class SkilledOpenApiConfig {
  /** The auth provider each `vaultRef` of the `authProviders` option reads the caller's own credential from. */
  readonly authProviders: ReadonlyMap<string, string>;

  constructor(public readonly options: SkilledOpenApiPluginOptions) {
    this.authProviders = new Map(Object.entries(options.authProviders ?? {}));
  }
  get outbound(): OutboundOptions {
    return this.options.outbound;
  }
  /** Default-deny policy for ops with no required-authorities (C1/C3). */
  get unprotectedOps(): UnprotectedOpsPolicy {
    return this.options.unprotectedOps;
  }
}

/**
 * Token for the resolver that turns a bundle's `vaultRef` into a credential, such as one reading a vault.
 * Provide it in `init({ providers })`, the `@App` that installs the plugin or `@FrontMcp({ providers })`;
 * without one, the plugin's built-in resolver reads the `credentials` option. `opts.authInfo` is the caller
 * the request is made for, so a resolver can pick each caller's or tenant's credential.
 */
export abstract class SkilledOpenApiCredentialResolver {
  abstract resolve(ref: string, opts: CredentialResolveOptions): Promise<string | undefined>;
}

/**
 * Convenience: cast a CredentialResolver instance to the abstract token.
 */
export function asCredentialResolverToken(resolver: CredentialResolver): SkilledOpenApiCredentialResolver {
  return resolver as unknown as SkilledOpenApiCredentialResolver;
}
