import { resource } from '@frontmcp/sdk';

/**
 * Function-style static resource for expense categories
 */
export default resource({
  name: 'expense-categories',
  uri: 'expense://categories',
  description: 'List of available expense categories',
  mimeType: 'application/json',
})((uri) => {
  const categories = [
    {
      id: 'travel',
      name: 'Travel',
      description: 'Business travel expenses including flights, hotels, and transportation',
      icon: 'plane',
      requiresApproval: true,
      maxAmount: 5000,
    },
    {
      id: 'meals',
      name: 'Meals & Entertainment',
      description: 'Business meals, client entertainment, and team events',
      icon: 'utensils',
      requiresApproval: false,
      maxAmount: 200,
    },
    {
      id: 'office',
      name: 'Office Supplies',
      description: 'Office supplies, stationery, and small equipment',
      icon: 'pencil',
      requiresApproval: false,
      maxAmount: 100,
    },
    {
      id: 'software',
      name: 'Software & Subscriptions',
      description: 'Software licenses, SaaS subscriptions, and digital tools',
      icon: 'laptop',
      requiresApproval: true,
      maxAmount: 1000,
    },
    {
      id: 'professional',
      name: 'Professional Services',
      description: 'Consulting, legal, and other professional services',
      icon: 'briefcase',
      requiresApproval: true,
      maxAmount: 10000,
    },
    {
      id: 'equipment',
      name: 'Equipment',
      description: 'Hardware, furniture, and office equipment',
      icon: 'desktop',
      requiresApproval: true,
      maxAmount: 2500,
    },
    {
      id: 'other',
      name: 'Other',
      description: 'Miscellaneous expenses not covered by other categories',
      icon: 'question',
      requiresApproval: true,
      maxAmount: 500,
    },
  ];

  return {
    contents: [
      {
        uri,
        mimeType: 'application/json',
        text: JSON.stringify(categories, null, 2),
      },
    ],
  };
});
