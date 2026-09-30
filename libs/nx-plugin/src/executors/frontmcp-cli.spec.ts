import { execFileSync, spawn } from 'child_process';
import { EventEmitter } from 'events';
import { join } from 'path';

import { createFakeWorkspace, type FakeWorkspace } from './__tests__/fake-workspace';
import {
  buildFrontmcpInvocation,
  describeInvocation,
  getProjectRoot,
  resolveFrontmcpBin,
  runFrontmcp,
  spawnFrontmcp,
  toAbsolute,
  waitForExit,
} from './frontmcp-cli';

jest.mock('child_process', () => ({ execFileSync: jest.fn(), spawn: jest.fn() }));

const mockExecFileSync = execFileSync as jest.MockedFunction<typeof execFileSync>;
const mockSpawn = spawn as jest.MockedFunction<typeof spawn>;

describe('frontmcp-cli', () => {
  let ws: FakeWorkspace;

  beforeEach(() => {
    jest.clearAllMocks();
    ws = createFakeWorkspace();
  });
  afterEach(() => ws.cleanup());

  describe('getProjectRoot', () => {
    it('resolves the project folder from the workspace configuration', () => {
      expect(getProjectRoot(ws.context)).toBe(join(ws.root, 'apps', 'demo'));
    });

    it('falls back to the workspace root when the project is unknown', () => {
      expect(getProjectRoot({ ...ws.context, projectName: undefined })).toBe(ws.root);
      expect(getProjectRoot({ ...ws.context, projectName: 'other' })).toBe(ws.root);
    });
  });

  describe('toAbsolute', () => {
    it('resolves workspace-relative paths against the workspace root', () => {
      expect(toAbsolute(ws.context, 'apps/demo/src/main.ts')).toBe(join(ws.root, 'apps/demo/src/main.ts'));
    });

    it('keeps absolute paths untouched', () => {
      expect(toAbsolute(ws.context, '/abs/main.ts')).toBe('/abs/main.ts');
    });
  });

  describe('resolveFrontmcpBin', () => {
    it('finds the CLI installed in the workspace', () => {
      expect(resolveFrontmcpBin(ws.root)).toBe(ws.binPath);
    });

    it('accepts a string bin field', () => {
      const other = createFakeWorkspace();
      require('fs').writeFileSync(
        join(other.root, 'node_modules', 'frontmcp', 'package.json'),
        JSON.stringify({ bin: 'dist/src/core/cli.js' }),
      );
      expect(resolveFrontmcpBin(other.root)).toBe(other.binPath);
      other.cleanup();
    });

    it('refuses to fall back to downloading the CLI when it is not installed', () => {
      const bare = createFakeWorkspace({ installCli: false });
      expect(() => resolveFrontmcpBin(bare.root)).toThrow(/not installed/);
      bare.cleanup();
    });

    it('reports a manifest without a bin as not installed', () => {
      const other = createFakeWorkspace();
      require('fs').writeFileSync(join(other.root, 'node_modules', 'frontmcp', 'package.json'), '{}');
      expect(() => resolveFrontmcpBin(other.root)).toThrow(/not installed/);
      other.cleanup();
    });

    it('reports an unreadable manifest as not installed', () => {
      const other = createFakeWorkspace();
      require('fs').writeFileSync(join(other.root, 'node_modules', 'frontmcp', 'package.json'), '{not json');
      expect(() => resolveFrontmcpBin(other.root)).toThrow(/not installed/);
      other.cleanup();
    });
  });

  describe('buildFrontmcpInvocation', () => {
    it('runs the local bin with node from the project folder', () => {
      const invocation = buildFrontmcpInvocation(ws.context, ['build'], { CLIENT_PORT: '7000' });
      expect(invocation.command).toBe(process.execPath);
      expect(invocation.args).toEqual([ws.binPath, 'build']);
      expect(invocation.cwd).toBe(join(ws.root, 'apps', 'demo'));
      expect(invocation.env['CLIENT_PORT']).toBe('7000');
      expect(invocation.env['FORCE_COLOR']).toBe('1');
      expect(describeInvocation(invocation)).toBe(`frontmcp build (in ${invocation.cwd})`);
    });
  });

  describe('runFrontmcp', () => {
    it('reports success when the CLI exits cleanly', () => {
      expect(runFrontmcp(ws.context, ['test'])).toEqual({ success: true });
      expect(mockExecFileSync).toHaveBeenCalledWith(
        process.execPath,
        [ws.binPath, 'test'],
        expect.objectContaining({ cwd: join(ws.root, 'apps', 'demo'), stdio: 'inherit' }),
      );
    });

    it('reports failure when the CLI exits non-zero without repeating its output', () => {
      const spy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
      mockExecFileSync.mockImplementation(() => {
        throw Object.assign(new Error('Command failed'), { status: 1 });
      });
      expect(runFrontmcp(ws.context, ['test'])).toEqual({ success: false });
      expect(spy).not.toHaveBeenCalled();
      spy.mockRestore();
    });

    it('reports a missing CLI to the user', () => {
      const bare = createFakeWorkspace({ installCli: false });
      const spy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
      expect(runFrontmcp(bare.context, ['build'])).toEqual({ success: false });
      expect(spy).toHaveBeenCalledWith(expect.stringMatching(/not installed/));
      expect(mockExecFileSync).not.toHaveBeenCalled();
      spy.mockRestore();
      bare.cleanup();
    });
  });

  describe('spawnFrontmcp / waitForExit', () => {
    function child() {
      const c = new EventEmitter() as EventEmitter & { killed: boolean; kill: jest.Mock };
      c.killed = false;
      c.kill = jest.fn(() => {
        c.killed = true;
      });
      return c;
    }

    it('spawns the local bin in the project folder', () => {
      const c = child();
      mockSpawn.mockReturnValue(c as never);
      expect(spawnFrontmcp(ws.context, ['dev'])).toBe(c);
      expect(mockSpawn).toHaveBeenCalledWith(
        process.execPath,
        [ws.binPath, 'dev'],
        expect.objectContaining({ cwd: join(ws.root, 'apps', 'demo'), stdio: 'inherit' }),
      );
    });

    it('returns undefined and reports when the CLI is not installed', () => {
      const bare = createFakeWorkspace({ installCli: false });
      const spy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
      expect(spawnFrontmcp(bare.context, ['dev'])).toBeUndefined();
      expect(spy).toHaveBeenCalled();
      spy.mockRestore();
      bare.cleanup();
    });

    it('resolves with the exit code and kills a child that is still alive', async () => {
      const c = child();
      const done = waitForExit(c as never);
      c.emit('close', 3);
      expect(await done).toBe(3);
      expect(c.kill).toHaveBeenCalled();
    });

    it('treats a null exit code and spawn errors as failure', async () => {
      const a = child();
      const doneA = waitForExit(a as never);
      a.emit('close', null);
      expect(await doneA).toBe(1);

      const b = child();
      const doneB = waitForExit(b as never);
      b.emit('error', new Error('boom'));
      expect(await doneB).toBe(1);
    });

    it('does not kill a child that already exited', async () => {
      const c = child();
      c.killed = true;
      const done = waitForExit(c as never);
      c.emit('close', 0);
      await done;
      expect(c.kill).not.toHaveBeenCalled();
    });
  });
});
