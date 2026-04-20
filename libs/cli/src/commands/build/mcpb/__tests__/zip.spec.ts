import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createDeterministicZip, listFilesForArchive } from '../zip';
import { validateMcpb } from '../validate';
import { mcpbManifestSchema } from '../manifest';

describe('listFilesForArchive', () => {
  let tmp: string;
  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mcpb-list-'));
  });
  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('lists files recursively and sorts lexicographically', () => {
    fs.mkdirSync(path.join(tmp, 'server'));
    fs.writeFileSync(path.join(tmp, 'server', 'index.js'), 'a');
    fs.writeFileSync(path.join(tmp, 'manifest.json'), 'b');
    fs.mkdirSync(path.join(tmp, 'bin', 'darwin-arm64'), { recursive: true });
    fs.writeFileSync(path.join(tmp, 'bin', 'darwin-arm64', 'demo'), 'c');

    const files = listFilesForArchive(tmp).map((f) => f.archivePath);
    expect(files).toEqual(['bin/darwin-arm64/demo', 'manifest.json', 'server/index.js']);
  });
});

describe('createDeterministicZip', () => {
  let tmp: string;
  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mcpb-zip-'));
  });
  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  function seedStage(name: string): { stageDir: string; archivePath: string } {
    const stageDir = path.join(tmp, name, '__stage');
    fs.mkdirSync(path.join(stageDir, 'server'), { recursive: true });
    fs.writeFileSync(path.join(stageDir, 'server', 'index.js'), 'console.log("hi")');
    const manifest = {
      manifest_version: '0.3',
      name: 'demo',
      version: '1.0.0',
      description: 'Demo',
      author: { name: 'Tester' },
      server: {
        type: 'node',
        entry_point: 'server/index.js',
        mcp_config: { command: 'node', args: ['${__dirname}/server/index.js'] },
      },
    };
    // sanity-check our fixture matches the schema
    expect(mcpbManifestSchema.safeParse(manifest).success).toBe(true);
    fs.writeFileSync(path.join(stageDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
    return { stageDir, archivePath: path.join(tmp, `${name}.mcpb`) };
  }

  it('produces a zip that validates end-to-end', async () => {
    const { stageDir, archivePath } = seedStage('valid');
    const result = await createDeterministicZip(stageDir, archivePath);
    expect(result.size).toBeGreaterThan(0);
    expect(result.entries.sort()).toEqual(['manifest.json', 'server/index.js']);

    const validation = await validateMcpb(archivePath);
    expect(validation.errors).toEqual([]);
    expect(validation.ok).toBe(true);
  });

  it('two back-to-back builds produce identical SHA-256 (deterministic mode)', async () => {
    const first = seedStage('det-a');
    const second = seedStage('det-b');
    const a = await createDeterministicZip(first.stageDir, first.archivePath);
    const b = await createDeterministicZip(second.stageDir, second.archivePath);
    expect(a.sha256).toBe(b.sha256);
  });

  it('includes files in lexicographic order in the entry list', async () => {
    const { stageDir, archivePath } = seedStage('order');
    fs.mkdirSync(path.join(stageDir, 'bin', 'darwin-arm64'), { recursive: true });
    fs.writeFileSync(path.join(stageDir, 'bin', 'darwin-arm64', 'demo'), 'binary');
    fs.writeFileSync(path.join(stageDir, 'icon.png'), 'png');

    const result = await createDeterministicZip(stageDir, archivePath);
    expect(result.entries).toEqual([
      'bin/darwin-arm64/demo',
      'icon.png',
      'manifest.json',
      'server/index.js',
    ]);
  });
});
