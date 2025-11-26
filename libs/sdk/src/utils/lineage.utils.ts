// file: libs/sdk/src/utils/lineage.utils.ts
// Owner lineage and qualified name utilities

import { EntryLineage } from '../common';

/**
 * Convert an entry lineage to a string key.
 *
 * @example
 * ownerKeyOf([{ kind: 'app', id: 'Portal' }, { kind: 'plugin', id: 'Auth' }])
 * => "app:Portal/plugin:Auth"
 */
export function ownerKeyOf(lineage: EntryLineage): string {
  return lineage.map((o) => `${o.kind}:${o.id}`).join('/');
}

/**
 * Create a fully qualified name from lineage and name.
 *
 * @example
 * qualifiedNameOf([{ kind: 'app', id: 'Portal' }], 'myTool')
 * => "app:Portal:myTool"
 */
export function qualifiedNameOf(lineage: EntryLineage, name: string): string {
  return `${ownerKeyOf(lineage)}:${name}`;
}

/**
 * Parse a qualified name back into lineage and name.
 *
 * @example
 * parseQualifiedName("app:Portal/plugin:Auth:myTool")
 * => { lineage: [{ kind: 'app', id: 'Portal' }, { kind: 'plugin', id: 'Auth' }], name: 'myTool' }
 */
export function parseQualifiedName(qualifiedName: string): { lineage: EntryLineage; name: string } | null {
  const lastColon = qualifiedName.lastIndexOf(':');
  if (lastColon === -1) return null;

  const ownerKey = qualifiedName.slice(0, lastColon);
  const name = qualifiedName.slice(lastColon + 1);

  const lineage: EntryLineage = [];
  const parts = ownerKey.split('/');

  for (const part of parts) {
    const colonIdx = part.indexOf(':');
    if (colonIdx === -1) continue;
    const kind = part.slice(0, colonIdx);
    if (kind !== 'scope' && kind !== 'app' && kind !== 'plugin') continue;
    const id = part.slice(colonIdx + 1);
    // `ref` is required by EntryOwnerRef but cannot be resolved from string parsing.
    // Callers must resolve the ref from context if needed.
    lineage.push({ kind, id, ref: undefined as any });
  }

  return { lineage, name };
}

/**
 * Get the depth of a lineage (number of owners).
 */
export function lineageDepth(lineage: EntryLineage): number {
  return lineage.length;
}

/**
 * Check if two lineages are equal.
 */
export function lineagesEqual(a: EntryLineage, b: EntryLineage): boolean {
  if (a.length !== b.length) return false;
  return a.every((owner, i) => owner.kind === b[i].kind && owner.id === b[i].id);
}

/**
 * Check if lineage `a` is an ancestor of lineage `b`.
 */
export function isAncestorLineage(ancestor: EntryLineage, descendant: EntryLineage): boolean {
  if (ancestor.length >= descendant.length) return false;
  return ancestor.every((owner, i) => owner.kind === descendant[i].kind && owner.id === descendant[i].id);
}
