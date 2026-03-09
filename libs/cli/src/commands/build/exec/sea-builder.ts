/**
 * Node.js Single Executable Application (SEA) builder.
 *
 * Packages a CJS bundle into a standalone binary that includes the Node.js runtime.
 * Requires Node.js >= 20.13.0.
 *
 * Build steps:
 * 1. Generate SEA config JSON
 * 2. Run `node --experimental-sea-config` to create the SEA blob
 * 3. Copy the current `node` binary
 * 4. Inject the blob using `postject`
 * 5. Re-sign on macOS (ad-hoc)
 */

import * as path from 'path';
import * as fs from 'fs';
import { runCmd } from '@frontmcp/utils';
import { c } from '../../../core/colors';

export interface SeaBuildResult {
  executablePath: string;
  executableSize: number;
}

export async function buildSea(
  bundlePath: string,
  outDir: string,
  appName: string,
): Promise<SeaBuildResult> {
  const blobPath = path.join(outDir, `${appName}.blob`);
  const seaConfigPath = path.join(outDir, `${appName}.sea-config.json`);
  const executablePath = path.join(outDir, `${appName}-bin`);

  // 1. Generate SEA config
  const seaConfig = {
    main: bundlePath,
    output: blobPath,
    disableExperimentalSEAWarning: true,
    useCodeCache: true,
  };
  fs.writeFileSync(seaConfigPath, JSON.stringify(seaConfig, null, 2));
  console.log(`${c('cyan', '[build:sea]')} generated SEA config`);

  // 2. Generate the SEA blob
  await runCmd('node', ['--experimental-sea-config', seaConfigPath]);
  console.log(`${c('cyan', '[build:sea]')} generated SEA blob`);

  // 3. Copy current node binary
  const nodePath = process.execPath;
  fs.copyFileSync(nodePath, executablePath);
  fs.chmodSync(executablePath, 0o755);
  console.log(`${c('cyan', '[build:sea]')} copied node binary`);

  // 4. On macOS, remove the existing signature before injection
  if (process.platform === 'darwin') {
    try {
      await runCmd('codesign', ['--remove-signature', executablePath]);
      console.log(`${c('cyan', '[build:sea]')} removed macOS signature`);
    } catch {
      // codesign may not be available in all environments
    }
  }

  // 5. Inject the blob using postject
  await runCmd('npx', [
    '-y',
    'postject',
    executablePath,
    'NODE_SEA_BLOB',
    blobPath,
    '--sentinel-fuse',
    'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2',
    ...(process.platform === 'darwin' ? ['--macho-segment-name', 'NODE_SEA'] : []),
  ]);
  console.log(`${c('green', '[build:sea]')} blob injected`);

  // 6. Re-sign on macOS with ad-hoc signature
  if (process.platform === 'darwin') {
    try {
      await runCmd('codesign', ['-s', '-', executablePath]);
      console.log(`${c('cyan', '[build:sea]')} re-signed macOS binary`);
    } catch {
      // codesign may not be available
    }
  }

  // 7. Clean up intermediate files
  fs.unlinkSync(blobPath);
  fs.unlinkSync(seaConfigPath);

  const stat = fs.statSync(executablePath);
  return { executablePath, executableSize: stat.size };
}
