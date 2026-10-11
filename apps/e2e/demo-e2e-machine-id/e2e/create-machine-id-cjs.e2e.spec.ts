/**
 * `create({ machineId })` pins the machine id the server reads in a CommonJS project too, where
 * `require('@frontmcp/sdk')` loads the CommonJS build of `@frontmcp/utils`.
 */
import { execFile } from 'node:child_process';
import * as path from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);
const fixture = path.join(__dirname, 'fixtures', 'create-machine-id.cjs');

describe('create({ machineId }) in a CommonJS project', () => {
  it('sets the machine id the CommonJS build reads', async () => {
    const { stdout } = await run(process.execPath, [fixture, 'pinned-machine-id'], {
      env: { ...process.env, NODE_ENV: 'test' },
    });

    expect(JSON.parse(stdout)).toEqual({ machineId: 'pinned-machine-id' });
  });
});
