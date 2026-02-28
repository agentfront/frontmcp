import { isProcessAlive } from '../pidfile';

describe('pm.pidfile', () => {
  describe('isProcessAlive', () => {
    it('should return true for current process PID', () => {
      expect(isProcessAlive(process.pid)).toBe(true);
    });

    it('should return false for non-existent PID', () => {
      // Use a very high PID that is unlikely to exist
      expect(isProcessAlive(999999)).toBe(false);
    });
  });

  describe('readPidFile', () => {
    it('should return null for non-existent file', () => {
      // Import directly - uses real paths but we use a name that won't exist
      const { readPidFile } = require('../pidfile');
      const result = readPidFile('__nonexistent_test_app_' + Date.now());
      expect(result).toBeNull();
    });
  });

  describe('removePidFile', () => {
    it('should not throw for non-existent file', () => {
      const { removePidFile } = require('../pidfile');
      expect(() => removePidFile('__nonexistent_test_app_' + Date.now())).not.toThrow();
    });
  });
});
