import {App} from '@frontmcp/sdk';

import {ExpenseConfigProvider,} from './provders';
import {CachePlugin} from '@frontmcp/plugins';
import {OpenapiAdapter} from "@frontmcp/adapters";
import CreateExpenseTool from './tools/create-expense.tool';
import GetExpenseTool from './tools/get-expense-fun.tool';
import {AddTool} from "./tools/add.tool";

@App({
  id: 'expense',
  name: 'Expense MCP app',
  providers: [
    ExpenseConfigProvider,
  ],
  adapters: [OpenapiAdapter.init({
    name: 'backend:api',
    url: 'https://frontmcp-test.proxy.beeceptor.com/openapi.json',
    baseUrl: 'https://frontmcp-test.proxy.beeceptor.com'
  })],
  plugins: [
    CachePlugin.init({
      type: 'redis',
      config: {
        host: 'localhost',
        port: 6379,
      }
    })
  ],
  tools: [
    AddTool,
    CreateExpenseTool,
    GetExpenseTool
  ],
})
export default class ExpenseMcpApp {
}





