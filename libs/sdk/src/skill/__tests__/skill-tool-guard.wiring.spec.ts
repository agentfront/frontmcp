import 'reflect-metadata';

import {
  createTestFetchServer,
  rpc20260728,
  type TestFetchServer,
} from '../../__test-utils__/helpers/mcp-20260728.helpers';
import { App, Skill, SkillContext, Tool, ToolContext } from '../../common';
import { type Scope } from '../../scope';
import { type SkillContent, type SkillLoadResult } from '../index';

const executed: string[] = [];

@Tool({ name: 'read_ticket', inputSchema: {} })
class ReadTicketTool extends ToolContext {
  async execute() {
    executed.push('read_ticket');
    return { ok: true };
  }
}

@Tool({ name: 'delete_ticket', inputSchema: {} })
class DeleteTicketTool extends ToolContext {
  async execute() {
    executed.push('delete_ticket');
    return { ok: true };
  }
}

@Skill({ name: 'triage', description: 'Triage support tickets', instructions: 'Read tickets only.' })
class TriageSkill extends SkillContext {}

@App({ id: 'desk', name: 'Desk', tools: [ReadTicketTool, DeleteTicketTool], skills: [TriageSkill] })
class DeskApp {}

const triageContent: SkillContent = {
  id: 'triage',
  name: 'triage',
  description: 'Triage support tickets',
  instructions: 'Read tickets only.',
  tools: [{ name: 'read_ticket', purpose: 'Read a ticket' }],
};

const triageLoadResult: SkillLoadResult = {
  skill: triageContent,
  availableTools: ['read_ticket'],
  missingTools: [],
  isComplete: true,
};

describe('skill tool guard on tools/call', () => {
  let server: TestFetchServer;

  beforeAll(async () => {
    server = await createTestFetchServer({ info: { name: 'skill-guard', version: '1.0.0' }, apps: [DeskApp] });
  });

  async function callInStrictTriageSession(toolName: string) {
    const sessionManager = (server.instance.getScopes()[0] as Scope).skillSession;
    if (!sessionManager) {
      throw new Error('the scope has skills, so it must have a skill session manager');
    }
    executed.length = 0;
    return sessionManager.runWithSession('triage-session', async () => {
      sessionManager.activateSkill('triage', triageContent, triageLoadResult, { policyMode: 'strict' });
      const { message } = await rpc20260728(server.handler, 'tools/call', { name: toolName, arguments: {} });
      return message;
    });
  }

  it('refuses a tool the active skill does not list', async () => {
    const message = await callInStrictTriageSession('delete_ticket');

    expect(message.error ?? message.result?.['isError']).toBeTruthy();
    expect(executed).toEqual([]);
  });

  it('runs a tool the active skill lists', async () => {
    const message = await callInStrictTriageSession('read_ticket');

    expect(message.result?.['isError']).toBeFalsy();
    expect(executed).toEqual(['read_ticket']);
  });
});
