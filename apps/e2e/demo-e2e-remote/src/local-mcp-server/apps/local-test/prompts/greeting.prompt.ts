import { Prompt, PromptContext, GetPromptResult } from '@frontmcp/sdk';

@Prompt({
  name: 'greeting',
  description: 'Generate a greeting prompt with the given name',
  arguments: [
    { name: 'name', description: 'Name to greet', required: true },
    { name: 'style', description: 'Greeting style (formal or casual)', required: false },
  ],
})
export default class GreetingPrompt extends PromptContext {
  async execute(args: Record<string, string>): Promise<GetPromptResult> {
    const name = args['name'] || 'World';
    const style = args['style'] || 'casual';

    let greeting: string;
    if (style === 'formal') {
      greeting = `Good day, ${name}. How may I assist you today?`;
    } else {
      greeting = `Hey ${name}! What's up?`;
    }

    return {
      messages: [
        {
          role: 'assistant',
          content: {
            type: 'text',
            text: greeting,
          },
        },
      ],
      description: `A ${style} greeting for ${name}`,
    };
  }
}
