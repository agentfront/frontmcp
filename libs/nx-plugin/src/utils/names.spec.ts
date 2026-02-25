import { toClassName, toPropertyName, toFileName, toConstantName, sanitizeProjectName } from './names';

describe('names', () => {
  describe('toClassName', () => {
    it('should convert kebab-case to PascalCase', () => {
      expect(toClassName('my-tool')).toBe('MyTool');
    });

    it('should handle single word', () => {
      expect(toClassName('calculate')).toBe('Calculate');
    });
  });

  describe('toPropertyName', () => {
    it('should convert to camelCase', () => {
      expect(toPropertyName('my-tool')).toBe('myTool');
    });
  });

  describe('toFileName', () => {
    it('should convert to kebab-case', () => {
      expect(toFileName('MyTool')).toBe('my-tool');
    });
  });

  describe('toConstantName', () => {
    it('should convert to UPPER_SNAKE_CASE', () => {
      expect(toConstantName('myTool')).toBe('MY_TOOL');
    });
  });

  describe('sanitizeProjectName', () => {
    it('should remove invalid characters', () => {
      expect(sanitizeProjectName('my@project!')).toBe('my-project');
    });

    it('should trim leading/trailing dashes', () => {
      expect(sanitizeProjectName('-my-project-')).toBe('my-project');
    });

    it('should lowercase', () => {
      expect(sanitizeProjectName('MyProject')).toBe('myproject');
    });
  });
});
