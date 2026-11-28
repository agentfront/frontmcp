import 'reflect-metadata';

import {
  App,
  FrontMcp,
  Tool,
  ToolContext,
  type AuthPrincipal,
  type PrincipalKind,
  type PrincipalResolver,
  type UserClaim,
} from '@frontmcp/sdk';

@Tool({ name: 'whoami', inputSchema: {} })
export class WhoAmITool extends ToolContext {
  async execute() {
    const principal: AuthPrincipal = this.auth.principal;
    const kind: PrincipalKind = principal.kind;
    const clientId: string | undefined = principal.clientId;
    const authTime: number | undefined = principal.authTime;
    const grantType: string | undefined = principal.grantType;
    return { kind, sub: principal.sub, clientId, authTime, grantType, isMachine: kind === 'machine' };
  }
}

/** The typed claims that tell a person from a machine. */
export function signedInAt(user: UserClaim): { authTime?: number; azp?: string; clientId?: string } {
  return { authTime: user.auth_time, azp: user.azp, clientId: user.client_id };
}

/** A Keycloak service account is a machine. */
const serviceAccounts: PrincipalResolver = (claims, detected) =>
  String(claims['preferred_username']).startsWith('service-account-') ? { kind: 'machine' } : { sub: detected.sub };

// @ts-expect-error a principal's kind is person, machine or anonymous
export const robot: PrincipalKind = 'robot';

@App({ name: 'Identity', tools: [WhoAmITool] })
export class IdentityApp {}

@FrontMcp({
  info: { name: 'identity', version: '1.0.0' },
  apps: [IdentityApp],
  auth: { mode: 'transparent', provider: 'https://idp.example.com', principal: serviceAccounts },
})
export class IdentityServer {}

@FrontMcp({
  info: { name: 'identity-async', version: '1.0.0' },
  apps: [IdentityApp],
  auth: { mode: 'local', principal: async (_claims, detected) => (detected.kind === 'anonymous' ? undefined : {}) },
})
export class AsyncIdentityServer {}
