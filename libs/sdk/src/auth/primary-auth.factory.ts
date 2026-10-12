import {
  isOrchestratedLocal,
  isOrchestratedMode,
  isPublicMode,
  isStaticMode,
  isTransparentMode,
  parseAuthOptions,
  type FrontMcpAuth,
  type PublicAuthOptions,
} from '../common';
import type { PrimaryAuthFactory } from './auth.registry';
import { LocalPrimaryAuth } from './instances/instance.local-primary-auth';
import { RemotePrimaryAuth } from './instances/instance.remote-primary-auth';

/** The primary auth of a scope that serves HTTP or configures `auth`: the OAuth, discovery and session flows of its mode. */
export const createPrimaryAuth: PrimaryAuthFactory = (scope, providers, options): FrontMcpAuth => {
  if (isPublicMode(options)) {
    return new LocalPrimaryAuth(scope, providers, options);
  }

  // #544 — static mode reuses the local instance (it needs the same session /
  // discovery surface public mode does) while `session:verify`'s
  // `handleStaticToken` stage is the whole of its authentication. Without this
  // branch a static config fell through to the public-mode fallback below,
  // which would silently serve a token-protected server unauthenticated.
  if (isStaticMode(options)) {
    return new LocalPrimaryAuth(scope, providers, options);
  }

  if (isTransparentMode(options)) {
    return new RemotePrimaryAuth(scope, providers, options);
  }

  if (isOrchestratedMode(options)) {
    if (isOrchestratedLocal(options)) {
      return new LocalPrimaryAuth(scope, providers, options);
    } else {
      // Remote mode: FrontMCP runs a local OAuth server that proxies user
      // authentication to a single mandatory upstream IdP. LocalPrimaryAuth
      // registers the flat remote config as one upstream provider (see
      // registerRemoteProvider), so /oauth/authorize federates straight to the
      // upstream IdP, the provider-callback exchanges + stores its tokens, and
      // the minted FrontMCP session identity derives from the upstream user.
      return new LocalPrimaryAuth(scope, providers, options);
    }
  }

  // Fallback (should never reach here) - create public mode with defaults
  const defaultOptions = parseAuthOptions({ mode: 'public' }) as PublicAuthOptions;
  return new LocalPrimaryAuth(scope, providers, defaultOptions);
};
