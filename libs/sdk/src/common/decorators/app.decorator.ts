import 'reflect-metadata';

import { InvalidDecoratorMetadataError } from '../../errors/decorator.errors';
import { parsePackageSpecifier } from '../../esm-loader/package-specifier';
import {
  frontMcpLocalAppMetadataSchema,
  type EsmAppOptions,
  type LocalAppMetadata,
  type RemoteAppMetadata,
  type RemoteUrlAppOptions,
} from '../metadata';
import { FrontMcpLocalAppTokens } from '../tokens';
import { captureCallerDir } from '../utils/caller-dir.utils';
import { validateRemoteUrl } from '../utils/validate-remote-url';

/** Basenames of THIS decorator file, skipped so the captured frame is the user's app module. */
const APP_DECORATOR_BASENAMES = ['app.decorator.ts', 'app.decorator.js'] as const;

/**
 * Decorator that marks a class as a McpApp module and provides metadata.
 *
 * Also provides static methods for declaring external apps:
 * - `App.esm()` — load an @App class from an npm package
 * - `App.remote()` — connect to an external MCP server
 *
 * @example
 * ```ts
 * import { FrontMcp, App } from '@frontmcp/sdk';
 *
 * @App({ name: 'Local', tools: [EchoTool] })
 * class LocalApp {}
 *
 * @FrontMcp({
 *   apps: [
 *     LocalApp,
 *     App.esm('@acme/tools@^1.0.0', { namespace: 'acme' }),
 *     App.remote('https://api.example.com/mcp', { namespace: 'api' }),
 *   ],
 * })
 * export default class Server {}
 * ```
 */
function FrontMcpApp(providedMetadata: LocalAppMetadata): ClassDecorator {
  // Capture the defining module's directory at decorator-evaluation time so a
  // `splitByApp` app's `auth.ui[slot]` relative paths anchor to THIS app file
  // rather than process.cwd() (#469 / issue #444).
  const sourceDir = captureCallerDir(APP_DECORATOR_BASENAMES);

  return (target: Function) => {
    const withSourceDir =
      sourceDir && !providedMetadata.__sourceDir ? { ...providedMetadata, __sourceDir: sourceDir } : providedMetadata;
    const { error, data: metadata } = frontMcpLocalAppMetadataSchema.safeParse(withSourceDir);
    if (error) {
      const formatted = error.format();
      if (formatted.plugins) {
        throw new InvalidDecoratorMetadataError('App', 'plugins', JSON.stringify(formatted.plugins, null, 2));
      }
      if (formatted.providers) {
        throw new InvalidDecoratorMetadataError('App', 'providers', JSON.stringify(formatted.providers, null, 2));
      }
      if (formatted.authProviders) {
        throw new InvalidDecoratorMetadataError(
          'App',
          'authProviders',
          JSON.stringify(formatted.authProviders, null, 2),
        );
      }
      if (formatted.adapters) {
        throw new InvalidDecoratorMetadataError('App', 'adapters', JSON.stringify(formatted.adapters, null, 2));
      }
      if (formatted.tools) {
        throw new InvalidDecoratorMetadataError('App', 'tools', JSON.stringify(formatted.tools, null, 2));
      }
      if (formatted.resources) {
        throw new InvalidDecoratorMetadataError('App', 'resources', JSON.stringify(formatted.resources, null, 2));
      }
      if (formatted.prompts) {
        throw new InvalidDecoratorMetadataError('App', 'prompts', JSON.stringify(formatted.prompts, null, 2));
      }
      throw error;
    }

    Reflect.defineMetadata(FrontMcpLocalAppTokens.type, true, target);
    for (const property in metadata) {
      Reflect.defineMetadata(FrontMcpLocalAppTokens[property] ?? property, metadata[property], target);
    }
  };
}

// ═══════════════════════════════════════════════════════════════════
// STATIC METHODS: App.esm() and App.remote()
// ═══════════════════════════════════════════════════════════════════

/**
 * Load an @App-decorated class from an npm package at runtime.
 *
 * @param specifier - npm package specifier (e.g., '@acme/tools@^1.0.0')
 * @param options - Optional per-app overrides
 */
function esmApp(specifier: string, options?: EsmAppOptions): RemoteAppMetadata {
  const parsed = parsePackageSpecifier(specifier);

  const packageConfig: RemoteAppMetadata['packageConfig'] = {};
  let hasPackageConfig = false;

  if (options?.loader) {
    packageConfig.loader = options.loader;
    hasPackageConfig = true;
  }
  if (options?.autoUpdate) {
    packageConfig.autoUpdate = options.autoUpdate;
    hasPackageConfig = true;
  }
  if (options?.cacheTTL !== undefined) {
    packageConfig.cacheTTL = options.cacheTTL;
    hasPackageConfig = true;
  }
  if (options?.importMap) {
    packageConfig.importMap = options.importMap;
    hasPackageConfig = true;
  }

  return {
    name: options?.name ?? parsed.fullName,
    urlType: 'esm',
    url: specifier,
    namespace: options?.namespace,
    description: options?.description,
    standalone: options?.standalone ?? false,
    filter: options?.filter,
    ...(hasPackageConfig ? { packageConfig } : {}),
  };
}

/**
 * Connect to an external MCP server via HTTP.
 *
 * @param url - MCP server endpoint URL (e.g., 'https://api.example.com/mcp')
 * @param options - Optional per-app overrides
 */
function remoteApp(url: string, options?: RemoteUrlAppOptions): RemoteAppMetadata {
  validateRemoteUrl(url);
  let derivedName: string;
  try {
    const parsed = new URL(url);
    derivedName = parsed.hostname.split('.')[0];
  } catch {
    derivedName = url;
  }

  return {
    name: options?.name ?? derivedName,
    urlType: 'url',
    url,
    namespace: options?.namespace,
    description: options?.description,
    standalone: options?.standalone ?? false,
    transportOptions: options?.transportOptions,
    remoteAuth: options?.remoteAuth,
    refreshInterval: options?.refreshInterval,
    cacheTTL: options?.cacheTTL,
    filter: options?.filter,
  };
}

// Attach static methods to the decorator function
Object.assign(FrontMcpApp, {
  esm: esmApp,
  remote: remoteApp,
});

// ═══════════════════════════════════════════════════════════════════
// TYPE-SAFE EXPORT
// ═══════════════════════════════════════════════════════════════════

/**
 * The `App` type — callable as a decorator AND has `.esm()` / `.remote()` static methods.
 */
type AppDecorator = {
  (metadata: LocalAppMetadata): ClassDecorator;
  esm(specifier: string, options?: EsmAppOptions): RemoteAppMetadata;
  remote(url: string, options?: RemoteUrlAppOptions): RemoteAppMetadata;
};

const App = FrontMcpApp as unknown as AppDecorator;

/**
 * Functional form of `@App` — build an app from a plain metadata object, no
 * decorator syntax. Synthesizes a class and applies the SAME `@App` metadata, so
 * the result is a genuine local app (`AppKind.LOCAL_CLASS`) usable anywhere a
 * decorated app class is — no parallel registry. Mirrors `tool` / `resource` /
 * `prompt` / `skill`, and lets a config/manifest assemble apps declaratively.
 *
 * @example
 * const billing = app({ name: 'billing', tools: [echoTool] });
 * createEdgeMcp({ info, apps: [billing] });
 */
function frontMcpApp(metadata: LocalAppMetadata): new () => object {
  const FunctionalApp = class {};
  FrontMcpApp(metadata)(FunctionalApp);
  return FunctionalApp;
}

export { FrontMcpApp, App, frontMcpApp, frontMcpApp as app };
