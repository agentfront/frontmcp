import {
  defineSetup,
  validateStepGraph,
  idToEnvName,
  SetupStep,
} from '../setup';

describe('setup', () => {
  describe('defineSetup', () => {
    it('should pass through the definition', () => {
      const def = defineSetup({ steps: [] });
      expect(def).toEqual({ steps: [] });
    });

    it('should accept steps with all fields', () => {
      const def = defineSetup({
        steps: [
          {
            id: 'test',
            prompt: 'Test prompt',
            description: 'A description',
            env: 'TEST_VAR',
            sensitive: true,
            group: 'Test',
            next: 'other',
            showWhen: { prev: 'yes' },
          },
        ],
      });
      expect(def.steps).toHaveLength(1);
      expect(def.steps[0].id).toBe('test');
    });
  });

  describe('idToEnvName', () => {
    it('should convert simple id to SCREAMING_SNAKE', () => {
      expect(idToEnvName('api_key')).toBe('API_KEY');
    });

    it('should replace hyphens with underscores', () => {
      expect(idToEnvName('auth-type')).toBe('AUTH_TYPE');
    });

    it('should handle dots', () => {
      expect(idToEnvName('server.port')).toBe('SERVER_PORT');
    });

    it('should handle already uppercase', () => {
      expect(idToEnvName('PORT')).toBe('PORT');
    });
  });

  describe('validateStepGraph', () => {
    it('should pass for empty steps', () => {
      expect(validateStepGraph([])).toEqual([]);
    });

    it('should pass for a simple linear graph', () => {
      const steps: SetupStep[] = [
        { id: 'a', prompt: 'A' },
        { id: 'b', prompt: 'B' },
        { id: 'c', prompt: 'C' },
      ];
      expect(validateStepGraph(steps)).toEqual([]);
    });

    it('should detect invalid next target (string)', () => {
      const steps: SetupStep[] = [
        { id: 'a', prompt: 'A', next: 'nonexistent' },
      ];
      const errors = validateStepGraph(steps);
      expect(errors.some((e) => e.includes('nonexistent'))).toBe(true);
    });

    it('should detect invalid next target (record)', () => {
      const steps: SetupStep[] = [
        { id: 'a', prompt: 'A', next: { yes: 'missing' } },
      ];
      const errors = validateStepGraph(steps);
      expect(errors.some((e) => e.includes('missing'))).toBe(true);
    });

    it('should detect invalid showWhen references', () => {
      const steps: SetupStep[] = [
        { id: 'a', prompt: 'A' },
        { id: 'b', prompt: 'B', showWhen: { nonexistent: 'val' } },
      ];
      const errors = validateStepGraph(steps);
      expect(errors.some((e) => e.includes('nonexistent'))).toBe(true);
    });

    it('should pass for valid branching graph', () => {
      const steps: SetupStep[] = [
        { id: 'auth', prompt: 'Auth type', next: { 'none': 'port', 'api-key': 'key' } },
        { id: 'key', prompt: 'API key', next: 'port' },
        { id: 'port', prompt: 'Port' },
      ];
      const errors = validateStepGraph(steps);
      // Only warnings about unreachable steps possible
      const realErrors = errors.filter((e) => !e.startsWith('Warning:'));
      expect(realErrors).toEqual([]);
    });

    it('should detect cycles', () => {
      const steps: SetupStep[] = [
        { id: 'a', prompt: 'A', next: 'b' },
        { id: 'b', prompt: 'B', next: 'a' },
      ];
      const errors = validateStepGraph(steps);
      expect(errors.some((e) => e.includes('Cycle'))).toBe(true);
    });

    it('should warn about unreachable steps', () => {
      const steps: SetupStep[] = [
        { id: 'a', prompt: 'A', next: 'c' },
        { id: 'b', prompt: 'B' }, // unreachable
        { id: 'c', prompt: 'C' },
      ];
      const errors = validateStepGraph(steps);
      expect(errors.some((e) => e.includes('unreachable') && e.includes('"b"'))).toBe(true);
    });
  });
});
