// dynamic-plugin.ts
import {Reference, PluginType, ProviderType, ProviderRegistryInterface} from '../interfaces';
import {collectDynamicProviders, dedupePluginProviders} from './dynamic.utils';

// keep your original options union; just add optional `providers`
type InitOptions<T> =
  | ((T & { useFactory?: never; inject?: never }) & { providers?: readonly ProviderType[] })
  | {
  inject: () => readonly Reference<any>[];
  useFactory: (...args: any[]) => T;
  providers?: readonly ProviderType[];
};

type PluginClassWithOptions<T> = {
  new(...args: any[]): any;
  prototype: { __options_brand?: T };
  // optional hook contributed by plugin authors
  dynamicProviders?: (options: T) => readonly ProviderType[];
};

type ValueMcpPlugin<T> = { provide: any; useValue: T; providers?: ProviderType[] };
type FactoryMcpPlugin<T> = { provide: any; inject: () => readonly Reference<any>[]; useFactory: (...args: any[]) => T };

type PluginReturn<T> = (ValueMcpPlugin<T> | FactoryMcpPlugin<T>) &
  PluginType & {
  providers?: readonly ProviderType[];
};

export abstract class DynamicPlugin<TOptions extends object> {
  /**
   * Private property to ensure options are typed correctly.
   */
  declare __options_brand: TOptions;

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
   * @param options
   */
  static init<TThis extends PluginClassWithOptions<any>>(
    this: TThis,
    options: InitOptions<TThis['prototype'] extends { __options_brand?: infer O } ? O : never>,
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