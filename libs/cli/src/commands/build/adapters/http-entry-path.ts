import * as path from 'path';

import { fileExists, readFile, writeFile } from '@frontmcp/utils';

import type { AdapterBuildContext } from '../types';

/**
 * `transport.http.path` configures the CLI while the server reads
 * `@FrontMcp({ http: { entryPath } })`. The SDK's `entryPath` default reads
 * `FRONTMCP_HTTP_ENTRY_PATH` (the seam `frontmcp dev` uses), so a built server
 * gets the configured path by setting it before the decorator runs. It only
 * supplies the default — an explicit decorator `entryPath` still wins.
 */
export function entryPathEnvLine(context?: AdapterBuildContext): string {
  const entryPath = context?.transportHttpPath;
  return entryPath ? `process.env.FRONTMCP_HTTP_ENTRY_PATH = ${JSON.stringify(entryPath)};\n` : '';
}

const NODE_ENTRY_MARKER = '// frontmcp: transport.http.path';
const USE_STRICT_PREFIX = /^(\s*(?:"use strict"|'use strict');?[ \t]*\r?\n)/;

/**
 * The node target has no generated wrapper — `node dist/main.js` runs the
 * compiled entry directly — so the configured path is set on its first line,
 * after a leading `"use strict"` so the directive keeps its meaning. Returns
 * false when the compiled entry is not where the build expects it.
 */
export async function applyEntryPathToNodeEntry(outDir: string, entryBasename: string, entryPath: string): Promise<boolean> {
  const compiled = path.join(outDir, entryBasename.replace(/\.[cm]?[jt]sx?$/, '.js'));
  if (!(await fileExists(compiled))) return false;
  const source = await readFile(compiled);
  if (source.includes(NODE_ENTRY_MARKER)) return true;
  const line = `${NODE_ENTRY_MARKER}\nprocess.env.FRONTMCP_HTTP_ENTRY_PATH = ${JSON.stringify(entryPath)};\n`;
  const strict = USE_STRICT_PREFIX.exec(source);
  const next = strict ? strict[1] + line + source.slice(strict[1].length) : line + source;
  await writeFile(compiled, next);
  return true;
}
