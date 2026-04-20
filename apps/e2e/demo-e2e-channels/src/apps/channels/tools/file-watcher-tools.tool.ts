import { z } from '@frontmcp/lazy-zod';
import { Tool, ToolContext } from '@frontmcp/sdk';

import { simulateFileEvent } from '../channels/file-watcher.channel';

const inputSchema = {
  file: z.string().describe('File path'),
  event: z.string().describe('Event type (change, create, delete)'),
  content: z.string().optional().describe('Optional new content'),
};

@Tool({
  name: 'simulate-file-event',
  description: 'Simulate a file system event for the file-watcher channel',
  inputSchema,
})
export default class SimulateFileEventTool extends ToolContext {
  async execute(input: { file: string; event: string; content?: string }) {
    simulateFileEvent(input.file, input.event, input.content);
    return { simulated: true, file: input.file, event: input.event };
  }
}
