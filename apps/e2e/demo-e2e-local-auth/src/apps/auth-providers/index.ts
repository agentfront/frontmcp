import { App, Tool, ToolContext } from '@frontmcp/sdk';

@Tool({ name: 'read-github-credential', description: 'Read the GitHub credential of the caller', inputSchema: {} })
class ReadGithubCredentialTool extends ToolContext {
  async execute() {
    const resolved = await this.authProviders.get('github');
    return { token: resolved?.credential.type === 'bearer' ? resolved.credential.token : null };
  }
}

@App({
  name: 'AuthProviders',
  description: 'Reads a credential of authProvidersVault',
  tools: [ReadGithubCredentialTool],
})
export class AuthProvidersApp {}
