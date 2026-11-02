import { App, FrontMcp, LogLevel, Tool, ToolContext } from '@frontmcp/sdk';

@Tool({ name: 'billing_imports', description: 'How many times the billing app module was imported', inputSchema: {} })
class BillingImportsTool extends ToolContext {
  async execute() {
    return { imports: (globalThis as { __lazyBillingImports?: number }).__lazyBillingImports ?? 0 };
  }
}

@App({ name: 'status', description: 'Reports what the server imported', tools: [BillingImportsTool] })
class StatusApp {}

const port = parseInt(process.env['PORT'] ?? '3104', 10);

@FrontMcp({
  info: { name: 'Demo E2E Lazy Apps', version: '0.1.0' },
  apps: [StatusApp, { id: 'billing', name: 'Billing', lazy: () => import('./billing.app.js') }],
  manifest: process.env['LAZY_APPS_MANIFEST'] || undefined,
  logging: { level: LogLevel.Warn },
  http: { port },
  auth: { mode: 'public', sessionTtl: 3600, anonymousScopes: ['anonymous'] },
  transport: { protocol: { json: true, legacy: true, strictSession: false } },
})
export class LazyAppsServer {}
