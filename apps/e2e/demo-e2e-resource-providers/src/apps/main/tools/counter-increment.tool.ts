import { Tool, ToolContext } from '@frontmcp/sdk';
import { z } from 'zod';

@Tool({
  name: 'counter_increment',
  description: 'Increment the counter using plugin context extension (this.counter)',
  inputSchema: {},
  outputSchema: {
    count: z.number(),
    counterInstanceId: z.string(),
  },
})
export default class CounterIncrementTool extends ToolContext {
  async execute(_input: Record<string, never>) {
    const newCount = this.counter.increment();
    return {
      count: newCount,
      counterInstanceId: this.counter.getInstanceId(),
    };
  }
}
