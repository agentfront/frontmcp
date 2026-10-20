import { z } from '@frontmcp/lazy-zod';
import { Tool, ToolContext } from '@frontmcp/sdk';

import { notesStore } from '../data/notes.store';

const inputSchema = {};

const outputSchema = z.object({
  cleared: z.number(),
});

type ClearNotesInput = z.infer<z.ZodObject<typeof inputSchema>>;
type ClearNotesOutput = z.infer<typeof outputSchema>;

@Tool({
  name: 'clear-notes',
  description: 'Delete every note once the caller confirms',
  inputSchema,
  outputSchema,
})
export default class ClearNotesTool extends ToolContext {
  async execute(_input: ClearNotesInput): Promise<ClearNotesOutput> {
    const answer = await this.elicit(
      'Delete every note?',
      z.object({ confirmed: z.boolean().describe('Confirm deleting every note') }),
    );
    if (answer.status !== 'accept' || answer.content?.confirmed !== true) {
      return { cleared: 0 };
    }

    const cleared = notesStore.getAll().length;
    notesStore.clear();
    return { cleared };
  }
}
