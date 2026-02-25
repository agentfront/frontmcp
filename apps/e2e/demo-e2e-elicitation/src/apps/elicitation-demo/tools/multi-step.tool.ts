import { Tool, ToolContext } from '@frontmcp/sdk';
import { z } from 'zod';

const inputSchema = {};

const outputSchema = z.object({
  message: z.string(),
  name: z.string().optional(),
  color: z.string().optional(),
  completedSteps: z.number(),
});

type Input = z.input<z.ZodObject<typeof inputSchema>>;
type Output = z.infer<typeof outputSchema>;

@Tool({
  name: 'multi-step-wizard',
  description:
    'Demonstrates multiple sequential elicitations. A wizard that collects name and color preference in two steps.',
  inputSchema,
  outputSchema,
})
export default class MultiStepWizardTool extends ToolContext<typeof inputSchema, typeof outputSchema> {
  async execute(_input: Input): Promise<Output> {
    // Step 1: Get name
    const step1 = await this.elicit(
      'Step 1: What is your name?',
      z.object({
        name: z.string().describe('Your name'),
      }),
    );

    if (step1.status !== 'accept' || !step1.content?.name) {
      return {
        message: 'Wizard cancelled at step 1',
        completedSteps: 0,
      };
    }

    const name = step1.content.name;

    // Step 2: Get preference
    const step2 = await this.elicit(
      `Hello ${name}! Step 2: Choose a color`,
      z.object({
        color: z.enum(['red', 'green', 'blue']).describe('Favorite color'),
      }),
    );

    if (step2.status !== 'accept' || !step2.content?.color) {
      return {
        message: 'Wizard cancelled at step 2',
        name,
        completedSteps: 1,
      };
    }

    return {
      message: `Welcome ${name}! Your favorite color is ${step2.content.color}`,
      name,
      color: step2.content.color,
      completedSteps: 2,
    };
  }
}
