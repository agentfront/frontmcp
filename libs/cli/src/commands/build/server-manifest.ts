import * as path from 'path';

import { ensureDir, writeFile } from '@frontmcp/utils';

import { c } from '../../core/colors';
import { resolveEntry } from '../../shared/fs';
import { extractProjectSchema } from '../skills/from-entry';
import type { ExtractedManifest, ExtractedSchema } from './exec/cli-runtime/schema-extractor';

/** The file every target's output directory gets. */
export const SERVER_MANIFEST_FILE = 'frontmcp.manifest.json';

export interface EmitServerManifestOptions {
  cwd: string;
  entry?: string;
  outDir: string;
  /** Fail the build (exit code 1) on a lint finding, or when no manifest can be built. */
  strictLint?: boolean;
}

const extractions = new Map<string, Promise<ExtractedSchema>>();

/** One extraction per entry, shared by the targets one `frontmcp build` builds. */
function extractionOf(entry: string, cwd: string): Promise<ExtractedSchema> {
  const key = `${cwd}\0${entry}`;
  let extraction = extractions.get(key);
  if (!extraction) {
    extraction = extractProjectSchema({ entry, cwd });
    extractions.set(key, extraction);
  }
  return extraction;
}

/** The manifest of the server at `entry` (absolute), from the build's one extraction; none when it failed. */
export async function serverManifestOf(cwd: string, entry: string): Promise<ExtractedManifest | undefined> {
  const schema = await extractionOf(entry, cwd).catch(() => undefined);
  return schema?.manifest;
}

/** Write `frontmcp.manifest.json` into `dir`, and return its path. */
export async function writeServerManifest(dir: string, manifest: ExtractedManifest): Promise<string> {
  await ensureDir(dir);
  const manifestPath = path.join(dir, SERVER_MANIFEST_FILE);
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  return manifestPath;
}

function report(message: string, strict: boolean | undefined): void {
  if (strict) {
    console.log(c('red', message));
    process.exitCode = 1;
  } else {
    console.log(c('yellow', message));
  }
}

/** Write `frontmcp.manifest.json` into a target's output directory, and report its lint findings. */
export async function emitServerManifest(options: EmitServerManifestOptions): Promise<void> {
  let schema: ExtractedSchema;
  try {
    schema = await extractionOf(await resolveEntry(options.cwd, options.entry), options.cwd);
  } catch (err) {
    report(`[build] ${SERVER_MANIFEST_FILE} not written: ${err instanceof Error ? err.message : String(err)}`, options.strictLint);
    return;
  }
  if (!schema.manifest) {
    report(`[build] ${SERVER_MANIFEST_FILE} not written: ${schema.manifestError ?? 'no manifest was built'}`, options.strictLint);
    return;
  }

  const manifestPath = await writeServerManifest(options.outDir, schema.manifest);
  console.log(c('green', `  Wrote ${path.relative(options.cwd, manifestPath)}`));

  const findings = schema.manifestFindings ?? [];
  for (const finding of findings) report(`[build] manifest lint (${finding.rule}): ${finding.message}`, options.strictLint);
  if (options.strictLint && findings.length > 0) {
    console.log(c('red', `[build] ${findings.length} manifest lint finding(s); --strict-lint fails the build.`));
  }
}
