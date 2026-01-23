// file: libs/sdk/src/skill/__tests__/skill-session.spec.ts

import {
  SkillSessionManager,
  MemorySkillSessionStore,
  SkillSessionState,
  createEmptySessionState,
  serializeSessionState,
  deserializeSessionState,
} from '../session';
import type { SkillContent } from '../../common/interfaces';
import type { SkillLoadResult } from '../skill-storage.interface';

describe('SkillSessionManager', () => {
  let manager: SkillSessionManager;
  let store: MemorySkillSessionStore;

  beforeEach(() => {
    store = new MemorySkillSessionStore();
    manager = new SkillSessionManager({ defaultPolicyMode: 'permissive' }, undefined, store);
  });

  const mockSkillContent: SkillContent = {
    id: 'test-skill',
    name: 'Test Skill',
    description: 'A test skill',
    instructions: 'Do something',
    tools: [
      { name: 'tool_a', purpose: 'Purpose A' },
      { name: 'tool_b', purpose: 'Purpose B' },
    ],
  };

  const mockLoadResult: SkillLoadResult = {
    skill: mockSkillContent,
    availableTools: ['tool_a', 'tool_b'],
    missingTools: [],
    isComplete: true,
  };

  describe('runWithSession', () => {
    it('should create a session context', async () => {
      await manager.runWithSession('session-1', async () => {
        const session = manager.getActiveSession();
        expect(session).toBeDefined();
        expect(session?.sessionId).toBe('session-1');
      });
    });

    it('should isolate sessions', async () => {
      let session1Id: string | undefined;
      let session2Id: string | undefined;

      await manager.runWithSession('session-1', async () => {
        session1Id = manager.getActiveSession()?.sessionId;
      });

      await manager.runWithSession('session-2', async () => {
        session2Id = manager.getActiveSession()?.sessionId;
      });

      expect(session1Id).toBe('session-1');
      expect(session2Id).toBe('session-2');
    });

    it('should return undefined when not in session context', () => {
      expect(manager.getActiveSession()).toBeUndefined();
    });
  });

  describe('activateSkill', () => {
    it('should activate a skill and set up tool allowlist', async () => {
      await manager.runWithSession('session-1', async () => {
        const result = manager.activateSkill('test-skill', mockSkillContent, mockLoadResult);

        expect(result.session.activeSkillId).toBe('test-skill');
        expect(result.session.activeSkillName).toBe('Test Skill');
        expect(result.session.allowedTools.has('tool_a')).toBe(true);
        expect(result.session.allowedTools.has('tool_b')).toBe(true);
        expect(result.availableTools).toEqual(['tool_a', 'tool_b']);
        expect(result.isComplete).toBe(true);
      });
    });

    it('should throw when not in session context', () => {
      expect(() => {
        manager.activateSkill('test-skill', mockSkillContent, mockLoadResult);
      }).toThrow('not running within a session context');
    });

    it('should support multiple skills with combined toolsets', async () => {
      const anotherSkill: SkillContent = {
        ...mockSkillContent,
        id: 'another-skill',
        name: 'Another Skill',
        tools: [{ name: 'tool_c' }],
      };

      await manager.runWithSession('session-1', async () => {
        manager.activateSkill('test-skill', mockSkillContent, mockLoadResult);
        expect(manager.getActiveSession()?.activeSkillId).toBe('test-skill');
        expect(manager.getActiveSkillCount()).toBe(1);

        manager.activateSkill('another-skill', anotherSkill, {
          ...mockLoadResult,
          skill: anotherSkill,
          availableTools: ['tool_c'],
        });

        const session = manager.getActiveSession();
        // Most recent skill is tracked
        expect(session?.activeSkillId).toBe('another-skill');
        expect(session?.activeSkillName).toBe('Another Skill');
        // Both skills are active
        expect(manager.getActiveSkillCount()).toBe(2);
        // Combined toolset includes tools from both skills
        expect(session?.allowedTools.has('tool_a')).toBe(true);
        expect(session?.allowedTools.has('tool_b')).toBe(true);
        expect(session?.allowedTools.has('tool_c')).toBe(true);
        // All active skill IDs are tracked
        expect(manager.getActiveSkillIds()).toContain('test-skill');
        expect(manager.getActiveSkillIds()).toContain('another-skill');
      });
    });

    it('should allow deactivating a specific skill', async () => {
      const anotherSkill: SkillContent = {
        ...mockSkillContent,
        id: 'another-skill',
        name: 'Another Skill',
        tools: [{ name: 'tool_c' }],
      };

      await manager.runWithSession('session-1', async () => {
        manager.activateSkill('test-skill', mockSkillContent, mockLoadResult);
        manager.activateSkill('another-skill', anotherSkill, {
          ...mockLoadResult,
          skill: anotherSkill,
          availableTools: ['tool_c'],
        });

        expect(manager.getActiveSkillCount()).toBe(2);

        // Deactivate just the first skill
        manager.deactivateSkill('test-skill');

        const session = manager.getActiveSession();
        expect(manager.getActiveSkillCount()).toBe(1);
        expect(session?.allowedTools.has('tool_c')).toBe(true);
        expect(session?.allowedTools.has('tool_a')).toBe(false);
        // Most recent skill pointer updated
        expect(session?.activeSkillId).toBe('another-skill');
      });
    });

    /**
     * Issue #5: Required tool semantics
     *
     * The activateSkill method should extract required tools from skill content
     * and track them in the session state. This enables enforcement of required
     * tool usage during skill execution.
     */
    it('should extract required tools from skill content', async () => {
      const skillWithRequired: SkillContent = {
        id: 'required-tools-skill',
        name: 'Required Tools Skill',
        description: 'A skill with required tools',
        instructions: 'Do something',
        tools: [
          { name: 'tool_a', required: true },
          { name: 'tool_b', required: false },
          { name: 'tool_c' }, // No required field defaults to false
        ],
      };

      const loadResult: SkillLoadResult = {
        skill: skillWithRequired,
        availableTools: ['tool_a', 'tool_b', 'tool_c'],
        missingTools: [],
        isComplete: true,
      };

      await manager.runWithSession('session-1', async () => {
        manager.activateSkill('required-tools-skill', skillWithRequired, loadResult);

        const session = manager.getActiveSession();
        expect(session?.requiredTools.has('tool_a')).toBe(true);
        expect(session?.requiredTools.has('tool_b')).toBe(false);
        expect(session?.requiredTools.has('tool_c')).toBe(false);
        expect(session?.requiredTools.size).toBe(1);
      });
    });

    it('should track required tools per active skill', async () => {
      const firstSkill: SkillContent = {
        id: 'first-skill',
        name: 'First Skill',
        description: 'First skill with required tools',
        instructions: 'Do first thing',
        tools: [{ name: 'tool_a', required: true }],
      };

      const secondSkill: SkillContent = {
        id: 'second-skill',
        name: 'Second Skill',
        description: 'Second skill with required tools',
        instructions: 'Do second thing',
        tools: [
          { name: 'tool_b', required: true },
          { name: 'tool_c', required: true },
        ],
      };

      await manager.runWithSession('session-1', async () => {
        manager.activateSkill('first-skill', firstSkill, {
          skill: firstSkill,
          availableTools: ['tool_a'],
          missingTools: [],
          isComplete: true,
        });

        manager.activateSkill('second-skill', secondSkill, {
          skill: secondSkill,
          availableTools: ['tool_b', 'tool_c'],
          missingTools: [],
          isComplete: true,
        });

        const session = manager.getActiveSession();
        // Combined required tools from both skills
        expect(session?.requiredTools.has('tool_a')).toBe(true);
        expect(session?.requiredTools.has('tool_b')).toBe(true);
        expect(session?.requiredTools.has('tool_c')).toBe(true);
        expect(session?.requiredTools.size).toBe(3);
      });
    });

    it('should clear required tools when skill is deactivated', async () => {
      const skillWithRequired: SkillContent = {
        id: 'required-skill',
        name: 'Required Skill',
        description: 'A skill with required tools',
        instructions: 'Do something',
        tools: [{ name: 'tool_a', required: true }],
      };

      await manager.runWithSession('session-1', async () => {
        manager.activateSkill('required-skill', skillWithRequired, {
          skill: skillWithRequired,
          availableTools: ['tool_a'],
          missingTools: [],
          isComplete: true,
        });

        expect(manager.getActiveSession()?.requiredTools.size).toBe(1);

        manager.deactivateSkill();

        expect(manager.getActiveSession()?.requiredTools.size).toBe(0);
      });
    });
  });

  describe('deactivateSkill', () => {
    it('should clear skill session state', async () => {
      await manager.runWithSession('session-1', async () => {
        manager.activateSkill('test-skill', mockSkillContent, mockLoadResult);
        expect(manager.hasActiveSkill()).toBe(true);

        manager.deactivateSkill();

        const session = manager.getActiveSession();
        expect(session?.activeSkillId).toBeNull();
        expect(session?.allowedTools.size).toBe(0);
        expect(manager.hasActiveSkill()).toBe(false);
      });
    });

    it('should be safe to call when no skill is active', async () => {
      await manager.runWithSession('session-1', async () => {
        expect(() => manager.deactivateSkill()).not.toThrow();
      });
    });
  });

  describe('checkToolAuthorization', () => {
    describe('permissive mode', () => {
      it('should allow tools in allowlist', async () => {
        await manager.runWithSession('session-1', async () => {
          manager.activateSkill('test-skill', mockSkillContent, mockLoadResult);

          const result = manager.checkToolAuthorization('tool_a');
          expect(result.allowed).toBe(true);
          expect(result.reason).toBe('skill_allowlist');
        });
      });

      it('should allow tools not in allowlist with warning', async () => {
        await manager.runWithSession('session-1', async () => {
          manager.activateSkill('test-skill', mockSkillContent, mockLoadResult);

          const result = manager.checkToolAuthorization('unknown_tool');
          expect(result.allowed).toBe(true);
          expect(result.reason).toBe('not_in_allowlist');
        });
      });
    });

    describe('strict mode', () => {
      beforeEach(() => {
        manager = new SkillSessionManager({ defaultPolicyMode: 'strict' }, undefined, store);
      });

      it('should allow tools in allowlist', async () => {
        await manager.runWithSession('session-1', async () => {
          manager.activateSkill('test-skill', mockSkillContent, mockLoadResult);

          const result = manager.checkToolAuthorization('tool_a');
          expect(result.allowed).toBe(true);
          expect(result.reason).toBe('skill_allowlist');
        });
      });

      it('should deny tools not in allowlist', async () => {
        await manager.runWithSession('session-1', async () => {
          manager.activateSkill('test-skill', mockSkillContent, mockLoadResult);

          const result = manager.checkToolAuthorization('unknown_tool');
          expect(result.allowed).toBe(false);
          expect(result.reason).toBe('not_in_allowlist');
        });
      });
    });

    describe('approval mode', () => {
      beforeEach(() => {
        manager = new SkillSessionManager({ defaultPolicyMode: 'approval' }, undefined, store);
      });

      it('should request approval for tools not in allowlist', async () => {
        await manager.runWithSession('session-1', async () => {
          manager.activateSkill('test-skill', mockSkillContent, mockLoadResult);

          const result = manager.checkToolAuthorization('unknown_tool');
          expect(result.allowed).toBe(false);
          expect(result.reason).toBe('not_in_allowlist');
          expect(result.requiresApproval).toBe(true);
        });
      });

      it('should allow dynamically approved tools', async () => {
        await manager.runWithSession('session-1', async () => {
          manager.activateSkill('test-skill', mockSkillContent, mockLoadResult);
          manager.approveToolForSession('unknown_tool');

          const result = manager.checkToolAuthorization('unknown_tool');
          expect(result.allowed).toBe(true);
          expect(result.reason).toBe('dynamically_approved');
        });
      });
    });

    describe('denied tools', () => {
      it('should deny explicitly denied tools', async () => {
        await manager.runWithSession('session-1', async () => {
          manager.activateSkill('test-skill', mockSkillContent, mockLoadResult);
          manager.denyToolForSession('tool_a');

          const result = manager.checkToolAuthorization('tool_a');
          expect(result.allowed).toBe(false);
          expect(result.reason).toBe('denied');
        });
      });
    });

    describe('no active skill', () => {
      it('should allow all tools when no skill is active', async () => {
        await manager.runWithSession('session-1', async () => {
          const result = manager.checkToolAuthorization('any_tool');
          expect(result.allowed).toBe(true);
          expect(result.reason).toBe('no_active_skill');
        });
      });

      it('should deny when requireExplicitActivation is true', async () => {
        manager = new SkillSessionManager({ requireExplicitActivation: true }, undefined, store);

        // Note: requireExplicitActivation only applies when there's no session context
        const result = manager.checkToolAuthorization('any_tool');
        expect(result.allowed).toBe(false);
        expect(result.reason).toBe('no_active_skill');
      });
    });
  });

  describe('rate limiting', () => {
    beforeEach(() => {
      manager = new SkillSessionManager(
        { maxToolCallsPerSession: 3, defaultPolicyMode: 'permissive' },
        undefined,
        store,
      );
    });

    it('should track tool call count', async () => {
      await manager.runWithSession('session-1', async () => {
        manager.activateSkill('test-skill', mockSkillContent, mockLoadResult);

        manager.recordToolCall('tool_a');
        manager.recordToolCall('tool_a');

        const session = manager.getActiveSession();
        expect(session?.toolCallCount).toBe(2);
      });
    });

    it('should deny when rate limit exceeded', async () => {
      await manager.runWithSession('session-1', async () => {
        manager.activateSkill('test-skill', mockSkillContent, mockLoadResult);

        // Make 3 calls (the limit)
        manager.recordToolCall('tool_a');
        manager.recordToolCall('tool_a');
        manager.recordToolCall('tool_a');

        // 4th call should be denied
        const result = manager.checkToolAuthorization('tool_a');
        expect(result.allowed).toBe(false);
        expect(result.reason).toBe('rate_limited');
      });
    });
  });

  describe('tool allowlist', () => {
    it('should return current allowlist', async () => {
      await manager.runWithSession('session-1', async () => {
        manager.activateSkill('test-skill', mockSkillContent, mockLoadResult);

        const allowlist = manager.getToolAllowlist();
        expect(allowlist).toContain('tool_a');
        expect(allowlist).toContain('tool_b');
        expect(allowlist.length).toBe(2);
      });
    });

    it('should return empty list when no skill active', async () => {
      await manager.runWithSession('session-1', async () => {
        const allowlist = manager.getToolAllowlist();
        expect(allowlist).toEqual([]);
      });
    });
  });

  describe('events', () => {
    it('should emit activated event', async () => {
      const onActivated = jest.fn();
      manager.on('activated', onActivated);

      await manager.runWithSession('session-1', async () => {
        manager.activateSkill('test-skill', mockSkillContent, mockLoadResult);
      });

      expect(onActivated).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'activated',
          sessionId: 'session-1',
          skillId: 'test-skill',
        }),
      );
    });

    it('should emit deactivated event', async () => {
      const onDeactivated = jest.fn();
      manager.on('deactivated', onDeactivated);

      await manager.runWithSession('session-1', async () => {
        manager.activateSkill('test-skill', mockSkillContent, mockLoadResult);
        manager.deactivateSkill();
      });

      expect(onDeactivated).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'deactivated',
          sessionId: 'session-1',
          skillId: 'test-skill',
        }),
      );
    });

    it('should emit tool_approved event', async () => {
      const onApproved = jest.fn();
      manager.on('tool_approved', onApproved);

      await manager.runWithSession('session-1', async () => {
        manager.activateSkill('test-skill', mockSkillContent, mockLoadResult);
        manager.approveToolForSession('new_tool');
      });

      expect(onApproved).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'tool_approved',
          toolName: 'new_tool',
        }),
      );
    });
  });
});

describe('MemorySkillSessionStore', () => {
  let store: MemorySkillSessionStore;

  beforeEach(() => {
    store = new MemorySkillSessionStore();
  });

  const createSession = (id: string): SkillSessionState => ({
    sessionId: id,
    activeSkillId: 'skill-1',
    activeSkillName: 'Skill 1',
    activeSkills: new Map([
      [
        'skill-1',
        {
          id: 'skill-1',
          name: 'Skill 1',
          allowedTools: new Set(['tool_a']),
          requiredTools: new Set(),
          activatedAt: Date.now(),
        },
      ],
    ]),
    allowedTools: new Set(['tool_a']),
    requiredTools: new Set(),
    policyMode: 'permissive',
    startedAt: Date.now(),
    approvedTools: new Set(),
    deniedTools: new Set(),
    toolCallCount: 0,
  });

  it('should save and retrieve session', async () => {
    const session = createSession('session-1');
    await store.save(session);

    const retrieved = await store.get('session-1');
    expect(retrieved).not.toBeNull();
    expect(retrieved?.sessionId).toBe('session-1');
    expect(retrieved?.activeSkillId).toBe('skill-1');
  });

  it('should return null for non-existent session', async () => {
    const retrieved = await store.get('non-existent');
    expect(retrieved).toBeNull();
  });

  it('should update session', async () => {
    const session = createSession('session-1');
    await store.save(session);

    await store.update('session-1', { toolCallCount: 5 });

    const retrieved = await store.get('session-1');
    expect(retrieved?.toolCallCount).toBe(5);
  });

  it('should delete session', async () => {
    const session = createSession('session-1');
    await store.save(session);

    await store.delete('session-1');

    const retrieved = await store.get('session-1');
    expect(retrieved).toBeNull();
  });

  it('should list active sessions', async () => {
    await store.save(createSession('session-1'));
    await store.save(createSession('session-2'));
    await store.save({
      ...createSession('session-3'),
      activeSkillId: null, // Inactive
      activeSkillName: null,
      activeSkills: new Map(), // Empty means no active skills
    });

    const active = await store.listActive();
    expect(active.length).toBe(2);
  });

  it('should limit active sessions list', async () => {
    await store.save(createSession('session-1'));
    await store.save(createSession('session-2'));
    await store.save(createSession('session-3'));

    const active = await store.listActive({ limit: 2 });
    expect(active.length).toBe(2);
  });

  it('should cleanup old sessions', async () => {
    const oldSession = createSession('old-session');
    oldSession.startedAt = Date.now() - 10000; // 10 seconds ago
    await store.save(oldSession);

    const newSession = createSession('new-session');
    newSession.startedAt = Date.now();
    await store.save(newSession);

    const cleaned = await store.cleanup(5000); // 5 second max age
    expect(cleaned).toBe(1);

    expect(await store.get('old-session')).toBeNull();
    expect(await store.get('new-session')).not.toBeNull();
  });

  it('should isolate retrieved sessions from store mutations', async () => {
    const session = createSession('session-1');
    await store.save(session);

    // Retrieve the session and mutate it
    const retrieved = await store.get('session-1');
    expect(retrieved).not.toBeNull();

    // Mutate the retrieved session's Sets and Maps
    retrieved!.allowedTools.add('mutated_tool');
    retrieved!.activeSkills.get('skill-1')!.allowedTools.add('another_mutated');
    retrieved!.approvedTools.add('mutated_approved');
    retrieved!.deniedTools.add('mutated_denied');

    // Get a fresh copy from the store
    const freshRetrieved = await store.get('session-1');

    // Verify the fresh copy is not affected by mutations
    expect(freshRetrieved!.allowedTools.has('mutated_tool')).toBe(false);
    expect(freshRetrieved!.activeSkills.get('skill-1')!.allowedTools.has('another_mutated')).toBe(false);
    expect(freshRetrieved!.approvedTools.has('mutated_approved')).toBe(false);
    expect(freshRetrieved!.deniedTools.has('mutated_denied')).toBe(false);
  });
});

describe('Session Serialization', () => {
  it('should serialize and deserialize session state', () => {
    const now = Date.now();
    const original: SkillSessionState = {
      sessionId: 'session-1',
      activeSkillId: 'skill-1',
      activeSkillName: 'Skill 1',
      activeSkills: new Map([
        [
          'skill-1',
          {
            id: 'skill-1',
            name: 'Skill 1',
            allowedTools: new Set(['tool_a', 'tool_b']),
            requiredTools: new Set(['tool_a']),
            activatedAt: now,
          },
        ],
      ]),
      allowedTools: new Set(['tool_a', 'tool_b']),
      requiredTools: new Set(['tool_a']),
      policyMode: 'strict',
      startedAt: now,
      approvedTools: new Set(['tool_c']),
      deniedTools: new Set(['tool_d']),
      toolCallCount: 5,
      metadata: { key: 'value' },
    };

    const serialized = serializeSessionState(original);
    expect(Array.isArray(serialized.allowedTools)).toBe(true);
    expect(Array.isArray(serialized.activeSkills)).toBe(true);
    expect(serialized.activeSkills.length).toBe(1);
    expect(serialized.activeSkills[0].id).toBe('skill-1');

    const deserialized = deserializeSessionState(serialized);
    expect(deserialized.sessionId).toBe(original.sessionId);
    expect(deserialized.allowedTools instanceof Set).toBe(true);
    expect(deserialized.allowedTools.has('tool_a')).toBe(true);
    expect(deserialized.requiredTools.has('tool_a')).toBe(true);
    expect(deserialized.approvedTools.has('tool_c')).toBe(true);
    expect(deserialized.deniedTools.has('tool_d')).toBe(true);
    // Check activeSkills Map deserialization
    expect(deserialized.activeSkills instanceof Map).toBe(true);
    expect(deserialized.activeSkills.size).toBe(1);
    expect(deserialized.activeSkills.get('skill-1')?.name).toBe('Skill 1');
  });

  it('should create empty session state', () => {
    const state = createEmptySessionState('session-1', { defaultPolicyMode: 'strict' });

    expect(state.sessionId).toBe('session-1');
    expect(state.activeSkillId).toBeNull();
    expect(state.policyMode).toBe('strict');
    expect(state.allowedTools.size).toBe(0);
  });
});
