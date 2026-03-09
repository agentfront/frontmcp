import { runQuestionnaire } from '../questionnaire';
import { ManifestSetupStep } from '../../build/exec/manifest';

describe('questionnaire', () => {
  describe('runQuestionnaire (silent mode)', () => {
    it('should use defaults in silent mode', async () => {
      const steps: ManifestSetupStep[] = [
        {
          id: 'port',
          prompt: 'Port',
          jsonSchema: { type: 'number', default: 3001 },
          env: 'PORT',
        },
        {
          id: 'name',
          prompt: 'Name',
          jsonSchema: { type: 'string', default: 'my-app' },
          env: 'APP_NAME',
        },
      ];

      const result = await runQuestionnaire(steps, { silent: true });

      expect(result.answers.port).toBe('3001');
      expect(result.answers.name).toBe('my-app');
    });

    it('should throw for required fields without defaults in silent mode', async () => {
      const steps: ManifestSetupStep[] = [
        {
          id: 'api_key',
          prompt: 'API Key',
          jsonSchema: { type: 'string', minLength: 1 },
          env: 'API_KEY',
        },
      ];

      await expect(runQuestionnaire(steps, { silent: true })).rejects.toThrow('requires input');
    });

    it('should respect showWhen conditions in silent mode', async () => {
      const steps: ManifestSetupStep[] = [
        {
          id: 'storage',
          prompt: 'Storage',
          jsonSchema: { type: 'string', enum: ['sqlite', 'redis'], default: 'sqlite' },
          env: 'STORAGE',
        },
        {
          id: 'redis_url',
          prompt: 'Redis URL',
          jsonSchema: { type: 'string', default: 'redis://localhost:6379' },
          env: 'REDIS_URL',
          showWhen: { storage: 'redis' },
        },
      ];

      const result = await runQuestionnaire(steps, { silent: true });

      // storage defaults to 'sqlite', so redis_url should be skipped
      expect(result.answers.storage).toBe('sqlite');
      expect(result.answers.redis_url).toBeUndefined();
    });

    it('should follow next routing in silent mode', async () => {
      const steps: ManifestSetupStep[] = [
        {
          id: 'auth',
          prompt: 'Auth',
          jsonSchema: { type: 'string', enum: ['none', 'api-key'], default: 'none' },
          env: 'AUTH',
          next: { none: 'port', 'api-key': 'api_key' },
        },
        {
          id: 'api_key',
          prompt: 'API Key',
          jsonSchema: { type: 'string', minLength: 1 },
          env: 'API_KEY',
          next: 'port',
        },
        {
          id: 'port',
          prompt: 'Port',
          jsonSchema: { type: 'number', default: 3001 },
          env: 'PORT',
        },
      ];

      const result = await runQuestionnaire(steps, { silent: true });

      expect(result.answers.auth).toBe('none');
      // Should skip api_key step due to next routing
      expect(result.answers.api_key).toBeUndefined();
      expect(result.answers.port).toBe('3001');
    });

    it('should generate env content', async () => {
      const steps: ManifestSetupStep[] = [
        {
          id: 'port',
          prompt: 'Port',
          jsonSchema: { type: 'number', default: 3001 },
          env: 'PORT',
          group: 'Network',
        },
      ];

      const result = await runQuestionnaire(steps, { silent: true });

      expect(result.envContent).toContain('PORT=3001');
      expect(result.envContent).toContain('# Network');
    });
  });
});
