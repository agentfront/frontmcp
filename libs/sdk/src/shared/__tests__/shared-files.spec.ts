import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { InvalidSharedServerOptionsError, UnsafeSharedServerDirectoryError } from '../../errors';
import {
  assertSocketPathFits,
  prepareSharedDirectory,
  readServerRecord,
  removeServerRecord,
  sharedServerFiles,
  writeServerRecord,
  type SharedServerRecord,
} from '../shared-files';

const posixOnly = process.platform === 'win32' ? describe.skip : describe;

const record: SharedServerRecord = { transport: 'http', port: 4123, path: '/', pid: 4242, secret: 's'.repeat(43) };

posixOnly('shared server files', () => {
  let home: string;
  let previousHome: string | undefined;

  beforeEach(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'sdk-shared-files-'));
    previousHome = process.env['FRONTMCP_HOME'];
    process.env['FRONTMCP_HOME'] = home;
  });

  afterEach(() => {
    if (previousHome === undefined) delete process.env['FRONTMCP_HOME'];
    else process.env['FRONTMCP_HOME'] = previousHome;
    fs.chmodSync(home, 0o700);
    fs.rmSync(home, { recursive: true, force: true });
  });

  it('keeps every file of a key in its own folder under FRONTMCP_HOME', () => {
    const files = sharedServerFiles('notes');
    const directory = path.join(home, 'shared', 'notes');
    expect(files).toEqual({
      directory,
      recordFile: path.join(directory, 'server.json'),
      socketPath: path.join(directory, 'server.sock'),
      lockFile: path.join(directory, 'start-lock.sqlite'),
    });
  });

  it('refuses a socket path longer than a socket address holds', () => {
    expect(() => assertSocketPathFits(sharedServerFiles('notes'))).not.toThrow();
    process.env['FRONTMCP_HOME'] = path.join(home, 'h'.repeat(40));
    const long = sharedServerFiles('k'.repeat(64));
    expect(() => assertSocketPathFits(long)).toThrow(InvalidSharedServerOptionsError);
    expect(() => assertSocketPathFits(long)).toThrow(
      `transport: the socket path ${long.socketPath} is longer than 103 bytes; use a shorter key or FRONTMCP_HOME, or transport 'http'`,
    );
  });

  it('creates the folder owner-only', async () => {
    const files = sharedServerFiles('notes');
    await prepareSharedDirectory(files);
    expect(fs.statSync(files.directory).mode & 0o777).toBe(0o700);
  });

  it.each([
    ['0777', 0o777],
    ['0770', 0o770],
  ])('refuses a home folder of mode %s', async (shown, mode) => {
    fs.chmodSync(home, mode);
    await expect(prepareSharedDirectory(sharedServerFiles('notes'))).rejects.toThrow(UnsafeSharedServerDirectoryError);
    await expect(prepareSharedDirectory(sharedServerFiles('notes'))).rejects.toThrow(
      `Refusing to keep the shared server's files under ${home} (mode ${shown}): the group or others can write to it. ` +
        'Set FRONTMCP_HOME to a folder only you can write to.',
    );
  });

  it('refuses a key folder the group can write to', async () => {
    const files = sharedServerFiles('notes');
    fs.mkdirSync(files.directory, { recursive: true, mode: 0o700 });
    fs.chmodSync(files.directory, 0o770);
    await expect(prepareSharedDirectory(files)).rejects.toThrow('the group or others can write to it');
  });

  it('writes the record owner-only and in one step', async () => {
    const files = sharedServerFiles('notes');
    await prepareSharedDirectory(files);
    await writeServerRecord(files, record);

    expect(fs.statSync(files.recordFile).mode & 0o777).toBe(0o600);
    expect(fs.readdirSync(files.directory)).toEqual(['server.json']);
    await expect(readServerRecord(files)).resolves.toEqual(record);
  });

  it('replaces the record a crashed server left', async () => {
    const files = sharedServerFiles('notes');
    await prepareSharedDirectory(files);
    await writeServerRecord(files, record);
    await writeServerRecord(files, { ...record, pid: 7, port: 5000 });
    await expect(readServerRecord(files)).resolves.toMatchObject({ pid: 7, port: 5000 });
  });

  it('reads no record when there is none, or when it is not one', async () => {
    const files = sharedServerFiles('notes');
    await prepareSharedDirectory(files);
    await expect(readServerRecord(files)).resolves.toBeUndefined();

    for (const content of ['not json', JSON.stringify({ ...record, transport: 'tcp' }), JSON.stringify({ pid: 1 })]) {
      fs.writeFileSync(files.recordFile, content, { mode: 0o600 });
      await expect(readServerRecord(files)).resolves.toBeUndefined();
    }
  });

  it('refuses to read a record others can read', async () => {
    const files = sharedServerFiles('notes');
    await prepareSharedDirectory(files);
    await writeServerRecord(files, record);
    fs.chmodSync(files.recordFile, 0o644);
    await expect(readServerRecord(files)).rejects.toThrow(
      `Refusing to keep the shared server's files under ${files.recordFile} (mode 0644): the group or others can read it.`,
    );
  });

  it('refuses to follow a record that is a link', async () => {
    const files = sharedServerFiles('notes');
    await prepareSharedDirectory(files);
    const elsewhere = path.join(home, 'elsewhere.json');
    fs.writeFileSync(elsewhere, JSON.stringify(record), { mode: 0o600 });
    fs.symlinkSync(elsewhere, files.recordFile);
    await expect(readServerRecord(files)).rejects.toThrow('it is not a regular file');
  });

  it('removes the record only for the server that wrote it', async () => {
    const files = sharedServerFiles('notes');
    await prepareSharedDirectory(files);
    await writeServerRecord(files, record);

    await removeServerRecord(files, record.pid + 1);
    expect(fs.existsSync(files.recordFile)).toBe(true);
    await removeServerRecord(files, record.pid);
    expect(fs.existsSync(files.recordFile)).toBe(false);
    await expect(removeServerRecord(files, record.pid)).resolves.toBeUndefined();
  });
});
