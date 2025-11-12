import { DESIGN_PARAMTYPES, META_ASYNC_WITH_TOKENS, Token, Type } from '../common';
import { getMetadata, hasAsyncWith } from './metadata.utils';

export const tokenName = (t: Token): string =>
  typeof t === 'function' && !!(t as any).prototype
    ? (t as any).name
    : (t as any)?.name ?? '[ref]';

export const isClass = (x: any): x is Type =>
  typeof x === 'function' && !!x.prototype;

export const isPromise = (v: any): v is Promise<any> =>
  !!v && typeof v.then === 'function';

export function getAsyncWithTokens(klass: Type<any>): Type<any>[] | null {
  const resolver = getMetadata<null | (() => any[])>(
    META_ASYNC_WITH_TOKENS,
    klass,
  ) as null | (() => any[]);
  if (!resolver) return null;
  const arr = resolver() ?? [];
  return arr.filter(isClass) as Type<any>[];
}

/** Read param types for static with(...) only; TDZ-friendly. */
export function readWithParamTypes(klass: Type, forWhat: 'discovery' | 'invocation'): Type[] {
  const lazy = getAsyncWithTokens(klass);
  if (lazy) return lazy;

  const meta = getMetadata<unknown[]>(DESIGN_PARAMTYPES, klass, 'with') as unknown[] | undefined;
  if (meta === undefined) {
    const where = `${klass.name}.with(...)`;
    const hint =
      'Add @AsyncWith(() => [DepA, DepB]) to lazily declare deps, or decorate \'with\' so TypeScript emits design:paramtypes.';
    throw new Error(`Cannot discover ${forWhat} deps for ${where}. ${hint}`);
  }

  const tdzIdx = meta.findIndex((t) => t === undefined);
  if (tdzIdx !== -1) {
    const where = `${klass.name}.with(...)`;
    throw new Error(
      `Unresolved dependency at param #${tdzIdx} in ${where} (ESM circular import / TDZ).\n` +
      `Fix: add @AsyncWith(() => [/* deps */]) on ${klass.name} to avoid TDZ, or refactor the import cycle.`,
    );
  }

  return (meta as any[]).filter(isClass) as Type[];
}


/** Discover deps for a CLASS token or a concrete Type (ctor/with). */
export function depsOfClass(klass: Type, phase: 'discovery' | 'invocation'): Type[] {
  if (hasAsyncWith(klass)) return readWithParamTypes(klass, phase);
  const ctorMeta: unknown[] = getMetadata<unknown[]>(DESIGN_PARAMTYPES, klass) ?? [];
  const tdzIdx = ctorMeta.findIndex((t) => t === undefined);
  if (tdzIdx !== -1) {
    throw new Error(
      `Unresolved constructor dependency in ${klass.name} at param #${tdzIdx} (ESM circular import / TDZ).\n` +
      `Fix: convert this provider to @AsyncWith(() => [/* deps */]) and use a static with(...), or break the import cycle.`,
    );
  }
  return (ctorMeta as any[]).filter(isClass) as Type[];
}


/** Discover deps for a Function token  without the first N args. */
export function depsOfFunc(fn: (...args: any[])=>any | Promise<any>, phase: 'discovery' | 'invocation'): Type[] {
  const [_ignoreInput, ...fnMeta]: unknown[] = getMetadata<unknown[]>(DESIGN_PARAMTYPES, fn) ?? [];
  const tdzIdx = fnMeta.findIndex((t) => t === undefined);
  if (tdzIdx !== -1) {
    throw new Error(`Unresolved function dependency in ${fn.name} at param #${tdzIdx} (ESM circular import / TDZ).\n`);
  }
  return (fnMeta as any[]).filter(isClass) as Type[];
}
