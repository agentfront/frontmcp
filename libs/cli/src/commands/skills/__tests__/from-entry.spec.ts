import * as os from 'os';
import * as path from 'path';

import { mkdtemp, readdir, rm, writeFile } from '@frontmcp/utils';

import { extractProjectSchema } from '../from-entry';

const mockExtractSchemas = jest.fn();
jest.mock('../../build/exec/cli-runtime/schema-extractor', () => ({
  extractSchemas: (...args: unknown[]) => mockExtractSchemas(...args),
}));

let project: string;

beforeEach(async () => {
  project = await mkdtemp(path.join(os.tmpdir(), 'frontmcp-from-entry-'));
  await writeFile(path.join(project, 'main.ts'), 'export default {};');
  mockExtractSchemas.mockReset();
});

afterEach(async () => {
  await rm(project, { recursive: true, force: true });
});

const bundles = async () => (await readdir(project)).filter((name) => name.startsWith('.frontmcp-extract-'));

describe('extractProjectSchema()', () => {
  it('reads the schema of the bundled entry and removes the bundle', async () => {
    mockExtractSchemas.mockResolvedValue({ tools: [] });

    await expect(extractProjectSchema({ entry: path.join(project, 'main.ts'), cwd: project })).resolves.toEqual({
      tools: [],
    });
    expect(mockExtractSchemas).toHaveBeenCalledWith(expect.stringMatching(/\.frontmcp-extract-.+entry\.cjs$/));
    expect(await bundles()).toEqual([]);
  });

  it('stops waiting for a server that never finishes booting, and removes the bundle', async () => {
    mockExtractSchemas.mockReturnValue(new Promise(() => undefined));

    await expect(
      extractProjectSchema({ entry: path.join(project, 'main.ts'), cwd: project, bootTimeoutMs: 20 }),
    ).rejects.toThrow('The server did not finish booting within 0.02 s');
    expect(await bundles()).toEqual([]);
  });
});
