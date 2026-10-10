/**
 * Class identity shared by every copy of a package loaded in one process.
 *
 * A process can hold two copies of a FrontMCP package: in an ES-module project `@frontmcp/sdk`'s ESM
 * build loads `@frontmcp/observability` with `require()`, which resolves observability's CommonJS
 * build, which in turn loads the CommonJS builds of the SDK and of its dependencies. Each copy has its
 * own classes, so a plain `instanceof` in one copy does not recognise an instance made by the other:
 * an error the client was answered with as a `PublicMcpError` was recorded as an internal error with
 * a new id (#802).
 *
 * A branded class answers `instanceof` for its own instances as usual, and also for an instance of
 * the class with the same brand from another copy. The brand is an own property of the class, so a
 * subclass is recognised only through a brand of its own: an unbranded subclass keeps the plain
 * check, and never matches a different subclass that happens to share a branded parent.
 *
 * @example
 * ```ts
 * export class GuardError extends Error {
 *   static override [Symbol.hasInstance](value: unknown): boolean {
 *     return isBrandedInstance(this, value);
 *   }
 * }
 * brandClass(GuardError, '@frontmcp/guard:GuardError');
 * ```
 */

/** The key every copy stores a class brand under. */
const CLASS_BRAND: unique symbol = Symbol.for('@frontmcp/class-brand');

type BrandedClass = { [CLASS_BRAND]?: string };

const ordinaryHasInstance = Function.prototype[Symbol.hasInstance];

/** The brand a class declares itself, not one it inherits from a branded parent. */
function ownBrandOf(klass: unknown): string | undefined {
  if (typeof klass !== 'function' || !Object.prototype.hasOwnProperty.call(klass, CLASS_BRAND)) return undefined;
  return (klass as BrandedClass)[CLASS_BRAND];
}

/** The class a prototype object belongs to, read without running a getter. */
function classOfPrototype(proto: object): unknown {
  return Object.getOwnPropertyDescriptor(proto, 'constructor')?.value;
}

/**
 * Give `klass` a process-wide brand. The same class in another copy of its package carries the same
 * brand, so each recognises the other's instances through {@link isBrandedInstance}. Namespace the
 * brand with the package name (`'@frontmcp/sdk:McpError'`).
 */
export function brandClass(klass: object, brand: string): void {
  Object.defineProperty(klass, CLASS_BRAND, { value: brand, enumerable: false, writable: false, configurable: false });
}

/**
 * `value instanceof klass`, also true when `value` is an instance of the class that carries `klass`'s
 * own brand in another copy of the package. Meant as the `static [Symbol.hasInstance]` of a branded
 * class (subclasses inherit it, and match through their own brand or the plain check).
 */
export function isBrandedInstance(klass: object, value: unknown): boolean {
  if (ordinaryHasInstance.call(klass, value)) return true;
  if (typeof value !== 'object' || value === null) return false;
  const brand = ownBrandOf(klass);
  if (brand === undefined) return false;
  for (
    let proto = Object.getPrototypeOf(value) as object | null;
    proto !== null;
    proto = Object.getPrototypeOf(proto)
  ) {
    if (ownBrandOf(classOfPrototype(proto)) === brand) return true;
  }
  return false;
}
