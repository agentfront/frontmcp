import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { sha256Hex } from '@frontmcp/utils';

import { withWorkspaceProtocolFallback } from '../test-server';

describe('withWorkspaceProtocolFallback', () => {
  let workspace: string;
  let sharedPathRoot: string;

  beforeEach(() => {
    workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'protocol-fallback-workspace-'));
    fs.mkdirSync(path.join(workspace, 'libs', 'protocol', 'dist'), { recursive: true });
    fs.writeFileSync(path.join(workspace, 'libs', 'protocol', 'dist', 'index.js'), '');
    sharedPathRoot = path.join(os.tmpdir(), 'frontmcp-test-node-path', sha256Hex(workspace).slice(0, 12));
  });

  afterEach(() => {
    fs.rmSync(workspace, { recursive: true, force: true });
    fs.rmSync(sharedPathRoot, { recursive: true, force: true });
  });

  it('points NODE_PATH at a new private directory, not at a package already in the shared temporary path', () => {
    const existingPackage = path.join(sharedPathRoot, '@frontmcp', 'protocol');
    fs.mkdirSync(existingPackage, { recursive: true });
    fs.writeFileSync(path.join(existingPackage, 'package.json'), '{"name":"@frontmcp/protocol"}');

    const env = withWorkspaceProtocolFallback({ NODE_PATH: '/existing' }, workspace);

    const [aliasRoot, ...rest] = (env['NODE_PATH'] ?? '').split(path.delimiter);
    expect(aliasRoot).not.toBe(sharedPathRoot);
    expect(rest).toEqual(['/existing']);
    expect(fs.realpathSync(path.join(aliasRoot, '@frontmcp', 'protocol'))).toBe(
      fs.realpathSync(path.join(workspace, 'libs', 'protocol')),
    );
    if (process.platform !== 'win32') {
      expect(fs.statSync(aliasRoot).mode & 0o777).toBe(0o700);
    }
  });
});
