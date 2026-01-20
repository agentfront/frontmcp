/**
 * GitHub App - Demonstrates upstream OAuth provider integration
 *
 * This app uses `this.orchestration.getToken('github')` to get the upstream
 * GitHub token and make API calls on behalf of the user.
 */
import { App } from '@frontmcp/sdk';
import { GitHubReposTool } from './tools/github-repos.tool';
import { GitHubUserTool } from './tools/github-user.tool';

@App({
  id: 'github',
  name: 'GitHub',
  description: 'GitHub integration using upstream OAuth provider',
  tools: [GitHubReposTool, GitHubUserTool],
})
export class GitHubApp {}
