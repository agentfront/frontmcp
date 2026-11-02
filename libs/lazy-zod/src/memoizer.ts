import { z as realZ } from 'zod';
import type { $ZodMemoizer } from 'zod/v4/core';

/** A registry symbol, so every copy of lazy-zod in the process recognizes the others' walk-less memoizers. */
const WALKLESS: unique symbol = Symbol.for('@frontmcp/lazy-zod.walklessMemoizer');

const zodConfig = realZ.config();
const defaultMemoizer = (realZ as { memoizer?: () => $ZodMemoizer }).memoizer;
const walklessMemoizers = new WeakMap<$ZodMemoizer, $ZodMemoizer>();

function isWalkless(memoizer: $ZodMemoizer | undefined): memoizer is $ZodMemoizer {
  return (memoizer as Record<symbol, unknown> | undefined)?.[WALKLESS] === true;
}

function buildWith<T>(memoizer: $ZodMemoizer, build: () => T): T {
  const saved = zodConfig.memoizer;
  zodConfig.memoizer = memoizer;
  try {
    return build();
  } finally {
    zodConfig.memoizer = saved;
  }
}

/** Zod's memoizer walks a container's whole subtree on its first parse, which would build every stand-in in it. */
export function withoutRecursionWalk<T>(build: () => T): T {
  const memoizer = zodConfig.memoizer ?? defaultMemoizer?.();
  if (!memoizer || isWalkless(memoizer)) return build();
  let walkless = walklessMemoizers.get(memoizer);
  if (!walkless) {
    walkless = Object.create(memoizer, {
      attach: { value: () => undefined },
      [WALKLESS]: { value: true },
    }) as $ZodMemoizer;
    walklessMemoizers.set(memoizer, walkless);
  }
  return buildWith(walkless, build);
}

/** Builds a schema that isn't FrontMCP's own, even inside a FrontMCP build, with Zod's memoizer and its cycle check. */
export function withRecursionWalk<T>(build: () => T): T {
  const memoizer = zodConfig.memoizer;
  return isWalkless(memoizer) ? buildWith(Object.getPrototypeOf(memoizer) as $ZodMemoizer, build) : build();
}
