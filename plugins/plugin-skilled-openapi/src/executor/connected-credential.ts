// file: plugins/plugin-skilled-openapi/src/executor/connected-credential.ts
//
// The caller's own credential for an auth provider, read from the vaults `@Tool({ authProviders })` reads.

import { AUTH_PROVIDERS_ACCESSOR, CREDENTIALS_ACCESSOR, type Credential } from '@frontmcp/auth';
import { type Token } from '@frontmcp/di';
import { ToolCredentialsRequiredError } from '@frontmcp/sdk';

/** The context-scoped providers of the tool call, and the tool's name for the error a missing credential raises. */
interface CallerVaultLookup {
  tryGet<T>(token: Token<T>): T | undefined;
  metadata: { name: string };
}

/**
 * The secret of the credential the caller connected as `provider`: from the auth providers vault
 * (`this.authProviders`), else the session credential vault (`this.credentials`). A caller who has none gets a
 * `ToolCredentialsRequiredError` (JSON-RPC -32001), with the session vault's connect URL as `authUrl` when it has
 * one. The URL is kept out of the message: it lets its holder connect a credential for the caller, and the message
 * reaches workflow errors and the audit log.
 */
export async function connectedCredentialOf(provider: string, toolCall: CallerVaultLookup): Promise<string> {
  const resolved = await toolCall.tryGet(AUTH_PROVIDERS_ACCESSOR)?.get(provider);
  if (resolved) return secretOf(resolved.credential, provider);

  const connection = await toolCall.tryGet(CREDENTIALS_ACCESSOR)?.requireConnect({ key: provider });
  if (connection?.connected) return connection.credential.secret;

  const toolId = toolCall.metadata.name;
  throw new ToolCredentialsRequiredError({
    toolId,
    providers: [provider],
    authUrl: connection?.resumeUrl,
    message: `Tool "${toolId}" sends the caller's own "${provider}" credential, which this caller hasn't connected. Connect "${provider}" and retry.`,
  });
}

function secretOf(credential: Credential, provider: string): string {
  switch (credential.type) {
    case 'oauth':
    case 'oauth_pkce':
      return credential.accessToken;
    case 'bearer':
      return credential.token;
    case 'api_key':
      return credential.key;
    default:
      throw new Error(
        `the "${provider}" credential is a ${credential.type} credential, which an auth binding can't send`,
      );
  }
}
