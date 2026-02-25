import { Job, JobContext } from '@frontmcp/sdk';
import { z } from 'zod';

@Job({
  name: 'greet',
  description: 'Greet a person by name',
  inputSchema: {
    name: z.string().describe('Name of the person to greet'),
  },
  outputSchema: {
    message: z.string().describe('Greeting message'),
  },
  tags: ['demo', 'greeting'],
})
export default class GreetJob extends JobContext {
  async execute(input: { name: string }) {
    return { message: `Hello, ${input.name}!` };
  }
}
