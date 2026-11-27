import { z } from '@frontmcp/lazy-zod';
import { MaterializedResourceContext, Resource, resourceStore, Tool, ToolContext } from '@frontmcp/sdk';

const pins: string[] = [];
let runs = 0;

/** Computed in this process from its pins; `pin_note` and `refresh_summary` mark it dirty. */
export const summary = resourceStore().key('summary', {
  produce: () => {
    runs++;
    return { pinned: pins.length, latest: pins.at(-1) ?? null };
  },
  minIntervalMs: 0,
});

@Resource({
  name: 'board-summary',
  uri: 'board://summary',
  description: 'A summary the server computes from its pins',
  mimeType: 'application/json',
  from: summary,
})
export class BoardSummaryResource extends MaterializedResourceContext {}

@Tool({ name: 'pin_note', description: 'Pin a note, which changes the summary', inputSchema: { note: z.string() } })
export class PinNoteTool extends ToolContext {
  async execute({ note }: { note: string }) {
    pins.push(note);
    summary.markDirty();
    return { pinned: pins.length };
  }
}

@Tool({ name: 'refresh_summary', description: 'Mark the summary dirty without changing it', inputSchema: {} })
export class RefreshSummaryTool extends ToolContext {
  async execute() {
    summary.markDirty();
    return { refreshed: true };
  }
}

@Tool({ name: 'summary_runs', description: 'How many times the summary was computed', inputSchema: {} })
export class SummaryRunsTool extends ToolContext {
  async execute() {
    return { runs };
  }
}
