import { detectPlatform } from '../pm.service';

describe('pm.service', () => {
  describe('detectPlatform', () => {
    it('should return launchd on macOS', () => {
      if (process.platform === 'darwin') {
        expect(detectPlatform()).toBe('launchd');
      }
    });

    it('should return systemd on linux', () => {
      if (process.platform === 'linux') {
        expect(detectPlatform()).toBe('systemd');
      }
    });

    it('should return a valid platform', () => {
      const platform = detectPlatform();
      expect(['launchd', 'systemd']).toContain(platform);
    });
  });
});
