import { Tool, ToolContext } from '@frontmcp/sdk';
import { z } from 'zod';

const inputSchema = { msg: z.string().default('ping') };

/**
 * Tool constrained to the CURRENT platform (process.platform).
 * This tool should always be visible since we match the running OS.
 */
@Tool({
  name: 'current_platform_tool',
  description: 'Tool matching the current OS platform',
  inputSchema,
  availableWhen: { platform: [process.platform] },
})
export default class CurrentPlatformTool extends ToolContext {
  async execute(input: { msg: string }) {
    return `Platform ${process.platform}: ${input.msg}`;
  }
}
