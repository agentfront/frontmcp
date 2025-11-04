import {App} from '@frontmcp/sdk';

import CreateExpenseTool from './tools/create-expense.tool';
import {ExpenseConfigProvider,} from './provders';
import CachePlugin from '@frontmcp/plugins/cache';
// import {createRedisProvider} from "../../expense-mcp/provders/redis.provider";
// import {SessionRedisProvider} from "../../expense-mcp/provders";
import OpenapiAdapter from "@frontmcp/adapters/openapi";

@App({
  id: 'expense',
  name: 'Expense MCP app',
  providers: [
    ExpenseConfigProvider,
    // createRedisProvider,
    // SessionRedisProvider
  ],
  adapters: [OpenapiAdapter.init({
    name: 'mock-expense-server',
    url: 'https://frontmcp-test.proxy.beeceptor.com/openapi.json',
  })],
  plugins: [
    CachePlugin
  ],
  tools: [CreateExpenseTool],
})
export default class ExpenseMcpApp {
}





