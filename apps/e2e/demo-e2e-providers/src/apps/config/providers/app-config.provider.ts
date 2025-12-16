import { Provider, ProviderScope } from '@frontmcp/sdk';

/**
 * Token for the AppConfigProvider
 */
export const APP_CONFIG_TOKEN = Symbol('APP_CONFIG');

/**
 * Application configuration interface
 */
export interface AppConfig {
  appName: string;
  version: string;
  environment: string;
  startedAt: Date;
  instanceId: string;
}

/**
 * GLOBAL scope provider - singleton shared across all requests.
 * Created once at server startup and reused for every request.
 */
@Provider({
  name: 'AppConfigProvider',
  scope: ProviderScope.GLOBAL,
})
export class AppConfigProvider implements AppConfig {
  readonly appName = 'Demo E2E Providers';
  readonly version = '0.1.0';
  readonly environment = process.env['NODE_ENV'] || 'development';
  readonly startedAt = new Date();
  readonly instanceId = `instance-${Math.random().toString(36).substring(2, 10)}`;

  getInfo(): AppConfig {
    return {
      appName: this.appName,
      version: this.version,
      environment: this.environment,
      startedAt: this.startedAt,
      instanceId: this.instanceId,
    };
  }
}
