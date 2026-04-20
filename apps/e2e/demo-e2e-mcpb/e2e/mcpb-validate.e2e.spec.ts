import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { ensureBuild, getArchivePath, runFrontmcp } from './helpers/mcpb-build';

describe('frontmcp mcpb validate', () => {
  beforeAll(async () => {
    await ensureBuild();
  });

  it('reports a valid archive produced by the build target', () => {
    const result = runFrontmcp(['mcpb', 'validate', getArchivePath()]);
    expect(result.exitCode).toBe(0);
    const combined = result.stdout + result.stderr;
    expect(combined).toContain('archive is valid');
    expect(combined).toContain('name=mcpb-demo');
    expect(combined).toContain('version=1.2.3');
  });

  it('exits non-zero and reports the error for a missing archive', () => {
    const missing = path.join(os.tmpdir(), 'does-not-exist.mcpb');
    const result = runFrontmcp(['mcpb', 'validate', missing]);
    expect(result.exitCode).not.toBe(0);
    expect(result.stdout + result.stderr).toContain('Cannot open archive');
  });

  it('rejects an archive that is not a valid ZIP', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcpb-e2e-'));
    try {
      const bogus = path.join(tmpDir, 'bogus.mcpb');
      fs.writeFileSync(bogus, 'not a zip archive');
      const result = runFrontmcp(['mcpb', 'validate', bogus]);
      expect(result.exitCode).not.toBe(0);
      expect(result.stdout + result.stderr).toContain('Cannot open archive');
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
