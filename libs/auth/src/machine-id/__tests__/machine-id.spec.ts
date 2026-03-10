/**
 * Machine ID Tests
 *
 * The machineId is computed at module load time via IIFE,
 * so we use jest.resetModules() between tests that need re-initialization.
 */

// Mock @frontmcp/utils before any imports
const mockRandomUUID = jest.fn(() => 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee');
const mockReadFileSync = jest.fn();
const mockMkdir = jest.fn(() => Promise.resolve());
const mockWriteFile = jest.fn(() => Promise.resolve());

jest.mock('@frontmcp/utils', () => ({
  randomUUID: mockRandomUUID,
  readFileSync: mockReadFileSync,
  mkdir: mockMkdir,
  writeFile: mockWriteFile,
}));

describe('machine-id', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv };
    delete process.env['MACHINE_ID'];
    delete process.env['MACHINE_ID_PATH'];
    delete process.env['NODE_ENV'];
    mockRandomUUID.mockReturnValue('aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee');
    mockReadFileSync.mockReset();
    mockMkdir.mockReset().mockResolvedValue(undefined);
    mockWriteFile.mockReset().mockResolvedValue(undefined);
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('should return a string from getMachineId()', async () => {
    mockReadFileSync.mockImplementation(() => {
      const err = new Error('ENOENT') as NodeJS.ErrnoException;
      err.code = 'ENOENT';
      throw err;
    });

    const { getMachineId } = await import('../machine-id');
    const id = getMachineId();
    expect(typeof id).toBe('string');
    expect(id.length).toBeGreaterThan(0);
  });

  it('should use MACHINE_ID env var as highest priority', async () => {
    process.env['MACHINE_ID'] = 'env-machine-id-123';

    const { getMachineId } = await import('../machine-id');
    expect(getMachineId()).toBe('env-machine-id-123');
  });

  it('should load machine ID from file in dev mode', async () => {
    mockReadFileSync.mockReturnValue('11111111-2222-3333-4444-555555555555');

    const { getMachineId } = await import('../machine-id');
    expect(getMachineId()).toBe('11111111-2222-3333-4444-555555555555');
  });

  it('should reject invalid file content and regenerate', async () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation();
    mockReadFileSync.mockReturnValue('not-a-uuid-format!@#$');

    const { getMachineId } = await import('../machine-id');
    const id = getMachineId();
    // Should fall through to randomUUID
    expect(id).toBe('aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee');
    warnSpy.mockRestore();
  });

  it('should not load from file in production mode', async () => {
    process.env['NODE_ENV'] = 'production';
    mockReadFileSync.mockReturnValue('11111111-2222-3333-4444-555555555555');

    const { getMachineId } = await import('../machine-id');
    // In production, file persistence is disabled so it generates a new UUID
    expect(getMachineId()).toBe('aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee');
    expect(mockReadFileSync).not.toHaveBeenCalled();
  });

  it('should generate new ID when file read throws ENOENT', async () => {
    mockReadFileSync.mockImplementation(() => {
      const err = new Error('ENOENT') as NodeJS.ErrnoException;
      err.code = 'ENOENT';
      throw err;
    });

    const { getMachineId } = await import('../machine-id');
    expect(getMachineId()).toBe('aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee');
  });

  it('should warn on non-ENOENT file read errors', async () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation();
    mockReadFileSync.mockImplementation(() => {
      const err = new Error('Permission denied') as NodeJS.ErrnoException;
      err.code = 'EACCES';
      throw err;
    });

    const { getMachineId } = await import('../machine-id');
    expect(getMachineId()).toBe('aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee');
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('Failed to load'));
    warnSpy.mockRestore();
  });

  it('should save generated ID to file in dev mode (fire-and-forget)', async () => {
    mockReadFileSync.mockImplementation(() => {
      const err = new Error('ENOENT') as NodeJS.ErrnoException;
      err.code = 'ENOENT';
      throw err;
    });

    await import('../machine-id');
    // Give the fire-and-forget promise a tick to execute
    await new Promise((r) => setTimeout(r, 50));
    expect(mockMkdir).toHaveBeenCalled();
    expect(mockWriteFile).toHaveBeenCalledWith(
      expect.stringContaining('machine-id'),
      'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
      expect.objectContaining({ mode: 0o600 }),
    );
  });

  it('should not save to file in production mode', async () => {
    process.env['NODE_ENV'] = 'production';
    mockReadFileSync.mockImplementation(() => {
      throw new Error('should not be called');
    });

    await import('../machine-id');
    await new Promise((r) => setTimeout(r, 50));
    expect(mockMkdir).not.toHaveBeenCalled();
    expect(mockWriteFile).not.toHaveBeenCalled();
  });

  it('should override with setMachineIdOverride', async () => {
    mockReadFileSync.mockImplementation(() => {
      const err = new Error('ENOENT') as NodeJS.ErrnoException;
      err.code = 'ENOENT';
      throw err;
    });

    const { getMachineId, setMachineIdOverride } = await import('../machine-id');
    const original = getMachineId();

    setMachineIdOverride('override-id-999');
    expect(getMachineId()).toBe('override-id-999');

    // Revert
    setMachineIdOverride(undefined);
    expect(getMachineId()).toBe(original);
  });

  it('should handle save failure gracefully', async () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation();
    mockReadFileSync.mockImplementation(() => {
      const err = new Error('ENOENT') as NodeJS.ErrnoException;
      err.code = 'ENOENT';
      throw err;
    });
    mockMkdir.mockRejectedValue(new Error('disk full'));

    const { getMachineId } = await import('../machine-id');
    // Should still return a valid ID despite save failure
    expect(getMachineId()).toBe('aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee');
    await new Promise((r) => setTimeout(r, 50));
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('Failed to save'));
    warnSpy.mockRestore();
  });
});
