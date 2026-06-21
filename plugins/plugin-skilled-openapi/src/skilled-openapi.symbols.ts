// file: plugins/plugin-skilled-openapi/src/skilled-openapi.symbols.ts
//
// Class-shaped DI tokens for plugin-internal services. Concrete instances are
// built by the plugin's `dynamicProviders()` and injected into the meta-tools
// via the standard `this.get(Token)` API.

import { type UnprotectedOpsPolicy } from './security/authority-guard';
import { type CredentialResolver } from './executor/credential-resolver';
import { type OutboundOptions, type SkilledOpenApiPluginOptions } from './skilled-openapi.types';

/**
 * Resolved-at-construction config for the plugin. Mirrors plugin options after
 * Zod parsing so downstream services don't re-parse.
 */
export class SkilledOpenApiConfig {
  constructor(public readonly options: SkilledOpenApiPluginOptions) {}
  get outbound(): OutboundOptions {
    return this.options.outbound;
  }
  /** Default-deny policy for ops with no required-authorities (C1/C3). */
  get unprotectedOps(): UnprotectedOpsPolicy {
    return this.options.unprotectedOps;
  }
}

/**
 * Token for the plugin-private credential resolver. Production wiring backs
 * it with `libs/auth`'s vault; v1.2.0 OSS demos use the in-memory resolver.
 */
export abstract class SkilledOpenApiCredentialResolver {
  abstract resolve(ref: string, opts: { bundleId: string }): Promise<string | undefined>;
}

/**
 * Convenience: cast a CredentialResolver instance to the abstract token.
 */
export function asCredentialResolverToken(resolver: CredentialResolver): SkilledOpenApiCredentialResolver {
  return resolver as unknown as SkilledOpenApiCredentialResolver;
}
