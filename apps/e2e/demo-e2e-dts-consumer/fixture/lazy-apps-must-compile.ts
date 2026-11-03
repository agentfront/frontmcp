import 'reflect-metadata';

import {
  App,
  fileSignal,
  FrontMcp,
  LazyAppConfigurationError,
  LazyAppLoadError,
  type FrontMcpConfigInput,
  type LazyAppMetadata,
  type ServerManifest,
} from '@frontmcp/sdk';

@App({ id: 'billing', name: 'Billing' })
export class BillingApp {}

export const billing: LazyAppMetadata = {
  id: 'billing',
  name: 'Billing',
  description: 'Charges and invoices',
  lazy: () => Promise.resolve({ BillingApp }),
  enabled: fileSignal('./features.json', 'billing'),
};

@FrontMcp({
  info: { name: 'dts-lazy-apps', version: '1.0.0' },
  apps: [BillingApp, billing, { name: 'Reports', lazy: () => Promise.resolve(BillingApp), enabled: false }],
  manifest: './frontmcp.manifest.json',
  serve: false,
})
export class LazyServer {}

export function withManifest(manifest: ServerManifest): FrontMcpConfigInput {
  return { info: { name: 'worker', version: '1.0.0' }, apps: [billing], manifest };
}

export function describeFailure(error: unknown): string {
  if (error instanceof LazyAppLoadError) return `${error.appName} retryable=${error.retryable}`;
  return error instanceof LazyAppConfigurationError ? error.message : 'other';
}

export const notAFunction: LazyAppMetadata = {
  name: 'Billing',
  // @ts-expect-error lazy is a function that imports the app
  lazy: './billing.app',
};
