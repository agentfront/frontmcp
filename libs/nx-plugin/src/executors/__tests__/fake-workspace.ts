import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import type { ExecutorContext } from '../executor-context.js';

export interface FakeWorkspace {
  root: string;
  binPath: string;
  context: ExecutorContext;
  cleanup: () => void;
}

/** A workspace on disk with a `frontmcp` CLI installed under node_modules and one project `demo` in `apps/demo`. */
export function createFakeWorkspace(options: { installCli?: boolean } = {}): FakeWorkspace {
  const root = mkdtempSync(join(tmpdir(), 'frontmcp-nx-exec-'));
  const binPath = join(root, 'node_modules', 'frontmcp', 'dist', 'src', 'core', 'cli.js');
  if (options.installCli !== false) {
    mkdirSync(join(binPath, '..'), { recursive: true });
    writeFileSync(
      join(root, 'node_modules', 'frontmcp', 'package.json'),
      JSON.stringify({ bin: { frontmcp: 'dist/src/core/cli.js' } }),
    );
    writeFileSync(binPath, '');
  }
  mkdirSync(join(root, 'apps', 'demo'), { recursive: true });
  return {
    root,
    binPath,
    context: {
      root,
      cwd: root,
      projectName: 'demo',
      projectsConfigurations: { version: 2, projects: { demo: { root: 'apps/demo' } } },
      isVerbose: false,
      projectGraph: { nodes: {}, dependencies: {} },
      nxJsonConfiguration: {},
    },
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  };
}
