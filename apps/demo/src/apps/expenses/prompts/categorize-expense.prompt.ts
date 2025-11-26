import { prompt } from '@frontmcp/sdk';

/**
 * Function-style prompt for categorizing expenses
 */
export default prompt({
  name: 'categorize-expense',
  description: 'Help categorize an expense based on its description and amount',
  arguments: [
    {
      name: 'description',
      description: 'Description of the expense',
      required: true,
    },
    {
      name: 'amount',
      description: 'Amount of the expense',
      required: true,
    },
    {
      name: 'vendor',
      description: 'Vendor or merchant name',
      required: false,
    },
  ],
})((args) => {
  const { description, amount, vendor } = args ?? {};

  const vendorInfo = vendor ? `\nVendor: ${vendor}` : '';

  return {
    description: 'Categorize an expense',
    messages: [
      {
        role: 'user' as const,
        content: {
          type: 'text' as const,
          text: `Please categorize the following expense:

Description: ${description}
Amount: $${amount}${vendorInfo}

Suggest the most appropriate category from:
- Travel
- Meals & Entertainment
- Office Supplies
- Software & Subscriptions
- Professional Services
- Marketing
- Equipment
- Utilities
- Other

Also provide:
1. Confidence level (High/Medium/Low)
2. Alternative category if applicable
3. Any compliance flags (e.g., requires receipt, needs approval)`,
        },
      },
    ],
  };
});
