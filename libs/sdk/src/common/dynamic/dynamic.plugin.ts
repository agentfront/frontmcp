// dynamic-plugin.ts
import { type Reference } from '@frontmcp/di';

import { MethodNotImplementedError } from '../../errors/transport.errors';
import { type PluginType, type ProviderType, type ToolType } from '../interfaces';
import {
  collectDynamicProviders,
  collectDynamicTools,
  dedupePluginProviders,
  pluginMetadataFromOptions,
} from './dynamic.utils';

// InitOptions accepts input type (what users provide to init())
type InitOptions<TInput> =
  | ((TInput & { useFactory?: never; inject?: never }) & { providers?: readonly ProviderType[] })
  | {
      inject: () => readonly Reference<any>[];
      useFactory: (...args: any[]) => TInput;
      providers?: readonly ProviderType[];
    };

type PluginClassWithOptions<TInput, TOptions> = {
  new (...args: any[]): any;
  prototype: { __options_brand?: TOptions; __options_input_brand?: TInput };
  // optional hook contributed by plugin authors
  dynamicProviders?: (options: TInput) => readonly ProviderType[];
  dynamicTools?: (options: TInput) => readonly ToolType[];
};

type ValueMcpPlugin<T> = { provide: any; useValue: T; providers?: ProviderType[] };
type FactoryMcpPlugin<T> = { provide: any; inject: () => readonly Reference<any>[]; useFactory: (...args: any[]) => T };

type PluginReturn<T> = (ValueMcpPlugin<T> | FactoryMcpPlugin<T>) &
  PluginType & {
    providers?: readonly ProviderType[];
  };

export function isDynamicPluginClass(value: unknown): value is new (options: unknown) => object {
  return typeof value === 'function' && value.prototype instanceof DynamicPlugin;
}

/** The options each `init(options)` instance was built with (#647). */
const initOptionsByInstance = new WeakMap<object, unknown>();

/**
 * The options `SomePlugin.init(options)` built `instance` with, or `undefined` for an instance
 * `init` did not build. A registry that is not the first to install the record uses them to build
 * an instance of its own.
 */
export function initOptionsOf(instance: object): { options: unknown } | undefined {
  return initOptionsByInstance.has(instance) ? { options: initOptionsByInstance.get(instance) } : undefined;
}

/**
 * Base class for plugins that support dynamic configuration.
 *
 * @template TOptions - The resolved options type (after parsing with defaults applied)
 * @template TInput - The input options type (what users provide to init()). Defaults to TOptions for backwards compatibility.
 */
export abstract class DynamicPlugin<TOptions extends object, TInput extends object = TOptions> {
  /**
   * Brand for resolved options type (used internally).
   */
  declare __options_brand: TOptions;

  /**
   * Brand for input options type (used by init()).
   */
  declare __options_input_brand: TInput;

  /**
   * Optional hook to contribute providers to the plugin.
   * @param options
   */
  static dynamicProviders?(options: any): readonly ProviderType[];

  /**
   * Optional hook to contribute tools to the plugin, for the options it was configured with.
   * @param options
   */
  static dynamicTools?(options: any): readonly ToolType[];

  get<T>(token: Reference<T>): T {
    throw new MethodNotImplementedError('DynamicPlugin', 'get');
  }

  /**
   * Static init() method to create a plugin provider.
   * @param options - Input options (with optional fields for defaults). Omitted, the plugin is
   *   built with `{}`, as `ApprovalPlugin.init()` is documented.
   */
  static init<TThis extends PluginClassWithOptions<any, any>>(
    this: TThis,
    options: InitOptions<
      TThis['prototype'] extends { __options_input_brand?: infer I } ? I : never
    > = {} as InitOptions<TThis['prototype'] extends { __options_input_brand?: infer I } ? I : never>,
  ): PluginReturn<TThis['prototype'] extends { __options_brand?: infer O } ? O : never> {
    const extraProviders = (options as any).providers as readonly ProviderType[] | undefined;
    const typedOptions = options as any;

    if ('useFactory' in options) {
      return {
        ...pluginMetadataFromOptions(typedOptions, []),
        provide: this,
        inject: options.inject as () => Reference<any>[],
        useFactory: options.useFactory as any,
        providers: dedupePluginProviders(extraProviders ?? []),
      };
    }

    const dyn = collectDynamicProviders(this, typedOptions);
    const mergedProviders = dedupePluginProviders([...(dyn ?? []), ...(extraProviders ?? [])]);
    const dynamicTools = collectDynamicTools(this, typedOptions);
    const instance = new this(options);
    initOptionsByInstance.set(instance, options);
    return {
      ...pluginMetadataFromOptions(typedOptions, dynamicTools),
      provide: this,
      useValue: instance,
      providers: mergedProviders,
    };
  }
}
