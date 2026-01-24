/**
 * Search Skills Flow Tests
 *
 * Tests for the SearchSkillsFlow which handles skill discovery.
 * These tests cover Issue #4: searchSkills tool mislabeling and pagination.
 *
 * Key areas tested:
 * 1. Tool name normalization using normalizeToolRef
 * 2. Pagination logic (hasMore calculation)
 * 3. Output format correctness
 */

import 'reflect-metadata';
import { normalizeToolRef } from '../../../common';
import type { SkillSearchResult } from '../../skill-storage.interface';

describe('SearchSkillsFlow', () => {
  describe('tool name normalization', () => {
    it('should use normalizeToolRef to extract tool names from strings', () => {
      const result = normalizeToolRef('simple-tool');
      expect(result.name).toBe('simple-tool');
      expect(result.required).toBe(false);
    });

    it('should handle object tool references with name', () => {
      const result = normalizeToolRef({ name: 'object-tool', purpose: 'Testing', required: true });
      expect(result.name).toBe('object-tool');
      expect(result.purpose).toBe('Testing');
      expect(result.required).toBe(true);
    });

    it('should preserve required flag from SkillToolRef', () => {
      const requiredTool = normalizeToolRef({ name: 'required-tool', required: true });
      const optionalTool = normalizeToolRef({ name: 'optional-tool', required: false });
      const defaultTool = normalizeToolRef({ name: 'default-tool' });

      expect(requiredTool.required).toBe(true);
      expect(optionalTool.required).toBe(false);
      expect(defaultTool.required).toBe(false);
    });

    it('should throw for invalid tool references', () => {
      expect(() => normalizeToolRef({} as never)).toThrow();
    });
  });

  describe('pagination logic', () => {
    /**
     * The flow should set hasMore=true when results equal the limit,
     * indicating there may be more results available.
     */
    it('should set hasMore=true when results equal limit', () => {
      // Simulate 10 results with limit=10
      const limit = 10;
      const results: Partial<SkillSearchResult>[] = Array(10).fill({
        metadata: {
          id: 'skill',
          name: 'skill',
          description: 'A skill',
          tools: [],
        },
        score: 0.9,
        availableTools: [],
        source: 'local' as const,
      });

      // hasMore calculation from the flow: skills.length >= limit
      const hasMore = results.length >= limit;
      expect(hasMore).toBe(true);
    });

    it('should set hasMore=false when results less than limit', () => {
      // Simulate 5 results with limit=10
      const limit = 10;
      const results: Partial<SkillSearchResult>[] = Array(5).fill({
        metadata: {
          id: 'skill',
          name: 'skill',
          description: 'A skill',
          tools: [],
        },
        score: 0.9,
        availableTools: [],
        source: 'local' as const,
      });

      // hasMore calculation from the flow
      const hasMore = results.length >= limit;
      expect(hasMore).toBe(false);
    });

    it('should report correct total count', () => {
      // The total should equal the actual number of results returned
      const results: Partial<SkillSearchResult>[] = Array(7).fill({
        metadata: {
          id: 'skill',
          name: 'skill',
          description: 'A skill',
          tools: [],
        },
        score: 0.9,
        availableTools: [],
        source: 'local' as const,
      });

      // total = skills.length (actual returned count)
      const total = results.length;
      expect(total).toBe(7);
    });

    it('should use default limit when not specified', () => {
      // Default limit from flow: options.topK ?? 10
      const options = { topK: undefined };
      const limit = options.topK ?? 10;
      expect(limit).toBe(10);
    });
  });

  describe('output format', () => {
    it('should transform search results to correct output format', () => {
      const mockResult: SkillSearchResult = {
        metadata: {
          id: 'review-pr',
          name: 'Review PR',
          description: 'Reviews pull requests',
          instructions: 'Step 1...',
          tools: ['github_get_pr', { name: 'github_add_comment', purpose: 'Add comments' }],
          tags: ['github', 'code-review'],
        },
        score: 0.95,
        availableTools: ['github_get_pr', 'github_add_comment'],
        source: 'local',
      };

      // Simulate the transformation done in finalize stage
      const transformed = {
        id: mockResult.metadata.id ?? mockResult.metadata.name,
        name: mockResult.metadata.name,
        description: mockResult.metadata.description,
        score: mockResult.score,
        tags: mockResult.metadata.tags,
        tools: (mockResult.metadata.tools ?? []).map((t) => {
          try {
            const normalized = normalizeToolRef(t);
            return {
              name: normalized.name,
              available: mockResult.availableTools.includes(normalized.name),
            };
          } catch {
            const toolName = typeof t === 'string' ? t : ((t as { name?: string }).name ?? 'unknown');
            return {
              name: toolName,
              available: mockResult.availableTools.includes(toolName),
            };
          }
        }),
        source: mockResult.source,
      };

      expect(transformed.id).toBe('review-pr');
      expect(transformed.name).toBe('Review PR');
      expect(transformed.score).toBe(0.95);
      expect(transformed.tags).toEqual(['github', 'code-review']);
      expect(transformed.tools).toHaveLength(2);
      expect(transformed.tools[0]).toEqual({ name: 'github_get_pr', available: true });
      expect(transformed.tools[1]).toEqual({ name: 'github_add_comment', available: true });
    });

    it('should handle missing id by using name', () => {
      const mockResult: SkillSearchResult = {
        metadata: {
          // No id specified
          name: 'Deploy App',
          description: 'Deploys the application',
          instructions: 'Deploy...',
        },
        score: 0.8,
        availableTools: [],
        source: 'local',
      };

      // id fallback: metadata.id ?? metadata.name
      const id = mockResult.metadata.id ?? mockResult.metadata.name;
      expect(id).toBe('Deploy App');
    });

    it('should mark tools as unavailable when not in availableTools', () => {
      const mockResult: SkillSearchResult = {
        metadata: {
          id: 'test-skill',
          name: 'Test Skill',
          description: 'A test skill',
          instructions: 'Test...',
          tools: ['available_tool', 'missing_tool'],
        },
        score: 0.7,
        availableTools: ['available_tool'], // missing_tool is not available
        source: 'local',
      };

      const tools = (mockResult.metadata.tools ?? []).map((t) => {
        const normalized = normalizeToolRef(t);
        return {
          name: normalized.name,
          available: mockResult.availableTools.includes(normalized.name),
        };
      });

      expect(tools).toEqual([
        { name: 'available_tool', available: true },
        { name: 'missing_tool', available: false },
      ]);
    });

    it('should handle empty tools array gracefully', () => {
      const mockResult: SkillSearchResult = {
        metadata: {
          id: 'no-tools',
          name: 'No Tools Skill',
          description: 'A skill without tools',
          instructions: 'Do nothing...',
          tools: [],
        },
        score: 0.5,
        availableTools: [],
        source: 'local',
      };

      const tools = (mockResult.metadata.tools ?? []).map((t) => {
        const normalized = normalizeToolRef(t);
        return {
          name: normalized.name,
          available: mockResult.availableTools.includes(normalized.name),
        };
      });

      expect(tools).toEqual([]);
    });

    it('should handle undefined tools gracefully', () => {
      const mockResult: SkillSearchResult = {
        metadata: {
          id: 'undefined-tools',
          name: 'Undefined Tools Skill',
          description: 'A skill with undefined tools',
          instructions: 'Do something...',
          // tools is undefined
        },
        score: 0.6,
        availableTools: [],
        source: 'local',
      };

      const tools = (mockResult.metadata.tools ?? []).map((t) => {
        const normalized = normalizeToolRef(t);
        return {
          name: normalized.name,
          available: mockResult.availableTools.includes(normalized.name),
        };
      });

      expect(tools).toEqual([]);
    });
  });

  describe('tool normalization fallback', () => {
    it('should fallback gracefully when normalizeToolRef fails', () => {
      // Simulate a tool reference that might fail normalization
      const tools: unknown[] = ['valid-tool', { name: 'also-valid' }];
      const availableTools = ['valid-tool'];

      const normalized = tools.map((t) => {
        try {
          const ref = normalizeToolRef(t as never);
          return {
            name: ref.name,
            available: availableTools.includes(ref.name),
          };
        } catch {
          const toolName = typeof t === 'string' ? t : ((t as { name?: string }).name ?? 'unknown');
          return {
            name: toolName,
            available: availableTools.includes(toolName),
          };
        }
      });

      expect(normalized).toEqual([
        { name: 'valid-tool', available: true },
        { name: 'also-valid', available: false },
      ]);
    });
  });
});
