import { Prompt, PromptContext } from '@frontmcp/sdk';

/**
 * Baseline prompt with no authorities — any authenticated caller may fetch it.
 */
@Prompt({
  name: 'public-hello',
  description: 'A public greeting prompt; no authorities.',
  arguments: [{ name: 'name', description: 'Who to greet', required: false }],
})
export default class PublicHelloPrompt extends PromptContext {
  async execute(args: Record<string, string>) {
    const who = args['name'] ?? 'world';
    return {
      description: 'Greeting',
      messages: [
        {
          role: 'user' as const,
          content: { type: 'text' as const, text: `Hello, ${who}!` },
        },
      ],
    };
  }
}
