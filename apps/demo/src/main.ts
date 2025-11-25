import { FrontMcp, LogLevel } from '@frontmcp/sdk';
import ExpenseMcpApp from './apps/expenses';
import CalculatorMcpApp from './apps/calculator';
import EmployeeTimeMcpApp from './apps/employee-time';
import CrmMcpApp from './apps/crm';

@FrontMcp({
  info: { name: 'Demo 🚀', version: '0.1.0' },
  // apps: [ExpenseMcpApp, CalculatorMcpApp, EmployeeTimeMcpApp, CrmMcpApp],
  apps: [CrmMcpApp],
  logging: { level: LogLevel.VERBOSE },
  http: {
    port: 3002,
  },
  auth: {
    type: 'remote',
    name: 'frontegg',
    baseUrl: 'https://sample-app.frontegg.com',
  },
})
export default class Server {}
