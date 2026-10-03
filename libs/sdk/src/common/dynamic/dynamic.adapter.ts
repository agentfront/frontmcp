// dynamic-adapter.ts
import { DynamicAdapterNameError, InvalidEntityError } from '../../errors';
import { type AdapterInterface, type AdapterType, type FrontMcpAdapterResponse, type Reference } from '../interfaces';
import { isAdapterInstance } from './dynamic.utils';

// keep your original options union; just add optional `providers`
type InitOptions<T, TAdapter> =
  | (T & {
      useFactory?: never;
      inject?: never;
      name: string;
    })
  | {
      inject: () => readonly Reference<any>[];
      /**
       * Returns the adapter's options (or a promise of them), from which the adapter is built, or
       * an adapter the factory built itself, named by the `name` given to `init()`.
       */
      useFactory: (...args: any[]) => T | TAdapter | Promise<T | TAdapter>;
      name: string;
    };

type AdapterClassWithOptions<T> = {
  new (...args: any[]): any;
  prototype: { __options_brand?: T };
};

/** The options type a `DynamicAdapter` subclass is declared with. */
type AdapterOptionsOf<TThis extends AdapterClassWithOptions<unknown>> = TThis['prototype'] extends {
  __options_brand?: infer O;
}
  ? O
  : never;

type AdapterReturn<T> = AdapterType;

/** Tracks adapter names per class to detect duplicates at registration time */
const usedAdapterNames = new WeakMap<object, Set<string>>();

/**
 * The adapter an `init({ name, inject, useFactory })` factory result stands for: an adapter the
 * factory built itself is kept; options build one, named by the `name` given to `init`, which is
 * the name the adapter is registered and de-duplicated under. An adapter is recognised by its
 * shape (`options.name` and `fetch()`), never rebuilt from its own fields, and must carry that name.
 */
function adapterFromFactoryResult(
  adapterClass: new (options: object) => AdapterInterface,
  adapterName: string,
  produced: unknown,
): AdapterInterface | Promise<AdapterInterface> {
  if (isPromiseLike(produced)) {
    return Promise.resolve(produced).then((resolved) => adapterFromFactoryResult(adapterClass, adapterName, resolved));
  }
  if (isAdapterInstance(produced)) {
    if (produced.options.name !== adapterName) {
      throw new InvalidEntityError(
        'adapter',
        adapterName,
        `useFactory to return an adapter named '${adapterName}', the name given to init(), not '${produced.options.name}'`,
      );
    }
    return produced;
  }
  if (!produced || typeof produced !== 'object') {
    throw new InvalidEntityError('adapter', adapterName, "useFactory to return the adapter's options object");
  }
  return new adapterClass({ ...produced, name: adapterName });
}

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  return (
    !!value &&
    (typeof value === 'object' || typeof value === 'function') &&
    typeof (value as { then?: unknown }).then === 'function'
  );
}

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
    options: InitOptions<AdapterOptionsOf<TThis>, InstanceType<TThis>> = {} as InitOptions<
      AdapterOptionsOf<TThis>,
      InstanceType<TThis>
    >,
  ): AdapterReturn<AdapterOptionsOf<TThis>> {
    const typedOptions = options as any;
    const adapterName = typedOptions.name;

    // Validate name is provided
    if (!adapterName || typeof adapterName !== 'string' || adapterName.trim() === '') {
      throw new DynamicAdapterNameError(
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
      throw new DynamicAdapterNameError(
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
      const factory = useFactory as (...args: unknown[]) => unknown;
      const adapterClass = this as unknown as new (options: object) => AdapterInterface;
      return {
        ...rest,
        provide: uniqueToken,
        inject: inject as () => Reference<any>[],
        // The factory returns the adapter's options, as a DynamicPlugin factory does; the adapter is
        // built from them here, so the registry gets an adapter rather than its options (#678).
        useFactory: (...args: unknown[]) => adapterFromFactoryResult(adapterClass, adapterName, factory(...args)),
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
