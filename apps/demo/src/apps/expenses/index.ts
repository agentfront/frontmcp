import { OpenapiAdapter } from '@frontmcp/adapters';
import { CachePlugin } from '@frontmcp/plugins';
import { App } from '@frontmcp/sdk';

import AuthorizationPlugin from './plugins/authorization.plugin';
// Prompts
import { CategorizeExpensePrompt, ExpenseReportPrompt } from './prompts';
import { ExpenseConfigProvider } from './providers';
// Resources
import { ExpenseByIdResource, ExpenseCategoriesResource, ExpensePolicyResource } from './resources';
import AddTool from './tools/add.tool';
import CreateExpenseTool from './tools/create-expense.tool';
import GetExpenseTool from './tools/get-expense-fun.tool';

@App({
  id: 'expense',
  name: 'Expense MCP app',
  providers: [ExpenseConfigProvider],
  adapters: [
    OpenapiAdapter.init({
      name: 'backend:api',
      url: 'https://frontmcp-test.proxy.beeceptor.com/openapi.json',
      baseUrl: 'https://frontmcp-test.proxy.beeceptor.com',
    }),
  ],
  plugins: [
    AuthorizationPlugin,
    CachePlugin.init({
      type: 'redis',
      config: {
        host: 'localhost',
        port: 6379,
      },
    }),
  ],
  tools: [AddTool, CreateExpenseTool, GetExpenseTool],
  prompts: [ExpenseReportPrompt, CategorizeExpensePrompt],
  resources: [ExpensePolicyResource, ExpenseByIdResource, ExpenseCategoriesResource],
})
export default class ExpenseMcpApp {}
