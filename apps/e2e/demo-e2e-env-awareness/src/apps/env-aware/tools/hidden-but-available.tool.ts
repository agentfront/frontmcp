import { Tool, ToolContext } from '@frontmcp/sdk';
import { z } from 'zod';

const inputSchema = { msg: z.string().default('ping') };

/**
 * Tool that is hidden from discovery but available on this platform.
 * Tests interaction between hideFromDiscovery and availableWhen.
 * Should NOT appear in tools/list, but should be callable.
 */
@Tool({
  name: 'hidden_but_available',
  description: 'Hidden tool on current platform',
  inputSchema,
  hideFromDiscovery: true,
  availableWhen: { platform: [process.platform] },
})
export default class HiddenButAvailableTool extends ToolContext {
  async execute(input: { msg: string }) {
    return `hidden but available: ${input.msg}`;
  }
}
