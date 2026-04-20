/**
 * Stage the MCPB archive layout on disk before zipping.
 *
 * Layout produced:
 *
 *   __stage/
 *     manifest.json
 *     server/
 *       index.js          (esbuild bundle, renamed from {name}.bundle.js)
 *       package.json      (minimal CJS manifest so Node resolves index.js)
 *       _skills/          (optional — when the server ships skills)
 *     bin/                (optional — when SEA is enabled)
 *       {platform}/{name}[.exe]
 *     icon.png            (optional)
 *     README.md           (optional)
 */

import * as fs from 'fs';
import * as path from 'path';
import type { BinaryEntry } from './binary';
import type { ExtractedSchema } from '../exec/cli-runtime/schema-extractor';
import { copySkillAssets } from '../exec/skill-assets';

export interface StageInput {
  stageDir: string;
  /** Project root (for reading README, icon, etc.). */
  cwd: string;
  /** Absolute path to the esbuild server bundle. */
  serverBundlePath: string;
  /** App name — written into server/package.json. */
  name: string;
  /** App version — written into server/package.json. */
  version: string;
  /** Schema extracted from the bundle (drives skill asset copy). */
  schema: ExtractedSchema;
  /** Absolute path of a resolved icon file (optional). */
  iconPath?: string;
  /** Binaries to stage under bin/{platform}/. */
  binaries?: BinaryEntry[];
  /** When true, copy README.md from cwd if present. @default true */
  includeReadme?: boolean;
}

export interface StageResult {
  stageDir: string;
  /** Relative paths written into the stage (for logging). */
  written: string[];
  /** Whether an icon was actually staged (drives manifest.icon field). */
  hasIcon: boolean;
  /** Number of skill asset files copied (zero when no skills). */
  skillAssetCount: number;
}

/** Build the staged `__stage/` tree on disk. */
export function stageMcpbDirectory(input: StageInput): StageResult {
  const {
    stageDir,
    cwd,
    serverBundlePath,
    name,
    version,
    schema,
    iconPath,
    binaries = [],
    includeReadme = true,
  } = input;

  const written: string[] = [];
  fs.mkdirSync(stageDir, { recursive: true });

  // 1. server/
  const serverDir = path.join(stageDir, 'server');
  fs.mkdirSync(serverDir, { recursive: true });

  const serverIndex = path.join(serverDir, 'index.js');
  fs.copyFileSync(serverBundlePath, serverIndex);
  written.push('server/index.js');

  // Minimal server/package.json so Node resolves index.js as CJS.
  const serverPkg = {
    name,
    version,
    main: 'index.js',
    type: 'commonjs',
    private: true,
  };
  fs.writeFileSync(
    path.join(serverDir, 'package.json'),
    `${JSON.stringify(serverPkg, null, 2)}\n`,
  );
  written.push('server/package.json');

  // 2. server/_skills/ (if the bundle exposes skills)
  const skillsResult = copySkillAssets(serverDir, schema.skillAssets);
  if (skillsResult.copiedCount > 0) {
    written.push('server/_skills/');
  }

  // 3. bin/{platform}/{file}
  for (const bin of binaries) {
    const destDir = path.join(stageDir, 'bin', bin.platform);
    fs.mkdirSync(destDir, { recursive: true });
    const destFile = path.join(destDir, bin.fileName);
    fs.copyFileSync(bin.srcPath, destFile);
    try {
      fs.chmodSync(destFile, 0o755);
    } catch {
      // Windows or a filesystem that rejects chmod — safe to ignore.
    }
    written.push(`bin/${bin.platform}/${bin.fileName}`);
  }

  // 4. icon.png
  let hasIcon = false;
  if (iconPath && fs.existsSync(iconPath)) {
    const destIcon = path.join(stageDir, 'icon.png');
    fs.copyFileSync(iconPath, destIcon);
    written.push('icon.png');
    hasIcon = true;
  }

  // 5. README.md
  if (includeReadme) {
    const readmePath = path.join(cwd, 'README.md');
    if (fs.existsSync(readmePath)) {
      fs.copyFileSync(readmePath, path.join(stageDir, 'README.md'));
      written.push('README.md');
    }
  }

  return {
    stageDir,
    written,
    hasIcon,
    skillAssetCount: skillsResult.copiedCount,
  };
}

/** Write the final manifest.json to the stage root. */
export function writeManifest(stageDir: string, manifest: unknown): string {
  const manifestPath = path.join(stageDir, 'manifest.json');
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  return manifestPath;
}
