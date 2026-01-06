// file: libs/cli/src/__tests__/colors.spec.ts

import { COLORS, c } from '../colors';

describe('colors', () => {
  describe('COLORS', () => {
    it('should have reset code', () => {
      expect(COLORS.reset).toBe('\x1b[0m');
    });

    it('should have bold code', () => {
      expect(COLORS.bold).toBe('\x1b[1m');
    });

    it('should have dim code', () => {
      expect(COLORS.dim).toBe('\x1b[2m');
    });

    it('should have red code', () => {
      expect(COLORS.red).toBe('\x1b[31m');
    });

    it('should have green code', () => {
      expect(COLORS.green).toBe('\x1b[32m');
    });

    it('should have yellow code', () => {
      expect(COLORS.yellow).toBe('\x1b[33m');
    });

    it('should have blue code', () => {
      expect(COLORS.blue).toBe('\x1b[34m');
    });

    it('should have cyan code', () => {
      expect(COLORS.cyan).toBe('\x1b[36m');
    });

    it('should have gray code', () => {
      expect(COLORS.gray).toBe('\x1b[90m');
    });
  });

  describe('c', () => {
    it('should wrap text with red color', () => {
      const result = c('red', 'error text');
      expect(result).toBe('\x1b[31merror text\x1b[0m');
    });

    it('should wrap text with green color', () => {
      const result = c('green', 'success');
      expect(result).toBe('\x1b[32msuccess\x1b[0m');
    });

    it('should wrap text with bold', () => {
      const result = c('bold', 'important');
      expect(result).toBe('\x1b[1mimportant\x1b[0m');
    });

    it('should wrap text with cyan', () => {
      const result = c('cyan', 'info');
      expect(result).toBe('\x1b[36minfo\x1b[0m');
    });

    it('should wrap text with yellow', () => {
      const result = c('yellow', 'warning');
      expect(result).toBe('\x1b[33mwarning\x1b[0m');
    });

    it('should wrap text with gray', () => {
      const result = c('gray', 'hint');
      expect(result).toBe('\x1b[90mhint\x1b[0m');
    });

    it('should wrap text with dim', () => {
      const result = c('dim', 'faded');
      expect(result).toBe('\x1b[2mfaded\x1b[0m');
    });

    it('should wrap text with blue', () => {
      const result = c('blue', 'link');
      expect(result).toBe('\x1b[34mlink\x1b[0m');
    });

    it('should handle empty string', () => {
      const result = c('red', '');
      expect(result).toBe('\x1b[31m\x1b[0m');
    });
  });
});
