import { analyzeScript } from '@enclave-vm/core/worker';

import { codeCallReviewRulesSchema, type CodeCallReviewRules } from '../codecall.types';
import { ReviewRules, type ReviewedTool } from '../review/review-rules';

const TOOLS: Record<string, ReviewedTool> = {
  'users.list': {
    name: 'users.list',
    annotations: { readOnlyHint: true },
    inputSchema: { type: 'object', properties: { limit: { type: 'number' } } },
  },
  'users.close': {
    name: 'users.close',
    annotations: { destructiveHint: true },
    inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
  },
  'mail.send': { name: 'mail.send', annotations: { openWorldHint: true }, inputSchema: null },
};

function rulesWith(rules: Partial<CodeCallReviewRules> = {}, hasApprovalChannel = true): ReviewRules {
  return new ReviewRules({
    rules: codeCallReviewRulesSchema.parse(rules),
    toolOf: (name) => TOOLS[name],
    hasApprovalChannel,
  });
}

const READ_THEN_SEND =
  "const page = await callTool('users.list', { limit: 1 });\nreturn await callTool('mail.send', { to: page.items[0].email });";
const FAN_OUT =
  "const page = await callTool('users.list', {});\nfor (const user of page.items) {\n  await callTool('mail.send', { to: 'a' });\n}";

describe('ReviewRules on a script', () => {
  it('allows a script that keeps to its tools and their schemas', () => {
    expect(rulesWith().reviewScript(analyzeScript("return await callTool('users.list', { limit: 5 });"))).toEqual({
      approvalCalls: [],
    });
  });

  it('denies every tool the script may not reach, each in its place', () => {
    const verdict = rulesWith().reviewScript(
      analyzeScript("await callTool('admin.purge', {});\nawait callTool('admin.wipe', {});\nreturn 1;"),
    );

    expect(verdict.refusal).toEqual({
      decision: 'denied',
      reason: 'Tool "admin.purge" is not available to this script; Tool "admin.wipe" is not available to this script',
      findings: [
        expect.objectContaining({
          rule: 'unavailable-tool',
          toolName: 'admin.purge',
          location: { line: 1, column: 6 },
        }),
        expect.objectContaining({ rule: 'unavailable-tool', toolName: 'admin.wipe', location: { line: 2, column: 6 } }),
      ],
    });
  });

  it('skips unavailable tools with availability off, and checks no schema it cannot read', () => {
    const verdict = rulesWith({ availability: false }).reviewScript(
      analyzeScript("return await callTool('admin.purge', { limit: 'x' });"),
    );

    expect(verdict).toEqual({ approvalCalls: [] });
  });

  it('denies a destructive call when nobody can approve it', () => {
    const verdict = rulesWith({}, false).reviewScript(
      analyzeScript("return await callTool('users.close', { id: 'u1' });"),
    );

    expect(verdict.refusal).toMatchObject({ decision: 'denied', findings: [{ rule: 'destructive-tool' }] });
    expect(verdict.refusal?.decision === 'denied' && verdict.refusal.reason).toContain('nobody can approve it here');
  });

  it('asks for approval of a destructive call written with literal arguments only', () => {
    expect(
      rulesWith().reviewScript(analyzeScript("return await callTool('users.close', { id: 'u1' });")).approvalCalls,
    ).toEqual([{ toolName: 'users.close', args: { id: 'u1' } }]);
    expect(
      rulesWith().reviewScript(analyzeScript("const id = 'u1';\nreturn await callTool('users.close', { id });"))
        .approvalCalls,
    ).toEqual([]);
  });

  it('leaves destructive tools to run without approval when the rule is off', () => {
    const rules = rulesWith({ destructive: false }, false);

    expect(rules.reviewScript(analyzeScript("return await callTool('users.close', { id: 'u1' });"))).toEqual({
      approvalCalls: [],
    });
  });

  it('asks for changes to literal arguments, and to a missing required one', () => {
    const verdict = rulesWith().reviewScript(
      analyzeScript("await callTool('users.list', { limit: '5' });\nreturn await callTool('users.close', {});"),
    );

    expect(verdict.refusal).toEqual({
      decision: 'needs_changes',
      findings: [
        expect.objectContaining({ rule: 'input-schema', suggestion: 'limit: 5', location: { line: 1, column: 6 } }),
        expect.objectContaining({ rule: 'input-schema', message: 'users.close: "id" is required' }),
      ],
    });
    expect(
      rulesWith({ inputSchema: false }).reviewScript(
        analyzeScript("return await callTool('users.list', { limit: '5' });"),
      ),
    ).toEqual({
      approvalCalls: [],
    });
  });

  it('asks for changes, or denies by policy, when a read result flows into an open-world tool', () => {
    const analysis = analyzeScript(READ_THEN_SEND);

    expect(rulesWith().reviewScript(analysis).refusal).toMatchObject({
      decision: 'needs_changes',
      findings: [{ rule: 'read-then-send', toolName: 'mail.send', location: { line: 2, column: 13 } }],
    });
    expect(rulesWith({ readThenSend: 'denied' }).reviewScript(analysis).refusal).toMatchObject({
      decision: 'denied',
      reason: 'The result of users.list flows into the arguments of mail.send, which reaches outside this server',
    });
    expect(rulesWith({ readThenSend: false }).reviewScript(analysis)).toEqual({ approvalCalls: [] });
  });

  it('follows no flow from a value of unknown origin or into a tool the script computes', () => {
    const unknownOrigin = "const send = async (to) => callTool('mail.send', { to });\nreturn await send('a');";
    const computedTarget =
      "const page = await callTool('users.list', {});\nconst name = 'mail' + '.send';\nreturn await callTool(name, { to: page.items[0].email });";

    expect(rulesWith().reviewScript(analyzeScript(unknownOrigin))).toEqual({ approvalCalls: [] });
    expect(rulesWith().reviewScript(analyzeScript(computedTarget))).toEqual({ approvalCalls: [] });
  });

  it('asks for a bound on a loop over a tool result, unless the rule is off or the loop is cut', () => {
    expect(rulesWith().reviewScript(analyzeScript(FAN_OUT, { callBudget: 100 })).refusal).toMatchObject({
      decision: 'needs_changes',
      findings: [
        {
          rule: 'fan-out',
          message: 'A loop over the result of users.list calls mail.send with no bound below the call budget',
          location: { line: 2, column: 0 },
        },
      ],
    });
    expect(rulesWith({ fanOut: false }).reviewScript(analyzeScript(FAN_OUT, { callBudget: 100 }))).toEqual({
      approvalCalls: [],
    });
    const cut = FAN_OUT.replace('page.items', 'page.items.slice(0, 5)');
    expect(rulesWith().reviewScript(analyzeScript(cut, { callBudget: 100 }))).toEqual({ approvalCalls: [] });
  });
});

describe('ReviewRules on a call', () => {
  it('denies a tool the caller may not reach', () => {
    expect(rulesWith().reviewCall('admin.purge', {}).refusal).toMatchObject({
      decision: 'denied',
      reason: 'Tool "admin.purge" is not available to this script',
    });
  });

  it('denies a destructive call when nobody can approve it', () => {
    expect(rulesWith({}, false).reviewCall('users.close', { id: 'u1' }).refusal?.decision).toBe('denied');
  });

  it('checks the real arguments, all of them known', () => {
    expect(rulesWith().reviewCall('users.close', 'not an object').refusal).toMatchObject({
      decision: 'needs_changes',
      findings: [{ message: 'users.close: "id" is required' }],
    });
  });

  it('asks for approval of a destructive call with its real arguments, and of nothing else', () => {
    expect(rulesWith().reviewCall('users.close', { id: 'u2' })).toEqual({
      approvalCalls: [{ toolName: 'users.close', args: { id: 'u2' } }],
    });
    expect(rulesWith().reviewCall('users.list', { limit: 1 })).toEqual({ approvalCalls: [] });
  });

  it('asks the tool lookup once per name', () => {
    const toolOf = jest.fn((name: string) => TOOLS[name]);
    const rules = new ReviewRules({ rules: codeCallReviewRulesSchema.parse({}), toolOf, hasApprovalChannel: true });

    rules.reviewCall('users.list', {});
    rules.reviewCall('users.list', {});

    expect(toolOf).toHaveBeenCalledTimes(1);
  });
});

describe('ReviewRules within what Enclave accepts', () => {
  it('keeps at most 100 findings, a reason of 4096 characters and tool names of 128', () => {
    const longName = 'x'.repeat(5000);
    const manyCalls = Array.from({ length: 150 }, (_, index) => `await callTool('admin.${index}', {});`).join('\n');

    const denied = rulesWith().reviewScript(analyzeScript(`${manyCalls}\nreturn 1;`)).refusal;
    const named = rulesWith().reviewCall(longName, {}).refusal;
    const changes = rulesWith().reviewScript(
      analyzeScript(Array.from({ length: 150 }, () => "await callTool('users.list', { limit: 'x' });").join('\n')),
    ).refusal;

    expect(denied?.findings).toHaveLength(100);
    expect(denied?.decision === 'denied' && denied.reason.length).toBeLessThanOrEqual(4096);
    expect(named?.findings[0]?.toolName).toHaveLength(128);
    expect(changes?.findings).toHaveLength(100);
  });
});
