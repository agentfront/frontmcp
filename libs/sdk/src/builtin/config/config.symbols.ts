import { Reference } from '../../common';
import type { ConfigPluginOptions } from './config.types';

/**
 * DI token for the plugin configuration.
 */
export const ConfigPluginConfigToken: Reference<ConfigPluginOptions> = Symbol(
  'plugin:config:options',
) as Reference<ConfigPluginOptions>;

// Note: ConfigService class itself is used as the DI token.
// Import ConfigService from './providers/config.service' to use as the injection token.
// This allows NestJS-style injection: constructor(config: ConfigService)
