import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { copySkillAssets } from '../skill-assets';
import type { ExtractedSkillAsset } from '../cli-runtime/schema-extractor';

describe('copySkillAssets', () => {
  let tmpDir: string;
  let srcDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-assets-'));
    srcDir = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-src-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    fs.rmSync(srcDir, { recursive: true, force: true });
  });

  it('returns zero when no assets provided', () => {
    const result = copySkillAssets(tmpDir, []);
    expect(result.copiedCount).toBe(0);
    expect(result.skillsDir).toBe('');
    expect(fs.existsSync(path.join(tmpDir, '_skills'))).toBe(false);
  });

  it('copies instruction file with flat naming', () => {
    const instr = path.join(srcDir, 'SKILL.md');
    fs.writeFileSync(instr, '# hi');

    const result = copySkillAssets(tmpDir, [
      { skillName: 'greet', instructionFile: instr },
    ]);

    expect(result.copiedCount).toBe(1);
    const dest = path.join(tmpDir, '_skills', 'greet--SKILL.md');
    expect(fs.existsSync(dest)).toBe(true);
    expect(fs.readFileSync(dest, 'utf-8')).toBe('# hi');
  });

  it('copies resource directories recursively and emits manifest', () => {
    const refDir = path.join(srcDir, 'references');
    fs.mkdirSync(refDir, { recursive: true });
    fs.writeFileSync(path.join(refDir, 'r.md'), 'ref');

    const asset: ExtractedSkillAsset = {
      skillName: 'alpha',
      resourceDirs: { references: refDir },
    };

    const result = copySkillAssets(tmpDir, [asset]);

    expect(result.copiedCount).toBe(1);
    const copied = path.join(tmpDir, '_skills', 'alpha--references', 'r.md');
    expect(fs.existsSync(copied)).toBe(true);

    const manifest = JSON.parse(
      fs.readFileSync(path.join(tmpDir, '_skills', 'manifest.json'), 'utf-8'),
    );
    expect(manifest.alpha.references).toBe('_skills/alpha--references');
  });

  it('skips missing instruction files without throwing', () => {
    const result = copySkillAssets(tmpDir, [
      { skillName: 'ghost', instructionFile: '/does/not/exist.md' },
    ]);
    expect(result.copiedCount).toBe(0);
  });
});
