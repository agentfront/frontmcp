// file: libs/sdk/src/tool/undeclared-arguments.ts
import { hasTransform } from '@frontmcp/lazy-zod';
import { findDroppedKeys } from '@frontmcp/utils';

/** The argument key paths parsing dropped; below a field with a transform the shapes differ, so none are compared. */
export function findUndeclaredArguments(
  shape: Readonly<Record<string, unknown>>,
  sent: unknown,
  parsed: unknown,
): string[] {
  return findDroppedKeys(sent, parsed).filter((keyPath) => {
    const field = topLevelKeyOf(keyPath);
    return keyPath === field || !hasTransform(shape[field]);
  });
}

export function topLevelKeyOf(keyPath: string): string {
  return keyPath.split(/[.[]/, 1)[0];
}
