import 'reflect-metadata';

import { Prompt, PromptContext } from '@frontmcp/sdk';

@Prompt({ name: 'daily-standup' })
export class DailyStandup extends PromptContext {
  async execute() {
    return {
      messages: [{ role: 'user' as const, content: { type: 'text' as const, text: 'What did you do yesterday?' } }],
    };
  }
}

@Prompt({ name: 'summarize', arguments: [{ name: 'text', required: true }] })
export class Summarize extends PromptContext {
  async execute(args: Record<string, string>) {
    return `Summarize this: ${args['text']}`;
  }
}

@Prompt({ name: 'pair', arguments: [] })
export class Pair extends PromptContext {
  async execute(args: Record<string, string>) {
    return [
      { role: 'user', content: { type: 'text', text: 'First message' } },
      { role: 'assistant', content: { type: 'text', text: 'Response template' } },
    ];
  }
}

@Prompt({ name: 'task', arguments: [{ name: 'text' }] })
export class Task extends PromptContext {
  async execute(args: Record<string, string>) {
    return { task: 'summarize', input: args['text'], options: { length: 'short' } };
  }
}

@Prompt({ name: 'review', arguments: [{ name: 'code', required: true }] })
export class Review extends PromptContext {
  async execute(args: Record<string, string>) {
    return {
      description: 'A customized prompt for code review',
      messages: [{ role: 'user', content: { type: 'text', text: `Review this code:\n\n${args['code']}` } }],
    };
  }
}
