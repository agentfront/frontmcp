import { Tool, ToolContext } from '@frontmcp/sdk';
import { z } from 'zod';

const inputSchema = { msg: z.string().default('ping') };

/**
 * Tool constrained to a platform that does NOT match the running OS.
 * Uses 'freebsd' which is very unlikely to be the test runner's platform.
 * This tool should NEVER appear in discovery.
 */
@Tool({
  name: 'impossible_platform_tool',
  description: 'Tool for a non-matching platform (should be filtered)',
  inputSchema,
  availableWhen: { platform: ['freebsd'] },
})
export default class ImpossiblePlatformTool extends ToolContext {
  async execute(input: { msg: string }) {
    return `freebsd: ${input.msg}`;
  }
}
