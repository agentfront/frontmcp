/**
 * Session Transport Tests
 *
 * Tests for TransportIdGenerator: ID generation format and uniqueness.
 */

const mockRandomUUID = jest.fn();

jest.mock('@frontmcp/utils', () => ({
  ...jest.requireActual('@frontmcp/utils'),
  randomUUID: () => mockRandomUUID(),
}));

import { TransportIdGenerator } from '../session.transport';

describe('TransportIdGenerator', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('createId()', () => {
    it('should return a UUID without dashes (32 hex chars)', () => {
      mockRandomUUID.mockReturnValue('550e8400-e29b-41d4-a716-446655440000');

      const id = TransportIdGenerator.createId();

      expect(id).toBe('550e8400e29b41d4a716446655440000');
      expect(id).toHaveLength(32);
      expect(id).toMatch(/^[0-9a-f]{32}$/);
    });

    it('should call randomUUID from @frontmcp/utils', () => {
      mockRandomUUID.mockReturnValue('aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee');

      TransportIdGenerator.createId();

      expect(mockRandomUUID).toHaveBeenCalledTimes(1);
    });

    it('should produce unique IDs on successive calls', () => {
      mockRandomUUID
        .mockReturnValueOnce('00000000-0000-0000-0000-000000000001')
        .mockReturnValueOnce('00000000-0000-0000-0000-000000000002')
        .mockReturnValueOnce('00000000-0000-0000-0000-000000000003');

      const id1 = TransportIdGenerator.createId();
      const id2 = TransportIdGenerator.createId();
      const id3 = TransportIdGenerator.createId();

      expect(id1).not.toBe(id2);
      expect(id2).not.toBe(id3);
      expect(id1).not.toBe(id3);
    });

    it('should remove all dashes from a standard UUID v4', () => {
      mockRandomUUID.mockReturnValue('a1b2c3d4-e5f6-7890-abcd-ef1234567890');

      const id = TransportIdGenerator.createId();

      expect(id).not.toContain('-');
      expect(id).toBe('a1b2c3d4e5f67890abcdef1234567890');
    });

    it('should handle UUID with no dashes (edge case)', () => {
      // Even if randomUUID somehow returned no dashes, should still work
      mockRandomUUID.mockReturnValue('abcdef1234567890abcdef1234567890');

      const id = TransportIdGenerator.createId();

      expect(id).toBe('abcdef1234567890abcdef1234567890');
    });
  });
});
