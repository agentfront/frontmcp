import { Prompt, PromptContext, type GetPromptResult } from '@frontmcp/sdk';

@Prompt({
  name: 'greeting',
  description: 'Produces a greeting for the supplied subject',
  arguments: [{ name: 'subject', description: 'Who to greet', required: false }],
})
export default class GreetingPrompt extends PromptContext {
  async execute(args: Record<string, string>): Promise<GetPromptResult> {
    const subject = args['subject'] ?? 'world';
    return {
      description: `Greeting for ${subject}`,
      messages: [
        {
          role: 'user',
          content: { type: 'text', text: `Say hello to ${subject}.` },
        },
      ],
    };
  }
}
