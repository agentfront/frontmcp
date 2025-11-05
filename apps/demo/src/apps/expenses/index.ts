import {App} from '@frontmcp/sdk';

import {ExpenseConfigProvider,} from './provders';
import CachePlugin from '@frontmcp/plugins/cache';
import OpenapiAdapter from "@frontmcp/adapters/openapi";
import CreateExpenseTool from './tools/create-expense.tool';
import GetExpenseTool from './tools/get-expense-fun.tool';

@App({
  id: 'expense',
  name: 'Expense MCP app',
  providers: [
    ExpenseConfigProvider,
  ],
  adapters: [OpenapiAdapter.init({
    name: 'backend:api',
    url: 'https://frontmcp-test.proxy.beeceptor.com/openapi.json',
  })],
  plugins: [
    CachePlugin
  ],
  tools: [
    CreateExpenseTool,
    GetExpenseTool
  ],
})
export default class ExpenseMcpApp {
}





