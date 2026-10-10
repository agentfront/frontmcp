import { tmpdir } from 'node:os';
import * as path from 'node:path';

import { cp, mkdir, mkdtemp, realpath, symlink } from '@frontmcp/utils';

export const WORKSPACE = path.resolve(__dirname, '../../../../..');
export const ESM_PROJECT_FIXTURE = path.resolve(__dirname, '../../fixture/esm-project');

const LINK_TYPE = process.platform === 'win32' ? 'junction' : 'dir';

export interface EsmProjectOptions {
  /** `@frontmcp/<name>` packages linked to their built `libs/<name>/dist`. */
  frontmcpPackages: readonly string[];
  /** Workspace `node_modules` entries the fixture imports itself (a scope such as `@opentelemetry` links whole). */
  thirdParty: readonly string[];
}

/**
 * The ES-module fixture (`"type": "module"`) copied into a temporary project whose node_modules link
 * each @frontmcp package to its built `dist`, the layout `npm install` produces. Outside the monorepo,
 * nothing (no tsconfig `paths`, no `development` condition) can point a package at its TypeScript
 * sources, so Node loads the packages' ESM bundles, and their CommonJS bundles wherever a bundle
 * `require()`s another package.
 */
export async function createEsmProject(options: EsmProjectOptions): Promise<string> {
  const dir = await realpath(await mkdtemp(path.join(tmpdir(), 'frontmcp-esm-project-')));
  await cp(ESM_PROJECT_FIXTURE, dir, { recursive: true });
  await mkdir(path.join(dir, 'node_modules', '@frontmcp'), { recursive: true });
  for (const name of options.frontmcpPackages) {
    await symlink(
      path.join(WORKSPACE, 'libs', name, 'dist'),
      path.join(dir, 'node_modules', '@frontmcp', name),
      LINK_TYPE,
    );
  }
  for (const name of options.thirdParty) {
    await symlink(path.join(WORKSPACE, 'node_modules', name), path.join(dir, 'node_modules', name), LINK_TYPE);
  }
  return dir;
}
