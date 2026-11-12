import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { cleanupPidFile, writePidFile } from '../socket';

describe('the PID record beside a socket', () => {
  let dir: string;
  let socketPath: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'frontmcp-socket-pid-'));
    socketPath = path.join(dir, 'app.sock');
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  (process.platform === 'win32' ? it.skip : it)(
    'is written as a new file, not through a link already at its path',
    () => {
      const elsewhere = path.join(dir, 'elsewhere.txt');
      fs.writeFileSync(elsewhere, 'keep');
      fs.symlinkSync(elsewhere, `${socketPath}.pid`);

      const pidPath = writePidFile(socketPath);

      expect(fs.readFileSync(elsewhere, 'utf-8')).toBe('keep');
      expect(fs.lstatSync(pidPath).isFile()).toBe(true);
      expect(fs.readFileSync(pidPath, 'utf-8')).toBe(String(process.pid));
    },
  );

  it('replaces a stale record', () => {
    fs.writeFileSync(`${socketPath}.pid`, '123');

    writePidFile(socketPath);

    expect(fs.readFileSync(`${socketPath}.pid`, 'utf-8')).toBe(String(process.pid));
  });

  it('is removed on exit only while it is still this process record', () => {
    fs.writeFileSync(`${socketPath}.pid`, '999999');
    cleanupPidFile(socketPath);
    expect(fs.existsSync(`${socketPath}.pid`)).toBe(true);

    writePidFile(socketPath);
    cleanupPidFile(socketPath);
    expect(fs.existsSync(`${socketPath}.pid`)).toBe(false);
  });
});
