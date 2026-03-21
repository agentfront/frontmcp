/**
 * @file resources-only-package.ts
 * @description ESM fixture with only @Resource decorated classes as named exports.
 * The ESM loader detects decorated classes automatically — no manifest needed.
 */
import 'reflect-metadata';
import { Resource, ResourceContext } from '@frontmcp/sdk';

@Resource({
  name: 'config',
  uri: 'esm://config',
  mimeType: 'application/json',
  description: 'Application configuration',
})
export class ConfigResource extends ResourceContext {
  async execute(uri: string) {
    return {
      contents: [
        {
          uri,
          text: JSON.stringify({ env: 'test', version: '1.0.0' }),
        },
      ],
    };
  }
}

@Resource({
  name: 'health',
  uri: 'esm://health',
  mimeType: 'application/json',
  description: 'Health check endpoint',
})
export class HealthResource extends ResourceContext {
  async execute(uri: string) {
    return {
      contents: [
        {
          uri,
          text: JSON.stringify({ healthy: true, uptime: 12345 }),
        },
      ],
    };
  }
}
