import type { CallToolResult } from '@frontmcp/protocol';

import {
  annotationsForClient,
  callerClientName,
  resolveClientProfile,
  shapeToolAnswer,
  summarizeStructuredContent,
} from '../client-profile';

describe('client profiles', () => {
  describe('resolveClientProfile', () => {
    const clients = {
      'claude-code': { structured: 'only' as const },
      'codex*': { structured: 'text' as const },
      '*': { annotations: 'no-numbers' as const },
    };

    it('picks the first glob that matches the client name, without regard to case', () => {
      expect(resolveClientProfile(clients, 'codex-mcp-client')).toEqual({ structured: 'text' });
      expect(resolveClientProfile(clients, 'Codex')).toEqual({ structured: 'text' });
      expect(resolveClientProfile(clients, 'claude-code')).toEqual({ structured: 'only' });
      expect(resolveClientProfile(clients, 'cursor-vscode')).toEqual({ annotations: 'no-numbers' });
    });

    it('is undefined without profiles, a client name or a match', () => {
      expect(resolveClientProfile(undefined, 'codex')).toBeUndefined();
      expect(resolveClientProfile(clients, undefined)).toBeUndefined();
      expect(resolveClientProfile({ 'codex*': { structured: 'text' } }, 'cursor')).toBeUndefined();
    });

    it('matches no profile for a client name over 256 characters, so a long name cannot stall the glob', () => {
      expect(resolveClientProfile({ '*a*b*': { structured: 'text' } }, `${'a'.repeat(256)}b`)).toBeUndefined();
      expect(resolveClientProfile({ '*a*b*': { structured: 'text' } }, `${'a'.repeat(255)}b`)).toEqual({
        structured: 'text',
      });
    });
  });

  describe('callerClientName', () => {
    it('prefers the request, then the session payload, then the notification service', () => {
      const notifications = { getClientInfo: (sessionId: string) => ({ name: `from-${sessionId}`, version: '1' }) };
      expect(
        callerClientName({
          context: { clientInfo: { name: 'per-request' } },
          authInfo: { sessionId: 's' },
          notifications,
        }),
      ).toBe('per-request');
      expect(
        callerClientName({ authInfo: { sessionId: 's', sessionIdPayload: { clientName: 'payload' } }, notifications }),
      ).toBe('payload');
      expect(callerClientName({ authInfo: { sessionId: 's' }, notifications })).toBe('from-s');
      expect(callerClientName({})).toBeUndefined();
    });
  });

  describe('summarizeStructuredContent', () => {
    it('describes each key on one line', () => {
      expect(
        summarizeStructuredContent({
          items: [1, 2, 3],
          one: [1],
          total: 3,
          ok: true,
          status: 'done',
          body: 'b'.repeat(100),
          meta: { a: 1, b: 2 },
          none: null,
        }),
      ).toBe(
        'The answer is in structuredContent: items (3 items), one (1 item), total: 3, ok: true, status: "done", body (100 characters), meta (2 keys), none: null.',
      );
    });

    it('names at most 12 keys', () => {
      const summary = summarizeStructuredContent(
        Object.fromEntries(Array.from({ length: 15 }, (_, index) => [`k${index}`, index])),
      );
      expect(summary).toContain('k11: 11, 3 more keys.');
      expect(summary).not.toContain('\n');
    });

    it('says so for an empty object', () => {
      expect(summarizeStructuredContent({})).toBe('The answer is in structuredContent.');
    });
  });

  describe('shapeToolAnswer', () => {
    const structuredContent = { items: [1, 2], total: 2 };
    const answer: CallToolResult = {
      content: [
        { type: 'text', text: JSON.stringify(structuredContent) },
        { type: 'text', text: 'note' },
      ],
      structuredContent,
    };

    it('leaves the answer alone with both', () => {
      expect(shapeToolAnswer(answer, 'both', true)).toBeUndefined();
    });

    it('replaces the text that repeats structuredContent with a summary with only', () => {
      expect(shapeToolAnswer(answer, 'only', true)).toEqual({
        content: [
          { type: 'text', text: 'The answer is in structuredContent: items (2 items), total: 2.' },
          { type: 'text', text: 'note' },
        ],
        structuredContent,
      });
    });

    it('answers as with both when the client was not told the output schema, or the answer is an error', () => {
      expect(shapeToolAnswer(answer, 'only', false)).toBeUndefined();
      expect(shapeToolAnswer({ ...answer, isError: true }, 'only', true)).toBeUndefined();
      expect(shapeToolAnswer({ content: [] }, 'only', true)).toBeUndefined();
    });

    it('drops structuredContent with text', () => {
      expect(shapeToolAnswer(answer, 'text', true)).toEqual({ content: answer.content });
      expect(shapeToolAnswer({ content: [] }, 'text', true)).toBeUndefined();
    });
  });

  describe('annotationsForClient', () => {
    const skillAnnotations = { audience: ['assistant' as const], lastModified: '2026-01-01T00:00:00Z' };

    it('keeps annotations without a mode', () => {
      expect(annotationsForClient({ priority: 0.5 }, undefined, false)).toEqual({ priority: 0.5 });
    });

    it('drops priority with no-numbers', () => {
      expect(annotationsForClient({ audience: ['user'], priority: 0.5 }, 'no-numbers', false)).toEqual({
        audience: ['user'],
      });
      expect(annotationsForClient({ priority: 0.5 }, 'no-numbers', false)).toBeUndefined();
    });

    it('gives a SKILL.md its full annotations with full', () => {
      expect(annotationsForClient(skillAnnotations, 'full', true)).toEqual({ ...skillAnnotations, priority: 0.8 });
      expect(annotationsForClient(undefined, 'full', true)).toEqual({ audience: ['assistant'], priority: 0.8 });
      expect(annotationsForClient({ priority: 0.2 }, 'full', false)).toEqual({ priority: 0.2 });
    });
  });
});
