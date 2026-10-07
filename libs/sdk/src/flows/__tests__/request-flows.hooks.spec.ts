/**
 * `logging/setLevel`, `resources/subscribe`, `resources/unsubscribe`, `skills/search` and `skills/load` are answered by
 * their flows, so hooks on those flows run for every client request, as they do for `tools/call`.
 */
import 'reflect-metadata';

import { type ReadResourceResult } from '@frontmcp/protocol';

import { App, FlowHooksOf, LogLevel, Plugin, Resource, ResourceContext, Skill, SkillContext } from '../../common';
import { connect } from '../../direct/connect';

const started: string[] = [];

const SetLevelHook = FlowHooksOf('logging:set-level');
const SubscribeHook = FlowHooksOf('resources:subscribe');
const UnsubscribeHook = FlowHooksOf('resources:unsubscribe');
const SearchSkillsHook = FlowHooksOf('skills:search');
const LoadSkillsHook = FlowHooksOf('skills:load');

@Plugin({ name: 'request-flow-log' })
class RequestFlowLogPlugin {
  @SetLevelHook.Will('setLevel')
  setLevel() {
    started.push('logging:set-level');
  }

  @SubscribeHook.Will('subscribe')
  subscribe() {
    started.push('resources:subscribe');
  }

  @UnsubscribeHook.Will('unsubscribe')
  unsubscribe() {
    started.push('resources:unsubscribe');
  }

  @SearchSkillsHook.Did('search')
  search() {
    started.push('skills:search');
  }

  @LoadSkillsHook.Will('loadSkills')
  load() {
    started.push('skills:load');
  }
}

@Resource({ name: 'queue', uri: 'tickets://queue' })
class QueueResource extends ResourceContext {
  async execute(uri: string): Promise<ReadResourceResult> {
    return { contents: [{ uri, text: '[]' }] };
  }
}

@Skill({ name: 'triage', description: 'Triage new tickets', instructions: 'Read the queue, then assign.' })
class TriageSkill extends SkillContext {}

@App({ id: 'desk', name: 'Desk', plugins: [RequestFlowLogPlugin], resources: [QueueResource], skills: [TriageSkill] })
class DeskApp {}

describe('request flows', () => {
  it('run the hooks of each flow a client request names', async () => {
    const client = await connect({
      info: { name: 'request-flows', version: '1.0.0' },
      apps: [DeskApp],
      logging: { level: LogLevel.Off },
      skillsConfig: { enabled: true },
    });

    await client.setLogLevel('info');
    await client.subscribeResource('tickets://queue');
    await client.unsubscribeResource('tickets://queue');
    const search = await client.searchSkills('triage');
    const load = await client.loadSkills(['triage']);
    await client.close();

    expect(started).toEqual([
      'logging:set-level',
      'resources:subscribe',
      'resources:unsubscribe',
      'skills:search',
      'skills:load',
    ]);
    expect(search.skills.map((skill) => skill.name)).toEqual(['triage']);
    expect(load.skills.map((skill) => skill.instructions)).toEqual(['Read the queue, then assign.']);
  });
});
