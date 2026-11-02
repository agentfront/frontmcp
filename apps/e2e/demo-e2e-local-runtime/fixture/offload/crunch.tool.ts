import { join } from 'node:path';

import { z } from '@frontmcp/lazy-zod';
import { Tool, ToolContext } from '@frontmcp/sdk';

import type { spin } from './spin';

@Tool({
  name: 'crunch',
  description: 'Spins a worker thread for a while',
  inputSchema: { ms: z.number().int().positive() },
})
export class CrunchTool extends ToolContext {
  async execute({ ms }: { ms: number }) {
    const turns = await this.offload<typeof spin>({ module: join(__dirname, 'spin.ts'), export: 'spin' }, [ms]);
    return { turns };
  }
}
