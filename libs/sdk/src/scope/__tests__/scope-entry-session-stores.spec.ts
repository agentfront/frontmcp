import 'reflect-metadata';

import { FrontMcpInstance } from '../../front-mcp/front-mcp';
import { App, LogLevel, Skill, SkillContext, type FrontMcpConfigInput, type ScopeEntry } from '../../index';
import { SkillSessionManager } from '../../skill/session/skill-session.manager';
import { MemoryEventStore } from '../../transport/event-stores';
import { type Scope } from '../scope.instance';

@Skill({ name: 'triage', description: 'Triage support tickets', instructions: 'Read tickets only.' })
class TriageSkill extends SkillContext {}

@App({ name: 'Desk', skills: [TriageSkill] })
class DeskApp {}

@App({ name: 'Notes' })
class NotesApp {}

const openScopes: ScopeEntry[] = [];

async function primaryScopeOf(config: FrontMcpConfigInput): Promise<ScopeEntry> {
  const scope = (await FrontMcpInstance.createForGraph(config)).getPrimaryScope();
  if (!scope) {
    throw new Error('the server must have a primary scope');
  }
  openScopes.push(scope);
  return scope;
}

afterAll(async () => {
  await Promise.all(openScopes.map((scope) => (scope as Scope).shutdown()));
});

describe('ScopeEntry skillSession and eventStore', () => {
  it('reach the skill session manager and the event store when they are configured', async () => {
    const scope = await primaryScopeOf({
      info: { name: 'scope-session-stores', version: '1.0.0' },
      apps: [DeskApp],
      transport: { eventStore: { enabled: true } },
      logging: { level: LogLevel.Off },
    });

    expect(scope.skillSession).toBeInstanceOf(SkillSessionManager);
    expect(scope.eventStore).toBeInstanceOf(MemoryEventStore);
  });

  it('are undefined without skills or an enabled event store', async () => {
    const scope = await primaryScopeOf({
      info: { name: 'scope-without-session-stores', version: '1.0.0' },
      apps: [NotesApp],
      logging: { level: LogLevel.Off },
    });

    expect({ skillSession: scope.skillSession, eventStore: scope.eventStore }).toEqual({
      skillSession: undefined,
      eventStore: undefined,
    });
  });

  it('are typed as possibly undefined', () => {
    const readAllowlist = (scope: ScopeEntry) =>
      // @ts-expect-error -- `skillSession` is undefined when the scope has no skills
      scope.skillSession.getToolAllowlist();
    const storeEvent = (scope: ScopeEntry) =>
      // @ts-expect-error -- `eventStore` is undefined unless it is enabled
      scope.eventStore.storeEvent('stream-1', {});

    expect([typeof readAllowlist, typeof storeEvent]).toEqual(['function', 'function']);
  });
});
