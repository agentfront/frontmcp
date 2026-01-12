// dynamic-adapter.ts
import { Reference, FrontMcpAdapterResponse, AdapterType, AdapterInterface } from '../interfaces';

// keep your original options union; just add optional `providers`
type InitOptions<T> =
  | (T & {
      useFactory?: never;
      inject?: never;
      name: string;
    })
  | {
      inject: () => readonly Reference<any>[];
      useFactory: (...args: any[]) => T;
      name: string;
    };

type AdapterClassWithOptions<T> = {
  new (...args: any[]): any;
  prototype: { __options_brand?: T };
};

type AdapterReturn<T> = AdapterType;

/** Tracks adapter names per class to detect duplicates at registration time */
const usedAdapterNames = new WeakMap<object, Set<string>>();

export abstract class DynamicAdapter<TOptions extends object> implements AdapterInterface {
  abstract options: { name: string } & TOptions;
  /**
   * Private property to ensure options are typed correctly.
   */
  declare __options_brand: TOptions;

  /**
   * Static init() method to create an adapter provider.
   *
   * Each call to init() creates a unique adapter instance with its own token,
   * keyed by `${ClassName}:${options.name}`. This allows multiple adapters
   * of the same class with different configurations (e.g., multiple OpenAPI
   * adapters for different APIs).
   *
   * **IMPORTANT:** The `name` option must be unique per adapter class.
   * Registering two adapters with the same class and name will throw an error.
   *
   * @param options - Adapter options including required `name` field
   * @throws Error if `name` is missing/empty or if a duplicate name is detected
   */
  static init<TThis extends AdapterClassWithOptions<any>>(
    this: TThis,
    options: InitOptions<TThis['prototype'] extends { __options_brand?: infer O } ? O : never>,
  ): AdapterReturn<TThis['prototype'] extends { __options_brand?: infer O } ? O : never> {
    const typedOptions = options as any;
    const adapterName = typedOptions.name;

    // Validate name is provided
    if (!adapterName || typeof adapterName !== 'string' || adapterName.trim() === '') {
      throw new Error(
        `Adapter ${this.name}.init() requires a non-empty 'name' option. ` +
          `This name is used to uniquely identify the adapter instance.`,
      );
    }

    // Check for duplicate names within the same adapter class
    let namesForClass = usedAdapterNames.get(this);
    if (!namesForClass) {
      namesForClass = new Set();
      usedAdapterNames.set(this, namesForClass);
    }

    if (namesForClass.has(adapterName)) {
      throw new Error(
        `Duplicate adapter name '${adapterName}' for ${this.name}. ` +
          `Each adapter instance must have a unique name within the same adapter class. ` +
          `Already registered: [${[...namesForClass].join(', ')}]`,
      );
    }
    namesForClass.add(adapterName);

    // Create unique token for this adapter instance.
    // Using Symbol.for() ensures stable identity across module boundaries
    // while allowing multiple adapters of the same class.
    const uniqueToken = Symbol.for(`adapter:${this.name}:${adapterName}`);

    if ('useFactory' in options) {
      const { inject, useFactory, ...rest } = typedOptions;
      return {
        provide: uniqueToken,
        inject: options.inject as () => Reference<any>[],
        useFactory: options.useFactory as any,
        ...rest,
      };
    }
    return {
      ...typedOptions,
      provide: uniqueToken,
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
