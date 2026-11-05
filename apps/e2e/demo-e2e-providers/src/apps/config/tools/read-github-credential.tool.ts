import { z } from '@frontmcp/lazy-zod';
import { Tool, ToolContext } from '@frontmcp/sdk';

const outputSchema = z.object({
  token: z.string().nullable(),
  authorization: z.string().nullable(),
});

@Tool({
  name: 'read-github-credential',
  description: "Read the server's GitHub credential through this.authProviders",
  inputSchema: {},
  outputSchema,
  authProviders: ['github'],
})
export default class ReadGithubCredentialTool extends ToolContext {
  async execute(): Promise<z.infer<typeof outputSchema>> {
    const resolved = await this.authProviders.get('github');
    const headers = await this.authProviders.headers('github');
    return {
      token: resolved?.credential.type === 'bearer' ? resolved.credential.token : null,
      authorization: headers['Authorization'] ?? null,
    };
  }
}
