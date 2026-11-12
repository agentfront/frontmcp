import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';

import { parseEnvContent } from '../../../shared/env';
import { ManifestSetupStep } from '../../build/exec/manifest';
import { runQuestionnaire, writeEnvFile } from '../questionnaire';

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

  describe('the .env file', () => {
    const values: Record<string, string> = {
      PLAIN: '3001',
      SPACES: 'two words',
      SEMICOLON: 'a;printf ran',
      SUBSTITUTION: '$(printf ran)',
      BACKTICKS: '`printf ran`',
      DOLLAR: 'pa$word',
      TILDE: '~/data',
      BACKSLASH: 'C:\\path',
      QUOTES: `it's "x" $y`,
    };
    const steps: ManifestSetupStep[] = Object.entries(values).map(([env, value]) => ({
      id: env.toLowerCase(),
      prompt: env,
      jsonSchema: { type: 'string', default: value },
      env,
      group: 'Keys\nGROUP_LINE=ran',
    }));

    (process.platform === 'win32' ? it.skip : it)('holds every answer as the runner, which sources it, reads it back', async () => {
      const dir = mkdtempSync(path.join(tmpdir(), 'frontmcp-env-'));
      try {
        const { envContent } = await runQuestionnaire(steps, { silent: true });
        writeEnvFile(dir, envContent);

        const script = 'set -euo pipefail; set -a; source "$1"; set +a; exec "$2" -e "process.stdout.write(JSON.stringify(process.env))"';
        const output = execFileSync('bash', ['-c', script, 'bash', path.join(dir, '.env'), process.execPath], { encoding: 'utf-8' });
        const sourced = JSON.parse(output) as Record<string, string | undefined>;

        for (const [env, value] of Object.entries(values)) expect(sourced[env]).toBe(value);
        expect(sourced['GROUP_LINE']).toBeUndefined();
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });

    it('holds the answers frontmcp start reads the same way, unless one mixes a single quote with $ or "', async () => {
      const { envContent } = await runQuestionnaire(steps, { silent: true });
      const { QUOTES: _mixedQuotes, ...readTheSame } = values;

      expect(parseEnvContent(envContent)).toEqual(expect.objectContaining(readTheSame));
    });

    it('refuses an env name that is not an environment variable name', async () => {
      const step: ManifestSetupStep = { id: 'key', prompt: 'Key', jsonSchema: { type: 'string', default: 'x' }, env: 'KEY;printf ran' };

      await expect(runQuestionnaire([step], { silent: true })).rejects.toThrow('not an environment variable name');
    });
  });
});
