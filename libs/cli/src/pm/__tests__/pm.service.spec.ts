import { detectPlatform } from '../pm.service';

describe('pm.service', () => {
  const originalPlatform = process.platform;

  afterEach(() => {
    Object.defineProperty(process, 'platform', { value: originalPlatform });
  });

  describe('detectPlatform', () => {
    it('should return launchd on macOS', () => {
      Object.defineProperty(process, 'platform', { value: 'darwin' });
      expect(detectPlatform()).toBe('launchd');
    });

    it('should return systemd on linux', () => {
      Object.defineProperty(process, 'platform', { value: 'linux' });
      expect(detectPlatform()).toBe('systemd');
    });

    it('should throw on Windows', () => {
      Object.defineProperty(process, 'platform', { value: 'win32' });
      expect(() => detectPlatform()).toThrow('Windows is not supported');
    });
  });
});
