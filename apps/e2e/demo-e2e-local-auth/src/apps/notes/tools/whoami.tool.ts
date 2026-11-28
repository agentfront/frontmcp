import { Tool, ToolContext } from '@frontmcp/sdk';

/** Who the caller's token speaks for, and the claims that tell a person from a machine. */
@Tool({
  name: 'whoami',
  description: "Returns the caller's principal and its auth_time, azp and client_id claims",
  inputSchema: {},
})
export default class WhoAmITool extends ToolContext {
  async execute() {
    const { auth_time, azp, client_id } = this.auth.claims;
    return { principal: this.auth.principal, claims: { auth_time, azp, client_id } };
  }
}
