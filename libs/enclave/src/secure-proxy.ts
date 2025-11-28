/**
 * Secure Proxy - Runtime Property Access Protection
 *
 * Wraps objects with Proxies that block access to dangerous properties like:
 * - constructor: Gives access to Function constructor for code execution
 * - __proto__: Prototype chain manipulation
 * - prototype: Prototype access
 *
 * This provides defense-in-depth against attacks like:
 * ```javascript
 * const m = 'const';
 * const Func = callTool[m + 'ructor'];  // Blocked!
 * ```
 *
 * @packageDocumentation
 */

import type { SecureProxyLevelConfig, SecurityLevel } from './types';

/**
 * Categorized blocked properties for defense-in-depth
 *
 * Organized by attack category to support per-security-level configuration
 */
export const BLOCKED_PROPERTY_CATEGORIES = {
  /**
   * Core prototype manipulation properties (always blocked except PERMISSIVE)
   */
  PROTOTYPE: new Set([
    'constructor',
    '__proto__',
    'prototype',
    '__defineGetter__',
    '__defineSetter__',
    '__lookupGetter__',
    '__lookupSetter__',
  ]),

  /**
   * Node.js 24 Iterator helper method names
   * Blocked at STRICT/SECURE to prevent prototype chain access via iterators
   */
  ITERATOR_HELPERS: new Set(['toArray', 'forEach', 'some', 'every', 'find', 'reduce', 'flatMap', 'drop', 'take']),

  /**
   * Reflection properties on Object
   * Blocked at STRICT to prevent introspection attacks
   */
  REFLECTION: new Set([
    'getOwnPropertyDescriptor',
    'getOwnPropertyDescriptors',
    'getOwnPropertyNames',
    'getOwnPropertySymbols',
    'getPrototypeOf',
    'setPrototypeOf',
    'defineProperty',
    'defineProperties',
    'preventExtensions',
    'isExtensible',
    'seal',
    'isSealed',
    'freeze',
    'isFrozen',
  ]),

  /**
   * Timing API properties
   * Blocked at STRICT to prevent timing attacks
   */
  TIMING: new Set(['hrtime', 'timeOrigin']),
} as const;

export type BlockedPropertyCategory = keyof typeof BLOCKED_PROPERTY_CATEGORIES;

/**
 * Get blocked properties for a security level
 *
 * @param level Security level
 * @returns Set of property names to block
 */
export function getBlockedPropertiesForLevel(level: SecurityLevel): Set<string> {
  const blocked = new Set<string>();

  // PERMISSIVE: No prototype blocking (handled by explicit config)
  // All other levels: Block core prototype manipulation
  if (level !== 'PERMISSIVE') {
    BLOCKED_PROPERTY_CATEGORIES.PROTOTYPE.forEach((p) => blocked.add(p));
  }

  switch (level) {
    case 'STRICT':
      // Block everything
      BLOCKED_PROPERTY_CATEGORIES.ITERATOR_HELPERS.forEach((p) => blocked.add(p));
      BLOCKED_PROPERTY_CATEGORIES.REFLECTION.forEach((p) => blocked.add(p));
      BLOCKED_PROPERTY_CATEGORIES.TIMING.forEach((p) => blocked.add(p));
      break;
    case 'SECURE':
      // Block iterator helpers (potential sandbox escape vectors)
      BLOCKED_PROPERTY_CATEGORIES.ITERATOR_HELPERS.forEach((p) => blocked.add(p));
      break;
    case 'STANDARD':
    case 'PERMISSIVE':
      // Handled above
      break;
  }

  return blocked;
}

/**
 * Default blocked properties (for backward compatibility)
 */
const BLOCKED_PROPERTIES = new Set([
  // Code execution
  'constructor',

  // Prototype manipulation
  '__proto__',
  'prototype',

  // Legacy getter/setter definition
  '__defineGetter__',
  '__defineSetter__',
  '__lookupGetter__',
  '__lookupSetter__',
]);

/**
 * Build blocked properties set from SecureProxyLevelConfig
 *
 * @param config The security level proxy configuration
 * @returns Set of property names to block
 */
export function buildBlockedPropertiesFromConfig(config: SecureProxyLevelConfig): Set<string> {
  const blocked = new Set<string>();

  if (config.blockConstructor) {
    blocked.add('constructor');
  }

  if (config.blockPrototype) {
    blocked.add('__proto__');
    blocked.add('prototype');
  }

  if (config.blockLegacyAccessors) {
    blocked.add('__defineGetter__');
    blocked.add('__defineSetter__');
    blocked.add('__lookupGetter__');
    blocked.add('__lookupSetter__');
  }

  return blocked;
}

/**
 * Default SecureProxyLevelConfig (matches current behavior - blocks everything)
 */
export const DEFAULT_SECURE_PROXY_CONFIG: SecureProxyLevelConfig = {
  blockConstructor: true,
  blockPrototype: true,
  blockLegacyAccessors: true,
  proxyMaxDepth: 10,
};

/**
 * Create a safe Reflect wrapper that blocks dangerous operations
 *
 * @param securityLevel The security level to apply
 * @returns A safe Reflect object or undefined (STRICT blocks Reflect entirely)
 */
export function createSafeReflect(securityLevel: SecurityLevel): typeof Reflect | undefined {
  // STRICT: Block Reflect entirely
  if (securityLevel === 'STRICT') {
    return undefined;
  }

  const dangerousMethods = new Set<string>(['setPrototypeOf']);

  // SECURE: Block additional methods
  if (securityLevel === 'SECURE') {
    dangerousMethods.add('apply');
    dangerousMethods.add('defineProperty');
  }

  return new Proxy(Reflect, {
    get(target, prop: string | symbol) {
      if (typeof prop === 'string' && dangerousMethods.has(prop)) {
        return undefined;
      }

      const value = Reflect.get(target, prop);

      // Wrap Reflect.construct to block Function constructors
      if (typeof value === 'function' && prop === 'construct') {
        return function (ctorTarget: unknown, args: unknown[], newTarget?: unknown) {
          // Block Function, AsyncFunction, GeneratorFunction, AsyncGeneratorFunction constructors
          // Intentional empty functions to obtain constructor references
          // eslint-disable-next-line @typescript-eslint/no-empty-function
          const AsyncFunction = async function () {}.constructor;
          // eslint-disable-next-line @typescript-eslint/no-empty-function
          const GeneratorFunction = function* () {}.constructor;
          // eslint-disable-next-line @typescript-eslint/no-empty-function
          const AsyncGeneratorFunction = async function* () {}.constructor;

          if (
            ctorTarget === Function ||
            ctorTarget === AsyncFunction ||
            ctorTarget === GeneratorFunction ||
            ctorTarget === AsyncGeneratorFunction
          ) {
            throw new Error('Reflect.construct with function constructors is blocked');
          }
          return Reflect.construct(
            ctorTarget as new (...args: unknown[]) => unknown,
            args as unknown[],
            newTarget as new (...args: unknown[]) => unknown,
          );
        };
      }

      return value;
    },
  });
}

/**
 * Properties that are specifically dangerous on Function objects
 */
const FUNCTION_BLOCKED_PROPERTIES = new Set([
  // Function object properties that could leak information
  'caller', // Deprecated but still exists
  'arguments', // Deprecated but still exists

  // Binding/applying could be used for exploitation
  // Note: We may want to allow these in some cases
  // 'bind',
  // 'call',
  // 'apply',
]);

/**
 * Options for secure proxy creation
 */
export interface SecureProxyOptions {
  /**
   * Security level configuration for the proxy
   * When provided, uses this to determine which properties to block
   */
  levelConfig?: SecureProxyLevelConfig;

  /**
   * Additional properties to block
   */
  additionalBlocked?: string[];

  /**
   * Whether to allow Function.prototype.bind/call/apply
   * Default: true (allows them for array methods like .map, .filter)
   */
  allowFunctionBinding?: boolean;

  /**
   * Maximum depth for recursive proxying
   * Default: 10
   */
  maxDepth?: number;

  /**
   * Custom handler for blocked property access
   * If not provided, returns undefined
   */
  onBlocked?: (target: unknown, property: string | symbol) => void;
}

/**
 * WeakMap to track already-proxied objects to prevent infinite recursion
 * and ensure we return the same proxy for the same object with the same config.
 *
 * The outer WeakMap is keyed by target object.
 * The inner Map is keyed by a config signature string.
 * This allows the same object to be proxied with different blocking configs.
 */
const proxyCache = new WeakMap<object, Map<string, object>>();

/**
 * WeakSet to track proxy objects (for isSecureProxy checks)
 * This is separate from proxyCache because proxyCache keys are targets, not proxies.
 */
const proxySet = new WeakSet<object>();

/**
 * Generate a cache key from SecureProxyLevelConfig
 * This allows different configs to create different proxies for the same target
 */
function getConfigCacheKey(config?: SecureProxyLevelConfig): string {
  if (!config) return 'default';
  return `${config.blockConstructor ? 'C' : 'c'}${config.blockPrototype ? 'P' : 'p'}${
    config.blockLegacyAccessors ? 'L' : 'l'
  }`;
}

/**
 * Built-in objects that have internal slots and should NOT be proxied
 * These objects use internal mechanisms that don't work through proxies
 *
 * NOTE: Promise is intentionally NOT in this list - we proxy Promises to block
 * constructor access attacks. Method binding is handled specially in the get handler.
 */
const NON_PROXYABLE_TYPES = new Set([
  // Map/Set have internal slots but we may need to proxy them in the future
  '[object Map]',
  '[object Set]',
  '[object WeakMap]',
  '[object WeakSet]',
  '[object ArrayBuffer]',
  '[object SharedArrayBuffer]',
  '[object DataView]',
  '[object Int8Array]',
  '[object Uint8Array]',
  '[object Uint8ClampedArray]',
  '[object Int16Array]',
  '[object Uint16Array]',
  '[object Int32Array]',
  '[object Uint32Array]',
  '[object Float32Array]',
  '[object Float64Array]',
  '[object BigInt64Array]',
  '[object BigUint64Array]',
  // Generators and iterators use internal slots
  '[object Generator]',
  '[object AsyncGenerator]',
  '[object GeneratorFunction]',
  '[object AsyncGeneratorFunction]',
  // Built-in iterators
  '[object Array Iterator]',
  '[object String Iterator]',
  '[object Map Iterator]',
  '[object Set Iterator]',
  '[object RegExp String Iterator]',
]);

/**
 * Types that need method binding when proxied
 * These types have internal slots that require `this` to be the original object
 * when calling their methods (e.g., Promise.prototype.then checks [[PromiseState]])
 */
const INTERNAL_SLOT_TYPES = new Set(['[object Promise]']);

/**
 * Check if a value is a proxyable target (object or function)
 * Excludes built-in objects with internal slots that don't work through proxies
 */
function isProxyable(value: unknown): value is object {
  if (value === null) return false;
  if (typeof value !== 'object' && typeof value !== 'function') return false;

  // Check for built-in types that have internal slots
  const tag = Object.prototype.toString.call(value);
  if (NON_PROXYABLE_TYPES.has(tag)) {
    return false;
  }

  return true;
}

/**
 * Create a secure proxy that blocks dangerous property access
 *
 * @param target The object to wrap
 * @param options Configuration options
 * @returns A proxy that blocks dangerous property access
 */
export function createSecureProxy<T extends object>(target: T, options: SecureProxyOptions = {}): T {
  // Return primitives as-is
  if (!isProxyable(target)) {
    return target;
  }

  // Generate cache key based on config
  const cacheKey = getConfigCacheKey(options.levelConfig);

  // Check if already proxied with this config
  const targetCache = proxyCache.get(target);
  if (targetCache) {
    const cached = targetCache.get(cacheKey);
    if (cached) {
      return cached as T;
    }
  }

  // Build blocked set from levelConfig if provided, otherwise use defaults
  const baseBlocked = options.levelConfig
    ? buildBlockedPropertiesFromConfig(options.levelConfig)
    : new Set(BLOCKED_PROPERTIES);

  // Add any additional blocked properties
  const blockedSet = new Set([...baseBlocked, ...(options.additionalBlocked || [])]);

  // Use maxDepth from levelConfig if provided, otherwise from options or default
  const maxDepth = options.maxDepth ?? options.levelConfig?.proxyMaxDepth ?? 10;

  // Create inner function for recursive proxying with depth tracking
  function proxyWithDepth<U extends object>(obj: U, depth: number): U {
    // Return primitives as-is
    if (!isProxyable(obj)) {
      return obj;
    }

    // Check cache first with config key
    const objCache = proxyCache.get(obj);
    if (objCache) {
      const cachedProxy = objCache.get(cacheKey);
      if (cachedProxy) {
        return cachedProxy as U;
      }
    }

    // Depth limit to prevent stack overflow
    if (depth > maxDepth) {
      return obj;
    }

    const proxy = new Proxy(obj, {
      get(target: U, property: string | symbol, receiver: unknown): unknown {
        // Convert symbol to string for checking
        const propName = typeof property === 'symbol' ? property.toString() : property;

        // Check if property is non-configurable (proxy invariant requires returning actual value)
        const descriptor = Object.getOwnPropertyDescriptor(target, property);
        const isNonConfigurable = descriptor && !descriptor.configurable;

        // Block dangerous properties (but respect proxy invariants)
        if (typeof propName === 'string' && blockedSet.has(propName)) {
          if (options.onBlocked) {
            options.onBlocked(target, propName);
          }

          // For non-configurable, non-writable properties, JavaScript proxy invariants require
          // returning the EXACT same object reference. We cannot proxy the return value.
          // This is a fundamental JS limitation for built-in properties like Array.prototype.
          if (isNonConfigurable && descriptor && !descriptor.writable) {
            // Must return exact value to satisfy invariant
            return Reflect.get(target, property, receiver);
          }

          // For configurable properties, we can block them
          return undefined;
        }

        // Block function-specific properties if target is a function
        if (typeof target === 'function' && typeof propName === 'string' && FUNCTION_BLOCKED_PROPERTIES.has(propName)) {
          if (options.onBlocked) {
            options.onBlocked(target, propName);
          }

          // Same invariant handling for non-configurable, non-writable properties
          if (isNonConfigurable && descriptor && !descriptor.writable) {
            return Reflect.get(target, property, receiver);
          }

          return undefined;
        }

        // Get the actual value
        const value = Reflect.get(target, property, receiver);

        // For methods on objects with internal slots (like Promise), we need to:
        // 1. Bind the method to the original object so internal slot checks pass
        // 2. Proxy the bound method to block constructor access
        // This prevents attacks like: callTool(...).then.constructor
        if (typeof value === 'function') {
          const tag = Object.prototype.toString.call(target);
          if (INTERNAL_SLOT_TYPES.has(tag)) {
            // Bind to original object so methods like .then() work correctly
            // Then proxy the bound function to block .constructor access
            const boundMethod = value.bind(target);
            return proxyWithDepth(boundMethod, depth + 1);
          }
        }

        // Recursively proxy objects and functions
        if (value !== null && (typeof value === 'object' || typeof value === 'function')) {
          return proxyWithDepth(value as object, depth + 1);
        }

        return value;
      },

      // Block setting dangerous properties
      set(target: U, property: string | symbol, value: unknown, receiver: unknown): boolean {
        const propName = typeof property === 'symbol' ? property.toString() : property;

        // Block setting dangerous properties
        if (typeof propName === 'string' && blockedSet.has(propName)) {
          if (options.onBlocked) {
            options.onBlocked(target, propName);
          }
          return false; // Silently fail
        }

        return Reflect.set(target, property, value, receiver);
      },

      // Block defining dangerous properties
      defineProperty(target: U, property: string | symbol, descriptor: PropertyDescriptor): boolean {
        const propName = typeof property === 'symbol' ? property.toString() : property;

        if (typeof propName === 'string' && blockedSet.has(propName)) {
          if (options.onBlocked) {
            options.onBlocked(target, propName);
          }
          return false;
        }

        return Reflect.defineProperty(target, property, descriptor);
      },

      // Block getPrototypeOf to prevent prototype chain walking
      getPrototypeOf(): object | null {
        // Return null to hide the prototype chain
        return null;
      },

      // Block setPrototypeOf
      setPrototypeOf(): boolean {
        return false;
      },

      // Intercept function calls to proxy return values
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Proxy handler signature requires any for compatibility
      apply(target: any, thisArg: any, argArray: any[]): any {
        // Call the original function
        const result = Reflect.apply(target, thisArg, argArray);

        // Proxy the return value if it's an object or function
        if (isProxyable(result)) {
          return proxyWithDepth(result, depth + 1);
        }

        return result;
      },
    });

    // Cache the proxy with config key
    let objCacheMap = proxyCache.get(obj);
    if (!objCacheMap) {
      objCacheMap = new Map<string, object>();
      proxyCache.set(obj, objCacheMap);
    }
    objCacheMap.set(cacheKey, proxy);

    // Track the proxy in the WeakSet for isSecureProxy checks
    proxySet.add(proxy);

    return proxy;
  }

  return proxyWithDepth(target, 0);
}

/**
 * Wrap multiple globals with secure proxies
 *
 * @param globals Object containing global values to wrap
 * @param options Proxy options
 * @returns New object with all values wrapped in secure proxies
 */
export function wrapGlobalsWithSecureProxy(
  globals: Record<string, unknown>,
  options: SecureProxyOptions = {},
): Record<string, unknown> {
  const wrapped: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(globals)) {
    if (value !== null && (typeof value === 'object' || typeof value === 'function')) {
      wrapped[key] = createSecureProxy(value as object, options);
    } else {
      // Primitives don't need proxying
      wrapped[key] = value;
    }
  }

  return wrapped;
}

/**
 * Create a secure version of standard library objects
 *
 * This creates proxied versions of Math, JSON, Array, Object, etc.
 * that block access to dangerous properties.
 */
export function createSecureStandardLibrary(options: SecureProxyOptions = {}): Record<string, unknown> {
  return wrapGlobalsWithSecureProxy(
    {
      Math,
      JSON,
      Array,
      Object,
      String,
      Number,
      Date,
      // Note: We intentionally don't include:
      // - Function (dangerous)
      // - eval (dangerous)
      // - Proxy, Reflect (meta-programming)
    },
    options,
  );
}

/**
 * Check if an object is a secure proxy
 *
 * @param obj Object to check
 * @returns true if the object is wrapped in a secure proxy
 */
export function isSecureProxy(obj: unknown): boolean {
  if (obj === null || typeof obj !== 'object') {
    return false;
  }
  return proxySet.has(obj as object);
}

/**
 * Clear the proxy cache
 *
 * @deprecated This function is a no-op. WeakMap and WeakSet entries are automatically
 * garbage collected when their target objects become unreachable. There is no need
 * to manually clear the cache.
 *
 * @throws {Error} Always throws to inform callers that this operation is not supported
 */
export function clearProxyCache(): void {
  throw new Error(
    'clearProxyCache is not supported. WeakMap/WeakSet entries are automatically garbage collected when target objects become unreachable.',
  );
}
