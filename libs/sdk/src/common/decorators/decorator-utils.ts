/**
 * Decorator Utilities for Dual-Mode Support
 *
 * This module provides utilities for creating decorators that work with both:
 * - Legacy TypeScript decorators (experimentalDecorators: true)
 * - TC39 Stage 3 decorators (native JS, used by esbuild/tsx)
 *
 * The key difference between the two modes:
 *
 * LEGACY TypeScript Method Decorator:
 *   (target: prototype, propertyKey: string, descriptor: PropertyDescriptor) => void
 *   - target is the class prototype (for instance methods) or class (for static)
 *   - propertyKey is the method name
 *   - descriptor is the property descriptor
 *
 * TC39 Stage 3 Method Decorator:
 *   (target: method, context: ClassMethodDecoratorContext) => method
 *   - target is the actual method function being decorated
 *   - context is an object with { kind, name, static, private, addInitializer }
 *   - The class isn't available during decoration (only via addInitializer at instance creation)
 *
 * @example
 * ```typescript
 * // Using the factory to create a dual-mode decorator
 * const MyDecorator = createMethodDecorator<{ stage: string }>({
 *   createMetadata: (args, options) => ({
 *     methodName: args.methodName,
 *     stage: options.stage,
 *   }),
 *   onLegacyDecoration: (ctor, metadata) => {
 *     // Immediately register on class (legacy mode)
 *     registerOnClass(ctor, metadata);
 *   },
 * });
 *
 * // Usage (works in both modes):
 * class MyFlow {
 *   @MyDecorator({ stage: 'execute' })
 *   async execute() {}
 * }
 * ```
 */

/**
 * TC39 Stage 3 Method Decorator Context
 * @see https://github.com/tc39/proposal-decorators
 */
export interface TC39MethodContext {
  readonly kind: 'method';
  readonly name: string | symbol;
  readonly static: boolean;
  readonly private: boolean;
  addInitializer(initializer: () => void): void;
}

/**
 * TC39 Stage 3 Class Decorator Context
 */
export interface TC39ClassContext {
  readonly kind: 'class';
  readonly name: string | undefined;
  addInitializer(initializer: () => void): void;
}

/**
 * Normalized arguments passed to method decorator handlers
 */
export interface MethodDecoratorArgs {
  /** The method function being decorated */
  method: Function;
  /** Method name as string */
  methodName: string;
  /** Whether this is a static method */
  isStatic: boolean;
  /** Decorator mode */
  mode: 'legacy' | 'tc39';
}

/**
 * Configuration for creating a dual-mode method decorator
 */
export interface MethodDecoratorConfig<TOptions, TMetadata> {
  /**
   * Create metadata from decorator arguments and options
   */
  createMetadata: (args: MethodDecoratorArgs, options: TOptions) => TMetadata;

  /**
   * Called immediately during legacy decoration with access to the class
   * Use this to register metadata directly on the class
   */
  onLegacyDecoration?: (ctor: Function, metadata: TMetadata) => void;

  /**
   * Store pending metadata for TC39 mode (required)
   * The metadata will be resolved later when the class is processed
   */
  storePendingMetadata: (method: Function, metadata: TMetadata) => void;
}

/**
 * Check if decorator context is TC39 Stage 3 style
 */
export function isTC39MethodContext(arg: unknown): arg is TC39MethodContext {
  return typeof arg === 'object' && arg !== null && 'kind' in arg && (arg as TC39MethodContext).kind === 'method';
}

/**
 * Check if decorator context is TC39 Stage 3 class context
 */
export function isTC39ClassContext(arg: unknown): arg is TC39ClassContext {
  return typeof arg === 'object' && arg !== null && 'kind' in arg && (arg as TC39ClassContext).kind === 'class';
}

/**
 * Creates a method decorator that works with both legacy TypeScript and TC39 Stage 3 decorators.
 *
 * For legacy decorators: onLegacyDecoration is called immediately with class constructor
 * For TC39 decorators: storePendingMetadata is called, metadata resolved later via resolvePendingMetadataForClass
 */
export function createDualModeMethodDecorator<TOptions, TMetadata>(
  config: MethodDecoratorConfig<TOptions, TMetadata>,
): (options: TOptions) => MethodDecorator {
  return (options: TOptions): MethodDecorator => {
    return (target: any, keyOrContext: any, descriptor?: PropertyDescriptor): any => {
      if (isTC39MethodContext(keyOrContext)) {
        // TC39 Stage 3 decorator style
        const context = keyOrContext;
        const methodName = String(context.name);
        const isStatic = context.static;
        const method = target; // In TC39, target is the method function itself

        const args: MethodDecoratorArgs = {
          method,
          methodName,
          isStatic,
          mode: 'tc39',
        };

        const metadata = config.createMetadata(args, options);
        config.storePendingMetadata(method, metadata);

        // Return the original method unchanged
        return target;
      } else {
        // Legacy TypeScript decorator style
        const key = keyOrContext;
        const methodName = String(key);
        const isStatic = typeof target === 'function';
        const method = descriptor?.value ?? target[key];
        const ctor = isStatic ? target : target.constructor;

        const args: MethodDecoratorArgs = {
          method,
          methodName,
          isStatic,
          mode: 'legacy',
        };

        const metadata = config.createMetadata(args, options);

        // In legacy mode, we have immediate access to the class
        if (config.onLegacyDecoration) {
          config.onLegacyDecoration(ctor, metadata);
        }

        // Return nothing to keep the original descriptor
        return undefined;
      }
    };
  };
}

/**
 * Storage for pending TC39 decorator metadata
 * Generic class that can be instantiated for different metadata types
 */
export class PendingMetadataRegistry<T> {
  private pending = new WeakMap<Function, T[]>();

  /**
   * Store pending metadata for a method (TC39 mode)
   */
  store(method: Function, metadata: T): void {
    const existing = this.pending.get(method) ?? [];
    existing.push(metadata);
    this.pending.set(method, existing);
  }

  /**
   * Get and optionally clear pending metadata for a method
   */
  consume(method: Function): T[] {
    const pending = this.pending.get(method) ?? [];
    this.pending.delete(method);
    return pending;
  }

  /**
   * Resolve all pending metadata for a class by scanning its prototype and static members
   */
  resolveForClass(ctor: Function, consume = true): T[] {
    const resolved: T[] = [];

    // Scan instance methods on prototype
    const proto = ctor.prototype;
    if (proto) {
      for (const name of Object.getOwnPropertyNames(proto)) {
        if (name === 'constructor') continue;
        try {
          const desc = Object.getOwnPropertyDescriptor(proto, name);
          const method = desc?.value;
          if (typeof method === 'function') {
            const pending = consume ? this.consume(method) : this.pending.get(method) ?? [];
            resolved.push(...pending);
          }
        } catch {
          // Ignore getter/setter errors
        }
      }
    }

    // Scan static methods on constructor
    for (const name of Object.getOwnPropertyNames(ctor)) {
      if (['prototype', 'length', 'name'].includes(name)) continue;
      try {
        const desc = Object.getOwnPropertyDescriptor(ctor, name);
        const method = desc?.value;
        if (typeof method === 'function') {
          const pending = consume ? this.consume(method) : this.pending.get(method) ?? [];
          resolved.push(...pending);
        }
      } catch {
        // Ignore getter/setter errors
      }
    }

    return resolved;
  }
}

/**
 * Creates a class decorator that works with both legacy TypeScript and TC39 Stage 3 decorators.
 */
export function createDualModeClassDecorator<TOptions>(
  handler: (ctor: Function, options: TOptions, context?: TC39ClassContext) => Function | void,
): (options: TOptions) => ClassDecorator {
  return (options: TOptions): ClassDecorator => {
    return (target: any, context?: any): any => {
      if (isTC39ClassContext(context)) {
        // TC39 Stage 3 class decorator
        return handler(target, options, context) ?? target;
      } else {
        // Legacy TypeScript class decorator
        return handler(target, options) ?? target;
      }
    };
  };
}
