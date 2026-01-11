import { DynamicPlugin, Plugin, ProviderType, ProviderScope } from '../../common';
import type { ConfigPluginOptions, ConfigPluginOptionsInput } from './config.types';
import { ConfigPluginConfigToken } from './config.symbols';
import { ConfigService } from './providers/config.service';
import { loadConfig } from './providers/config-loader';
import { loadEnvFiles, populateProcessEnv } from './providers/env-loader';

/**
 * ConfigPlugin - Environment variable management for FrontMCP.
 *
 * Provides typed access to configuration with convict-style nested path support.
 * Loads from .env files, YAML config files, and validates with Zod schemas.
 *
 * @example
 * ```typescript
 * // Basic usage (flat env vars)
 * @FrontMcp({
 *   plugins: [
 *     ConfigPlugin.init({
 *       envPath: '.env',
 *       localEnvPath: '.env.local',
 *     }),
 *   ],
 * })
 * class MyServer {}
 *
 * // With typed schema (convict-style)
 * import { z } from 'zod';
 *
 * const configSchema = z.object({
 *   database: z.object({
 *     url: z.string(),
 *     port: z.number().default(5432),
 *   }),
 *   debug: z.boolean().default(false),
 * });
 *
 * @FrontMcp({
 *   plugins: [
 *     ConfigPlugin.init({
 *       schema: configSchema,
 *       basePath: __dirname,
 *     }),
 *   ],
 * })
 * class ProductionServer {}
 *
 * // In a tool:
 * class MyTool extends ToolContext {
 *   async execute(input) {
 *     // Typed access with dot notation
 *     const dbUrl = this.config.getOrThrow('database.url');
 *     const port = this.config.get('database.port', 5432);
 *     const debug = this.config.get('debug');
 *   }
 * }
 * ```
 */
@Plugin({
  name: 'config',
  description: 'Environment variable management with typed access',
  providers: [],
  contextExtensions: [
    {
      property: 'config',
      token: ConfigService,
      errorMessage: 'ConfigPlugin is not installed. Add ConfigPlugin.init() to your plugins array.',
    },
  ],
})
export default class ConfigPlugin<TConfig extends object = Record<string, string>> extends DynamicPlugin<
  ConfigPluginOptions<TConfig>,
  ConfigPluginOptionsInput<TConfig>
> {
  static defaultOptions: ConfigPluginOptions = {
    envPath: '.env',
    localEnvPath: '.env.local',
    configPath: 'config.yml',
    loadEnv: true,
    loadYaml: false,
    populateProcessEnv: true,
    strict: true,
  };

  options: ConfigPluginOptions<TConfig>;

  constructor(options: ConfigPluginOptionsInput<TConfig> = {}) {
    super();
    this.options = {
      ...ConfigPlugin.defaultOptions,
      ...options,
    } as ConfigPluginOptions<TConfig>;
  }

  /**
   * Dynamic providers based on plugin options.
   */
  static override dynamicProviders = <T extends object>(options: ConfigPluginOptionsInput<T>): ProviderType[] => {
    const providers: ProviderType[] = [];
    const config: ConfigPluginOptions<T> = {
      ...(ConfigPlugin.defaultOptions as ConfigPluginOptions<T>),
      ...options,
    };

    // ─────────────────────────────────────────────────────────────────────────
    // Config Options Provider
    // ─────────────────────────────────────────────────────────────────────────

    providers.push({
      name: 'config:options',
      provide: ConfigPluginConfigToken,
      useValue: config,
    });

    // ─────────────────────────────────────────────────────────────────────────
    // ConfigService Provider (GLOBAL scope - singleton)
    // ─────────────────────────────────────────────────────────────────────────

    providers.push({
      name: 'config:service',
      provide: ConfigService,
      scope: ProviderScope.GLOBAL,
      inject: () => [ConfigPluginConfigToken] as const,
      useFactory: async (pluginConfig: ConfigPluginOptions<T>): Promise<ConfigService<T>> => {
        // If schema provided, use the new loader with nested path support
        if (pluginConfig.schema) {
          const loadedConfig = await loadConfig(pluginConfig.schema, {
            basePath: pluginConfig.basePath,
            envPath: pluginConfig.envPath,
            localEnvPath: pluginConfig.localEnvPath,
            configPath: pluginConfig.configPath,
            loadEnv: pluginConfig.loadEnv,
            loadYaml: pluginConfig.loadYaml,
            populateProcessEnv: pluginConfig.populateProcessEnv,
          });
          return new ConfigService<T>(loadedConfig);
        }

        // Legacy mode: flat env vars without schema
        let env: Record<string, string> = {};

        if (pluginConfig.loadEnv) {
          const basePath = pluginConfig.basePath ?? process.cwd();
          env = await loadEnvFiles(basePath, pluginConfig.envPath, pluginConfig.localEnvPath);
        }

        // Merge with existing process.env
        const merged = { ...env };
        for (const [key, value] of Object.entries(process.env)) {
          if (value !== undefined && merged[key] === undefined) {
            merged[key] = value;
          }
        }

        // Populate process.env if enabled
        if (pluginConfig.populateProcessEnv) {
          populateProcessEnv(env, false);
        }

        return new ConfigService<T>(merged as unknown as T);
      },
    });

    return providers;
  };
}
