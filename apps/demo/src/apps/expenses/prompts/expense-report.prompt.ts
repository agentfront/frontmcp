import { Prompt, PromptContext } from '@frontmcp/sdk';

@Prompt({
  name: 'expense-report',
  description: 'Generate an expense report summary for a given time period',
  arguments: [
    {
      name: 'startDate',
      description: 'Start date for the report (YYYY-MM-DD)',
      required: true,
    },
    {
      name: 'endDate',
      description: 'End date for the report (YYYY-MM-DD)',
      required: true,
    },
    {
      name: 'category',
      description: 'Optional expense category filter',
      required: false,
    },
  ],
})
export default class ExpenseReportPrompt extends PromptContext {
  async execute(args: Record<string, string>) {
    const { startDate, endDate, category } = args;

    const categoryFilter = category ? ` for category "${category}"` : '';

    return {
      description: `Expense report from ${startDate} to ${endDate}${categoryFilter}`,
      messages: [
        {
          role: 'user' as const,
          content: {
            type: 'text' as const,
            text: `Please generate an expense report summary for the period from ${startDate} to ${endDate}${categoryFilter}.

Include the following information:
1. Total expenses for the period
2. Breakdown by category
3. Top 5 largest expenses
4. Comparison with previous period (if available)
5. Any anomalies or unusual spending patterns

Format the report in a clear, professional manner suitable for management review.`,
          },
        },
      ],
    };
  }
}
