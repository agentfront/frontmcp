import { Job, JobContext } from '@frontmcp/sdk';
import { z } from 'zod';

@Job({
  name: 'analyze-text',
  description: 'Analyze text and return statistics',
  inputSchema: {
    text: z.string().describe('Text to analyze'),
  },
  outputSchema: {
    wordCount: z.number(),
    charCount: z.number(),
    summary: z.string(),
  },
  tags: ['demo', 'analysis'],
})
export default class AnalyzeTextJob extends JobContext {
  async execute(input: { text: string }) {
    const words = input.text.trim().split(/\s+/).filter(Boolean);
    return {
      wordCount: words.length,
      charCount: input.text.length,
      summary: `Text has ${words.length} words and ${input.text.length} characters`,
    };
  }
}
