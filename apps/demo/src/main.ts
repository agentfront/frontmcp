import ExpenseMcpApp from './apps/expenses';
import {FrontMcp, LogLevel} from '@frontmcp/sdk';

@FrontMcp({
  info: {
    name: 'Expense MCP Server',
    version: '1.0.0',
  },
  apps: [
    ExpenseMcpApp,
  ],
  http: {
    port: 3001,
  },
  logging: {
    level: LogLevel.VERBOSE,
  },
  auth: {
    type: 'remote',
    name: 'frontegg',
    baseUrl: 'https://autheu.davidantoon.me',
  },
})
export default class MyMcpSever {
}