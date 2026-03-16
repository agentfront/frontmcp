/**
 * @file validate-remote-url.ts
 * @description Shared URL validation for .remote() factory methods.
 */

import { isValidMcpUri } from '@frontmcp/utils';

/**
 * Validate that a remote URL has a valid URI scheme per RFC 3986.
 * Used by all .remote() factory methods (Tool, Resource, Prompt, Agent, Skill, Job).
 *
 * @param url - The URL to validate
 * @throws Error if the URL does not have a valid scheme
 */
export function validateRemoteUrl(url: string): void {
  if (!isValidMcpUri(url)) {
    throw new Error(`Invalid remote URL "${url}": URI must have a valid scheme (e.g., file://, https://, custom://)`);
  }
}
