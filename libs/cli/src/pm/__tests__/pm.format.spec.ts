import { formatUptime, formatProcessTable, formatProcessDetail } from '../pm.format';
import { ProcessInfo } from '../pm.types';

describe('pm.format', () => {
  describe('formatUptime', () => {
    it('should format seconds', () => {
      const now = new Date();
      const thirtySecsAgo = new Date(now.getTime() - 30000).toISOString();
      expect(formatUptime(thirtySecsAgo)).toMatch(/^\d+s$/);
    });

    it('should format minutes', () => {
      const now = new Date();
      const fiveMinsAgo = new Date(now.getTime() - 5 * 60 * 1000).toISOString();
      expect(formatUptime(fiveMinsAgo)).toMatch(/^\d+m \d+s$/);
    });

    it('should format hours', () => {
      const now = new Date();
      const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000).toISOString();
      expect(formatUptime(twoHoursAgo)).toMatch(/^\d+h \d+m$/);
    });

    it('should format days', () => {
      const now = new Date();
      const threeDaysAgo = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000).toISOString();
      expect(formatUptime(threeDaysAgo)).toMatch(/^\d+d \d+h$/);
    });
  });

  describe('formatProcessTable', () => {
    it('should handle empty process list', () => {
      const result = formatProcessTable([]);
      expect(result).toContain('No managed processes');
    });

    it('should format a table with processes', () => {
      const processes: ProcessInfo[] = [
        {
          name: 'test-app',
          pid: 12345,
          supervisorPid: 12344,
          status: 'running',
          entry: '/path/to/main.ts',
          port: 3001,
          startedAt: new Date().toISOString(),
          restartCount: 0,
          uptime: '5m 30s',
          cliVersion: '0.8.1',
        },
      ];

      const result = formatProcessTable(processes);
      expect(result).toContain('test-app');
      expect(result).toContain('12345');
      expect(result).toContain('3001');
    });
  });

  describe('formatProcessDetail', () => {
    it('should format process detail', () => {
      const process: ProcessInfo = {
        name: 'test-app',
        pid: 12345,
        supervisorPid: 12344,
        status: 'running',
        entry: '/path/to/main.ts',
        port: 3001,
        startedAt: '2024-01-01T00:00:00.000Z',
        restartCount: 2,
        uptime: '1h 30m',
        cliVersion: '0.8.1',
      };

      const result = formatProcessDetail(process);
      expect(result).toContain('test-app');
      expect(result).toContain('12345');
      expect(result).toContain('12344');
      expect(result).toContain('3001');
      expect(result).toContain('/path/to/main.ts');
      expect(result).toContain('2');
      expect(result).toContain('0.8.1');
    });

    it('should include socket path when present', () => {
      const process: ProcessInfo = {
        name: 'socket-app',
        pid: 54321,
        supervisorPid: 54320,
        status: 'running',
        entry: '/path/to/main.ts',
        socketPath: '/tmp/test.sock',
        startedAt: '2024-01-01T00:00:00.000Z',
        restartCount: 0,
        uptime: '10s',
        cliVersion: '0.8.1',
      };

      const result = formatProcessDetail(process);
      expect(result).toContain('/tmp/test.sock');
    });
  });
});
