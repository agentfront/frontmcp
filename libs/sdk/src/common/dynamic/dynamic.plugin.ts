// dynamic-plugin.ts
import { Reference, PluginType, ProviderType, ProviderRegistryInterface } from '../interfaces';
import { collectDynamicProviders, dedupePluginProviders } from './dynamic.utils';

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
};

type ValueMcpPlugin<T> = { provide: any; useValue: T; providers?: ProviderType[] };
type FactoryMcpPlugin<T> = { provide: any; inject: () => readonly Reference<any>[]; useFactory: (...args: any[]) => T };

type PluginReturn<T> = (ValueMcpPlugin<T> | FactoryMcpPlugin<T>) &
  PluginType & {
    providers?: readonly ProviderType[];
  };

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

  get<T>(token: Reference<T>): T {
    throw new Error('Method not implemented.');
  }

  /**
   * Static init() method to create a plugin provider.
   * @param options - Input options (with optional fields for defaults)
   */
  static init<TThis extends PluginClassWithOptions<any, any>>(
    this: TThis,
    options: InitOptions<TThis['prototype'] extends { __options_input_brand?: infer I } ? I : never>,
  ): PluginReturn<TThis['prototype'] extends { __options_brand?: infer O } ? O : never> {
    const extraProviders = (options as any).providers as readonly ProviderType[] | undefined;
    const typedOptions = options as any;

    if ('useFactory' in options) {
      return {
        ...typedOptions,
        provide: this,
        inject: options.inject as () => Reference<any>[],
        useFactory: options.useFactory as any,
        providers: dedupePluginProviders(extraProviders ?? []),
      };
    }

    const dyn = collectDynamicProviders(this, typedOptions);
    const mergedProviders = dedupePluginProviders([...(dyn ?? []), ...(extraProviders ?? [])]);
    return {
      ...typedOptions,
      provide: this,
      useValue: new this(options),
      providers: mergedProviders,
    };
  }
}
