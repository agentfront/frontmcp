import { z } from '@frontmcp/lazy-zod';
import { Tool, ToolContext, type ToolType } from '@frontmcp/sdk';

import { runLog } from '../data/run-log';

const outputSchema = z.object({ ran: z.array(z.string()) });

/** A tool that answers the hooks that ran before it, in the order they ran. */
export function ranHooksTool(name: string): ToolType {
  @Tool({ name, description: 'The hooks that ran before this call, in order', inputSchema: {}, outputSchema })
  class RanHooksTool extends ToolContext {
    async execute(): Promise<z.infer<typeof outputSchema>> {
      return { ran: runLog.take() };
    }
  }
  return RanHooksTool;
}
