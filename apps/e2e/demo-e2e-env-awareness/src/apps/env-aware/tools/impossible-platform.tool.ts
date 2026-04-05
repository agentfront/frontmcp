import { Tool, ToolContext } from '@frontmcp/sdk';
import { z } from 'zod';

const inputSchema = { msg: z.string().default('ping') };

// Deterministically pick a platform that is NOT the current one
const NON_MATCHING_PLATFORMS = ['darwin', 'linux', 'win32', 'freebsd', 'sunos'];
const nonMatchingPlatform = NON_MATCHING_PLATFORMS.find((p) => p !== process.platform) ?? 'freebsd';

/**
 * Tool constrained to a platform that does NOT match the running OS.
 * Deterministically selects a different platform from the current one.
 * This tool should NEVER appear in discovery.
 */
@Tool({
  name: 'impossible_platform_tool',
  description: 'Tool for a non-matching platform (should be filtered)',
  inputSchema,
  availableWhen: { platform: [nonMatchingPlatform] },
})
export default class ImpossiblePlatformTool extends ToolContext {
  async execute(input: { msg: string }) {
    return `freebsd: ${input.msg}`;
  }
}
