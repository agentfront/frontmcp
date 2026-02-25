import { Workflow } from '@frontmcp/sdk';

@Workflow({
  name: 'greet-and-analyze',
  description: 'Greet a person then analyze the greeting',
  trigger: 'manual',
  steps: [
    {
      id: 'greet',
      jobName: 'greet',
      input: { name: 'World' },
    },
    {
      id: 'analyze',
      jobName: 'analyze-text',
      dependsOn: ['greet'],
      input: (steps) => {
        const greetResult = steps.get('greet');
        if (!greetResult) throw new Error('greet step outputs unavailable');
        return { text: (greetResult.outputs as { message: string }).message };
      },
    },
  ],
  tags: ['demo'],
})
export default class GreetAndAnalyzeWorkflow {}
