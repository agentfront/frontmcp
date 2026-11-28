import { FrontMcp, LogLevel } from '@frontmcp/sdk';

import { FeaturesApp } from './apps/features';
import { invoicesEnabled } from './apps/features/reviews.signal';

const port = parseInt(process.env['PORT'] ?? '3114', 10);

@FrontMcp({
  info: { name: 'Demo E2E Live Surface', version: '0.1.0' },
  apps: [FeaturesApp],
  // One feature map for the server: every `invoice_` entry follows the invoices feature
  enabled: (entry) => (entry.name.startsWith('invoice_') ? invoicesEnabled : undefined),
  logging: { level: LogLevel.Warn },
  http: { port },
  auth: {
    mode: 'public',
    sessionTtl: 3600,
    anonymousScopes: ['anonymous'],
  },
  transport: {
    protocol: { json: true, legacy: true, strictSession: false },
  },
})
export default class Server {}
