import type { infer as zInfer, ZodTypeAny } from 'zod';

export class LazyZodSchema<T extends ZodTypeAny> {
  private _resolved: T | undefined;
  readonly _output!: zInfer<T>;
  readonly _input!: zInfer<T>;

  constructor(private readonly factory: () => T) {}

  private materialize(): T {
    const inner = this.factory();
    this._resolved = inner;
    // Self-patch: replace hot-path methods with bound calls that bypass
    // the wrapper. After first call, parse/safeParse etc. are one-hop.
    this.parse = inner.parse.bind(inner) as LazyZodSchema<T>['parse'];
    this.safeParse = inner.safeParse.bind(inner) as LazyZodSchema<T>['safeParse'];
    this.parseAsync = inner.parseAsync.bind(inner) as LazyZodSchema<T>['parseAsync'];
    this.safeParseAsync = inner.safeParseAsync.bind(inner) as LazyZodSchema<T>['safeParseAsync'];
    return inner;
  }

  private inner(): T {
    return this._resolved ?? this.materialize();
  }

  get _def() {
    return (this.inner() as ZodTypeAny)._def;
  }

  parse(data: unknown): zInfer<T> {
    return this.inner().parse(data) as zInfer<T>;
  }

  safeParse(data: unknown) {
    return this.inner().safeParse(data);
  }

  parseAsync(data: unknown): Promise<zInfer<T>> {
    return this.inner().parseAsync(data) as Promise<zInfer<T>>;
  }

  safeParseAsync(data: unknown) {
    return this.inner().safeParseAsync(data);
  }

  optional() {
    return this.inner().optional();
  }

  nullable() {
    return this.inner().nullable();
  }

  describe(description: string) {
    return this.inner().describe(description);
  }
}

export const lazyZ = <T extends ZodTypeAny>(factory: () => T): LazyZodSchema<T> => new LazyZodSchema(factory);

export type InferLazy<L> = L extends LazyZodSchema<infer T> ? zInfer<T> : never;
