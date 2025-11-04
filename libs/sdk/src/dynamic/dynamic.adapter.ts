// dynamic-adapter.ts
import {
  Reference,
  FrontMcpAdapterResponse,
  AdapterType,
  AdapterInterface,
} from '../interfaces';

// keep your original options union; just add optional `providers`
type InitOptions<T> =
  | ((T & {
    useFactory?: never;
    inject?: never;
    name: string;
  }))
  | {
  inject: () => readonly Reference<any>[];
  useFactory: (...args: any[]) => T;
  name: string;
};

type AdapterClassWithOptions<T> = {
  new(...args: any[]): any;
  prototype: { __options_brand?: T };
};

type AdapterReturn<T> = AdapterType

export abstract class DynamicAdapter<TOptions extends object> implements AdapterInterface {
  /**
   * Private property to ensure options are typed correctly.
   */
  declare __options_brand: TOptions;

  /**
   * Static init() method to create a plugin provider.
   * @param options
   */
  static init<TThis extends AdapterClassWithOptions<any>>(
    this: TThis,
    options: InitOptions<TThis['prototype'] extends { __options_brand?: infer O } ? O : never>,
  ): AdapterReturn<TThis['prototype'] extends { __options_brand?: infer O } ? O : never> {
    const typedOptions = options as any;
    if ('useFactory' in options) {
      const { inject, useFactory, ...rest } = typedOptions;
      return {
        provide: this,
        inject: options.inject as () => Reference<any>[],
        useFactory: options.useFactory as any,
        ...rest,
      };
    }
    return {
      ...typedOptions,
      provide: this,
      useValue: new this(options),
    };
  }

  /**
   * Abstract fetch method to be implemented by subclasses.
   * @returns A promise resolving to any type the will be used
   * to trnasform into tools, resources, prompts, etc.
   */
  abstract fetch(): Promise<FrontMcpAdapterResponse> | FrontMcpAdapterResponse;
}

