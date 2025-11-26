import { ResourceTemplate, ResourceContext } from '@frontmcp/sdk';
import { ReadResourceResult } from '@modelcontextprotocol/sdk/types.js';

type ExpenseParams = {
  expenseId: string;
};

@ResourceTemplate({
  name: 'expense-by-id',
  uriTemplate: 'expense://expenses/{expenseId}',
  description: 'Get expense details by ID',
  mimeType: 'application/json',
})
export default class ExpenseByIdResource extends ResourceContext<ExpenseParams> {
  async execute(uri: string, params: ExpenseParams): Promise<ReadResourceResult> {
    const { expenseId } = params;

    // Mock expense data - in real app, would fetch from database
    const expense = {
      id: expenseId,
      description: `Business expense #${expenseId}`,
      amount: Math.floor(Math.random() * 500) + 50,
      currency: 'USD',
      category: 'Travel',
      status: 'approved',
      submittedBy: 'john.doe@company.com',
      submittedAt: new Date().toISOString(),
      approvedBy: 'manager@company.com',
      approvedAt: new Date().toISOString(),
      receipt: {
        url: `https://receipts.company.com/${expenseId}.pdf`,
        uploadedAt: new Date().toISOString(),
      },
      metadata: {
        project: 'Q4-Marketing',
        costCenter: 'CC-1001',
      },
    };

    return {
      contents: [
        {
          uri,
          mimeType: 'application/json',
          text: JSON.stringify(expense, null, 2),
        },
      ],
    };
  }
}
