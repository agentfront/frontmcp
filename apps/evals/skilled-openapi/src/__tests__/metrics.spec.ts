import { measureTask, totalMetrics } from '../metrics';
import { NO_USAGE } from '../model';
import type { TaskTranscript, ToolCallRecord } from '../run-task';

function call(name: string, structuredContent?: Record<string, unknown>, isError = false): ToolCallRecord {
  return { name, input: {}, text: '', isError, structuredContent, durationMs: 5 };
}

const loaded = (skillId: string) => call('load_skill', { skill: { id: skillId } });

function transcript(toolCalls: ToolCallRecord[], overrides: Partial<TaskTranscript> = {}): TaskTranscript {
  return {
    answer: 'done',
    stopReason: 'end_turn',
    turns: toolCalls.length + 1,
    toolCalls,
    usage: { inputTokens: 100, outputTokens: 20, cacheReadInputTokens: 300, cacheCreationInputTokens: 50 },
    latencyMs: 1_000,
    ...overrides,
  };
}

describe('measureTask', () => {
  it('counts the calls by tool and shows their order, a repeat back to back once', () => {
    const metrics = measureTask(
      transcript([call('search_skill'), loaded('invoices'), call('execute_action'), call('execute_action')]),
    );

    expect(metrics).toMatchObject({
      toolCalls: 4,
      toolCallsByName: { search_skill: 1, load_skill: 1, execute_action: 2 },
      flow: ['search_skill', 'load_skill', 'execute_action'],
      searched: true,
      actedBeforeLoading: false,
      reloadedSkills: [],
      turns: 5,
      latencyMs: 1_000,
    });
  });

  it('reports an action run before any skill was loaded', () => {
    expect(measureTask(transcript([call('run_workflow'), loaded('reports')])).actedBeforeLoading).toBe(true);
    expect(measureTask(transcript([call('execute_action')])).actedBeforeLoading).toBe(true);
  });

  it('does not report acting before loading when the model ran no action', () => {
    expect(measureTask(transcript([loaded('reports')]))).toMatchObject({ actedBeforeLoading: false, searched: false });
    expect(measureTask(transcript([]))).toMatchObject({ toolCalls: 0, flow: [], actedBeforeLoading: false });
  });

  it('finds a skill loaded twice, by skillId or within skillIds', () => {
    const twice = measureTask(
      transcript([
        loaded('invoices'),
        call('load_skill', { skills: [{ skill: { id: 'reports' } }, { skill: { id: 'invoices' } }] }),
        loaded('reports'),
      ]),
    );

    expect(twice.reloadedSkills).toEqual(['invoices', 'reports']);
  });

  it('does not count a failed load, or a result that names no skill, as a load', () => {
    const metrics = measureTask(
      transcript([
        call('load_skill', { skill: { id: 'invoices' } }, true),
        call('load_skill'),
        call('load_skill', { skills: ['invoices', { skill: { name: 'no id' } }] }),
        loaded('invoices'),
      ]),
    );

    expect(metrics.reloadedSkills).toEqual([]);
  });
});

describe('totalMetrics', () => {
  it('adds up the tasks, their tool calls, tokens and time', () => {
    const searched = measureTask(transcript([call('search_skill'), loaded('reports'), call('execute_action')]));
    const careless = measureTask(transcript([call('execute_action'), loaded('invoices'), loaded('invoices')]));

    const totals = totalMetrics([
      { check: { passed: true, failed: [] }, metrics: searched },
      { check: { passed: false, failed: ['the answer says the invoice is open'] }, metrics: careless },
    ]);

    expect(totals).toEqual({
      tasks: 2,
      passed: 1,
      toolCalls: 6,
      toolCallsByName: { search_skill: 1, load_skill: 3, execute_action: 2 },
      tasksThatSearched: 1,
      tasksThatActedBeforeLoading: 1,
      tasksThatReloadedASkill: 1,
      turns: 8,
      usage: { inputTokens: 200, outputTokens: 40, cacheReadInputTokens: 600, cacheCreationInputTokens: 100 },
      latencyMs: 2_000,
    });
  });

  it('is all zeros for no tasks', () => {
    expect(totalMetrics([])).toMatchObject({ tasks: 0, passed: 0, toolCalls: 0, toolCallsByName: {}, usage: NO_USAGE });
  });
});
