import { FrontMcp, LogLevel } from '@frontmcp/sdk';
import ExpenseMcpApp from './apps/expenses';
import CalculatorMcpApp from './apps/calculator';
import EmployeeTimeMcpApp from './apps/employee-time';

@FrontMcp({
  info: { name: 'Demo 🚀', version: '0.1.0' },
  apps: [ExpenseMcpApp, CalculatorMcpApp, EmployeeTimeMcpApp],
  logging: { level: LogLevel.VERBOSE },
  http: {
    port: 3002,
  },
  auth: {
    mode: 'transparent',
    remote: {
      provider: process.env['IDP_PROVIDER_URL'] || 'https://sample-app.frontegg.com',
      name: 'frontegg',
      dcrEnabled: false,
    },
    expectedAudience: process.env['IDP_EXPECTED_AUDIENCE'] || 'https://sample-app.frontegg.com',
    requiredScopes: [],
    allowAnonymous: true, // Allow anonymous access for demo
    anonymousScopes: ['anonymous'],
  },
})
export default class Server {}
