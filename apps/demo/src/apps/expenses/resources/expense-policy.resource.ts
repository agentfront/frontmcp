import { Resource, ResourceContext } from '@frontmcp/sdk';
import { ReadResourceResult } from '@modelcontextprotocol/sdk/types.js';

@Resource({
  name: 'expense-policy',
  uri: 'expense://policy/current',
  description: 'Current company expense policy document',
  mimeType: 'application/json',
})
export default class ExpensePolicyResource extends ResourceContext {
  async execute(uri: string): Promise<ReadResourceResult> {
    const policy = {
      version: '2.1.0',
      effectiveDate: '2024-01-01',
      lastUpdated: '2024-06-15',
      categories: {
        travel: {
          dailyLimit: 500,
          requiresPreApproval: true,
          approvalThreshold: 1000,
        },
        meals: {
          dailyLimit: 75,
          requiresReceipt: true,
          minimumReceiptAmount: 25,
        },
        office: {
          monthlyLimit: 200,
          requiresPreApproval: false,
        },
        software: {
          requiresITApproval: true,
          annualBudget: 5000,
        },
      },
      approvalLevels: [
        { threshold: 100, approver: 'manager' },
        { threshold: 500, approver: 'director' },
        { threshold: 5000, approver: 'vp' },
        { threshold: Infinity, approver: 'cfo' },
      ],
      submissionDeadline: 'End of month + 5 business days',
      receiptRequirements: {
        required: true,
        minimumAmount: 25,
        acceptedFormats: ['PDF', 'PNG', 'JPG'],
      },
    };

    return {
      contents: [
        {
          uri,
          mimeType: 'application/json',
          text: JSON.stringify(policy, null, 2),
        },
      ],
    };
  }
}
