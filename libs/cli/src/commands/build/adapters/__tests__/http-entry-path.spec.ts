import * as os from 'os';
import * as path from 'path';

import { mkdtemp, readFile, rm, writeFile } from '@frontmcp/utils';

import { applyEntryPathToNodeEntry, entryPathEnvLine } from '../http-entry-path';

describe('entryPathEnvLine', () => {
  it('is empty without a configured path', () => {
    expect(entryPathEnvLine()).toBe('');
    expect(entryPathEnvLine({})).toBe('');
  });

  it('assigns the path as a string literal', () => {
    expect(entryPathEnvLine({ transportHttpPath: '/mcp' })).toBe('process.env.FRONTMCP_HTTP_ENTRY_PATH = "/mcp";\n');
  });
});

describe('applyEntryPathToNodeEntry (#642)', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), 'frontmcp-entry-path-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('prepends the assignment to the compiled entry', async () => {
    await writeFile(path.join(dir, 'main.js'), 'require("reflect-metadata");\n');
    expect(await applyEntryPathToNodeEntry(dir, 'main.ts', '/mcp')).toBe(true);
    const out = await readFile(path.join(dir, 'main.js'));
    expect(out.startsWith('// frontmcp: transport.http.path\nprocess.env.FRONTMCP_HTTP_ENTRY_PATH = "/mcp";\n')).toBe(true);
    expect(out).toContain('require("reflect-metadata");');
  });

  it('keeps a leading "use strict" directive first', async () => {
    await writeFile(path.join(dir, 'main.js'), '"use strict";\nrequire("x");\n');
    await applyEntryPathToNodeEntry(dir, 'main.ts', '/api');
    const out = await readFile(path.join(dir, 'main.js'));
    expect(out.startsWith('"use strict";\n')).toBe(true);
    expect(out.indexOf('FRONTMCP_HTTP_ENTRY_PATH')).toBeLessThan(out.indexOf('require("x")'));
  });

  it('is idempotent', async () => {
    await writeFile(path.join(dir, 'main.js'), 'require("x");\n');
    await applyEntryPathToNodeEntry(dir, 'main.ts', '/mcp');
    const once = await readFile(path.join(dir, 'main.js'));
    expect(await applyEntryPathToNodeEntry(dir, 'main.ts', '/mcp')).toBe(true);
    expect(await readFile(path.join(dir, 'main.js'))).toBe(once);
  });

  it('reports false when the compiled entry is missing', async () => {
    expect(await applyEntryPathToNodeEntry(dir, 'main.ts', '/mcp')).toBe(false);
  });

  it('produces a script that sets the env var before its own requires run', async () => {
    const { execFileSync } = await import('child_process');
    await writeFile(
      path.join(dir, 'main.js'),
      '"use strict";\nconsole.log(process.env.FRONTMCP_HTTP_ENTRY_PATH);\n',
    );
    await applyEntryPathToNodeEntry(dir, 'main.ts', '/mcp');
    const out = execFileSync('node', [path.join(dir, 'main.js')], {
      env: { ...process.env, FRONTMCP_HTTP_ENTRY_PATH: '' },
      encoding: 'utf-8',
    });
    expect(out.trim()).toBe('/mcp');
  });
});
