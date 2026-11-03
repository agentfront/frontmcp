import { Tool, ToolContext, z } from '@frontmcp/sdk';

import { board } from './board.store';
import { VisitCounter } from './visit-counter.provider';

@Tool({ name: 'add-card', description: 'Add a card to the board', inputSchema: { title: z.string() } })
export class AddCardTool extends ToolContext {
  async execute({ title }: { title: string }) {
    const snapshot = await board.update((cards) => [...cards, title]);
    return { revision: snapshot.revision };
  }
}

@Tool({ name: 'record-visit', description: 'Record a visit and return the count', inputSchema: {} })
export class RecordVisitTool extends ToolContext {
  async execute() {
    return { visits: this.get(VisitCounter).record() };
  }
}
