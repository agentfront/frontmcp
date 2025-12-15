import { Prompt, PromptContext, GetPromptResult } from '@frontmcp/sdk';

@Prompt({
  name: 'product-recommendation',
  description: 'Generate product recommendations based on preferences',
  arguments: [
    {
      name: 'category',
      description: 'Product category to recommend from',
      required: false,
    },
    {
      name: 'budget',
      description: 'Maximum budget for recommendations',
      required: false,
    },
  ],
})
export default class ProductRecommendationPrompt extends PromptContext {
  async execute(args: Record<string, string>): Promise<GetPromptResult> {
    const category = args.category || 'all categories';
    const budget = args.budget ? `under $${args.budget}` : 'any price range';

    return {
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text: `Please recommend products from ${category} ${budget}. Consider quality, value, and customer reviews.`,
          },
        },
      ],
      description: `Product recommendations for ${category}`,
    };
  }
}
