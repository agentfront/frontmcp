import {
  ToolMetadata,
  FrontMcpToolTokens,
  ToolType,
  Token,
  ToolRecord,
  ToolKind,
  EntryLineage,
  Type, ToolContext, extendedToolMetadata
} from '@frontmcp/sdk';
import {depsOfClass, depsOfFunc, isClass} from '../utils/token.utils';
import {getMetadata} from '../utils/metadata.utils';
import {NameCase} from "./tool.types";

export function collectToolMetadata(cls: ToolType): ToolMetadata {

  const extended = getMetadata(extendedToolMetadata, cls);
  const seed = (extended ? {...extended} : {}) as ToolMetadata;
  return Object.entries(FrontMcpToolTokens).reduce((metadata, [key, token]) => {
    const value = getMetadata(token, cls);
    if (value) {
      return Object.assign(metadata, {
        [key]: value
      });
    } else {
      return metadata;
    }
  }, seed);
}

export function normalizeTool(item: any): ToolRecord {
  if (item && typeof item === 'function' && item[FrontMcpToolTokens.type] === 'function-tool' && item[FrontMcpToolTokens.metadata]) {
    return {
      kind: ToolKind.FUNCTION,
      provide: item(),
      metadata: item[FrontMcpToolTokens.metadata] as ToolMetadata,
    };
  }

  if (isClass(item)) {
    // read McpToolMetadata from class
    const metadata = collectToolMetadata(item);
    return {kind: ToolKind.CLASS_TOKEN, provide: item as Type<ToolContext>, metadata};
  }
  const name = (item as any)?.name ?? String(item);
  throw new Error(
    `Invalid adapter '${name}'. Expected a class or a adapter object.`,
  );
}

/**
 * For graph/cycle detection. Returns dependency tokens that should be graphed.
 * - FUNCTION: get function params without the first argument (the tool input)
 * - CLASS_TOKEN: deps come from the class constructor
 */
export function toolDiscoveryDeps(rec: ToolRecord): Token[] {
  switch (rec.kind) {
    case ToolKind.FUNCTION: {
      return depsOfFunc(rec.provide, 'discovery');
    }
    case ToolKind.CLASS_TOKEN:
      return depsOfClass(rec.provide, 'discovery');
  }
}


// Allowed chars per MCP spec: a-zA-Z0-9 _ -. /
const MCP_ALLOWED = /[A-Za-z0-9_\-./]/;

export function splitWords(input: string): string[] {
  const parts: string[] = [];
  let buff = '';
  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    const isAlphaNum = /[A-Za-z0-9]/.test(ch);
    if (!isAlphaNum) {
      if (buff) {
        parts.push(buff);
        buff = '';
      }
      continue;
    }
    if (buff && /[a-z]/.test(buff[buff.length - 1]) && /[A-Z]/.test(ch)) {
      parts.push(buff);
      buff = ch;
    } else {
      buff += ch;
    }
  }
  if (buff) parts.push(buff);
  return parts;
}

export function toCase(words: string[], kind: NameCase): string {
  const safe = words.filter(Boolean);
  switch (kind) {
    case 'snake':
      return safe.map(w => w.toLowerCase()).join('_');
    case 'kebab':
      return safe.map(w => w.toLowerCase()).join('-');
    case 'dot':
      return safe.map(w => w.toLowerCase()).join('.');
    case 'camel':
      if (safe.length === 0) return '';
      return safe[0].toLowerCase() + safe.slice(1)
        .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join('');
  }
}

export function normalizeSegment(raw: string, kind: NameCase): string {
  const words = splitWords(raw);
  let cased = toCase(words, kind);
  cased = [...cased].filter(ch => MCP_ALLOWED.test(ch)).join('');
  return cased || 'x';
}

export function normalizeProviderId(raw: string | undefined, kind: NameCase): string | undefined {
  if (!raw) return undefined;
  const tokens = raw.split(/\W+/);
  const cased = toCase(tokens, kind);
  const safe = [...cased].filter(ch => MCP_ALLOWED.test(ch)).join('');
  return safe || undefined;
}

export function normalizeOwnerPath(ownerKey: string, kind: NameCase): string {
  const levels = ownerKey.split('/');
  const normLevels = levels.map(level => {
    const parts = level.split(':'); // ["app","Portal"]
    return parts.map(p => normalizeSegment(p, kind)).join(
      kind === 'snake' ? '_' : kind === 'kebab' ? '-' : kind === 'dot' ? '.' : '',
    );
  });
  if (kind === 'camel') return normLevels.map(seg => seg.charAt(0).toLowerCase() + seg.slice(1)).join('');
  const sep = kind === 'snake' ? '_' : kind === 'kebab' ? '-' : '.';
  return normLevels.join(sep);
}

export function shortHash(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h) + s.charCodeAt(i);
  return (h >>> 0).toString(16).slice(-6).padStart(6, '0');
}

export function ensureMaxLen(name: string, max: number): string {
  if (name.length <= max) return name;
  const hash = shortHash(name);
  const lastSep = Math.max(name.lastIndexOf('_'), name.lastIndexOf('-'), name.lastIndexOf('.'), name.lastIndexOf('/'));
  const tail = lastSep > 0 ? name.slice(lastSep + 1) : name.slice(-Math.max(3, Math.min(16, Math.floor(max / 4))));
  const budget = Math.max(1, max - (1 + hash.length + 1 + tail.length));
  const prefix = name.slice(0, budget);
  return `${prefix}-${hash}-${tail}`.slice(0, max);
}

export function sepFor(kind: NameCase): string {
  return kind === 'snake' ? '_' : kind === 'kebab' ? '-' : kind === 'dot' ? '.' : '';
}

export function ownerKeyOf(lineage: EntryLineage): string {
  return lineage.map(o => `${o.kind}:${o.id}`).join('/');
}

export function qualifiedNameOf(lineage: EntryLineage, name: string): string {
  return `${ownerKeyOf(lineage)}:${name}`;
}
