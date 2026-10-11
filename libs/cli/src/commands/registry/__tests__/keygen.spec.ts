import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { RegistryError } from '../errors';
import { generateRegistryKey } from '../keygen';
import { formatProofRecord, parsePrivateKey, publicKeyBase64 } from '../keys';

describe('generateRegistryKey', () => {
  let tempDir: string;
  let logSpy: jest.SpyInstance;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'registry-keygen-'));
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined);
  });

  afterEach(() => {
    logSpy.mockRestore();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  const printed = () => logSpy.mock.calls.map((call) => call.join(' ')).join('\n');

  it('writes the hex seed with mode 0600 in a new directory and prints only the public halves', async () => {
    const keyPath = path.join(tempDir, 'keys', 'registry.key');
    await generateRegistryKey({ out: keyPath });

    const seedHex = fs.readFileSync(keyPath, 'utf8').trim();
    expect(seedHex).toMatch(/^[0-9a-f]{64}$/);
    expect(fs.statSync(keyPath).mode & 0o777).toBe(0o600);
    expect(fs.statSync(path.dirname(keyPath)).mode & 0o777).toBe(0o700);

    const publicKey = publicKeyBase64(parsePrivateKey(seedHex));
    const output = printed();
    expect(output).toContain(`MCP_REGISTRY_PUBLIC_KEY=${publicKey}`);
    expect(output).toContain(formatProofRecord(publicKey));
    expect(output).toContain(`--key-file ${keyPath}`);
    expect(output).not.toContain(seedHex);
  });

  it('refuses to overwrite a key unless forced, and keeps mode 0600 when forced', async () => {
    const keyPath = path.join(tempDir, 'registry.key');
    fs.writeFileSync(keyPath, 'existing', { mode: 0o644 });

    await expect(generateRegistryKey({ out: keyPath })).rejects.toThrow(RegistryError);
    expect(fs.readFileSync(keyPath, 'utf8')).toBe('existing');

    await generateRegistryKey({ out: keyPath, force: true });
    expect(fs.readFileSync(keyPath, 'utf8').trim()).toMatch(/^[0-9a-f]{64}$/);
    expect(fs.statSync(keyPath).mode & 0o777).toBe(0o600);
  });
});
