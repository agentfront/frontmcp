import {Provider, ProviderScope} from '@frontmcp/sdk';

@Provider({
  name: 'expense-config',
  description: 'Expense MCP configuration provider',
  scope: ProviderScope.GLOBAL,
})
export default class ExpenseConfigProvider {
  config = {
    redis: {
      host: 'localhost',
      port: 6379,
    },
    cache: {
      defaultTTL: 50,
    },
  } as const;

  constructor() {
    console.log('ExpenseConfigProvider');
  }

  get<T extends keyof typeof this.config>(key: T): typeof this.config[T] {
    return this.config[key];
  }
}
